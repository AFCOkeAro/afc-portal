import { blessingsRollup } from '../../utils/blessing-report'
import type {
  BranchDetail,
  BranchSectionWarning,
  DashboardAttendancePoint,
  EventRow,
  PersonRow,
  VisitorRow,
  WelfareCaseRow,
} from '../../../types/portal'
import {
  ageFromDob,
  branchCollectionScope,
  branchNames,
  can,
  countItems,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  scopeFilter,
  stripHiddenMany,
} from '../../utils/portal'

const BRANCH_FIELDS = [
  'id',
  'name',
  'code',
  'slug',
  'branch_type',
  'type_label',
  'zone',
  'area',
  'parent_branch',
  'address',
  'city',
  'state',
  'phone',
  'email',
  'status',
  'sort',
]

const PERSON_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'date_of_birth',
  'gender',
  'is_minor',
  'phone',
  'email',
  'branch',
  'membership_status',
  'status',
]

const EVENT_FIELDS = [
  'id',
  'title',
  'slug',
  'summary',
  'event_type',
  'branch',
  'start_at',
  'end_at',
  'location',
  'address',
  'capacity',
  'waitlist_enabled',
  'registration_open',
  'registration_opens_at',
  'registration_closes_at',
  'fee_amount',
  'currency',
  'requires_guardian_consent',
  'collect_medical',
  'age_min',
  'age_max',
  'visibility',
  'status',
]

const VISITOR_FIELDS = [
  'id',
  'branch',
  'visitor_first_name',
  'visitor_last_name',
  'email',
  'phone',
  'visit_date',
  'event',
  'age_group',
  'invited_by',
  'person',
  'status',
  'follow_up_owner',
  'next_follow_up_date',
  'notes',
]

const WELFARE_FIELDS = [
  'id',
  'case_ref',
  'branch',
  'person',
  'category',
  'priority',
  'status',
  'amount_requested',
  'amount_assisted',
  'assigned_to',
  'opened_at',
  'closed_at',
]

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

interface SettledSection<T> {
  value: T
  warning?: BranchSectionWarning
}

