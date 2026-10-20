import type { Department } from '@afc/shared'
import {
  branchNames,
  departmentScopeFilter,
  fullName,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
} from '../../utils/portal'

const DEPARTMENT_FIELDS = [
  'id',
  'name',
  'code',
  'department_type',
  'branch',
  'leader_person',
  'description',
  'status',
]

export interface DepartmentRow extends Department {
  branch_name: string | null
  leader_name: string | null
  member_count: number
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'read')

  const query = getQuery(event)
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const departmentType =
    typeof query.department_type === 'string' ? query.department_type : undefined
  const status =
    query.status === 'all'
      ? undefined
      : query.status === 'inactive'
        ? 'inactive'
        : 'active'

  if (branch && !scope.isArea && !scope.branchIds.includes(branch)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That branch is outside your scope',
      data: { code: 'branch_out_of_scope' },
    })
  }

  const result = await listItems<Record<string, unknown>>(event, scope, 'departments', {
    filter: mergeFilters(
      status ? { status: { _eq: status } } : undefined,
      departmentType ? { department_type: { _eq: departmentType } } : undefined,
      // An explicit branch narrows to that branch only (area-wide rows have
      // no branch, so they drop out of a narrowed view by construction).
      branch ? { branch: { _eq: branch } } : departmentScopeFilter(scope),
    ),
    fields: DEPARTMENT_FIELDS,
    sort: 'name',
    limit: -1,
    search: search || undefined,
  })

  const ids = result.data.map((row) => String(row.id))
  const counts = new Map<string, number>()
  if (ids.length > 0) {
    const links = await listItems<{ id: string | number; departments: string | null }>(
      event,
      scope,
      'people_departments',
      {
        filter: {
          _and: [{ departments: { _in: ids } }, { status: { _eq: 'active' } }],
        },
        fields: ['id', 'departments'],
        limit: -1,
      },
    )
    for (const link of links.data) {
      if (!link.departments) continue
      const key = String(link.departments)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const leaderIds = [
    ...new Set(
      result.data
        .map((row) => row.leader_person)
        .filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ),
    ),
  ]
  const leaderNames = new Map<string, string>()
  if (leaderIds.length > 0) {
    const leaders = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: mergeFilters({ id: { _in: leaderIds } }, scopeFilter(scope)),
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      limit: leaderIds.length,
    })
    for (const leader of leaders.data) {
      leaderNames.set(
        String(leader.id),
        fullName(
          leader.first_name as string | null,
          leader.last_name as string | null,
          leader.preferred_name as string | null | undefined,
        ),
      )
    }
  }

  const names = await branchNames(event, scope)
  const rows: DepartmentRow[] = result.data.map((row) => ({
    ...(row as unknown as Department),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    leader_name: row.leader_person
      ? (leaderNames.get(String(row.leader_person)) ?? null)
      : null,
    member_count: counts.get(String(row.id)) ?? 0,
  }))

  return { data: rows }
})
