import { youthProfileFormSchema } from '@afc/shared'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/youth — link a youth profile to a shared-DB person (US-Y1).
 *
 * The person link is the whole point: youth is a segment of the church DB,
 * not a second store (US-Y1 AC2), so the body takes a person id and never
 * a name. The person must be inside the caller's scope (a cross-scope id
 * is a 404, never a foreign link) and must not already have a profile
 * (1-1, migration 0012 UNIQUE -- the 409 names the conflict instead of
 * letting Postgres report it). The create writes a youth_profile_events
 * `created` row in the same request -- the portal is the writer, the table
 * is the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'youth_profiles', 'create')

  const parsed = youthProfileFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // The person is read inside the caller's scope: DOB never enters this
  // request (fields are names only); is_minor is not consulted here --
  // youth eligibility is the is_youth flag / profile link, not a gate.
  await findScopedItem(event, scope, 'people', form.person, {
    fields: ['id'],
  })

  const existing = await listItems<{ id: string }>(event, scope, 'youth_profiles', {
    filter: { person: { _eq: form.person } },
    fields: ['id'],
    limit: 1,
  })
  if (existing.data.length > 0) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That person already has a youth profile',
      data: { code: 'conflict', fields: { person: 'Link the existing profile instead' } },
    })
  }

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a youth profile with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'youth_profiles',
    {
      person: form.person,
      education_level: form.education_level ?? null,
      institution: form.institution ?? null,
      course: form.course ?? null,
      study_level: form.study_level ?? null,
      employment_status: form.employment_status ?? null,
      professional_status: form.professional_status ?? null,
      is_entrepreneur: form.is_entrepreneur ?? false,
      youth_leadership_role: form.youth_leadership_role ?? null,
      branch,
      zone: form.zone ?? null,
      status: form.status ?? 'active',
      created_at: now,
      updated_at: now,
    },
  )

  await createItem(event, scope, 'youth_profile_events', {
    profile: String(created.id),
    event_type: 'created',
    detail: `Youth profile linked for ${form.person}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
