import { z } from 'zod'
import {
  assertNyscTransition,
  CAMPUS_STUDENT_FIELDS,
  campusStudentScopeFilter,
  isLevelProgression,
  stripStudent,
} from '../../../utils/campus'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const studentPatchSchema = z.object({
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
    .optional(),
  graduation_year: z.number().int().min(1900).max(2100).nullish(),
  coordinator: z.string().uuid().nullish(),
  afcf_handshake_status: z
    .enum(['not_contacted', 'contacted', 'connected', 'active', 'declined'])
    .optional(),
  afcmf_linked: z.boolean().optional(),
  nysc_status: z
    .enum([
      'not_deployed',
      'waiting_callup',
      'deployed',
      'serving',
      'completed',
      'exempt',
    ])
    .optional(),
  nysc_deployment: z.string().max(300).nullish(),
  next_checkup_date: z.string().date().nullish(),
  status: z.enum(['active', 'inactive', 'graduated']).optional(),
  notes: z.string().max(2000).nullish(),
})

/**
 * PATCH /api/campus/students/:id — undergraduate progression, check-ups,
 * AFCF handshake, NYSC deployment (US-C4 AC1, US-C5).
 *
 * Level moves never regress (freshman → … → final_year → graduated;
 * `other` is unordered and always allowed). NYSC moves are validated
 * against the seeded `nysc_status_transitions` graph — a skip-step move
 * (e.g. not_deployed → serving) is a 400. Branch/zone/person/institution
 * links are immutable here (a transfer is a new row or an office matter,
 * not an edit). financial_support_total is never accepted.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_students', 'update')

  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A student id is required',
      data: { code: 'validation_error' },
    })
  }

  const parsed = studentPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const scopeFilter = await campusStudentScopeFilter(event, scope, {})
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'campus_students',
    id,
    { fields: CAMPUS_STUDENT_FIELDS, scope: scopeFilter },
  ).catch(() => {
    throw createError({
      statusCode: 404,
      statusMessage: 'That student was not found in your scope',
      data: { code: 'not_found' },
    })
  })

  if (
    form.level &&
    !isLevelProgression(
      typeof row.level === 'string' ? row.level : null,
      form.level,
    )
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `Level cannot regress from ${row.level} to ${form.level}`,
      data: {
        code: 'invalid_level_transition',
        fields: { level: `Cannot move from ${row.level} to ${form.level}` },
      },
    })
  }

  if (
    form.nysc_status &&
    typeof row.nysc_status === 'string' &&
    form.nysc_status !== row.nysc_status
  ) {
    await assertNyscTransition(event, scope, row.nysc_status, form.nysc_status)
  }

  const body: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  for (const key of [
    'course',
    'level',
    'graduation_year',
    'coordinator',
    'afcf_handshake_status',
    'afcmf_linked',
    'nysc_status',
    'nysc_deployment',
    'next_checkup_date',
    'status',
    'notes',
  ] as const) {
    if (form[key] !== undefined) body[key] = form[key]
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'campus_students',
    id,
    body,
  )

  return { data: stripStudent(scope, { ...updated, id: String(updated.id ?? id) }) }
})
