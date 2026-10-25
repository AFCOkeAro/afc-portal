import type { ExpenseRow } from '../../../../types/portal'
import {
  eventScopeFilter,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
  throwStoreUnavailable,
  visibleFields,
  zoneScopeFilter,
} from '../../../utils/portal'

const EXPENSE_FIELDS = [
  'id',
  'event',
  'branch',
  'zone',
  'category',
  'category_other_label',
  'amount',
  'currency',
  'spent_on',
  'receipt',
  'notes',
  'recorded_by',
  'created_at',
]

/**
 * GET /api/events/:id/expenses — scoped expense list (AFC-801, US-E1).
 *
 * The event must be in the caller's scope (fail-closed 404 otherwise); the
 * expense rows are then bounded to that event AND the caller's branch/zone
 * predicate, so a cross-branch expense recorded against a shared event
 * stays out of a narrower session. Amounts follow the §10 matrix through
 * the shared field restriction (`eventExpenses` hides amount/notes from
 * non-finance roles); the branch-admin-own scoping is the query predicate.
 * Totals are folded client-side from this list (no separate endpoint).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_expenses', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'An event id is required' })

  // AFC-801: the list hits the 0044 register. An unreadable store maps to
  // the named error, never a bare 500. Deliberate 4xx (scope 404s) pass
  // through untouched.
  try {
    await findScopedItem<Record<string, unknown>>(event, scope, 'events', id, {
      fields: ['id', 'branch'],
      scope: eventScopeFilter(scope),
    })

    const result = await listItems<ExpenseRow>(event, scope, 'event_expenses', {
      filter: mergeFilters(
        { event: { _eq: id } },
        scope.isArea
          ? undefined
          : scope.zoneIds.length > 0
            ? zoneScopeFilter(scope)
            : scopeFilter(scope),
      ),
      fields: visibleFields(scope, 'event_expenses', EXPENSE_FIELDS),
      sort: 'spent_on,created_at',
      limit: -1,
    })

    const rows = stripHiddenMany(
      scope,
      'event_expenses',
      result.data as unknown as Record<string, unknown>[],
    ).map((row) => ({
      ...row,
      id: String(row.id),
    }))

    return { data: rows }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'expense_store', '0044')
  }
})
