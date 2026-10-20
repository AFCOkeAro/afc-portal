import { createItem, getPortalScope, requireCan } from '../../utils/portal'
import {
  HARDENING_COLLECTIONS,
  parseStopRequest,
  suppressionChannelFor,
  type SuppressionReason,
} from '../../utils/hardening'

/**
 * Record a consent withdrawal / STOP (AFC-486, retention_consent_automation
 * Flow step "stop").
 *
 * A STOP suppresses all further sends to that number on the withdrawn
 * channel (or every channel for STOP ALL), recorded with a reason. The body
 * carries the contact HASH, never a raw phone number — hashing happens
 * client-side via identityHash() (or server-side from digits the caller
 * already holds through the people routes); this route never sees PII it
 * does not already have through its own read grant.
 *
 * Enforcement: staff holding a communications create grant record the
 * withdrawal. The tick enforces it via hardening_suppressed(); this route
 * only records.
 */

const REASONS: SuppressionReason[] = [
  'opt_out_stop',
  'consent_withdrawn',
  'dnc',
  'invalid_contact',
  'over_cap_abuse',
]

const CHANNELS = ['whatsapp', 'sms', 'email'] as const

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'create')

  const body = await readBody<{
    contact_hash?: unknown
    channel?: unknown
    reason?: unknown
    source?: unknown
    inbound_text?: unknown
  }>(event)

  const contactHash =
    typeof body.contact_hash === 'string' ? body.contact_hash.trim() : ''
  if (!contactHash) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'A contact hash is required (hash the number first; this route takes no raw phone)',
      data: { code: 'contact_hash_required' },
    })
  }

  const channel =
    typeof body.channel === 'string' &&
    (CHANNELS as readonly string[]).includes(body.channel)
      ? (body.channel as (typeof CHANNELS)[number])
      : null
  if (!channel) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel must be one of whatsapp, sms, email',
      data: { code: 'channel_required' },
    })
  }

  const reason: SuppressionReason =
    typeof body.reason === 'string' &&
    (REASONS as readonly string[]).includes(body.reason)
      ? (body.reason as SuppressionReason)
      : 'opt_out_stop'

  const inbound =
    typeof body.inbound_text === 'string' ? parseStopRequest(body.inbound_text) : null
  const storedChannel = suppressionChannelFor(channel, inbound?.allChannels ?? false)

  const source =
    body.source === 'member_reply' || body.source === 'flow' || body.source === 'tick'
      ? body.source
      : 'staff_action'

  try {
    const row = await createItem<{ id: string }>(
      event,
      scope,
      HARDENING_COLLECTIONS.suppressions,
      {
        contact_hash: contactHash,
        channel: storedChannel,
        reason,
        source,
      },
    )
    return { suppressed: true, id: row.id, channel: storedChannel, reason, source }
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Suppression store unavailable (migration 0015 not applied?)',
      data: { code: 'pending_migration_0015', cause: String(error) },
    })
  }
})
