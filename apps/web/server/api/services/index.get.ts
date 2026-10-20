import type { SundayService } from '@afc/shared'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  zoneScopeFilter,
} from '../../utils/portal'

const SERVICE_FIELDS = [
  'id',
  'branch',
  'zone',
  'service_date',
  'service_time',
  'service_type',
  'theme',
  'preacher',
  'expected_attendance',
  'total_attendance',
  'status',
  'notes',
  'created_by',
  'created_at',
]

export interface ServiceRow extends SundayService {
  branch_name: string | null
}

/**
 * GET /api/services?branch=&zone=&status=&service_type=
 *
 * Hierarchy-scoped service list (AFC-473, data-model-expansion §10). Area
 * staff see all; zone staff see their zone's services; branch staff see
 * their own branches' services. Requested values are intersected with the
 * scope predicate (empty, never foreign); an explicitly out-of-scope `zone`
 * or `branch` is a 403 (fail-closed). Same predicate shape as bscs.get.ts.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_services', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const branch =
    typeof query.branch === 'string' && query.branch.length > 0 ? query.branch : undefined
  const zone =
    typeof query.zone === 'string' && query.zone.length > 0 ? query.zone : undefined
  const status =
    typeof query.status === 'string' && query.status.length > 0 ? query.status : undefined
  const serviceType =
    typeof query.service_type === 'string' && query.service_type.length > 0
      ? query.service_type
      : undefined

  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, zone, visibleZones)
  // resolveBranch 403s on a branch outside the caller's scope; an
  // explicitly out-of-scope branch is a 403, never an empty list.
  const resolvedBranch = branch ? resolveBranch(scope, branch) : undefined

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    {
      filter: mergeFilters(
        zone ? { zone: { _eq: zone } } : undefined,
        resolvedBranch ? { branch: { _eq: resolvedBranch } } : undefined,
        status ? { status: { _eq: status } } : undefined,
        serviceType ? { service_type: { _eq: serviceType } } : undefined,
        scope.isArea
          ? undefined
          : scope.zoneIds.length > 0
            ? zoneScopeFilter(scope)
            : { branch: { _in: scope.branchIds } },
      ),
      fields: SERVICE_FIELDS,
      sort: '-service_date,-service_time',
      page,
      limit,
    },
  )

  const names = await branchNames(event, scope)
  const rows: ServiceRow[] = result.data.map((row) => ({
    ...(row as unknown as SundayService),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
  }))

  return { data: rows, meta: result.meta }
})
