import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwStoreUnavailable,
  zoneScopeFilter,
} from '../utils/portal'

export interface BscSummary {
  id: string
  name: string
  code: string
  parent_branch: string
  zone: string | null
  status: string
  geo_lat: number | null
  geo_lng: number | null
  address: string | null
  location: string | null
  leader: string | null
}

/**
 * GET /api/bscs?zone=&branch=
 *
 * Hierarchy-scoped Bible Study Centre list (AFC-461a,
 * data-model-expansion §10). Area staff see all; zone staff see their
 * zone's centres; branch staff see their own branches' centres. Requested
 * values are intersected with the scope predicate (empty, never foreign);
 * an explicitly out-of-scope `zone` or `branch` is a 403 (fail-closed).
 */
export default defineEventHandler(async (event): Promise<BscSummary[]> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'bible_study_centres', 'read')

  const query = getQuery(event)
  const zone =
    typeof query.zone === 'string' && query.zone.length > 0 ? query.zone : undefined
  const branch =
    typeof query.branch === 'string' && query.branch.length > 0 ? query.branch : undefined

  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, zone, visibleZones)
  const resolvedBranch = branch ? resolveBranch(scope, branch) : undefined

  // AFC-672: same contract as branches.get.ts — geo + contact on the list
  // rows for the merged Churches map/tooltips. Operational fields only
  // (§2.4), caller already holds the bible_study_centres read grant.
  // Named fail-closed errors, never a bare 500 (AFC-639a precedent).
  try {
    const result = await listItems<BscSummary>(event, scope, 'bible_study_centres', {
      filter: mergeFilters(
        { status: { _eq: 'active' } },
        zone ? { zone: { _eq: zone } } : undefined,
        resolvedBranch ? { parent_branch: { _eq: resolvedBranch } } : undefined,
        scope.isArea
          ? undefined
          : scope.zoneIds.length > 0
            ? zoneScopeFilter(scope)
            : { parent_branch: { _in: scope.branchIds } },
      ),
      fields: [
        'id',
        'name',
        'code',
        'parent_branch',
        'zone',
        'status',
        'geo_lat',
        'geo_lng',
        'address',
        'location',
        'leader',
      ],
      sort: 'name',
      limit: -1,
    })
    return result.data.map((bsc) => ({ ...bsc, id: String(bsc.id) }))
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'bsc_store', '0002')
  }
})
