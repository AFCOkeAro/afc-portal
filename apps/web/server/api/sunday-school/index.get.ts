import type { SundaySchoolClass } from '@afc/shared'
import type { SundaySchoolClassRow } from '../../../types/portal'
import {
  branchNames,
  can,
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

/**
 * GET /api/sunday-school?search=&branch=&status=&page=&limit=
 *
 * Hierarchy-scoped Sunday School class list (AFC-870, data-model-expansion
 * §2.6/§10). `sunday_school_classes.branch` is nullable (zonal/area-level
 * classes), so a branch caller sees their own branches' classes plus the
 * null-branch ones — the same shape as the dashboard widget and the
 * event/department scope predicates. The Directus policy stays
 * authoritative; this only scopes the query. No new privilege: reads
 * `sunday_school_classes` (+ optional `people` names for teachers) only.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_school_classes', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch =
    typeof query.branch === 'string' && query.branch.length > 0 ? query.branch : undefined
  const status =
    typeof query.status === 'string' && query.status.length > 0 ? query.status : undefined

  const result = await listItems<Record<string, unknown>>(
    event,
    scope,
    'sunday_school_classes',
    {
      filter: mergeFilters(
        status ? { status: { _eq: status } } : { status: { _eq: 'active' } },
        branch
          ? { branch: { _eq: branch } }
          : scope.isArea
            ? undefined
            : {
                _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
              },
      ),
      fields: CLASS_FIELDS,
      sort: 'class_name',
      page,
      limit,
      search: search || undefined,
    },
  )

  const names = await branchNames(event, scope)

  let teacherNames = new Map<string, string>()
  if (can(scope, 'people', 'read')) {
    const teacherIds = [
      ...new Set(
        result.data
          .map((row) => row.teacher)
          .filter(
            (teacher): teacher is string =>
              typeof teacher === 'string' && teacher.length > 0,
          ),
      ),
    ]
    if (teacherIds.length > 0) {
      const teachers = await listItems<{
        id: string | number
        first_name: string
        last_name: string
        preferred_name: string | null
      }>(event, scope, 'people', {
        filter: mergeFilters({ id: { _in: teacherIds } }, scopeFilter(scope)),
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: -1,
      })
      teacherNames = new Map(
        teachers.data.map((person) => [
          String(person.id),
          person.preferred_name ||
            [person.first_name, person.last_name].filter(Boolean).join(' ') ||
            String(person.id),
        ]),
      )
    }
  }

  const rows: SundaySchoolClassRow[] = result.data.map((row) => ({
    ...(row as unknown as SundaySchoolClass),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
  }))

  return {
    data: rows.map((row) => ({
      ...row,
      teacher_name: row.teacher ? (teacherNames.get(String(row.teacher)) ?? null) : null,
    })),
    meta: result.meta,
  }
})
