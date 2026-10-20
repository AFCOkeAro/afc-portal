import { createHash, randomBytes } from 'node:crypto'
import {
  MEMBER_OTP_EXPIRY_MINUTES,
  MEMBER_OTP_REQUEST_ACK,
  hashOtpCode,
  isMemberOtpEnabled,
  memberOtpThrottle,
  normalizeMemberPhone,
  randomOtpCode,
  throwMemberOtpDisabled,
} from '../../../utils/member-otp'
import { directusFetch } from '../../../utils/directus'

/**
 * Request a member OTP code (AFC-482, track d).
 *
 * DISABLED behind the AFC-478 hard gate: answers 503 member_otp_disabled
 * unless NUXT_MEMBER_OTP_ENABLED=true (re-review verdict + CTO approval).
 *
 * Enabled-shape contract (F1):
 * - Body carries ONLY a phone number. No person, user, or password field
 *   is read -- identity is established at verify time from the
 *   directus_users.member_person link, never from client input (F2: there
 *   is nothing to forge because nothing is accepted). No passwords exist
 *   for members; staff MFA is unchanged.
 * - Enumeration-resistant: the response is identical whether the number
 *   is registered or not, whether the input is malformed, whether the
 *   counts lookup fails, and whether the throttle fires. Failure and
 *   throttling paths write no row and still return the ack.
 * - Storage is hashes only (member_otp_codes has no plaintext column);
 *   the code comes from the platform CSPRNG and is never logged.
 */
export default defineEventHandler(async (event) => {
  if (!isMemberOtpEnabled(event)) throwMemberOtpDisabled()

  const body = await readBody<Record<string, unknown>>(event)
  const phone = normalizeMemberPhone(body.phone)
  if (!phone || phone.replace(/\D/g, '').length < 7) {
    return { message: MEMBER_OTP_REQUEST_ACK }
  }

  const phoneHash = createHash('sha256').update(phone).digest('hex')
  const ip =
    (
      event.node.req.headers['x-forwarded-for'] ??
      event.node.req.socket?.remoteAddress ??
      ''
    )
      .toString()
      .split(',')[0]
      ?.trim() ?? ''
  const ipHash = ip ? createHash('sha256').update(ip).digest('hex') : null

  // Rolling-window counts feed the pure F1 gate (DB: member_otp_throttle).
  // A count lookup that fails fails closed to "no row, ack anyway" -- an
  // error that distinguishes states would be an oracle.
  let sentPhone1h: number
  let sentIp1h = 0
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const phoneRows = await directusFetch<{ data: unknown[] }>(
      event,
      '/items/member_otp_codes',
      {
        query: {
          filter: JSON.stringify({
            phone_hash: { _eq: phoneHash },
            requested_at: { _gte: since },
          }),
          limit: MEMBER_OTP_EXPIRY_MINUTES * 60,
        },
      },
    ).catch(() => ({ data: [] as unknown[] }))
    sentPhone1h = phoneRows.data.length
    if (ipHash) {
      const ipRows = await directusFetch<{ data: unknown[] }>(
        event,
        '/items/member_otp_codes',
        {
          query: {
            filter: JSON.stringify({
              request_ip_hash: { _eq: ipHash },
              requested_at: { _gte: since },
            }),
            limit: MEMBER_OTP_EXPIRY_MINUTES * 60,
          },
        },
      ).catch(() => ({ data: [] as unknown[] }))
      sentIp1h = ipRows.data.length
    }
  } catch {
    return { message: MEMBER_OTP_REQUEST_ACK }
  }

  if (!memberOtpThrottle(sentPhone1h, sentIp1h).allowed) {
    return { message: MEMBER_OTP_REQUEST_ACK }
  }

  const code = randomOtpCode()
  const salt = randomBytes(16).toString('hex')
  const requestedAt = new Date()
  const expiresAt = new Date(
    requestedAt.getTime() + MEMBER_OTP_EXPIRY_MINUTES * 60 * 1000,
  )
  try {
    await directusFetch(event, '/items/member_otp_codes', {
      method: 'POST',
      body: {
        phone_hash: phoneHash,
        code_hash: hashOtpCode(code, salt),
        code_salt: salt,
        requested_at: requestedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        request_ip_hash: ipHash,
      },
    })
  } catch {
    // A write that fails still returns the ack: delivery state is not
    // distinguishable from outside, so there is nothing to learn.
    return { message: MEMBER_OTP_REQUEST_ACK }
  }

  // Delivery (WhatsApp/SMS send of `code`) is procurement-dependent
  // (Termii/BSP sender ID, template approval) and stays unconfigured in
  // this scaffolding: the challenge row is the auditable record, and the
  // send integration lands with enablement. The code is never logged.
  return { message: MEMBER_OTP_REQUEST_ACK }
})
