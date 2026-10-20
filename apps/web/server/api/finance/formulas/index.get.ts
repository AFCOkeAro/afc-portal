import type { WecaFormulaRow } from '../../../../types/finance'
import { getPortalScope, listItems, requireCan } from '../../../utils/portal'

/**
 * GET /api/finance/formulas — the board-ratified formula schedule (AFC-475).
 *
 * Read-only by construction: this directory holds no POST, PATCH, or DELETE
 * for `weca_return_formulas`, matching the migration grant (SELECT only for
 * the app). A future board revision lands as a reviewed migration row (A3),
 * never as an app write. Returns select their `formula_version` from these
 * rows -- rates live here, never in client code.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'weca_return_formulas', 'read')

  const result = await listItems<WecaFormulaRow>(event, scope, 'weca_return_formulas', {
    fields: ['version', 'effective_from', 'rules', 'notes'],
    sort: 'effective_from',
    limit: 50,
  })

  return { data: result.data, meta: result.meta }
})
