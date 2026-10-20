import { collectPeopleSummary } from '../../utils/people-summary'
import { getPortalScope, requireCan } from '../../utils/portal'

/**
 * People dashboard summary (AFC-576).
 *
 * GET /api/people/summary — permission-scoped like the list route: staff
 * session, `people` read grant, caller branches only (scopeFilter). The
 * household/zone side additionally needs the `households` read grant; when
 * the caller lacks it the people figures still hold and `households_visible`
 * is false with empty household figures (fail-closed, never foreign rows).
 *
 * Aggregates only — no DOB, address, or names in the payload. Gender is
 * male/female with `not_recorded` as a data-quality footnote (the model
 * default is `unspecified`; no further categories are invented).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')

  const summary = await collectPeopleSummary(event, scope)
  return { data: summary }
})
