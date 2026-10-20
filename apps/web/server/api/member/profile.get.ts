import { isMemberSession } from '../../utils/event-invites'
import {
  isMemberOtpEnabled,
  isMemberSessionLive,
  redactMemberPhone,
  throwMemberOtpDisabled,
} from '../../utils/member-otp'
import { directusFetch } from '../../utils/directus'
import { requireSession } from '../../utils/session'
import { getPortalScope } from '../../utils/portal'

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

  const scope = await getPortalScope(event)
  if (!isMemberSession(scope)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'This profile surface is for member sessions only',
      data: { code: 'forbidden' },
    })
  }

  const { session } = await requireSession(event)
  const personId = session.user.personId
  if (!personId) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Your login is not linked to a member record yet',
      data: { code: 'member_unlinked' },
    })
  }

  if (!isMemberSessionLive(Date.parse(session.expiresAt), null, Date.now())) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Your session has expired; request a new code',
      data: { code: 'session_expired' },
    })
  }

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
