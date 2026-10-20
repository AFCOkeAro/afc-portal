import { z } from 'zod'
import {
  COACHING_ATTENDANCE_FIELDS,
  visibleProgrammeIds,
} from '../../../utils/campus'
import { directusFetch } from '../../../utils/directus'
import {
  createItem,
  getPortalScope,
  requireCan,
  throwValidation,
  updateItem,
} from '../../../utils/portal'

const markFormSchema = z.object({
  timetable: z.string().uuid().nullish(),
  programme: z.string().uuid().nullish(),
  class_date: z.string().date('Class date must be YYYY-MM-DD'),
  campus_student: z.string().uuid().nullish(),
  person: z.string().uuid().nullish(),
  present: z.boolean().default(true),
})

/**
 * POST /api/campus/attendance — mark class attendance (US-C2 AC1).
 *
 * Idempotent per (timetable, student, date): re-marking the same identity
 * for the same session+date updates the existing row (the four partial
 * uniques in migration 0003 are the backstop; this read-then-write is the
 * portal path). Session needs at least one of timetable/programme
 * (migration CHECK); the student side needs exactly one of
 * campus_student/person. The programme (or the slot's programme) must be
 * inside the caller's visible set.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_class_attendance', 'create')

  const parsed = markFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (!form.timetable && !form.programme) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A timetable slot or a programme is required',
      data: {
        code: 'validation_error',
        fields: { timetable: 'Choose a slot or a programme' },
      },
    })
  }
  const hasStudent = form.campus_student ? 1 : 0
  const hasPerson = form.person ? 1 : 0
  if (hasStudent + hasPerson !== 1) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Choose exactly one student identity',
      data: {
        code: 'validation_error',
        fields: { campus_student: 'Link one campus student or one person' },
      },
    })
  }

  // Resolve the owning programme for the scope check: a slot mark resolves
  // through its timetable's programme; a general mark names it directly.
  let owningProgramme: string | null = form.programme ?? null
  if (form.timetable) {
    const slot = await directusFetch<{ data: Record<string, unknown> }>(
      event,
      `/items/coaching_timetable/${form.timetable}`,
      {
        accessToken: scope.token,
        query: { fields: 'id,programme' },
      },
    ).catch(() => {
      throw createError({
        statusCode: 404,
        statusMessage: 'That timetable slot was not found in your scope',
        data: { code: 'not_found' },
      })
    })
    owningProgramme = String(slot.data.programme ?? '')
    if (!owningProgramme) {
      throw createError({
        statusCode: 400,
        statusMessage: 'That slot has no programme and cannot be scoped',
        data: { code: 'unscoped_session' },
      })
    }
  }

  if (!scope.isArea && owningProgramme) {
    const visible = await visibleProgrammeIds(event, scope)
    if (!visible.includes(owningProgramme)) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That programme was not found in your scope',
        data: { code: 'not_found' },
      })
    }
  }

  const identityFilter = form.campus_student
    ? { campus_student: { _eq: form.campus_student } }
    : { person: { _eq: form.person } }
  const sessionFilter = form.timetable
    ? { timetable: { _eq: form.timetable } }
    : { programme: { _eq: form.programme } }

  const existing = await directusFetch<{
    data: Array<Record<string, unknown>>
  }>(event, '/items/coaching_class_attendance', {
    accessToken: scope.token,
    query: {
      fields: COACHING_ATTENDANCE_FIELDS.join(','),
      limit: 1,
      filter: {
        _and: [
          sessionFilter,
          identityFilter,
          { class_date: { _eq: form.class_date } },
        ],
      },
    },
  })

  const now = new Date().toISOString()
  const current = existing.data[0]
  if (current?.id != null) {
    requireCan(scope, 'coaching_class_attendance', 'update')
    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'coaching_class_attendance',
      String(current.id),
      { present: form.present, updated_at: now },
    )
    return {
      data: { ...updated, id: String(updated.id ?? current.id) },
      meta: { idempotent: true },
    }
  }

  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_class_attendance',
    {
      timetable: form.timetable ?? null,
      programme: form.programme ?? null,
      class_date: form.class_date,
      campus_student: form.campus_student ?? null,
      person: form.person ?? null,
      present: form.present,
      marked_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )
  return {
    data: { ...created, id: String(created.id) },
    meta: { idempotent: false },
  }
})
