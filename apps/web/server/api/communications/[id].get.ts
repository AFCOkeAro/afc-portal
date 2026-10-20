import type { Communication, CommunicationRecipient } from '@afc/shared'
import {
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHidden,
  stripHiddenMany,
  visibleFields,
} from '../../utils/portal'
import type { RecipientCounts } from './index.get'

/**
 * Delivery-log detail (AFC-479, ADR-0009 decision 2, data-model-v4 §4.6).
 * One header with its recipient rows. Internals (contact_value,
 * error_detail, provider_message_id) are stripped for non-staff scopes via
 * visibleFields/stripHidden (data-model-v4 §5.1); roles without a recipient
 * read grant get the header with a null recipient block, never a partial
 * one. Read-only: this slice enables no send path.
 */

const HEADER_FIELDS = [
  'id',
  'source_kind',
  'campaign',
  'campaign_step',
  'campaign_run',
  'event_invite',
  'consent_policy',
  'branch',
  'status',
  'estimated_cost',
  'created_by',
  'created_at',
]

const RECIPIENT_FIELDS = [
  'id',
  'communication',
  'contact_value',
  'contact_hash',
  'channel',
  'consent_basis',
  'message_rendered',
  'status',
  'exclusion_reason',
  'provider_message_id',
  'error_detail',
  'sent_at',
  'delivered_at',
  'read_at',
  'created_at',
]

export interface CommunicationDetail extends Communication {
  branch_name: string | null
  recipients: Array<Omit<CommunicationRecipient, 'id'> & { id: string }> | null
  recipient_counts: RecipientCounts | null
}

export default defineEventHandler(async (event): Promise<CommunicationDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A log id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'communications',
    id,
    { fields: visibleFields(scope, 'communications', HEADER_FIELDS) },
  )
  const names = await branchNames(event, scope)

  let recipients: CommunicationDetail['recipients'] = null
  let recipientCounts: RecipientCounts | null = null
  if (can(scope, 'communication_recipients', 'read')) {
    const result = await listItems<CommunicationRecipient>(
      event,
      scope,
      'communication_recipients',
      {
        filter: { communication: { _eq: id } },
        fields: visibleFields(scope, 'communication_recipients', RECIPIENT_FIELDS),
        sort: 'created_at',
        limit: -1,
      },
    )
    const stripped = stripHiddenMany(
      scope,
      'communication_recipients',
      result.data as unknown as Record<string, unknown>[],
    )
    recipients = stripped.map((recipient) => ({
      ...(recipient as unknown as CommunicationRecipient),
      id: String(recipient.id),
    }))
    const counts: RecipientCounts = {
      total: recipients.length,
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      excluded: 0,
      excluded_reasons: {},
    }
    for (const recipient of recipients) {
      if (recipient.status === 'queued') counts.queued += 1
      else if (recipient.status === 'sent') counts.sent += 1
      else if (recipient.status === 'delivered') counts.delivered += 1
      else if (recipient.status === 'read') counts.read += 1
      else if (recipient.status === 'failed') counts.failed += 1
      else if (recipient.status === 'excluded') {
        counts.excluded += 1
        const reason = String(recipient.exclusion_reason ?? 'unknown')
        counts.excluded_reasons[reason] = (counts.excluded_reasons[reason] ?? 0) + 1
      }
    }
    recipientCounts = counts
  }

  return {
    ...(stripHidden(scope, 'communications', row) as unknown as Communication),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    recipients,
    recipient_counts: recipientCounts,
  }
})
