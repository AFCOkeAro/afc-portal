import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'

/**
 * GET /api/outreach-locations/:id — one mission field with its secretary
 * assignments. Person names resolve server-side so the AVS page renders
 * one round trip.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_locations', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A location id is required' })
  try {
    const location = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'outreach_locations',
      id,
    )
    const links = await listItems<{ id: string; person: string | null }>(
      event,
      scope,
      'outreach_location_secretaries',
      {
        filter: { location: { _eq: id } },
        fields: ['id', 'person'],
        limit: 100,
      },
    )
    const personIds = [
      ...new Set(
        links.data.map((row: { person: unknown }) => row.person).filter(Boolean),
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
      data: {
        ...location,
        secretaries: links.data.map((row: { id: unknown; person: unknown }) => ({
          id: String(row.id),
          person: row.person ? String(row.person) : null,
          name: row.person ? (names.get(String(row.person)) ?? 'Unknown') : null,
        })),
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
