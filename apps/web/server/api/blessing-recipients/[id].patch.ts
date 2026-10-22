import { blessingRecipientUpdateSchema } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
  zoneScopeFilter,
} from '../../utils/portal'

/**
 * PATCH /api/blessing-recipients/:id — correct an individual blessing
 * (AFC-671 §C). No DELETE anywhere: individual blessings are ministry
 * facts; corrections are UPDATEs. A cross-scope id is a 404
 * (findScopedItem), never a foreign edit.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessing_recipients', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: 'A blessing recipient id is required',
    })

  const parsed = blessingRecipientUpdateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  await findScopedItem(event, scope, 'blessing_recipients', id, {
    fields: ['id'],
    scope: scope.isArea
      ? {}
      : scope.zoneIds.length > 0
        ? zoneScopeFilter(scope)
        : { branch: { _in: scope.branchIds } },
  })

  if (form.person) {
    await findScopedItem(event, scope, 'people', form.person, {
      fields: ['id'],
    })
  }

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) patch[key] = value
  }
  if (form.branch !== undefined) {
    patch.branch = resolveBranch(scope, form.branch)
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'blessing_recipients',
    id,
    patch,
  )

  return { data: { ...updated, id: String(updated.id) } }
})
