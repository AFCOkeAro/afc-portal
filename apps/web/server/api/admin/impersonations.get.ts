import { IMPERSONATION_AUDIT_COLLECTION } from '@afc/shared'
import { getPortalScope, listItems, throwStoreUnavailable } from '../../utils/portal'
import { DirectusAuthError } from '../../utils/directus'

/**
 * GET /api/admin/impersonations — audit list (AFC-684).
 *
 * Area admins (and super admins) only. Zone admins start previews but do not
 * get the area-wide log; branch staff get a 403. Failures map to named
 * 403/503 codes — never a bare 500, never a degraded empty list.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  // Area-wide log for area staff only (AFC-684 §B). Zone admins start
  // previews but do not get the area-wide log; branch staff get a 403.
  // `requireCan(users, read)` would admit super_admin only (matrix §10 gives
  // area_admin no user grant), so the gate is `isArea`, not a collection.
  if (!scope.isArea) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only area admins may read the impersonation log',
      data: { code: 'impersonation_log_forbidden' },
    })
  }

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page ?? 1) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 25) || 25))

  try {
    const result = await listItems<Record<string, unknown>>(event, scope, IMPERSONATION_AUDIT_COLLECTION, {
      page,
      limit,
      sort: '-started_at',
      fields: ['id', 'actor', 'target_user', 'target_branch', 'target_zone', 'action', 'reason', 'started_at'],
    })
    return result
  } catch (error) {
    if (error instanceof DirectusAuthError) {
      throw createError({
        statusCode: 403,
        statusMessage: 'The impersonation log refused this read — sign in again or ask for read access',
        data: { code: 'impersonation_log_forbidden' },
      })
    }
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throwStoreUnavailable(error, 'impersonation_log', '0037')
  }
})
