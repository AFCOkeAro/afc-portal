import type {
  DashboardAttendancePoint,
  DashboardCelebrationItem,
  DashboardData,
  DashboardSundaySession,
  EventRow,
  SundaySchoolClassRow,
  VisitorRow,
  WelfareCaseRow,
} from '../../types/portal'
import {
  branchNames,
  can,
  countItems,
  eventScopeFilter,
  getPortalScope,
  isHidden,
  listItems,
  mergeFilters,
  scopeFilter,
} from '../utils/portal'
import {
  celebrationsToCalendarItems,
  type CelebrationRow as FeedCelebrationRow,
} from '../utils/celebration-feed'
import { collectPeopleSummary } from '../utils/people-summary'

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

function dateDaysAhead(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

const SUNDAY_SCHOOL_FIELDS = [
  'id',
  'class_name',
  'branch',
  'zone',
  'teacher',
  'students_count',
  'status',
]

const CELEBRATION_DASH_FIELDS = [
  'id',
  'person',
  'type',
  'event_date',
  'is_recurring',
  'title',
  'branch',
  'zone',
  'status',
]

const BIRTHDAY_PERSON_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'is_minor',
  'branch',
  'date_of_birth',
]

/** Next-30-day occurrence of a month/day pair, or null when outside the window. */
function occurrenceInWindow(
  month: number,
  day: number,
  from: string,
  to: string,
): string | null {
  const fromYear = Number(from.slice(0, 4))
  for (const year of [fromYear, fromYear + 1]) {
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    // Feb 29 in a non-leap year is not a real date: skip it rather than
    // shifting it, so the widget never shows a greeting on the wrong day.
    const check = new Date(`${candidate}T00:00:00Z`)
    if (
      Number.isNaN(check.getTime()) ||
      check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day
    ) {
      continue
    }
    if (candidate >= from && candidate <= to) return candidate
  }
  return null
}

function monthDayOf(date: string): { month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return { month: Number(match[2]), day: Number(match[3]) }
}

function personDisplayName(row: Record<string, unknown>): string {
  const preferred =
    typeof row.preferred_name === 'string' ? row.preferred_name.trim() : ''
  const first = typeof row.first_name === 'string' ? row.first_name.trim() : ''
  const last = typeof row.last_name === 'string' ? row.last_name.trim() : ''
  const base = [first, last].filter(Boolean).join(' ')
  if (preferred && base && preferred !== base) return `${preferred} (${base})`
  return preferred || base || 'Unnamed'
}

