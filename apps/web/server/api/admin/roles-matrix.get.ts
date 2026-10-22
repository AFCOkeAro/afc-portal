import { STAFF_ROLES } from '@afc/shared'
import { grantsForRole } from '@afc/shared/role-matrix'
import { requireArea } from '../../utils/admin-guard'
import { buildModules } from '../../utils/admin-catalog'

/**
 * GET /api/admin/roles-matrix — module catalog with per-role visibility
 * (AFC-669). Area admins only. Built server-side: the UI must not import
 * the role matrix (data-model §13 rule 7).
 */
export default defineEventHandler(async (event) => {
  await requireArea(event)
  return {
    roles: (STAFF_ROLES as readonly string[])
      .filter((role) => role !== 'none')
      .map((role) => ({
        staffRole: role,
        grants: grantsForRole(role as never),
      })),
    modules: buildModules(),
  }
})
