import { can, getPortalScope, listItems, mergeFilters } from '../../utils/portal'

/**
 * GET /api/visitors/campaign-options — active campaigns for the intake
 * dropdown (AFC-907).
 *
 * Intake roles include volunteers (visitors:create) who hold no
 * communications read grant, so the full campaign catalogue route cannot
 * serve them. This endpoint carries only id + key + name of active
 * campaigns in scope. No send, enqueue or activation path.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  if (!can(scope, 'visitors', 'read') && !can(scope, 'visitors', 'create')) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Visitors intake is required for campaign options',
      data: { code: 'forbidden' },
    })
  }

  const branchScope = scope.isArea
    ? undefined
    : {
        _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
      }
  try {
    const result = await listItems<Record<string, unknown>>(event, scope, 'campaigns', {
      filter: mergeFilters(branchScope, { status: { _eq: 'active' } }),
      fields: ['id', 'key', 'name'],
      sort: 'name',
      limit: -1,
    })
    return {
      data: (result.data ?? []).map((row) => ({
        id: String(row.id),
        key: String(row.key ?? ''),
        name: String(row.name ?? ''),
      })),
    }
  } catch {
    return { data: [] as Array<{ id: string; key: string; name: string }> }
  }
})
