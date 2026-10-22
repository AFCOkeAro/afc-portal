import { blessingUpdateSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  resolveBranch,
  throwValidation,
  updateItem,
  zoneScopeFilter,
} from '../../utils/portal'

/**
 * PATCH /api/blessings/:id — correct a blessing record (US-B1 AC3).
 *
 * Edits are audited: the update writes a blessing_events `updated` row in
 * the same request with the session user as actor. total_count is not an
 * accepted field -- it re-derives from the edited counts in Postgres.
 * Single-count (AFC-671): sending `count` mirrors male_count = count,
 * female_count = 0 so GENERATED total stays equal to the count.
 * A cross-scope id is a 404 (findScopedItem), never a foreign edit.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessings', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A blessing id is required' })

  const parsed = blessingUpdateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  await findScopedItem(event, scope, 'blessings', id, {
    fields: ['id'],
    scope: scope.isArea
      ? {}
      : scope.zoneIds.length > 0
        ? zoneScopeFilter(scope)
        : { branch: { _in: scope.branchIds } },
  })

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updated_at: now }
  for (const [key, value] of Object.entries(form)) {
    if (value !== undefined) patch[key] = value
  }
  // Single-count mirror (AFC-671): a sent count carries male, clears
  // female, so GENERATED total re-derives to exactly the count.
  if (form.count !== undefined && form.count !== null) {
    patch.count = form.count
    patch.male_count = form.count
    patch.female_count = 0
  }
  // Branch moves stay inside the caller's scope: resolveBranch 403s on a
  // branch outside it; area staff may re-scope freely.
  if (form.branch !== undefined) {
    patch.branch = resolveBranch(scope, form.branch)
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'blessings',
    id,
    patch,
  )

  await createItem(event, scope, 'blessing_events', {
    blessing: id,
    event_type: 'updated',
    detail: `Record edited (${
      Object.keys(patch)
        .filter((key) => key !== 'updated_at')
        .join(', ') || 'no fields'
    })`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...updated, id: String(updated.id) } }
})
