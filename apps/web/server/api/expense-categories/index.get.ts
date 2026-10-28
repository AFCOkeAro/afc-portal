import { getPortalScope, listItems, requireCan } from '../../utils/portal'

/**
 * GET /api/expense-categories — the spend taxonomy (AFC-825). Active keys
 * ordered for form selects; staff-readable (the expense and budget forms
 * need the list). Writes ride the area-only POST next door.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_expenses', 'read')

  const result = await listItems<{
    key: string
    label: string
    sort: number
    active: boolean
  }>(event, scope, 'expense_categories', {
    filter: { active: { _eq: true } },
    fields: ['key', 'label', 'sort', 'active'],
    sort: 'sort',
    limit: -1,
  })
  return { data: result.data }
})
