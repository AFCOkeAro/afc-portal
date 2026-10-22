import { requireArea } from '../../utils/admin-guard'
import { bundlesWithModules } from '../../utils/admin-catalog'

/**
 * GET /api/admin/bundles — assignable module-bundle presets (AFC-669).
 * A bundle is a staff role plus its scope contract; assigning one to a
 * person is setting their staff role and scope links (People tab).
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  return { data: bundlesWithModules() }
})
