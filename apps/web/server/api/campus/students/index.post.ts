import { z } from 'zod'
import { assertPersonGuardian, campusStudentScopeFilter } from '../../../utils/campus'
import {
  createItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../../utils/portal'

const studentFormSchema = z.object({
  person: z.string().uuid('Choose a person'),
  institution: z.string().uuid().nullish(),
  course: z.string().max(200).nullish(),
  level: z
    .enum([
      'freshman',
      'sophomore',
      'junior',
      'senior',
      'final_year',
      'graduated',
      'other',
    ])
    .default('freshman'),
  admission_year: z.number().int().min(1900).max(2100).nullish(),
  graduation_year: z.number().int().min(1900).max(2100).nullish(),
  coordinator: z.string().uuid().nullish(),
  afcf_handshake_status: z
    .enum(['not_contacted', 'contacted', 'connected', 'active', 'declined'])
    .default('not_contacted'),
  afcmf_linked: z.boolean().default(false),
  nysc_status: z
    .enum([
      'not_deployed',
      'waiting_callup',
      'deployed',
      'serving',
      'completed',
      'exempt',
    ])
    .default('not_deployed'),
  nysc_deployment: z.string().max(300).nullish(),
  next_checkup_date: z.string().date().nullish(),
  branch: z.string().uuid().nullish(),
  zone: z.string().uuid().nullish(),
  status: z.enum(['active', 'inactive', 'graduated']).default('active'),
  notes: z.string().max(2000).nullish(),
})

/**
 * POST /api/campus/students — enrol a campus student (US-C4 AC1).
 *
 * One person may hold successive student rows across institutions (person
 * is required but NOT unique — migration 0003 choice). Branch resolves to
 * the caller's own branch for branch staff; area staff name one. Zone is
 * backfilled from the branch by Flow where the branch is known; an explicit
 * zone outside scope is a 403. financial_support_total is never accepted
 * in the body — it is Flow-maintained (derived Σ disbursed).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_students', 'create')

  const parsed = studentFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (
    form.admission_year != null &&
    form.graduation_year != null &&
    form.admission_year > form.graduation_year
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Graduation year cannot precede admission year',
      data: {
        code: 'validation_error',
        fields: { graduation_year: 'Must be on or after the admission year' },
      },
    })
  }

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a student with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone ?? null, visibleZones)

  // Touch the predicate so an out-of-scope branch/zone combination fails
  // the same way the list route fails it (fail-closed, one rule).
  await campusStudentScopeFilter(event, scope, { branch, zone: form.zone })

  // F2: enrol must not accept a bare minor person id — the linked person
  // must exist and carry a guardian when under 18 (same 400 as people POST).
  await assertPersonGuardian(event, scope, form.person)

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'campus_students',
    {
      person: form.person,
      institution: form.institution ?? null,
      course: form.course ?? null,
      level: form.level,
      admission_year: form.admission_year ?? null,
      graduation_year: form.graduation_year ?? null,
      coordinator: form.coordinator ?? null,
      afcf_handshake_status: form.afcf_handshake_status,
      afcmf_linked: form.afcmf_linked,
      nysc_status: form.nysc_status,
      nysc_deployment: form.nysc_deployment ?? null,
      next_checkup_date: form.next_checkup_date ?? null,
      branch,
      zone: form.zone ?? null,
      status: form.status,
      notes: form.notes ?? null,
      created_at: now,
      updated_at: now,
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
