import {
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../utils/portal'

export interface AreaSummary {
  id: string
  name: string
  code: string
  status: string
}

/**
 * GET /api/areas
 *
 * Hierarchy top-level list (AFC-758: group creation needs an area picker;
 * zones carry only the area id). Caller must hold areas read; active rows
 * only. Fail-closed named errors, never a bare 500.
 */
export default defineEventHandler(async (event): Promise<AreaSummary[]> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'areas', 'read')

  try {
    const result = await listItems<AreaSummary>(event, scope, 'areas', {
      filter: { status: { _eq: 'active' } },
      fields: ['id', 'name', 'code', 'status'],
      sort: 'sort,name',
      limit: -1,
    })
    return result.data.map((area) => ({ ...area, id: String(area.id) }))
  } catch (cause) {
    const error = cause as { statusCode?: number }
    if (error.statusCode) throw cause
    throwStoreUnavailable(cause, 'area_store', '0002')
  }
})
