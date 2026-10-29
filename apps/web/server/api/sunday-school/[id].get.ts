import type { SundaySchoolClass } from '@afc/shared'
import {
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
} from '../../utils/portal'

const CLASS_FIELDS = [
  'id',
  'class_name',
  'branch',
  'zone',
  'teacher',
  'students_count',
  'status',
]

const SESSION_FIELDS = [
  'id',
  'branch',
  'session_date',
  'session_name',
  'session_type',
  'headcount_total',
]

export interface SundaySchoolClassDetail extends SundaySchoolClass {
  branch_name: string | null
  teacher_name: string | null
  /** Five most recent sunday_school sessions for the class branch (events rail). */
  sessions: Array<{
    id: string
    session_date: string
    session_name: string | null
    total: number | null
    branch_name: string | null
  }>
  /**
   * Birthdays-by-month histogram for the class branch (chart rail).
   * Month counts only (index 0 = January) — never a DOB, year, or age.
   * Empty unless the caller may read people.
   */
  birthdaysByMonth: number[]
}

function monthIndex(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const month = Number(match[2])
  return month >= 1 && month <= 12 ? month - 1 : null
}

/**
 * GET /api/sunday-school/:id — class detail with events + birthday rails.
 *
 * Scoping mirrors the list route: a class outside the caller's scope is a
 * 404, never a foreign class. Students are NOT invented here — the model
 * holds no enrolment join, so the page reuses the existing scoped
 * /api/people?search=&branch= pool (searchable select, no new privilege)
 * and the sessions rail below. The birthday rail aggregates month counts
 * from branch-scoped people rows and returns counts only, so no DOB, age,
 * or minor identity leaves the server beyond what /api/people already
 * exposes through its own hidden-field stripping.
 */
export default defineEventHandler(async (event): Promise<SundaySchoolClassDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_school_classes', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A class id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_school_classes',
    id,
    {
      fields: CLASS_FIELDS,
      scope: scope.isArea
        ? {}
        : {
            _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
          },
    },
  )

  const names = await branchNames(event, scope)
  const branchName = row.branch ? (names.get(String(row.branch)) ?? null) : null

  let teacherName: string | null = null
  if (row.teacher && can(scope, 'people', 'read')) {
    try {
      const teacher = await findScopedItem<{
        first_name: string
        last_name: string
        preferred_name: string | null
      }>(event, scope, 'people', String(row.teacher), {
        fields: ['first_name', 'last_name', 'preferred_name'],
      })
      teacherName =
        teacher.preferred_name ||
        [teacher.first_name, teacher.last_name].filter(Boolean).join(' ') ||
        null
    } catch {
      teacherName = null
    }
  }

  let sessions: SundaySchoolClassDetail['sessions'] = []
  if (can(scope, 'attendance_sessions', 'read') && row.branch) {
    const recent = await listItems<{
      id: string | number
      session_date: string
      session_name: string | null
      headcount_total: number | null
      branch: string | null
    }>(event, scope, 'attendance_sessions', {
      filter: mergeFilters(
        { session_type: { _eq: 'sunday_school' } },
        { branch: { _eq: String(row.branch) } },
      ),
      fields: SESSION_FIELDS,
      sort: '-session_date',
      limit: 5,
    })
    sessions = recent.data.map((session) => ({
      id: String(session.id),
      session_date: session.session_date,
      session_name: session.session_name,
      total: session.headcount_total,
      branch_name: session.branch ? (names.get(String(session.branch)) ?? null) : null,
    }))
  }

  const birthdaysByMonth = new Array<number>(12).fill(0)
  if (can(scope, 'people', 'read') && row.branch) {
    const people = await listItems<{ date_of_birth: string | null }>(
      event,
      scope,
      'people',
      {
        filter: mergeFilters(
          { branch: { _eq: String(row.branch) } },
          { date_of_birth: { _nnull: true } },
          scopeFilter(scope),
        ),
        fields: ['date_of_birth'],
        limit: 500,
      },
    )
    for (const person of people.data) {
      const index = monthIndex(person.date_of_birth)
      if (index !== null) birthdaysByMonth[index] = (birthdaysByMonth[index] ?? 0) + 1
    }
  }

  return {
    ...(row as unknown as SundaySchoolClass),
    id: String(row.id),
    branch_name: branchName,
    teacher_name: teacherName,
    sessions,
    birthdaysByMonth,
  }
})
