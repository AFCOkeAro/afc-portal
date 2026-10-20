import {
  campusOutcomeScopeFilter,
  EXAM_RESULT_FIELDS,
  stripResults,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/results?exam=&exam_year=&campus_student=
 *
 * WAEC/UTME/admission results (AFC-484, US-C3 AC1/AC3). Scope resolves
 * through the student → branch for student-linked rows; scores/aggregate
 * are stripped per the role matrix before rows leave the server (§11.1:
 * coordinator + branch-admin-own + own-student reads).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'exam_results', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const exam = text('exam')
  const examYear = text('exam_year')
  const student = text('campus_student') ?? text('student')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  // Results carry no programme column: the scope resolves through the
  // student (campus_student xor person) branch/zone via a relational
  // filter. The Directus policy remains the enforcement point; this keeps
  // the portal read inside the same boundary.
  const scopeFilter = campusOutcomeScopeFilter(scope, [
    'campus_student',
    'person',
  ])

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'exam_results',
    {
      filter: mergeFilters(
        scopeFilter,
        exam ? { exam: { _eq: exam } } : undefined,
        examYear ? { exam_year: { _eq: Number(examYear) } } : undefined,
        student ? { campus_student: { _eq: student } } : undefined,
      ),
      fields: EXAM_RESULT_FIELDS,
      sort: '-exam_year',
      page,
      limit,
    },
  )

  return {
    data: stripResults(scope, result.data),
    meta: { total: result.meta.total, page, limit },
  }
})
