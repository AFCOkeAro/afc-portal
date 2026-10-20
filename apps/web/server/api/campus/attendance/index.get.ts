import {
  campusAttendanceScopeFilter,
  COACHING_ATTENDANCE_FIELDS,
} from '../../../utils/campus'
import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
} from '../../../utils/portal'

/**
 * GET /api/campus/attendance?programme=&timetable=&class_date=&present=
 *
 * Class attendance marks (AFC-484, US-C2 AC1). Scope resolves through the
 * parent programme (slot marks through their timetable's programme where
 * the programme link is set, otherwise through the general programme+date
 * link). General marks with neither link are invisible to non-area sessions
 * (fail-closed): they carry no scope and the portal never invents one.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_class_attendance', 'read')

  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  const programme = text('programme')
  const timetable = text('timetable')
  const classDate = text('class_date')
  const present = text('present')
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))

  const scopeFilter = await campusAttendanceScopeFilter(event, scope)

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_class_attendance',
    {
      filter: mergeFilters(
        scopeFilter,
        programme ? { programme: { _eq: programme } } : undefined,
        timetable ? { timetable: { _eq: timetable } } : undefined,
        classDate ? { class_date: { _eq: classDate } } : undefined,
        present === 'true'
          ? { present: { _eq: true } }
          : present === 'false'
            ? { present: { _eq: false } }
            : undefined,
      ),
      fields: COACHING_ATTENDANCE_FIELDS,
      sort: '-class_date',
      page,
      limit,
    },
  )

  return {
    data: result.data,
    meta: { total: result.meta.total, page, limit },
  }
})
