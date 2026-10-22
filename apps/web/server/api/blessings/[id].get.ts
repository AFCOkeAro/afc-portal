import type { Blessing, BlessingEvent, BlessingRecipient } from '@afc/shared'
import {
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  zoneScopeFilter,
} from '../../utils/portal'

const BLESSING_FIELDS = [
  'id',
  'blessing_type',
  'other_label',
  'count',
  'male_count',
  'female_count',
  'total_count',
  'branch',
  'zone',
  'bsc',
  'session',
  'event',
  'sunday_service',
  'service_date',
  'recorded_by',
  'notes',
  'created_at',
  'updated_at',
]

const EVENT_FIELDS = [
  'id',
  'blessing',
  'event_type',
  'detail',
  'actor_user',
  'created_at',
]

const RECIPIENT_FIELDS = [
  'id',
  'blessing',
  'blessing_type',
  'other_label',
  'person',
  'attendee_user',
  'branch',
  'zone',
  'bsc',
  'session',
  'event',
  'sunday_service',
  'service_date',
  'recorded_by',
  'notes',
  'created_at',
  'updated_at',
]

export interface BlessingDetail extends Blessing {
  branch_name: string | null
  events: BlessingEvent[]
  /** Individual rows linked to this aggregate (blessing FK). */
  recipients: BlessingRecipient[]
  /** Standalone rows on the same program (branch + date + program links). */
  standalone_recipients: BlessingRecipient[]
}

/**
 * GET /api/blessings/:id — blessing detail with its audit trail.
 *
 * A cross-branch id is a 404 here exactly like the services detail route,
 * never a foreign blessing. The trail (blessing_events) is a child of the
 * blessing, so scoping the blessing scopes the trail.
 */
export default defineEventHandler(async (event): Promise<BlessingDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessings', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A blessing id is required' })

  // Same hierarchy predicate as the list: area all, zone grants by zone,
  // branch staff by branch. A blessing outside the caller's scope is a 404.
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'blessings',
    id,
    {
      fields: BLESSING_FIELDS,
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const names = await branchNames(event, scope)
  const trail = await listItems<BlessingEvent>(event, scope, 'blessing_events', {
    filter: { blessing: { _eq: id } },
    fields: EVENT_FIELDS,
    sort: 'created_at',
    limit: -1,
  })

  // Individual rows alongside the aggregate (AFC-671 §D): linked rows via
  // the blessing FK, plus standalone rows on the same program (branch +
  // date + identical program links). Gated on blessing_recipients:read;
  // anything else renders zero, never foreign.
  let recipients: BlessingRecipient[] = []
  let standalone: BlessingRecipient[] = []
  if (can(scope, 'blessing_recipients', 'read')) {
    const linked = await listItems<BlessingRecipient>(event, scope, 'blessing_recipients', {
      filter: { blessing: { _eq: id } },
      fields: RECIPIENT_FIELDS,
      sort: 'created_at',
      limit: -1,
    })
    recipients = linked.data.map((item) => ({ ...item, id: String(item.id) }))
    const eqOrNull = (value: unknown) =>
      value ? { _eq: value } : { _null: true }
    const same = await listItems<BlessingRecipient>(event, scope, 'blessing_recipients', {
      filter: {
        blessing: { _null: true },
        branch: { _eq: row.branch },
        service_date: { _eq: row.service_date },
        blessing_type: { _eq: row.blessing_type },
        session: eqOrNull(row.session),
        event: eqOrNull(row.event),
        sunday_service: eqOrNull(row.sunday_service),
      },
      fields: RECIPIENT_FIELDS,
      sort: 'created_at',
      limit: -1,
    })
    standalone = same.data.map((item) => ({ ...item, id: String(item.id) }))
  }

  return {
    ...(row as unknown as Blessing),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    events: trail.data.map((item) => ({ ...item, id: String(item.id) })),
    recipients,
    standalone_recipients: standalone,
  }
})
