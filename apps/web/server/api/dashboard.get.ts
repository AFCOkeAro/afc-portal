import type {
  DashboardAttendancePoint,
  DashboardData,
  EventRow,
  VisitorRow,
  WelfareCaseRow,
} from '../../types/portal'
import {
  branchNames,
  can,
  countItems,
  eventScopeFilter,
  getPortalScope,
  listItems,
  mergeFilters,
  scopeFilter,
} from '../utils/portal'

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

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export default defineEventHandler(async (event): Promise<DashboardData> => {
  const scope = await getPortalScope(event)
  const now = new Date().toISOString()
  const names = await branchNames(event, scope)
  const branchFilter = scopeFilter(scope)
  const eventFilter = eventScopeFilter(scope)

  const [
    people,
    branches,
    upcomingEvents,
    followUps,
    currentSessions,
    priorSessions,
    trendSessions,
    welfareCases,
  ] = await Promise.all([
    countItems(
      event,
      scope,
      'people',
      mergeFilters({ status: { _eq: 'active' } }, branchFilter),
    ),
    listItems<Record<string, unknown>>(event, scope, 'branches', {
      filter: mergeFilters({ status: { _eq: 'active' } }, branchFilter),
      fields: ['id', 'name', 'code', 'branch_type', 'status'],
      sort: 'sort,name',
      limit: -1,
    }),
    listItems<EventRow>(event, scope, 'events', {
      filter: mergeFilters(
        { start_at: { _gte: now }, status: { _eq: 'published' } },
        eventFilter,
      ),
      fields: EVENT_FIELDS,
      sort: 'start_at',
      limit: 5,
    }),
    listItems<VisitorRow>(event, scope, 'visitors', {
      filter: mergeFilters({ status: { _in: ['new', 'follow_up'] } }, branchFilter),
      fields: VISITOR_FIELDS,
      sort: 'next_follow_up_date,visit_date',
      limit: 5,
    }),
    listItems<{ headcount_total: number | null }>(event, scope, 'attendance_sessions', {
      filter: mergeFilters(
        {
          session_date: {
            _gte: dateDaysAgo(30),
            _lte: dateDaysAgo(0),
          },
        },
        branchFilter,
      ),
      fields: ['headcount_total'],
      limit: -1,
    }),
    listItems<{ headcount_total: number | null }>(event, scope, 'attendance_sessions', {
      filter: mergeFilters(
        {
          session_date: {
            _gte: dateDaysAgo(60),
            _lt: dateDaysAgo(30),
          },
        },
        branchFilter,
      ),
      fields: ['headcount_total'],
      limit: -1,
    }),
    listItems<{
      id: string | number
      session_date: string
      headcount_total: number | null
      branch: string | null
    }>(event, scope, 'attendance_sessions', {
      filter: mergeFilters({ session_date: { _gte: dateDaysAgo(84) } }, branchFilter),
      fields: ['id', 'session_date', 'headcount_total', 'branch'],
      sort: '-session_date',
      limit: 16,
    }),
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
  ])

  const upcomingIds = upcomingEvents.data.map((row) => String(row.id))
  const upcomingRegistrations =
    upcomingIds.length > 0
      ? await countItems(event, scope, 'event_registrations', {
          _and: [
            { event: { _in: upcomingIds } },
            { registration_status: { _neq: 'cancelled' } },
          ],
        })
      : 0

  const openFollowUps = await countItems(
    event,
    scope,
    'visitors',
    mergeFilters({ status: { _in: ['new', 'follow_up'] } }, branchFilter),
  )

  const openWelfare = can(scope, 'welfare_cases', 'read')
    ? await countItems(
        event,
        scope,
        'welfare_cases',
        mergeFilters({ status: { _in: ['open', 'in_progress'] } }, branchFilter),
      )
    : 0

  const currentAttendance = currentSessions.data.reduce(
    (sum, session) => sum + Number(session.headcount_total ?? 0),
    0,
  )
  const priorAttendance = priorSessions.data.reduce(
    (sum, session) => sum + Number(session.headcount_total ?? 0),
    0,
  )

  const attendanceTrend: DashboardAttendancePoint[] = [...trendSessions.data]
    .reverse()
    .map((session) => ({
      date: session.session_date,
      total: Number(session.headcount_total ?? 0),
      branch_name: session.branch ? (names.get(String(session.branch)) ?? null) : null,
    }))

  const upcomingRegistrationCounts = new Map<string, number>()
  if (upcomingIds.length > 0) {
    const registrations = await listItems<{ event: string; registration_status: string }>(
      event,
      scope,
      'event_registrations',
      {
        filter: {
          _and: [
            { event: { _in: upcomingIds } },
            { registration_status: { _neq: 'cancelled' } },
          ],
        },
        fields: ['event', 'registration_status'],
        limit: -1,
      },
    )
    for (const registration of registrations.data) {
      const key = String(registration.event)
      upcomingRegistrationCounts.set(key, (upcomingRegistrationCounts.get(key) ?? 0) + 1)
    }
  }

  const upcomingRows: EventRow[] = upcomingEvents.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    registered_count: upcomingRegistrationCounts.get(String(row.id)) ?? 0,
    confirmed_count: 0,
    attended_count: 0,
  }))

  const visitorRows: VisitorRow[] = followUps.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: null,
  }))

  const welfareRows: WelfareCaseRow[] = welfareCases.data.map((row) => ({
    ...row,
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: null,
    contribution_total: '0.00',
    event_count: 0,
  }))

  const label = scope.isArea
    ? 'All branches'
    : scope.branchIds
        .map((id) => names.get(id) ?? id)
        .filter(Boolean)
        .join(', ') || 'No branch'

  return {
    scope: {
      isArea: scope.isArea,
      label,
      branchCount: branches.data.length,
    },
    metrics: {
      people,
      upcomingEvents: upcomingEvents.meta.total,
      upcomingRegistrations,
      attendanceCurrent: currentAttendance,
      attendancePrior: priorAttendance,
      openFollowUps,
      openWelfare,
    },
    attendanceTrend,
    upcomingEvents: upcomingRows,
    followUps: visitorRows,
    welfareCases: welfareRows,
    branches: branches.data.map((branch) => ({
      ...(branch as unknown as DashboardData['branches'][number]),
      id: String(branch.id),
    })),
  }
})
