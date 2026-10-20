import { isMemberSession } from '../../utils/event-invites'
import {
  isMemberOtpEnabled,
  requireLiveMemberSession,
  redactMemberPhone,
  throwMemberOtpDisabled,
} from '../../utils/member-otp'
import { directusFetch } from '../../utils/directus'
import { requireSession } from '../../utils/session'
import type { PortalScope } from '../../utils/portal'

/**
 * Read the member's own profile (AFC-482, track d self-service).
 *
 * DISABLED behind the AFC-478 hard gate: answers 503 member_otp_disabled
 * unless NUXT_MEMBER_OTP_ENABLED=true (re-review verdict + CTO approval).
 *
 * Scope contract (data-model-v4 §5 + §5.1):
 * - Member sessions only (role === 'member'); staff sessions get 403 --
 *   this surface is the member's own record, not a staff lookup.
 * - The person id comes from the session (personId), never from a query
 *   parameter (F2: nothing to forge, no cross-read possible by construction).
 * - member_access_expires_at is re-checked on this request (F1): a lapsed
 *   time-box answers 401, not the profile.
 * - The projection is redacted: phone is `0801 ••• •234`, and recipient
 *   internals (contact_value, error_detail, provider_message_id),
 *   consent history rows, and staff fields are never selected.
 */
export default defineEventHandler(async (event) => {
  if (!isMemberOtpEnabled(event)) throwMemberOtpDisabled()

  // Member-only surface: identity comes from the session, never from a
  // query parameter and never from staff branch scoping (getPortalScope
  // rejects scopeless sessions, which every member session is -- so member
  // routes read the session directly). isMemberSession only reads
  // scope.role, so a minimal role shim keeps the shared check without
  // pulling staff scoping into the member path.
  const { session } = await requireSession(event)
  if (!isMemberSession({ role: session.user.staffRole } as PortalScope)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This profile surface is for member sessions only',
      data: { code: 'forbidden' },
    })
  }

  const personId = session.user.personId
  if (!personId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Your login is not linked to a member record yet',
      data: { code: 'member_unlinked' },
    })
  }

  // D1 (AFC-526): the access time-box is live-read for the session user on
  // every request and fails closed (lookup failure -> 401). A lapsed
  // time-box answers 401 on the next read despite a live cookie.
  await requireLiveMemberSession(event, session.user.id, Date.parse(session.expiresAt), Date.now())

  const person = await directusFetch<{ data: Record<string, unknown> }>(
    event,
    `/items/people/${personId}`,
    {
      query: {
        fields: 'id,first_name,last_name,phone,branch,zone',
      },
    },
  ).catch(() => null)
  if (!person?.data) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Member record not found',
      data: { code: 'member_not_found' },
    })
  }

  const row = person.data
  return {
    id: String(row.id),
    first_name: (row.first_name as string | null) ?? null,
    last_name: (row.last_name as string | null) ?? null,
    phone_redacted: redactMemberPhone(row.phone as string | null),
    branch: (row.branch as string | null) ?? null,
    zone: (row.zone as string | null) ?? null,
  }
})
