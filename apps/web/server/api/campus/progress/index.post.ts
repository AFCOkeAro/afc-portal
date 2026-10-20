import { z } from 'zod'
import {
  assertPersonGuardian,
  assertStudentInScope,
  visibleProgrammeIds,
} from '../../../utils/campus'
import {
  createItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const progressFormSchema = z
  .object({
    campus_student: z.string().uuid().nullish(),
    person: z.string().uuid().nullish(),
    programme: z.string().uuid('Choose a programme'),
    assessment: z.string().max(200).nullish(),
    score: z.number().min(0).nullish(),
    max_score: z.number().positive().nullish(),
    progress_date: z.string().date().nullish(),
    remarks: z.string().max(2000).nullish(),
  })
  .refine((form) => (form.campus_student ? 1 : 0) + (form.person ? 1 : 0) === 1, {
    message: 'Link one campus student or one person',
    path: ['campus_student'],
  })
  .refine(
    (form) =>
      form.score == null || form.max_score == null || form.score <= form.max_score,
    { message: 'Score cannot exceed the maximum', path: ['score'] },
  )

/**
 * POST /api/campus/progress — record an assessment (US-C2 AC2).
 *
 * The programme must be inside the caller's visible set. The score≤max
 * check mirrors the migration CHECK so the portal reports it as a 400 with
 * a field error instead of a raw constraint failure.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_progress', 'create')

  const parsed = progressFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (!scope.isArea) {
    const visible = await visibleProgrammeIds(event, scope)
    if (!visible.includes(form.programme)) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That programme was not found in your scope',
        data: { code: 'not_found' },
      })
    }
  }

  // F1: intersect the student scope — an area-wide programme is visible
  // everywhere, so the student row must also sit in the caller's scope.
  const studentRow = await assertStudentInScope(event, scope, {
    campus_student: form.campus_student,
    person: form.person,
  })

  // F2: refuse a person-identity (or underlying linked person) minor
  // without a guardian.
  if (form.person) {
    await assertPersonGuardian(event, scope, form.person)
  } else {
    const linkedPerson = studentRow.person
    if (linkedPerson != null && String(linkedPerson).length > 0) {
      await assertPersonGuardian(event, scope, String(linkedPerson))
    }
  }

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_progress',
    {
      campus_student: form.campus_student ?? null,
      person: form.person ?? null,
      programme: form.programme,
      assessment: form.assessment ?? null,
      score: form.score ?? null,
      max_score: form.max_score ?? null,
      progress_date: form.progress_date ?? null,
      remarks: form.remarks ?? null,
      recorded_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
