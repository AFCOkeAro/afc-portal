import { getPortalScope, requireCan, deleteItem } from '../../utils/portal'
import { requireArea } from '../../utils/admin-guard'

/**
 * DELETE /api/custom-forms/:id — withdraw a definition (AFC-897).
 * Area-only: definitions are global taxonomy. Rows ever submitted through
 * the form stay in their own registers; only the definition goes.
 * Phase 1 has no edit path (versioning is later): a mistaken definition
 * is deleted and recreated, never silently rewritten.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'custom_forms', 'read')
  requireArea(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A form id is required' })
  }
  await deleteItem(event, scope, 'custom_forms', id)
  return { data: { id } }
})
