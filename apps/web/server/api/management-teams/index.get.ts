import {
  branchNames,
  departmentScopeFilter,
  fullName,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

export interface ManagementTeamMember {
  person: string
  display_name: string
  role: string
  phone: string | null
  branch_name: string | null
}

export interface ManagementTeamEntry {
  department: string
  department_name: string
  department_type: string | null
  code: string | null
  level: 'branch' | 'zone' | 'area'
  leaders: ManagementTeamMember[]
}

/**
 * GET /api/management-teams?level=branch|zone|area&id=<uuid>
 *
 * Read-only rollup (AFC-593): department + group leaders at one scope
 * level. Leaders resolve through the existing `people_departments`
 * junction (role=leader, status=active) plus the department's
 * `leader_person` pointer where it names someone outside the junction.
 * Contact scope mirrors the department detail route (names + phone as the
 * route already exposes them); no new write paths -- this endpoint is
 * GET-only by construction.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'read')

  const query = getQuery(event)
  const level =
    query.level === 'branch' || query.level === 'zone' || query.level === 'area'
      ? query.level
      : null
  const id = typeof query.id === 'string' && query.id.length > 0 ? query.id : null
  if (!level || !id) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A level (branch, zone or area) and an id are required',
    })
  }

  // Fail closed: an explicit level outside the caller's grants is a 403.
  if (!scope.isArea) {
    if (level === 'branch' && !scope.branchIds.includes(id)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That branch is outside your scope',
        data: { code: 'branch_out_of_scope' },
      })
    }
    if (level === 'zone' && !scope.zoneIds.includes(id)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That zone is outside your scope',
        data: { code: 'zone_out_of_scope' },
      })
    }
    if (level === 'area' && scope.areaId !== id) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That area is outside your scope',
        data: { code: 'area_out_of_scope' },
      })
    }
  }

  const scopeMatch =
    level === 'branch'
      ? { branch: { _eq: id } }
      : level === 'zone'
        ? { zone: { _eq: id } }
        : {
            _or: [
              { area: { _eq: id } },
              { branch: { _null: true }, zone: { _null: true }, area: { _null: true } },
            ],
          }

  let departments: { data: Record<string, unknown>[] }
  let links: {
    data: {
      people: string | null
      departments: string | null
      role: string | null
      status: string | null
    }[]
  }
  try {
    departments = await listItems<Record<string, unknown>>(event, scope, 'departments', {
      filter: mergeFilters(
        { status: { _eq: 'active' } },
        scopeMatch,
        departmentScopeFilter(scope),
      ),
      fields: [
        'id',
        'name',
        'code',
        'department_type',
        'branch',
        'zone',
        'area',
        'leader_person',
        'status',
      ],
      sort: 'name',
      limit: -1,
    })

    const ids = departments.data.map((row) => String(row.id))
    links =
      ids.length > 0
        ? await listItems(event, scope, 'people_departments', {
            filter: {
              _and: [
                { departments: { _in: ids } },
                { status: { _eq: 'active' } },
                { role: { _eq: 'leader' } },
              ],
            },
            fields: ['people', 'departments', 'role', 'status'],
            limit: -1,
          })
        : { data: [] }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'department_store', '0020')
  }

  const personIds = [
    ...new Set(
      [
        ...links.data.map((link) => link.people),
        ...departments.data.map((row) => row.leader_person),
      ].filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  ]
  const peopleById = new Map<string, Record<string, unknown>>()
  if (personIds.length > 0) {
    const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: mergeFilters({ id: { _in: personIds } }, scopeFilter(scope)),
      fields: ['id', 'first_name', 'last_name', 'preferred_name', 'phone', 'branch'],
      limit: personIds.length,
    })
    for (const person of people.data) peopleById.set(String(person.id), person)
  }

  const names = await branchNames(event, scope)
  const leadersByDept = new Map<string, ManagementTeamMember[]>()
  for (const link of links.data) {
    if (!link.departments || !link.people) continue
    const person = peopleById.get(String(link.people))
    if (!person) continue
    const key = String(link.departments)
    const list = leadersByDept.get(key) ?? []
    list.push({
      person: String(link.people),
      display_name: fullName(
        person.first_name as string | null,
        person.last_name as string | null,
        person.preferred_name as string | null | undefined,
      ),
      role: String(link.role ?? 'leader'),
      phone: (person.phone as string | null) ?? null,
      branch_name: person.branch ? (names.get(String(person.branch)) ?? null) : null,
    })
    leadersByDept.set(key, list)
  }

  const entries: ManagementTeamEntry[] = departments.data.map((row) => {
    const leaders = [...(leadersByDept.get(String(row.id)) ?? [])]
    const pointer = row.leader_person ? String(row.leader_person) : null
    if (pointer && !leaders.some((entry) => entry.person === pointer)) {
      const person = peopleById.get(pointer)
      if (person) {
        leaders.push({
          person: pointer,
          display_name: fullName(
            person.first_name as string | null,
            person.last_name as string | null,
            person.preferred_name as string | null | undefined,
          ),
          role: 'leader',
          phone: (person.phone as string | null) ?? null,
          branch_name: person.branch ? (names.get(String(person.branch)) ?? null) : null,
        })
      }
    }
    leaders.sort((a, b) => a.display_name.localeCompare(b.display_name))
    return {
      department: String(row.id),
      department_name: String(row.name ?? ''),
      department_type: (row.department_type as string | null) ?? null,
      code: (row.code as string | null) ?? null,
      level,
      leaders,
    }
  })

  return { data: entries }
})
