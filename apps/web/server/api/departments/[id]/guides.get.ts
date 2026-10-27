import {
  departmentScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../../utils/portal'

/**
 * GET /api/departments/:id/guides — list a department's guides (AFC-800,
 * parent AFC-759).
 *
 * Scoped reads: the parent loads through findScopedItem with
 * departmentScopeFilter (an out-of-scope parent is a scoped 404, never
 * foreign rows); guides list ORDER BY sort_order, id. Failures carry
 * { code, fields }, never a bare 500.
 */
const GUIDE_FIELDS = [
  'id',
  'department',
  'title',
  'body',
  'sort_order',
  'created_at',
  'updated_at',
]

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }

  // AFC-800: guides live on the 0043 store; an unreadable store maps to the
  // named error, never a bare 500. Deliberate 4xx (scope 404s) pass through.
  try {
    await findScopedItem(event, scope, 'departments', id, {
      fields: ['id'],
      scope: departmentScopeFilter(scope),
    })

    const guides = await listItems<Record<string, unknown>>(
      event,
      scope,
      'department_guides',
      {
        filter: { department: { _eq: id } },
        fields: GUIDE_FIELDS,
        sort: 'sort_order,id',
        limit: -1,
      },
    )
    return { data: guides.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0043')
  }
})
