import { isCustomFormModule } from '@afc/shared'
import {
  getPortalScope,
  listItems,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'

/** GET /api/custom-forms?module= — the form register (AFC-897). */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'custom_forms', 'read')

  const query = getQuery(event)
  const raw = query.module
  const module = typeof raw === 'string' && raw.length > 0 ? raw : undefined
  if (module !== undefined && !isCustomFormModule(module)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom forms link to a v1 module',
      data: { code: 'unknown_module' },
    })
  }
  try {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'custom_forms',
      {
        filter: module ? { module: { _eq: module } } : {},
        fields: ['id', 'name', 'module', 'schema', 'created_at'],
        sort: 'name',
        page: 1,
        limit: 100,
      },
    )
    return { data: result.data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'custom_form_store', '0061')
  }
})
