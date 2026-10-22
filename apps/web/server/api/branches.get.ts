import type { BranchSummary } from '../../types/portal'
import {
  branchCollectionScope,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  scopeZoneIds,
  throwStoreUnavailable,
} from '../utils/portal'

/**
 * GET /api/branches?zone=&area=
 *
 * Hierarchy-scoped branch list (AFC-461a, data-model-expansion §10). Area
 * staff see all active branches; zone staff see their zones' rows; branch
 * staff see their own rows. Requested `zone`/`area` values are intersected
 * with the scope predicate, so an out-of-scope request returns empty, never
 * foreign rows; an explicitly out-of-scope `zone` is a 403 (fail-closed).
 */
export default defineEventHandler(async (event): Promise<BranchSummary[]> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'branches', 'read')

  const query = getQuery(event)
  const zone =
    typeof query.zone === 'string' && query.zone.length > 0 ? query.zone : undefined
  const area =
    typeof query.area === 'string' && query.area.length > 0 ? query.area : undefined

  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, zone, visibleZones)

  // AFC-672: merged Churches surface needs geo + contact on the list rows so
  // the map and pin tooltips render without a per-row detail read. All fields
  // below are operational (data-model-expansion §2.3), none is §10.1
  // restricted, and the caller already holds the branches read grant
  // (requireCan above, fail-closed). No new collection, no widened grant.
  // Fail-closed with a named error (AFC-639a precedent): Directus 401/403
  // surfaces as branch_store_forbidden (403), any other read failure as
  // pending_migration_0002 (503), never a bare 500.
  try {
    const result = await listItems<BranchSummary>(event, scope, 'branches', {
      filter: mergeFilters(
        { status: { _eq: 'active' } },
        zone ? { zone: { _eq: zone } } : undefined,
        area ? { area: { _eq: area } } : undefined,
        branchCollectionScope(scope),
      ),
      fields: [
        'id',
        'name',
        'code',
        'branch_type',
        'type_label',
        'zone',
        'area',
        'status',
        'geo_lat',
        'geo_lng',
        'address',
        'city',
        'state',
        'phone',
        'email',
        'pastor',
      ],
      sort: 'sort,name',
      limit: -1,
    })
    return result.data.map((branch) => ({ ...branch, id: String(branch.id) }))
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'branch_store', '0002')
  }
})
