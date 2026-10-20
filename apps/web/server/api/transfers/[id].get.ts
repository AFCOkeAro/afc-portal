import { findScopedItem, getPortalScope, listItems, requireCan } from '../../utils/portal'
import { transferScope } from '../../utils/office'

/**
 * GET /api/transfers/:id — scoped detail with the audit trail.
 *
 * Out-of-scope ids 404 (fail-closed): the scope predicate is part of the
 * lookup, so a cross-branch id is indistinguishable from a missing one.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'transfers', 'read')

  const id = String(getRouterParam(event, 'id'))
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'transfers',
    id,
    {
      scope: transferScope(scope),
    },
  )
  const trail = await listItems<Record<string, unknown>>(
    event,
    scope,
    'transfer_events',
    {
      filter: { transfer: { _eq: id } },
      sort: 'created_at',
      limit: 100,
    },
  )
  return { data: row, audit: trail.data }
})
