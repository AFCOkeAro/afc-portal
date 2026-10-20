import {
  CAMPUS_STUDENT_FIELDS,
  campusStudentScopeFilter,
  stripStudent,
  supportTotal,
} from '../../../utils/campus'
import {
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/students/:id — student campus-care record
 * (US-C3 AC3, US-C4 AC3, US-C5).
 *
 * Returns the student with `support_total` (derived Σ disbursed, computed
 * here from the support rows the caller can see — the stored
 * Flow-maintained column is the system of record and is stripped per the
 * role matrix for roles outside the §11.1 read set). A cross-scope id is a
 * 404, never a row.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_students', 'read')

  const id = String(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A student id is required',
      data: { code: 'validation_error' },
    })
  }

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

  let support_total: number | null
  if (scope.hiddenFields.campus_financial_support?.includes('amount')) {
    support_total = null
  } else {
    try {
      const support = await listItems<Record<string, unknown>>(
        event,
        scope,
        'campus_financial_support',
        {
          filter: { student: { _eq: id } },
          fields: ['amount', 'status'],
          limit: 200,
        },
      )
      support_total = supportTotal(support.data)
    } catch {
      support_total = null
    }
  }

  return {
    data: { ...stripStudent(scope, row), support_total },
  }
})
