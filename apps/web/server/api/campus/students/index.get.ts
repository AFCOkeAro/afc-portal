import {
  campusStudentScopeFilter,
  CAMPUS_STUDENT_FIELDS,
  stripStudents,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/students?branch=&zone=&level=&nysc_status=&status=
 *
 * Campus students (AFC-484, US-C4/US-C5). Scope resolves on the student's
 * own branch/zone denorm. financial_support_total is stripped per the role
 * matrix (§11.1) before rows leave the server.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'campus_students', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))

  const scopeFilter = await campusStudentScopeFilter(event, scope, {
    branch: text('branch'),
    zone: text('zone'),
  })

  const level = text('level')
  const nysc = text('nysc_status')
  const status = text('status')

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'campus_students',
    {
      filter: mergeFilters(
        scopeFilter,
        level ? { level: { _eq: level } } : undefined,
        nysc ? { nysc_status: { _eq: nysc } } : undefined,
        status ? { status: { _eq: status } } : undefined,
      ),
      fields: CAMPUS_STUDENT_FIELDS,
      sort: '-created_at',
      page,
      limit,
    },
  )

  return {
    data: stripStudents(scope, result.data),
    meta: { total: result.meta.total, page, limit },
  }
})
