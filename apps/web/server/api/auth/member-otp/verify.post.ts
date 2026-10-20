import { createHash } from 'node:crypto'
import type { StaffRole } from '@afc/shared'
import {
  MEMBER_OTP_SESSION_HOURS,
  MEMBER_OTP_SESSION_TOKEN,
  hashOtpCode,
  isMemberOtpEnabled,
  memberOtpVerifyGate,
  normalizeMemberPhone,
  otpHashesEqual,
  throwMemberOtpDisabled,
} from '../../../utils/member-otp'
import { directusFetch } from '../../../utils/directus'
import { writeSession } from '../../../utils/session'

interface OtpChallenge {
  id: string
  phone_hash: string
  code_hash: string
  code_salt: string
  requested_at: string
  expires_at: string
  attempt_count: number
  consumed_at: string | null
}

interface PersonRow {
  id: string
}

interface MemberUserRow {
  id: string
  member_person: string | null
  member_access_expires_at: string | null
}

/** Every failure path answers this: the response never says which check failed. */
function throwInvalidCode(): never {
  throw createError({
    statusCode: 401,
    statusMessage: 'That code is not valid',
    data: { code: 'invalid_code' },
  })
}

/**
 * Verify a member OTP code (AFC-482, track d).
 *
 * DISABLED behind the AFC-478 hard gate: answers 503 member_otp_disabled
 * unless NUXT_MEMBER_OTP_ENABLED=true (re-review verdict + CTO approval).
 *
 * Enabled-shape contract (F1 + F2):
 * - Body carries ONLY phone + code. No person, user, or password field is
 *   read (F2: nothing to forge). Wrong codes, expired codes, locked codes,
 *   consumed codes, unknown phones, unlinked numbers, and lapsed
 *   time-boxes all answer the same 401 invalid_code.
 * - Replay is rejected before expiry is checked (single-use); attempts >=
 *   5 invalidate the code and the counter advances on every failed
 *   comparison; comparison is timing-safe on the salted hash.
 * - The session is bound server-side to exactly one member_person taken
 *   from directus_users.member_person (F2), with lifetime <= 8h and
 *   member_access_expires_at carried on the user for the per-request
 *   re-check (F1). No passwords for members; staff MFA is unchanged.
 */
export default defineEventHandler(async (event) => {
  if (!isMemberOtpEnabled(event)) throwMemberOtpDisabled()

  const body = await readBody<Record<string, unknown>>(event)
  const phone = normalizeMemberPhone(body.phone)
  const code = typeof body.code === 'string' ? body.code.trim() : ''
  if (!phone || !/^\d{6}$/.test(code)) throwInvalidCode()

  const phoneHash = createHash('sha256').update(phone).digest('hex')

  let challenges: OtpChallenge[] = []
  try {
    const found = await directusFetch<{ data: OtpChallenge[] }>(
      event,
      '/items/member_otp_codes',
      {
        query: {
          filter: JSON.stringify({ phone_hash: { _eq: phoneHash } }),
          sort: '-requested_at',
          limit: 1,
          fields:
            'id,phone_hash,code_hash,code_salt,requested_at,expires_at,attempt_count,consumed_at',
        },
      },
    )
    challenges = found.data ?? []
  } catch {
    throwInvalidCode()
  }

  const challenge = challenges[0]
  if (!challenge) throwInvalidCode()

  const now = Date.now()
  const gate = memberOtpVerifyGate(
    challenge.consumed_at !== null,
    now >= Date.parse(challenge.expires_at),
    challenge.attempt_count,
  )
  if (!gate.allowed) throwInvalidCode()

  if (!otpHashesEqual(hashOtpCode(code, challenge.code_salt), challenge.code_hash)) {
    try {
      await directusFetch(event, `/items/member_otp_codes/${challenge.id}`, {
        method: 'PATCH',
        body: { attempt_count: challenge.attempt_count + 1 },
      })
    } catch {
      // Counter write failing must not change the response shape.
    }
    throwInvalidCode()
  }

  // Single-use: consume before issuing anything, so a replay racing this
  // response meets a consumed row.
  try {
    await directusFetch(event, `/items/member_otp_codes/${challenge.id}`, {
      method: 'PATCH',
      body: {
        attempt_count: challenge.attempt_count + 1,
        consumed_at: new Date(now).toISOString(),
      },
    })
  } catch {
    throwInvalidCode()
  }

  // Server-side binding (F2): person <- people by phone, user <- users by
  // member_person. Both lookups are server-side; the request supplies
  // nothing but phone + code. An unlinked number looks exactly like a bad
  // code (no oracle).
  let userId: string | null = null
  let memberPerson: string | null = null
  let memberAccessExpiresAt: string | null = null
  try {
    const people = await directusFetch<{ data: PersonRow[] }>(event, '/items/people', {
      query: {
        filter: JSON.stringify({ phone: { _eq: phone } }),
        limit: 1,
        fields: 'id',
      },
    })
    const personId = (people.data ?? [])[0]?.id ?? null
    if (personId) {
      const users = await directusFetch<{ data: MemberUserRow[] }>(event, '/users', {
        query: {
          filter: JSON.stringify({ member_person: { _eq: personId } }),
          limit: 1,
          fields: 'id,member_person,member_access_expires_at',
        },
      })
      const user = (users.data ?? [])[0] ?? null
      if (user?.member_person) {
        userId = user.id
        memberPerson = user.member_person
        memberAccessExpiresAt = user.member_access_expires_at
      }
    }
  } catch {
    throwInvalidCode()
  }
  if (!userId || !memberPerson) throwInvalidCode()

  // The time-box is enforced at issue AND on every request (F1). A lapsed
  // time-box looks like a bad code.
  const sessionExpiresAt = now + MEMBER_OTP_SESSION_HOURS * 60 * 60 * 1000
  const accessExpiresAt = memberAccessExpiresAt ? Date.parse(memberAccessExpiresAt) : null
  if (accessExpiresAt !== null && now >= accessExpiresAt) throwInvalidCode()
  const expiresAt =
    accessExpiresAt === null
      ? sessionExpiresAt
      : Math.min(sessionExpiresAt, accessExpiresAt)

  try {
    await directusFetch(event, '/items/member_sessions', {
      method: 'POST',
      body: {
        user_id: userId,
        member_person: memberPerson,
        issued_at: new Date(now).toISOString(),
        // D2 (AFC-526): persist the min(session, access) value computed
        // above, not the full 8h sessionExpiresAt, so the DB row, the
        // cookie, and the per-request re-check agree.
        expires_at: new Date(expiresAt).toISOString(),
      },
    })
  } catch {
    throwInvalidCode()
  }

  // The member role is not a StaffRole: the cast is the seam the
  // role-matrix owner widens when the Directus member policy lands.
  // Sibling track (b) already branches on role === 'member'
  // (inviteCapabilities/isMemberSession): a member session gets the
  // member path, never staff breadth, and fail-closed no grants.
  await writeSession(event, {
    accessToken: MEMBER_OTP_SESSION_TOKEN,
    refreshToken: null,
    session: {
      user: {
        id: userId,
        email: '',
        firstName: null,
        staffRole: 'member' as StaffRole,
        branchId: null,
        branchIds: [],
        departmentIds: [],
        personId: memberPerson,
      },
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    },
  })

  return { personId: memberPerson, expiresAt: new Date(expiresAt).toISOString() }
})
