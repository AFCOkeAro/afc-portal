import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeZoneIds,
} from '../utils/portal'

export interface ZoneSummary {
  id: string
  name: string
  code: string
  area: string | null
  status: string
}

/**
 * GET /api/zones?area=
 *
 * Hierarchy-scoped zone list (AFC-461a, data-model-expansion §10). Area
 * staff see all zones; zone staff see their own zones; branch staff see the
 * zones containing their branches (derived, one `branches` read). A user
 * with no scope never reaches here — `getPortalScope` fails closed first.
 */
export default defineEventHandler(async (event): Promise<ZoneSummary[]> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'zones', 'read')

  const query = getQuery(event)
  const area =
    typeof query.area === 'string' && query.area.length > 0 ? query.area : undefined

  const visibleZones = scope.isArea ? null : await scopeZoneIds(event, scope)

  const result = await listItems<ZoneSummary>(event, scope, 'zones', {
    filter: mergeFilters(
      { status: { _eq: 'active' } },
      area ? { area: { _eq: area } } : undefined,
      visibleZones ? { id: { _in: visibleZones } } : undefined,
    ),
    fields: ['id', 'name', 'code', 'area', 'status'],
    sort: 'sort,name',
    limit: -1,
  })
  return result.data.map((zone) => ({ ...zone, id: String(zone.id) }))
})
