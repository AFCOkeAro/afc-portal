import { householdPatchSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
} from '../../utils/portal'

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'update')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A household id is required' })
  }
  await findScopedItem(event, scope, 'households', id, { fields: ['id'] })

  const parsed = householdPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const payload: Record<string, unknown> = {}
  if (form.name !== undefined) payload.name = form.name
  if (form.branch !== undefined) payload.branch = resolveBranch(scope, form.branch)
  if (form.address !== undefined) payload.address = form.address ?? null
  if (form.phone !== undefined) payload.phone = form.phone ?? null
  if (form.wedding_date !== undefined) payload.wedding_date = form.wedding_date ?? null
  if (form.household_head !== undefined) {
    if (form.household_head) {
      await findScopedItem(event, scope, 'people', form.household_head, {
        fields: ['id'],
      })
    }
    payload.household_head = form.household_head ?? null
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'households',
    id,
    payload,
  )
  return { data: { ...updated, id: String(updated.id) } }
})
