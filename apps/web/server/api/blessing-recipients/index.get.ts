import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../utils/portal'
import { blessingScopeFilter } from '../../utils/blessing-report'

/**
 * GET /api/blessing-recipients — scoped individual-blessing list (AFC-671 §C).
 *
 * Same hierarchy predicate as the blessings list (area all, zone grants by
 * zone, branch staff by branch): an explicitly out-of-scope `zone` or
 * `branch` is a 403 (fail-closed), never an empty list. Optional filters:
 * blessing_type, person, session, event, sunday_service, service/event
 * alias, date range, sort allowlist.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessing_recipients', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  const branch = text('branch')
  const zone = text('zone')
  const blessingType = text('blessing_type')
  const person = text('person')
  const session = text('session')
  const programEvent = text('event')
  const service = text('sunday_service') ?? text('service')
  const from = text('date_from')
  const to = text('date_to')
  const sortRaw = text('sort')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const sort = sortRaw === 'service_date' ? 'service_date' : '-service_date'

  const filter = mergeFilters(
    await blessingScopeFilter(event, scope, { branch, zone }),
    blessingType ? { blessing_type: { _eq: blessingType } } : undefined,
    person ? { person: { _eq: person } } : undefined,
    session ? { session: { _eq: session } } : undefined,
    programEvent ? { event: { _eq: programEvent } } : undefined,
    service ? { sunday_service: { _eq: service } } : undefined,
    from || to
      ? {
          service_date: {
            ...(from ? { _gte: from } : {}),
            ...(to ? { _lte: to } : {}),
          },
        }
      : undefined,
  )

  const result = await listItems<Record<string, unknown>>(event, scope, 'blessing_recipients', {
    filter,
    fields: [
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
    ],
    sort,
    page,
    limit,
  })

  return {
    data: result.data.map((row) => ({ ...row, id: String(row.id) })),
    meta: { total: result.meta.total, page, limit },
  }
})
