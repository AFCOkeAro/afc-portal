import type { BudgetRow } from '../../../../../types/portal'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
  throwStoreUnavailable,
  visibleFields,
} from '../../../../utils/portal'

const BUDGET_FIELDS = [
  'id',
  'event',
  'category_key',
  'amount',
  'notes',
  'recorded_by',
  'created_at',
]

/**
 * GET /api/events/:id/budgets — latest planned line per category (AFC-825).
 *
 * The event must be in the caller's scope (fail-closed 404 otherwise); rows
 * are the latest per category (append-only history, revision = new row).
 * Amounts follow the §10 matrix through the shared field restriction
 * (budgets mirror the expense finance set); the branch-admin-own scoping is
 * the event predicate. Variance against spend is folded client-side from
 * the scoped expense list (no separate endpoint).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_budgets', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  try {
    await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: ['id', 'branch'],
      scope: eventScopeFilter(scope),
    })

    const result = await listItems<BudgetRow>(event, scope, 'event_budgets', {
      filter: { event: { _eq: id } },
      fields: visibleFields(scope, 'event_budgets', BUDGET_FIELDS),
      sort: '-created_at',
      limit: -1,
    })

    const seen = new Set<string>()
    const latest = (result.data as unknown as Record<string, unknown>[]).filter((row) => {
      const key = String(row.category_key)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const rows = stripHiddenMany(scope, 'event_budgets', latest).map((row) => ({
      ...row,
      id: String(row.id),
    }))
    return { data: rows }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'budget store', '0045')
  }
})
