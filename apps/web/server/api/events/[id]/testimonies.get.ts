import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../../utils/portal'

const FIELDS = ['id', 'event', 'name', 'message', 'contact', 'created_at']

/**
 * GET /api/events/:id/testimonies — scoped staff list of shared
 * testimonies (AFC-828 phase 4), newest first.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_testimonies', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })
  try {
    await findScopedItem(event, scope, 'events', id, { fields: ['id'] })
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'event_testimonies',
      {
        filter: mergeFilters({ event: { _eq: id } }, scopeFilter(scope)),
        fields: FIELDS,
        sort: '-created_at',
        page: 1,
        limit: 100,
      },
    )
    return { data: result.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'testimony_store', '0057')
  }
})