// AFC-564: one failing section must not 500 the whole dashboard. Each section
// settles independently: on failure the original error is logged server-side,
// the section falls back to its empty value, and a named warning travels in
// the response (same spirit as the 03c51fe named codes: degraded, never
// silent). The branch lookup below stays outside: a branch that cannot load
// is still 404/403, never a degraded 200.
async function settleSection<T>(
  section: string,
  work: Promise<T>,
  fallback: T,
): Promise<SettledSection<T>> {
  try {
    return { value: await work }
  } catch (error) {
    console.error('branch detail section failed (' + section + ')', error)
    return { value: fallback, warning: { section, code: section + '_unavailable' } }
  }
}
export default defineEventHandler(async (event): Promise<BranchDetail> => {
  const scope = await getPortalScope(event)
  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A branch id is required' })

  // Hierarchy-aware: zone staff see their zones' branches, branch staff
  // their own rows (AFC-461a). Same predicate as the list endpoint.
  const branchScope = branchCollectionScope(scope)
  const branch = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'branches',
    id,
    { fields: BRANCH_FIELDS, scope: branchScope },
  )
  const branchFilter = { branch: { _eq: id } }
  const now = new Date().toISOString()

  const [
    peopleResult,
    youthResult,
    minorsResult,
    openFollowUpsResult,
    attendanceResult,
    eventsResult,
    recentPeopleResult,
    followUpsResult,
    welfareCasesResult,
    blessingsResult,
  ] = await Promise.all([
    settleSection(
      'people',
      countItems(
        event,
        scope,
        'people',
        mergeFilters({ status: { _eq: 'active' } }, branchFilter),
      ),
      0,
    ),
    settleSection(
      'youth',
      countItems(
        event,
        scope,
        'people',
        mergeFilters({ membership_status: { _eq: 'youth' } }, branchFilter),
      ),
      0,
    ),
    settleSection(
      'minors',
      countItems(
        event,
        scope,
        'people',
        mergeFilters({ is_minor: { _eq: true } }, branchFilter),
      ),
      0,
    ),
    settleSection(
      'openFollowUps',
      countItems(
        event,
        scope,
        'visitors',
        mergeFilters({ status: { _in: ['new', 'follow_up'] } }, branchFilter),
      ),
      0,
    ),
    settleSection(
      'attendance',
      listItems<{
        id: string | number
        session_date: string
        headcount_total: number | null
        branch: string | null
      }>(event, scope, 'attendance_sessions', {
        filter: mergeFilters({ session_date: { _gte: daysAgo(84) } }, branchFilter),
        fields: ['id', 'session_date', 'headcount_total', 'branch'],
        sort: '-session_date',
        limit: -1,
      }),
      { data: [], meta: { total: 0, page: 1, limit: -1 } },
    ),
    settleSection(
      'events',
      listItems<EventRow>(event, scope, 'events', {
        filter: mergeFilters(
          {
            start_at: { _gte: now },
            status: { _eq: 'published' },
            _or: [{ branch: { _eq: id } }, { branch: { _null: true } }],
          },
          scopeFilter(scope),
        ),
        fields: EVENT_FIELDS,
        sort: 'start_at',
        limit: 5,
      }),
      { data: [], meta: { total: 0, page: 1, limit: 5 } },
    ),
    settleSection(
      'recentPeople',
      listItems<PersonRow>(event, scope, 'people', {
        filter: mergeFilters({ status: { _eq: 'active' } }, branchFilter),
        fields: PERSON_FIELDS,
        sort: 'last_name,first_name',
        limit: 8,
      }),
      { data: [], meta: { total: 0, page: 1, limit: 8 } },
    ),
    settleSection(
      'followUps',
      listItems<VisitorRow>(event, scope, 'visitors', {
        filter: mergeFilters({ status: { _in: ['new', 'follow_up'] } }, branchFilter),
        fields: VISITOR_FIELDS,
        sort: 'next_follow_up_date,visit_date',
        limit: 5,
      }),
      { data: [], meta: { total: 0, page: 1, limit: 5 } },
    ),
    settleSection(
      'welfareCases',
      can(scope, 'welfare_cases', 'read')
        ? listItems<WelfareCaseRow>(event, scope, 'welfare_cases', {
            filter: mergeFilters(
              { status: { _in: ['open', 'in_progress'] } },
              branchFilter,
            ),
            fields: WELFARE_FIELDS,
            sort: '-opened_at',
            limit: 5,
          })
        : Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 5 } }),
      { data: [], meta: { total: 0, page: 1, limit: 5 } },
    ),
    // Blessings breakdown (AFC-474, prd-expansion §1.1
    // analytics-with-drill-down): counts that link to the filtered list.
    // Gated on blessings:read; anything else renders zero, never foreign.
    settleSection(
      'blessings',
      can(scope, 'blessings', 'read')
        ? blessingsRollup(event, scope, { branch: id })
        : Promise.resolve({ total: 0, breakdown: [] }),
      { total: 0, breakdown: [] },
    ),
  ])
  const warnings: BranchSectionWarning[] = []
  for (const section of [
    peopleResult,
    youthResult,
    minorsResult,
    openFollowUpsResult,
    attendanceResult,
    eventsResult,
    recentPeopleResult,
    followUpsResult,
    welfareCasesResult,
    blessingsResult,
  ]) {
    if (section.warning) warnings.push(section.warning)
  }
  const people = peopleResult.value
  const youth = youthResult.value
  const minors = minorsResult.value
  const openFollowUps = openFollowUpsResult.value
  const attendance = attendanceResult.value
  const events = eventsResult.value
  const recentPeople = recentPeopleResult.value
  const followUps = followUpsResult.value
  const welfareCases = welfareCasesResult.value
  const blessings = blessingsResult.value

  const names = await branchNames(event, scope)
  const lastSunday = attendance.data.find(
    (session) => session.session_date <= new Date().toISOString().slice(0, 10),
  )
  const attendanceLast30Days = attendance.data
    .filter((session) => session.session_date >= daysAgo(30))
    .reduce((sum, session) => sum + Number(session.headcount_total ?? 0), 0)

  const attendanceTrend: DashboardAttendancePoint[] = [...attendance.data]
    .reverse()
    .map((session) => ({
      date: session.session_date,
      total: Number(session.headcount_total ?? 0),
      branch_name: session.branch ? (names.get(String(session.branch)) ?? null) : null,
    }))

  return {
    ...(branch as unknown as BranchDetail),
    id: String(branch.id),
    people_count: people,
    youth_count: youth,
    minor_count: minors,
    open_follow_ups: openFollowUps,
    open_welfare: can(scope, 'welfare_cases', 'read') ? welfareCases.meta.total : 0,
    upcoming_events: events.meta.total,
    attendance_last_sunday: Number(lastSunday?.headcount_total ?? 0),
    attendance_last_30_days: attendanceLast30Days,
    attendance_trend: attendanceTrend,
    blessings_total: blessings.total,
    blessings_breakdown: blessings.breakdown,
    warnings,
    recent_people: stripHiddenMany(
      scope,
      'people',
      recentPeople.data.map((person) => ({
        ...person,
        id: String(person.id),
        branch_name: names.get(String(person.branch)) ?? null,
        age: ageFromDob(person.date_of_birth),
      })),
    ),
    events: events.data.map((row) => ({
      ...row,
      id: String(row.id),
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      registered_count: 0,
      confirmed_count: 0,
      attended_count: 0,
    })),
    follow_ups: followUps.data.map((row) => ({
      ...row,
      id: String(row.id),
      branch_name: names.get(String(row.branch)) ?? null,
      person_name: null,
    })),
    welfare_cases: welfareCases.data.map((row) => ({
      ...row,
      id: String(row.id),
      branch_name: names.get(String(row.branch)) ?? null,
      person_name: null,
      contribution_total: '0.00',
      event_count: 0,
    })),
  }
})
