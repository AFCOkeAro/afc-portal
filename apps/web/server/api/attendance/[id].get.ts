import type { AttendanceDetail } from '../../../types/portal'
import {
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHiddenMany,
} from '../../utils/portal'

const SESSION_FIELDS = [
  'id',
  'branch',
  'session_date',
  'session_type',
  'service',
  'event',
  'session_name',
  'headcount_total',
  'headcount_men',
  'headcount_women',
  'headcount_children',
  'recorded_by',
  'recorded_at',
]

interface AttendanceRecordRow {
  id: string | number
  session: string
  person: string | null
  attendee_name: string | null
  attendance_category: string | null
  recorded_by: string | null
  recorded_at: string | null
}

export default defineEventHandler(async (event): Promise<AttendanceDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_sessions', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A session id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'attendance_sessions',
    id,
    { fields: SESSION_FIELDS },
  )
  const names = await branchNames(event, scope)

  let records: AttendanceRecordRow[] = []
  if (can(scope, 'attendance_records', 'read')) {
    const result = await listItems<AttendanceRecordRow>(
      event,
      scope,
      'attendance_records',
      {
        filter: { session: { _eq: id } },
        fields: [
          'id',
          'session',
          'person',
          'attendee_name',
          'attendance_category',
          'recorded_by',
          'recorded_at',
        ],
        sort: 'attendee_name',
        limit: -1,
      },
    )
    records = stripHiddenMany(
      scope,
      'attendance_records',
      result.data as unknown as Record<string, unknown>[],
    ) as unknown as AttendanceRecordRow[]
  }

  const personIds = [
    ...new Set(
      records
        .map((record) => record.person)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const people = new Map<string, string>()
  if (personIds.length > 0) {
    const response = await listItems<{
      id: string | number
      first_name: string
      last_name: string
      preferred_name: string | null
    }>(event, scope, 'people', {
      filter: { id: { _in: personIds } },
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      limit: personIds.length,
    })
    for (const person of response.data) {
      const name = [person.first_name, person.last_name].filter(Boolean).join(' ')
      people.set(String(person.id), person.preferred_name || name)
    }
  }

  return {
    ...(row as unknown as AttendanceDetail),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    records_count: records.length,
    records: records.map((record) => ({
      ...record,
      id: String(record.id),
      person_name: record.person ? (people.get(record.person) ?? null) : null,
    })) as AttendanceDetail['records'],
  }
})
