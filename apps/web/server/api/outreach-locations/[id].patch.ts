import { outreachLocationPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'

/**
 * PATCH /api/outreach-locations/:id — correct a mission field.
 * Branch/zone are write-once (stamped at create); everything operational
 * stays editable.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_locations', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A location id is required' })
  try {
    await findScopedItem(event, scope, 'outreach_locations', id, { fields: ['id'] })

    const parsed = outreachLocationPatchSchema.safeParse(await readBody(event))
    if (!parsed.success) throwValidation(parsed.error)
    const form = parsed.data
    if (Object.keys(form).length === 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nothing to update',
        data: { code: 'validation_error' },
      })
    }
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'outreach_locations',
      id,
      {
        ...(form.name !== undefined ? { name: form.name } : {}),
        ...(form.category !== undefined ? { category: form.category } : {}),
        ...(form.address !== undefined ? { address: form.address ?? null } : {}),
        ...(form.ownership !== undefined ? { ownership: form.ownership } : {}),
        ...(form.contact_name !== undefined
          ? { contact_name: form.contact_name ?? null }
          : {}),
        ...(form.contact_phone !== undefined
          ? { contact_phone: form.contact_phone ?? null }
          : {}),
        ...(form.visiting_days !== undefined
          ? { visiting_days: form.visiting_days ?? null }
          : {}),
        ...(form.notes !== undefined ? { notes: form.notes ?? null } : {}),
      },
    )
    return { data: updated }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
