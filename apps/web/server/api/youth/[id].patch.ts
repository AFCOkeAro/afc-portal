import { youthProfileUpdateSchema } from '@afc/shared'
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
 * PATCH /api/youth/:id — correct a youth profile (US-Y1 AC2: edits shared).
 *
 * Edits are audited: the update writes a youth_profile_events `updated` row
 * in the same request with the session user as actor. The person link is
 * immutable here -- a 1-1 child does not move between people; a wrong link
 * is a new profile, reviewed, not a PATCH. A cross-scope id is a 404
 * (findScopedItem), never a foreign edit.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'youth_profiles', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: 'A youth profile id is required',
    })

  const parsed = youthProfileUpdateSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  await findScopedItem(event, scope, 'youth_profiles', id, {
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
  if (form.branch !== undefined) {
    patch.branch = resolveBranch(scope, form.branch)
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'youth_profiles',
    id,
    patch,
  )

  await createItem(event, scope, 'youth_profile_events', {
    profile: id,
    event_type: 'updated',
    detail: `Profile edited (${
      Object.keys(patch)
        .filter((key) => key !== 'updated_at')
        .join(', ') || 'no fields'
    })`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...updated, id: String(updated.id) } }
})
