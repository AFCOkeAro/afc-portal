import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

/**
 * Member phone-OTP scaffolding (AFC-482, data-model-v4 §3.2 + §5 + §5.2,
 * prd-addendum-v4 §3.3 + §6 OQ-R7, ADR-0009 decision 6).
 *
 * HARD GATE (AFC-478 verdict CHANGES-REQUIRED): every route in
 * `api/auth/member-otp/*` and `api/member/*` answers
 * `503 member_otp_disabled` unless `NUXT_MEMBER_OTP_ENABLED=true`.
 * Flipping that flag requires the SecurityEngineer re-review verdict plus
 * CTO approval -- it is an enablement action, not a config tweak. The
 * schema half of this slice (migration 20261020_0007) carries the F1
 * parameter block; this file is the HTTP half. Nothing here issues a
 * usable session while the flag is off.
 *
 * F1 parameters (AFC-478 verdict, mirrored from the migration header):
 * 6-digit CSPRNG codes, expiry <= 10 min, salted-sha256 storage only
 * (no plaintext column exists), single-use, <= 5 verify attempts per
 * code, resend <= 3/hr per phone and <= 10/hr per IP, session bound
 * server-side to exactly one member_person with lifetime <= 8h and
 * member_access_expires_at re-checked on every request. Device binding
 * is explicitly dropped for v1; the sealed httpOnly session cookie is
 * the bearer. SIM-swap is a recorded accepted risk (see migration).
 *
 * F2 rule (AFC-478 F2): on invite.create and any consent write,
 * inviter_user := session user and inviter_person := session
 * member_person. A request carrying different values is rejected with
 * 403 -- never silently overwritten. These routes accept NO person or
 * user fields at all, so there is nothing to forge: identity comes from
 * the session only. The pure check lives in the DB
 * (member_invite_identity_ok); the small TS mirrors below exist so the
 * route can reject before touching the database, and the DB pins the
 * canonical rule.
 */

export const MEMBER_OTP_CODE_DIGITS = 6
export const MEMBER_OTP_EXPIRY_MINUTES = 10
export const MEMBER_OTP_MAX_ATTEMPTS = 5
export const MEMBER_OTP_RESEND_PHONE_PER_HOUR = 3
export const MEMBER_OTP_RESEND_IP_PER_HOUR = 10
export const MEMBER_OTP_SESSION_HOURS = 8

/** The bearer stored in the sealed cookie for a verified member session. */
export const MEMBER_OTP_SESSION_TOKEN = 'member-otp-session'

/** Enumeration-resistant request response: identical on every path. */
export const MEMBER_OTP_REQUEST_ACK =
  'If this number is registered you will receive a code shortly'

export interface MemberOtpThrottle {
  allowed: boolean
  blockedReason: 'otp_resend_phone_cap' | 'otp_resend_ip_cap' | null
}

export interface MemberOtpVerifyGate {
  allowed: boolean
  attemptsRemaining: number
  lockedReason: 'otp_replay' | 'otp_expired' | 'otp_locked' | null
}

/** Disabled-behind-flag: default off; enablement needs re-review + CTO. */
export function isMemberOtpEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  return String(config.memberOtpEnabled ?? '') === 'true'
}

/** The gate every member-OTP and member self-service route calls first. */
export function throwMemberOtpDisabled(): never {
  throw createError({
    statusCode: 503,
    statusMessage:
      'Member phone login is not enabled yet. It ships after the SecurityEngineer re-review (AFC-478).',
    data: { code: 'member_otp_disabled' },
  })
}

/** F1 resend rule mirror (DB: member_otp_throttle). */
export function memberOtpThrottle(
  sentPhone1h: number,
  sentIp1h: number,
): MemberOtpThrottle {
  if (sentPhone1h >= MEMBER_OTP_RESEND_PHONE_PER_HOUR) {
    return { allowed: false, blockedReason: 'otp_resend_phone_cap' }
  }
  if (sentIp1h >= MEMBER_OTP_RESEND_IP_PER_HOUR) {
    return { allowed: false, blockedReason: 'otp_resend_ip_cap' }
  }
  return { allowed: true, blockedReason: null }
}

/** F1 verify rule mirror (DB: member_otp_verify_gate). */
export function memberOtpVerifyGate(
  consumed: boolean,
  expired: boolean,
  attempts: number,
): MemberOtpVerifyGate {
  if (consumed)
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_replay' }
  if (expired)
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_expired' }
  if (attempts >= MEMBER_OTP_MAX_ATTEMPTS) {
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_locked' }
  }
  return {
    allowed: true,
    attemptsRemaining: MEMBER_OTP_MAX_ATTEMPTS - attempts,
    lockedReason: null,
  }
}

/** F1 session rule mirror (DB: member_session_valid). */
export function isMemberSessionLive(
  sessionExpiresAt: number,
  memberAccessExpiresAt: number | null,
  now: number,
): boolean {
  if (now >= sessionExpiresAt) return false
  if (memberAccessExpiresAt !== null && now >= memberAccessExpiresAt) return false
  return true
}

/**
 * F2 identity mirror (DB: member_invite_identity_ok). Null claims mean
 * "not supplied" and are filled from the session; differing values are
 * forgery and the route answers 403.
 */
export function isMemberInviteIdentityOk(
  sessionUser: string,
  sessionPerson: string,
  claimedUser: string | null,
  claimedPerson: string | null,
): boolean {
  if (claimedUser !== null && claimedUser !== sessionUser) return false
  if (claimedPerson !== null && claimedPerson !== sessionPerson) return false
  return true
}

/** `+2348012345678` -> `+234 ••• 5678`. Members see redacted numbers only. */
export function redactMemberPhone(phone: string | null | undefined): string {
  const text = (phone ?? '').trim()
  if (text.length < 7) return '••••'
  return `${text.slice(0, 4)} ••• ${text.slice(-4)}`
}

/** Trim + drop cosmetic separators. No country-code rewriting (capture concern). */
export function normalizeMemberPhone(phone: unknown): string {
  if (typeof phone !== 'string') return ''
  return phone.trim().replace(/[\s\-().]/g, '')
}

/** sha256(code || salt): the only form a code is ever stored or compared in. */
export function hashOtpCode(code: string, salt: string): string {
  return createHash('sha256').update(`${code}${salt}`).digest('hex')
}

/**
 * Constant-time comparison for the presented code hash. Length is fixed by
 * the hex digest, so no length oracle is introduced here.
 */
export function otpHashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** A 6-digit code from the platform CSPRNG. Never logged, never stored. */
export function randomOtpCode(): string {
  const max = 10 ** MEMBER_OTP_CODE_DIGITS
  return String(randomInt(0, max)).padStart(MEMBER_OTP_CODE_DIGITS, '0')
}
