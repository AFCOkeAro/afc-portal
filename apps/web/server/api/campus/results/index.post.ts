import { z } from 'zod'
import {
  assertPersonGuardian,
  assertStudentInScope,
  stripResult,
} from '../../../utils/campus'
import {
  createItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const resultFormSchema = z
  .object({
    campus_student: z.string().uuid().nullish(),
    person: z.string().uuid().nullish(),
    exam: z.enum(['waec', 'utme', 'admission']),
    exam_year: z.number().int().min(1900).max(2100).nullish(),
    scores: z.record(z.unknown()).default({}),
    aggregate: z.string().max(50).nullish(),
    status: z
      .enum(['pending', 'passed', 'failed', 'admitted', 'not_admitted'])
      .default('pending'),
    institution: z.string().max(300).nullish(),
  })
  .refine((form) => (form.campus_student ? 1 : 0) + (form.person ? 1 : 0) === 1, {
    message: 'Link one campus student or one person',
    path: ['campus_student'],
  })
  .refine(
    (form) =>
      form.exam !== 'admission' ||
      (form.status !== 'passed' && form.status !== 'failed'),
    { message: 'Admission results use admitted/not admitted', path: ['status'] },
  )
  .refine(
    (form) =>
      form.exam === 'admission' ||
      (form.status !== 'admitted' && form.status !== 'not_admitted'),
    { message: 'WAEC/UTME results use passed/failed', path: ['status'] },
  )

/**
 * POST /api/campus/results — record a WAEC/UTME/admission result
 * (US-C3 AC1/AC2).
 *
 * One result per (student, exam, year) is a partial-unique at the DB layer;
 * a re-recorded diet surfaces as a 409, not a silent second row. The
 * student must sit inside the caller's scope (fail-closed for person-linked
 * rows with no branch). Admission results name the institution (AC2). The
 * response strips scores/aggregate for roles outside the §11.1 read set.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'exam_results', 'create')

  const parsed = resultFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // Scope check against the student row itself: a non-area session may
  // only record results for a student whose branch/zone they hold. A
  // student with no branch (person-linked, unscoped) is fail-closed.
  // F1: always resolve (area staff included) so the F2 guardian check has
  // the linked person without a second fetch drifting from the scope read.
  const studentRow = await assertStudentInScope(event, scope, {
    campus_student: form.campus_student,
    person: form.person,
  })

  // F2: person-identity writes (or the person behind a campus_student row)
  // must not link a minor without a guardian.
  if (form.person) {
    await assertPersonGuardian(event, scope, form.person)
  } else {
    const linkedPerson = studentRow.person
    if (linkedPerson != null && String(linkedPerson).length > 0) {
      await assertPersonGuardian(event, scope, String(linkedPerson))
    }
  }

  const now = new Date().toISOString()
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'exam_results',
      {
        campus_student: form.campus_student ?? null,
        person: form.person ?? null,
        exam: form.exam,
        exam_year: form.exam_year ?? null,
        scores: form.scores,
        aggregate: form.aggregate ?? null,
        status: form.status,
        institution: form.institution ?? null,
        recorded_by: scope.session.user.id,
        created_at: now,
        updated_at: now,
      },
    )
    return {
      data: stripResult(scope, { ...created, id: String(created.id) }),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/duplicate|unique|23505/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A result already exists for that student, exam and year',
        data: { code: 'duplicate_result' },
      })
    }
    throw error
  }
})
