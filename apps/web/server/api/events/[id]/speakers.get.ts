import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../../utils/portal'

const FIELDS = [
  'id',
  'event',
  'branch',
  'zone',
  'person',
  'external_name',
  'status',
  'special_requests',
  'bio',
  'created_by',
  'created_at',
]

/**
 * GET /api/events/:id/speakers — bookings for one event (AFC-843).
 * The event is scope-gated first; directory names resolve server-side.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_speakers', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  try {
    await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'event_speakers',
      {
        filter: mergeFilters({ event: { _eq: id } }, scopeFilter(scope)),
        fields: FIELDS,
        sort: 'created_at',
        limit: 100,
      },
    )
    const personIds = [
      ...new Set(
        result.data.map((row: Record<string, unknown>) => row.person).filter(Boolean),
      ),
    ]
    let names = new Map<string, string>()
    if (personIds.length > 0) {
      const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: 100,
      }).catch(() => ({ data: [] as Record<string, unknown>[] }))
      names = new Map(
        people.data.map((row: Record<string, unknown>) => {
          const full =
            `${String(row.first_name ?? '').trim()} ${String(row.last_name ?? '').trim()}`.trim()
          return [
            String(row.id),
            String(row.preferred_name ?? '').trim() || full || 'Unnamed member',
          ]
        }),
      )
    }
    return {
      data: result.data.map((row: Record<string, unknown>) => ({
        ...row,
        name: row.person
          ? (names.get(String(row.person)) ?? 'Unknown')
          : (row.external_name ?? 'Guest'),
      })),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'speaker_store', '0053')
  }
})
