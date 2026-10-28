import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

const FIELDS = [
  'id',
  'branch',
  'zone',
  'name',
  'category',
  'address',
  'ownership',
  'contact_name',
  'contact_phone',
  'visiting_days',
  'notes',
  'created_by',
  'created_at',
]

/**
 * GET /api/outreach-locations — AVS mission fields (AFC-841), scoped to
 * the caller's branch/zone. Branch + category filters feed the AVS page.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_locations', 'read')

  const query = getQuery(event)
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const category = typeof query.category === 'string' ? query.category : undefined
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  try {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'outreach_locations',
      {
        filter: mergeFilters(
          branch ? { branch: { _eq: branch } } : undefined,
          category ? { category: { _eq: category } } : undefined,
          scopeFilter(scope),
        ),
        fields: FIELDS,
        sort: 'name',
        page: 1,
        limit: 100,
        search: search || undefined,
      },
    )
    return { data: result.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
