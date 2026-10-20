import { celebrationUpdateSchema } from '@afc/shared'
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
import { readCelebrationPerson } from '../../utils/celebration-feed'

/**
 * PATCH /api/celebrations/:id — correct a draft/approved celebration.
 *
 * Status moves are NOT accepted here: they go through the transition
 * endpoint, which validates the draft -> approved -> published -> archived
 * graph and writes the matching lifecycle audit row. A published or
 * archived row is immutable here (a correction after publish is a new
 * transition, reviewed, not a silent PATCH). The minor safeguard re-fires:
 * clearing guardian_consent on a minor's row is refused. A cross-scope id
 * is a 404 (findScopedItem), never a foreign edit.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'update')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A celebration id is required' })

  const body = (await readBody(event)) as Record<string, unknown>
  // Status is not in the update schema on purpose: moves go through the
  // transition endpoint. Zod strips unknown keys silently, so the refusal
  // has to look at the raw body -- otherwise a status smuggled into a
  // field edit would pass validation and vanish without an audit row.
  if (body.status !== undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Move status through the transition endpoint, not a field edit',
      data: {
        code: 'validation_error',
        fields: { status: 'Use the approve/publish flow' },
      },
    })
  }

  const parsed = celebrationUpdateSchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const existing = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'celebrations',
    id,
    {
      fields: ['id', 'person', 'status', 'guardian_consent'],
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  if (existing.status === 'published' || existing.status === 'archived') {
    throw createError({
      statusCode: 400,
      statusMessage: `A ${existing.status} celebration cannot be edited here`,
      data: { code: 'immutable_state' },
    })
  }

  const personId = form.person ?? String(existing.person)
  const person = await readCelebrationPerson(event, scope, personId)
  const consentStays =
    form.guardian_consent ??
    (existing as { guardian_consent?: boolean }).guardian_consent ??
    false
  if (person.is_minor === true && consentStays !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Guardian consent is required for a celebration naming a minor',
      data: {
        code: 'validation_error',
        fields: { guardian_consent: 'Confirm guardian consent first' },
      },
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
    'celebrations',
    id,
    patch,
  )

  await createItem(event, scope, 'celebration_events', {
    celebration: id,
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
