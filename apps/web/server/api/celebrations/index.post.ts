import { celebrationFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'
import { readCelebrationPerson } from '../../utils/celebration-feed'

/**
 * POST /api/celebrations — record a celebration or shout-out (US-Y2/US-Y3).
 *
 * The person must be inside the caller's scope (a cross-scope id is a 404,
 * never a foreign greeting); the branch resolves to the caller's own for
 * branch staff. The minor safeguard fires here: a celebration for a minor
 * (is_minor, Flow-derived) is refused without guardian_consent = true
 * (register.post.ts guardian precedent). DOB is never read -- the route
 * asks the person row only for is_minor. New rows land as `draft`: the
 * shout-out publish path moves them through approved to published via
 * the transition endpoint, which is where publish_channels gets written.
 * The create writes a celebration_events `created` row in the same
 * request -- the portal is the writer, the table is the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'create')

  const parsed = celebrationFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const person = await readCelebrationPerson(event, scope, form.person)
  if (person.is_minor === true && form.guardian_consent !== true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Guardian consent is required for a celebration naming a minor',
      data: {
        code: 'validation_error',
        fields: { guardian_consent: 'Confirm guardian consent first' },
      },
    })
  }

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a celebration with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'celebrations',
    {
      person: form.person,
      type: form.type,
      event_date: form.event_date,
      is_recurring: form.is_recurring ?? false,
      title: form.title ?? null,
      message: form.message ?? null,
      visibility: form.visibility ?? 'internal',
      publish_channels: form.publish_channels ?? [],
      branch,
      zone: form.zone ?? null,
      status: 'draft',
      guardian_consent: form.guardian_consent ?? false,
      created_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )

  await createItem(event, scope, 'celebration_events', {
    celebration: String(created.id),
    event_type: 'created',
    detail: `${form.type.replace(/_/g, ' ')} recorded for ${form.event_date}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