export default defineEventHandler(async (event): Promise<DashboardData> => {
  const scope = await getPortalScope(event)
  const now = new Date().toISOString()
  const names = await branchNames(event, scope)
  const branchFilter = scopeFilter(scope)
  const eventFilter = eventScopeFilter(scope)

  // AFC-577 capability gates. The family side reuses the AFC-576 collector
  // (no duplicated aggregation); the birthday side is staff-only with the
  // same scoping as visitor follow-ups (celebrations read AND visitors
  // read), so a volunteer sees no birthday content at all.
  const canHouseholds = can(scope, 'households', 'read')
  const canSundaySchool = can(scope, 'sunday_school_classes', 'read')
  const canSessions = can(scope, 'attendance_sessions', 'read')
  const celebrationsVisible =
    can(scope, 'celebrations', 'read') && can(scope, 'visitors', 'read')
  // sunday_school_classes.branch is nullable (zonal/area-level classes), so a
  // branch caller sees their own branches' classes plus the null-branch
  // ones -- the same shape as the event/department scope predicates. The
  // Directus policy stays authoritative; this only scopes the query.
  const sundayClassFilter = scope.isArea
    ? { status: { _eq: 'active' } }
    : mergeFilters(
        { status: { _eq: 'active' } },
        {
          _or: [{ branch: { _in: scope.branchIds } }, { branch: { _null: true } }],
        },
      )

  const [
    people,
    branches,
    upcomingEvents,
    followUps,
    currentSessions,
    priorSessions,
    trendSessions,
    welfareCases,
    peopleSummary,
    sundayClasses,
    sundaySessions,
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
    can(scope, 'people', 'read')
      ? collectPeopleSummary(event, scope)
      : Promise.resolve(null),
    canSundaySchool
      ? listItems<{
          id: string | number
          class_name: string
          branch: string | null
          students_count: number | null
          status: string | null
        }>(event, scope, 'sunday_school_classes', {
          filter: sundayClassFilter,
          fields: SUNDAY_SCHOOL_FIELDS,
          sort: 'class_name',
          limit: -1,
        })
      : Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: -1 } }),
    canSundaySchool && canSessions
      ? listItems<{
          id: string | number
          session_date: string
          session_name: string | null
          headcount_total: number | null
          branch: string | null
        }>(event, scope, 'attendance_sessions', {
          filter: mergeFilters({ session_type: { _eq: 'sunday_school' } }, branchFilter),
          fields: ['id', 'session_date', 'session_name', 'headcount_total', 'branch'],
          sort: '-session_date',
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

  // AFC-577 Sunday School summary: class count + total enrolment from the
  // scoped active classes, plus the 5 most recent sunday_school sessions.
  // The model holds no class schedule, so there is no "next sessions" list
  // to show -- recent sessions are what the model supports.
  const sundayClassRows: SundaySchoolClassRow[] = sundayClasses.data.map((row) => ({
    id: String(row.id),
    class_name: row.class_name,
    branch: row.branch,
    zone: null,
    teacher: null,
    students_count: row.students_count,
    status: (row.status ?? 'active') as SundaySchoolClassRow['status'],
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
  }))
  const sundayEnrolment = sundayClassRows.reduce(
    (sum, row) => sum + Number(row.students_count ?? 0),
    0,
  )
  const sundayTopClasses = [...sundayClassRows]
    .sort(
      (a, b) =>
        Number(b.students_count ?? 0) - Number(a.students_count ?? 0) ||
        a.class_name.localeCompare(b.class_name),
    )
    .slice(0, 5)
  const sundaySessionRows: DashboardSundaySession[] = sundaySessions.data.map(
    (session) => ({
      id: String(session.id),
      session_date: session.session_date,
      total: Number(session.headcount_total ?? 0),
      branch_name: session.branch ? (names.get(String(session.branch)) ?? null) : null,
    }),
  )

  // AFC-577 upcoming birthdays/anniversaries: staff-only, same scoping as
  // visitor follow-ups (celebrationsVisible). Two scoped sources merged into
  // one next-30-day list: approved/published birthday + anniversary
  // celebrations (recurring rows projected into the window with the shared
  // calendar mapper, so the widget agrees with the calendar feed), plus
  // month/day matches on people.date_of_birth. The DOB half runs only when
  // the caller's role may read the DOB field at all; neither half puts a
  // full date of birth, birth year, or age in the payload.
  const windowFrom = dateDaysAgo(0)
  const windowTo = dateDaysAhead(30)
  let celebrationItems: DashboardCelebrationItem[] = []
  if (celebrationsVisible) {
    // Celebrations half: scoped like the feed (area sees all; zone staff
    // see their zones; branch staff see their branches). Recurring rows are
    // read whole and projected in code because Directus cannot express
    // EXTRACT(month/day) -- the same approach as collectCelebrations.
    const scopePred = scope.isArea
      ? undefined
      : scope.zoneIds.length > 0
        ? { zone: { _in: scope.zoneIds } }
        : { branch: { _in: scope.branchIds } }
    const celebrationRows: Array<Record<string, unknown>> = []
    let celebrationPage = 1
    for (;;) {
      const result = await listItems<Record<string, unknown>>(
        event,
        scope,
        'celebrations',
        {
          filter: mergeFilters(
            scopePred,
            { status: { _in: ['approved', 'published'] } },
            { type: { _in: ['birthday', 'wedding_anniversary'] } },
            {
              _or: [
                { is_recurring: { _eq: true } },
                { event_date: { _gte: windowFrom, _lte: windowTo } },
              ],
            },
          ),
          fields: CELEBRATION_DASH_FIELDS,
          limit: 200,
          page: celebrationPage,
        },
      )
      celebrationRows.push(...result.data)
      if (result.data.length < 200 || celebrationRows.length >= result.meta.total) break
      celebrationPage += 1
    }
    const feedRows = celebrationRows as unknown as FeedCelebrationRow[]
    const occurrences = celebrationsToCalendarItems(feedRows, {
      from: windowFrom,
      to: windowTo,
    })
    const byId = new Map(feedRows.map((row) => [String(row.id), row]))
    const celebrationPersonIds = [
      ...new Set(occurrences.map((item) => String(byId.get(item.id)?.person ?? ''))),
    ].filter(Boolean)
    const celebrationPeople = new Map<string, Record<string, unknown>>()
    for (let i = 0; i < celebrationPersonIds.length; i += 100) {
      const chunk = celebrationPersonIds.slice(i, i + 100)
      const result = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: chunk } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name', 'is_minor'],
        limit: 100,
      })
      for (const row of result.data) celebrationPeople.set(String(row.id), row)
    }
    celebrationItems = occurrences.map((item) => {
      const row = byId.get(item.id)
      const person = celebrationPeople.get(String(row?.person ?? ''))
      return {
        kind: 'celebration' as const,
        id: item.id,
        name: person ? personDisplayName(person) : 'Unnamed',
        label: String(row?.type ?? 'celebration').replace(/_/g, ' '),
        date: item.date,
        branch_name: row?.branch ? (names.get(String(row.branch)) ?? null) : null,
        person_is_minor:
          typeof person?.is_minor === 'boolean' ? (person.is_minor as boolean) : null,
        href: `/celebrations/${item.id}`,
      }
    })

    // People-DOB half: month/day matches on active people in scope. Runs
    // only for roles that may read date_of_birth (super/area/branch admin
    // per FIELD_RESTRICTIONS); anyone else gets the celebrations half only.
    if (!isHidden(scope, 'people', 'date_of_birth')) {
      const birthdayItems: DashboardCelebrationItem[] = []
      let personPage = 1
      for (;;) {
        const result = await listItems<Record<string, unknown>>(event, scope, 'people', {
          filter: mergeFilters(
            branchFilter,
            { status: { _eq: 'active' } },
            { date_of_birth: { _nnull: true } },
          ),
          fields: BIRTHDAY_PERSON_FIELDS,
          limit: 200,
          page: personPage,
        })
        for (const row of result.data) {
          const md = monthDayOf(String(row.date_of_birth ?? ''))
          if (!md) continue
          const occurrence = occurrenceInWindow(md.month, md.day, windowFrom, windowTo)
          if (!occurrence) continue
          birthdayItems.push({
            kind: 'birthday',
            id: String(row.id),
            name: personDisplayName(row),
            label: 'birthday',
            date: occurrence,
            branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
            person_is_minor:
              typeof row.is_minor === 'boolean' ? (row.is_minor as boolean) : null,
            href: `/people/${String(row.id)}`,
          })
        }
        if (result.data.length < 200) break
        personPage += 1
      }
      // Merge, de-duplicating people who also have a birthday celebration
      // row (the named celebration wins over the derived DOB match). The
      // join is by person id, never by name (names are not unique).
      const celebratedPersonIds = new Set(
        celebrationItems
          .filter((item) => item.label === 'birthday')
          .map((item) => String(byId.get(item.id)?.person ?? '')),
      )
      for (const item of birthdayItems) {
        if (celebratedPersonIds.has(item.id)) continue
        celebrationItems.push(item)
      }
    }
    celebrationItems = celebrationItems
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name))
      .slice(0, 10)
  }

  const family = peopleSummary?.family ?? {
    households: 0,
    avg_members: 0,
    unlinked_people: 0,
  }
  const householdsVisible = canHouseholds && (peopleSummary?.households_visible ?? false)

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
      households: family.households,
      unlinkedPeople: family.unlinked_people,
      sundaySchoolClasses: canSundaySchool ? sundayClassRows.length : 0,
      sundaySchoolEnrolment: canSundaySchool ? sundayEnrolment : 0,
      upcomingCelebrations: celebrationItems.length,
    },
    attendanceTrend,
    upcomingEvents: upcomingRows,
    followUps: visitorRows,
    welfareCases: welfareRows,
    family: {
      households: family.households,
      avg_members: family.avg_members,
      unlinked_people: family.unlinked_people,
      households_visible: householdsVisible,
    },
    sundaySchool: {
      classes: canSundaySchool ? sundayClassRows.length : 0,
      enrolment: canSundaySchool ? sundayEnrolment : 0,
      visible: canSundaySchool,
    },
    sundaySchoolClasses: canSundaySchool ? sundayTopClasses : [],
    sundaySchoolSessions: canSundaySchool ? sundaySessionRows : [],
    upcomingCelebrations: celebrationItems,
    branches: branches.data.map((branch) => ({
      ...(branch as unknown as DashboardData['branches'][number]),
      id: String(branch.id),
    })),
  }
})
