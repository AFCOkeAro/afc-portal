import {
  csvResponse,
  getPortalScope,
  listItems,
  mergeFilters,
  scopeFilter,
} from '../../utils/portal'
import {
  INVITE_FIELDS,
  INVITE_STATUSES,
  inviteCapabilities,
  requireInviteCap,
} from '../../utils/event-invites'
import type { InviteRow } from '../../utils/event-invites'

/**
 * Staff CSV export (AFC-480, US-E3 AC1). Branch admin and above, branch
 * scoped, full rows (the export is a staff surface, so contact values are
 * included -- members never reach it: exportCsv is false for them).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'exportCsv', 'export event invitations')

  const query = getQuery(event)
  const eventFilter = typeof query.event === 'string' ? query.event : undefined
  const inviter = typeof query.inviter === 'string' ? query.inviter : undefined
  const status =
    typeof query.status === 'string' && INVITE_STATUSES.includes(query.status as never)
      ? query.status
      : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined

  const result = await listItems<InviteRow>(event, scope, 'event_invites', {
    filter: mergeFilters(
      scopeFilter(scope),
      branch ? { branch: { _eq: branch } } : undefined,
      eventFilter ? { event: { _eq: eventFilter } } : undefined,
      inviter ? { inviter_user: { _eq: inviter } } : undefined,
      status ? { status: { _eq: status } } : undefined,
    ),
    fields: INVITE_FIELDS,
    sort: '-created_at',
    limit: -1,
  })

  const header = [
    'id',
    'event',
    'branch',
    'inviter_user',
    'invitee_name',
    'invitee_phone',
    'invitee_age_band',
    'channel_choice',
    'status',
    'approval_required',
    'blocked_reason',
    'retry_of',
    'created_at',
  ]
  const rows: string[][] = [header]
  for (const row of result.data) {
    rows.push([
      String(row.id),
      String(row.event ?? ''),
      String(row.branch ?? ''),
      String(row.inviter_user ?? ''),
      String(row.invitee_name ?? ''),
      String(row.invitee_phone ?? ''),
      String(row.invitee_age_band ?? ''),
      String(row.channel_choice ?? ''),
      String(row.status ?? ''),
      row.approval_required ? 'yes' : 'no',
      String(row.blocked_reason ?? ''),
      String(row.retry_of ?? ''),
      String(row.created_at ?? ''),
    ])
  }
  return csvResponse(event, 'event-invites.csv', rows)
})
