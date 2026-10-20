import type { Communication, CommunicationRecipient } from '@afc/shared'
import {
  branchNames,
  can,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHidden,
} from '../../utils/portal'

/**
 * Delivery-log read surface (AFC-479, ADR-0009 decision 2, data-model-v4
 * §4.6). One log for every message: this list returns the `communications`
 * headers with per-status recipient counts. Per-recipient rows live on the
 * detail route; internals (contact_value, error_detail, provider_message_id)
 * are stripped for non-staff scopes via the shared field restrictions
 * (data-model-v4 §5.1). Read-only: this slice enables no send path.
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

const SOURCE_KINDS = ['manual', 'campaign', 'invite', 'welcome_form', 'birthday_webhook']
const HEADER_STATUSES = ['queued', 'sending', 'sent', 'partial', 'failed', 'cancelled']

export interface RecipientCounts {
  total: number
  queued: number
  sent: number
  delivered: number
  read: number
  failed: number
  excluded: number
  excluded_reasons: Record<string, number>
}

export interface CommunicationRow extends Communication {
  branch_name: string | null
  recipient_counts: RecipientCounts | null
}

function emptyCounts(): RecipientCounts {
  return {
    total: 0,
    queued: 0,
    sent: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    excluded: 0,
    excluded_reasons: {},
  }
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const sourceKind =
    typeof query.source_kind === 'string' && SOURCE_KINDS.includes(query.source_kind)
      ? query.source_kind
      : undefined
  const status =
    typeof query.status === 'string' && HEADER_STATUSES.includes(query.status)
      ? query.status
      : undefined

  const result = await listItems<Communication>(event, scope, 'communications', {
    filter: mergeFilters(
      branch ? { branch: { _eq: branch } } : undefined,
      sourceKind ? { source_kind: { _eq: sourceKind } } : undefined,
      status ? { status: { _eq: status } } : undefined,
      scopeFilter(scope),
    ),
    fields: HEADER_FIELDS,
    sort: '-created_at',
    page,
    limit,
  })

  const names = await branchNames(event, scope)

  // Counts only: no recipient internals cross this route (data-model-v4 §5.1).
  // Roles without a recipient read grant see a null count block rather than a
  // partial one -- a partial block would be mistaken for an empty send.
  const countsById = new Map<string, RecipientCounts>()
  if (can(scope, 'communication_recipients', 'read') && result.data.length > 0) {
    const ids = result.data.map((row) => String(row.id))
    const recipients = await listItems<CommunicationRecipient>(
      event,
      scope,
      'communication_recipients',
      {
        filter: { communication: { _in: ids } },
        fields: ['communication', 'status', 'exclusion_reason'],
        limit: -1,
      },
    )
    for (const recipient of recipients.data) {
      const key = String(recipient.communication)
      const counts = countsById.get(key) ?? emptyCounts()
      counts.total += 1
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
      countsById.set(key, counts)
    }
  }

  const rows: CommunicationRow[] = result.data.map((row) => ({
    ...(stripHidden(
      scope,
      'communications',
      row as unknown as Record<string, unknown>,
    ) as unknown as Communication),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    recipient_counts: countsById.get(String(row.id)) ?? null,
  }))

  return { data: rows, meta: result.meta }
})
