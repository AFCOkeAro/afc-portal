import { outreachSecretaryFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
} from '../../../../utils/portal'

/**
 * POST /api/outreach-locations/:id/secretaries — assign a secretary.
 * The location and the person are both scope-gated; duplicates are refused
 * by the 0051 unique pair (surfaced as a 400, not a bare 500).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_location_secretaries', 'create')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A location id is required' })
  try {
    await findScopedItem(event, scope, 'outreach_locations', id, { fields: ['id'] })

    const parsed = outreachSecretaryFormSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)

    await findScopedItem(event, scope, 'people', parsed.data.person, { fields: ['id'] })
    try {
      const created = await createItem<Record<string, unknown>>(
        event,
        scope,
        'outreach_location_secretaries',
        {
          location: id,
          person: parsed.data.person,
          created_by: scope.session.user.id,
        },
      )
      return { data: { ...created, id: String(created.id) } }
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throw createError({
        statusCode: 400,
        statusMessage: 'That person is already assigned to this location',
        data: { code: 'duplicate_assignment' },
      })
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
