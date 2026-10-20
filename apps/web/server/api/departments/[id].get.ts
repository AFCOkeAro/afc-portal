import type { Department } from '@afc/shared'
import {
  branchNames,
  departmentScopeFilter,
  findScopedItem,
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

const MEMBER_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'gender',
  'phone',
  'branch',
  'membership_status',
  'status',
]

export interface DepartmentMemberRow {
  id: string
  display_name: string
  role: string
  phone: string | null
  branch_name: string | null
  membership_status: string
  status: string
  joined_at: string | null
}

export interface DepartmentDetail extends Department {
  branch_name: string | null
  leader_name: string | null
  member_count: number
  members: DepartmentMemberRow[]
}

export default defineEventHandler(async (event): Promise<DepartmentDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'departments', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A department id is required' })
  }

  // Area-wide departments carry a null branch, so the default branch-scoped
  // predicate would hide them from branch staff. The explicit _or keeps the
  // area-wide visibility grant (data-model §2.2) without leaking foreign rows.
  const department = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'departments',
    id,
    { fields: DEPARTMENT_FIELDS, scope: departmentScopeFilter(scope) },
  )

  const links = await listItems<{
    id: string | number
    people: string | null
    role: string | null
    joined_at: string | null
    status: string | null
  }>(event, scope, 'people_departments', {
    filter: {
      _and: [{ departments: { _eq: id } }, { status: { _eq: 'active' } }],
    },
    fields: ['id', 'people', 'role', 'joined_at', 'status'],
    limit: -1,
  })

  const personIds = [
    ...new Set(
      links.data
        .map((link) => link.people)
        .filter(
          (value): value is string => typeof value === 'string' && value.length > 0,
        ),
    ),
  ]
  const peopleById = new Map<string, Record<string, unknown>>()
  if (personIds.length > 0) {
    const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: mergeFilters({ id: { _in: personIds } }, scopeFilter(scope)),
      fields: MEMBER_FIELDS,
      limit: personIds.length,
    })
    for (const person of people.data) peopleById.set(String(person.id), person)
  }
  const linkByPerson = new Map<string, (typeof links.data)[number]>()
  for (const link of links.data) {
    if (link.people) linkByPerson.set(String(link.people), link)
  }

  const names = await branchNames(event, scope)
  const members: DepartmentMemberRow[] = []
  for (const [personId, person] of peopleById) {
    const link = linkByPerson.get(personId)
    if (!link) continue
    members.push({
      id: personId,
      display_name: fullName(
        person.first_name as string | null,
        person.last_name as string | null,
        person.preferred_name as string | null | undefined,
      ),
      role: String(link.role ?? 'member'),
      phone: (person.phone as string | null) ?? null,
      branch_name: person.branch ? (names.get(String(person.branch)) ?? null) : null,
      membership_status: String(person.membership_status ?? ''),
      status: String(person.status ?? ''),
      joined_at: link.joined_at,
    })
  }
  members.sort((a, b) => a.display_name.localeCompare(b.display_name))

  let leaderName: string | null = null
  if (department.leader_person) {
    const leader = peopleById.get(String(department.leader_person))
    if (leader) {
      leaderName = fullName(
        leader.first_name as string | null,
        leader.last_name as string | null,
        leader.preferred_name as string | null | undefined,
      )
    } else {
      const leaderRows = await listItems<Record<string, unknown>>(
        event,
        scope,
        'people',
        {
          filter: mergeFilters(
            { id: { _eq: String(department.leader_person) } },
            scopeFilter(scope),
          ),
          fields: ['id', 'first_name', 'last_name', 'preferred_name'],
          limit: 1,
        },
      )
      const found = leaderRows.data[0]
      if (found) {
        leaderName = fullName(
          found.first_name as string | null,
          found.last_name as string | null,
          found.preferred_name as string | null | undefined,
        )
      }
    }
  }

  return {
    ...(department as unknown as Department),
    id: String(department.id),
    branch_name: department.branch
      ? (names.get(String(department.branch)) ?? null)
      : null,
    leader_name: leaderName,
    member_count: members.length,
    members,
  }
})
