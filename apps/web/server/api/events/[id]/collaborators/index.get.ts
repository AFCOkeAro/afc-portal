import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../../../utils/portal'

const FIELDS = ['id', 'event', 'person', 'areas', 'created_at']

/**
 * GET /api/events/:id/collaborators — scoped list of the event's
 * collaborators (AFC-880). Each row carries the person's display name
 * (one batched people read) so the manage UI renders without N+1 reads.
 * Names only — no contact data. The areas inside each row are enforced
 * on the write routes, not here.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_collaborators', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  try {
    await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'event_collaborators',
      {
        filter: mergeFilters({ event: { _eq: id } }, scopeFilter(scope)),
        fields: FIELDS,
        sort: 'created_at',
        page: 1,
        limit: 100,
      },
    )
    const personIds = [
      ...new Set(result.data.map((row) => String(row.person)).filter((v) => v !== '')),
    ]
    let names = new Map<string, string>()
    if (personIds.length > 0) {
      const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: personIds.length,
      }).catch(() => ({ data: [] as Array<Record<string, unknown>> }))
      names = new Map(
        people.data.map((row) => [
          String(row.id),
          String(
            row.preferred_name ||
              [row.first_name, row.last_name].filter(Boolean).join(' ') ||
              'Someone',
          ),
        ]),
      )
    }
    return {
      data: result.data.map((row) => ({
        ...row,
        person_name: names.get(String(row.person)) ?? 'Someone',
      })),
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'collaborator_store', '0060')
  }
})
