import {
  campusProgressScopeFilter,
  COACHING_PROGRESS_FIELDS,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/progress?programme=&campus_student=
 *
 * Coaching assessments (AFC-484, US-C2 AC2). Scope resolves through the
 * parent programme. Score reads stay coordinator/branch-admin-own scoped
 * via the route filter; the collection carries no score column restriction
 * of its own (expansion §11.1 names students/results/support, and the
 * route policy is the enforcement point here).
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_progress', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const programme = text('programme')
  const student = text('campus_student') ?? text('student')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  // F1: programme AND student scope (intersect) — an area-wide programme
  // alone must not expose another branch's students.
  const scopeFilter = await campusProgressScopeFilter(event, scope)

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_progress',
    {
      filter: mergeFilters(
        scopeFilter,
        programme ? { programme: { _eq: programme } } : undefined,
        student ? { campus_student: { _eq: student } } : undefined,
      ),
      fields: COACHING_PROGRESS_FIELDS,
      sort: '-progress_date',
      page,
      limit,
    },
  )

  return {
    data: result.data,
    meta: { total: result.meta.total, page, limit },
  }
})
