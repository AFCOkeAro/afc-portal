import { isCustomFormModule } from '@afc/shared'
import { getPortalScope, requireCan } from '../../utils/portal'
import { readModuleColumns } from '../../utils/custom-forms'

/**
 * GET /api/custom-forms/fields?module=visitors — the DB-backed field
 * picker source (AFC-897). Lists the drawable live columns of the linked
 * module with their database kinds and required-from-DB flags, so the
 * builder offers what the database has and the create route enforces
 * coverage of the NOT NULL-no-default columns against this same list.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'custom_forms', 'read')

  const query = getQuery(event)
  const raw = query.module
  const module = typeof raw === 'string' ? raw : ''
  if (!isCustomFormModule(module)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Name a v1 module to list its fields',
      data: { code: 'unknown_module' },
    })
  }
  const columns = await readModuleColumns(event, module)
  return { data: { module, fields: columns } }
})
