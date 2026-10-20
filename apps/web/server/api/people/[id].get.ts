import type { PersonDetail, PersonTimelineItem } from '../../../types/portal'
import {
  ageFromDob,
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  isHidden,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHidden,
  visibleFields,
} from '../../utils/portal'

const PERSON_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'other_names',
  'gender',
  'date_of_birth',
  'is_minor',
  'phone',
  'email',
  'address',
  'household',
  'branch',
  'membership_status',
  'member_since',
  'guardian',
  'consent_data',
  'consent_media',
  'consent_signed_at',
  'status',
  'notes',
  'safeguarding_flag',
]

interface AttendanceRecordRow {
  id: string | number
  session: string | null
  attendance_category: string | null
  recorded_at: string | null
}

interface SessionRow {
  id: string | number
  session_name: string
  session_date: string
  session_type: string
}

interface RegistrationRow {
  id: string | number
  event: string | null
  registration_status: string
  created_at: string | null
}

interface EventRow {
  id: string | number
  title: string
  start_at: string
}

interface VisitorRow {
  id: string | number
  visit_date: string
  status: string
}

export default defineEventHandler(async (event): Promise<PersonDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A person id is required' })
  }

  const person = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'people',
    id,
    { fields: visibleFields(scope, 'people', PERSON_FIELDS) },
  )
  const names = await branchNames(event, scope)
  const timeline: PersonTimelineItem[] = []

  const [attendance, registrations, visitorRows, welfareRows] = await Promise.all([
    listItems<AttendanceRecordRow>(event, scope, 'attendance_records', {
      filter: { person: { _eq: id } },
      fields: ['id', 'session', 'attendance_category', 'recorded_at'],
      sort: '-recorded_at',
      limit: 25,
    }),
    can(scope, 'events', 'read')
      ? listItems<RegistrationRow>(event, scope, 'event_registrations', {
          filter: mergeFilters(
            { person: { _eq: id } },
            scopeFilter(scope),
          ),
          fields: ['id', 'event', 'registration_status', 'created_at'],
          sort: '-created_at',
          limit: 20,
        })
      : Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 20 } }),
    can(scope, 'visitors', 'read')
      ? listItems<VisitorRow>(event, scope, 'visitors', {
          filter: mergeFilters({ person: { _eq: id } }, scopeFilter(scope)),
          fields: ['id', 'visit_date', 'status'],
          sort: '-visit_date',
          limit: 10,
        })
      : Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 10 } }),
    can(scope, 'welfare_cases', 'read')
      ? listItems<{ id: string | number; case_ref: string; category: string; status: string; opened_at: string | null }>(
          event,
          scope,
          'welfare_cases',
          {
            filter: mergeFilters({ person: { _eq: id } }, scopeFilter(scope)),
            fields: ['id', 'case_ref', 'category', 'status', 'opened_at'],
            sort: '-opened_at',
            limit: 10,
          },
        )
      : Promise.resolve({ data: [], meta: { total: 0, page: 1, limit: 10 } }),
  ])

  const sessionIds = [
    ...new Set(
      attendance.data
        .map((record) => record.session)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const sessions = new Map<string, SessionRow>()
  if (sessionIds.length > 0) {
    const response = await listItems<SessionRow>(event, scope, 'attendance_sessions', {
      filter: { id: { _in: sessionIds } },
      fields: ['id', 'session_name', 'session_date', 'session_type'],
      limit: sessionIds.length,
    })
    for (const session of response.data) sessions.set(String(session.id), session)
  }

  for (const record of attendance.data) {
    const session = record.session ? sessions.get(record.session) : undefined
    timeline.push({
      id: `attendance-${record.id}`,
      kind: 'attendance',
      title: session?.session_name ?? 'Attendance',
      detail: record.attendance_category
        ? `Recorded as ${record.attendance_category.replace(/_/g, ' ')}`
        : null,
      at: record.recorded_at ?? session?.session_date ?? null,
    })
  }

  const eventIds = [
    ...new Set(
      registrations.data
        .map((registration) => registration.event)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const events = new Map<string, EventRow>()
  if (eventIds.length > 0) {
    const response = await listItems<EventRow>(event, scope, 'events', {
      filter: { id: { _in: eventIds } },
      fields: ['id', 'title', 'start_at'],
      limit: eventIds.length,
    })
    for (const row of response.data) events.set(String(row.id), row)
  }

  for (const registration of registrations.data) {
    const event = registration.event ? events.get(registration.event) : undefined
    timeline.push({
      id: `registration-${registration.id}`,
      kind: 'registration',
      title: event?.title ?? 'Event registration',
      detail: `Registration ${registration.registration_status.replace(/_/g, ' ')}`,
      at: registration.created_at ?? event?.start_at ?? null,
    })
  }

  for (const visitor of visitorRows.data) {
    timeline.push({
      id: `visitor-${visitor.id}`,
      kind: 'visitor',
      title: 'Visitor follow-up',
      detail: `Status ${visitor.status.replace(/_/g, ' ')}`,
      at: visitor.visit_date,
    })
  }

  for (const welfare of welfareRows.data) {
    timeline.push({
      id: `welfare-${welfare.id}`,
      kind: 'welfare',
      title: `Welfare ${welfare.case_ref}`,
      detail: `${welfare.category} · ${welfare.status}`,
      at: welfare.opened_at,
    })
  }

  timeline.sort((a, b) => {
    const left = a.at ? Date.parse(a.at) : 0
    const right = b.at ? Date.parse(b.at) : 0
    return right - left
  })

  const record = person
  const row = stripHidden(scope, 'people', {
    ...record,
    id: String(record.id),
    branch_name: record.branch
      ? (names.get(String(record.branch)) ?? null)
      : null,
    age: isHidden(scope, 'people', 'date_of_birth')
      ? null
      : ageFromDob(record.date_of_birth as string | null | undefined),
  })

  return { ...(row as unknown as PersonDetail), timeline }
})
