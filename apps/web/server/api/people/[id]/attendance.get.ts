import { SERVICE_TYPE_KEYS } from '@afc/shared'
import {
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
  zoneScopeFilter,
} from '../../../utils/portal'

const DAY_MS = 86_400_000
const DEFAULT_WEEKS = 12
const MAX_WEEKS = 52

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** Monday (UTC) starting the week that holds `day` (YYYY-MM-DD). */
function weekStartFor(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  const offset = (date.getUTCDay() + 6) % 7
  return isoDay(new Date(date.getTime() - offset * DAY_MS))
}

function mondayOfCurrentWeek(now: Date): Date {
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  )
  const offset = (midnight.getUTCDay() + 6) % 7
  return new Date(midnight.getTime() - offset * DAY_MS)
}

interface PersonRecordRow {
  id: string | number
  session: string | null
  recorded_at: string | null
}

interface SessionRow {
  id: string | number
  session_name: string
  session_date: string
  session_type: string
}

/**
 * Per-person attendance history (AFC-597).
 *
 * GET /api/people/:id/attendance?weeks=N&session_type=
 *
 * Pure read over the existing check-in rows: attendance_records links
 * person+session (records.post.ts flow) and attendance_sessions carries the
 * session_type/service + date. The person lookup goes through
 * findScopedItem, so a person outside the caller scope is a 404
 * (fail-closed); sessions outside the caller scope never enter either the
 * `held` denominator or the `present` numerator. No new collections.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'people', 'read')
  requireCan(scope, 'attendance_sessions', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A person id is required' })
  }

  const query = getQuery(event)
  const rawWeeks = Array.isArray(query.weeks) ? query.weeks[0] : query.weeks
  let weeks = rawWeeks === undefined ? DEFAULT_WEEKS : Number(rawWeeks)
  if (!Number.isFinite(weeks)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'weeks must be a number between 1 and 52',
      data: { code: 'validation_error', fields: { weeks: 'Expected 1-52' } },
    })
  }
  weeks = Math.floor(weeks)
  if (weeks < 1 || weeks > MAX_WEEKS) {
    throw createError({
      statusCode: 400,
      statusMessage: 'weeks must be a number between 1 and 52',
      data: { code: 'validation_error', fields: { weeks: 'Expected 1-52' } },
    })
  }

  const rawType = Array.isArray(query.session_type)
    ? query.session_type[0]
    : query.session_type
  const sessionType =
    typeof rawType === 'string' && rawType.trim().length > 0 ? rawType.trim() : null
  if (sessionType && !(SERVICE_TYPE_KEYS as readonly string[]).includes(sessionType)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown session type: ${sessionType}`,
      data: { code: 'validation_error', fields: { session_type: 'Unknown type' } },
    })
  }

  try {
    await findScopedItem(event, scope, 'people', id, { fields: ['id'] })

    const now = new Date()
    const currentMonday = mondayOfCurrentWeek(now)
    const oldestMonday = new Date(currentMonday.getTime() - (weeks - 1) * 7 * DAY_MS)
    const from = isoDay(oldestMonday)
    const to = isoDay(now)

    const sessionFilter = mergeFilters(
      { session_date: { _gte: from, _lte: to } },
      sessionType ? { session_type: { _eq: sessionType } } : undefined,
      scopeFilter(scope),
      zoneScopeFilter(scope),
    )

    const [held, mine] = await Promise.all([
      listItems<SessionRow>(event, scope, 'attendance_sessions', {
        filter: sessionFilter,
        fields: ['id', 'session_name', 'session_date', 'session_type'],
        sort: 'session_date',
        limit: -1,
      }),
      listItems<PersonRecordRow>(event, scope, 'attendance_records', {
        filter: { person: { _eq: id } },
        fields: ['id', 'session', 'recorded_at'],
        sort: '-recorded_at',
        limit: -1,
      }),
    ])

    // Only scoped sessions count: index the in-window, in-scope sessions.
    const scopedSessions = new Map<string, SessionRow>()
    for (const session of held.data) {
      if (!session.session_date) continue
      if (session.session_date < from || session.session_date > to) continue
      scopedSessions.set(String(session.id), session)
    }

    // The person's check-ins that land on a scoped in-window session.
    const attendedSessionIds = new Set<string>()
    const attendedSessions: SessionRow[] = []
    for (const record of mine.data) {
      if (!record.session) continue
      const key = String(record.session)
      if (attendedSessionIds.has(key)) continue
      const session = scopedSessions.get(key)
      if (!session) continue
      attendedSessionIds.add(key)
      attendedSessions.push(session)
    }
    attendedSessions.sort((a, b) => (a.session_date < b.session_date ? -1 : 1))

    const buckets = Array.from({ length: weeks }, (_, index) => {
      const start = new Date(oldestMonday.getTime() + index * 7 * DAY_MS)
      return { week_start: isoDay(start), sessions_held: 0, present: 0 }
    })
    const bucketIndex = new Map(buckets.map((bucket, index) => [bucket.week_start, index]))
    for (const session of scopedSessions.values()) {
      const index = bucketIndex.get(weekStartFor(session.session_date))
      const bucket = index === undefined ? undefined : buckets[index]
      if (bucket) bucket.sessions_held += 1
    }
    const countedWeeks = new Set<string>()
    for (const session of attendedSessions) {
      const week = weekStartFor(session.session_date)
      const index = bucketIndex.get(week)
      const bucket = index === undefined ? undefined : buckets[index]
      if (!bucket) continue
      // One presence mark per week keeps the bar chart readable when a
      // week holds several sessions of the filtered type.
      if (countedWeeks.has(week)) continue
      countedWeeks.add(week)
      bucket.present = 1
    }

    const sessionsHeld = buckets.reduce((sum, bucket) => sum + bucket.sessions_held, 0)
    const weeksPresent = buckets.reduce((sum, bucket) => sum + bucket.present, 0)
    const sessionsAttended = attendedSessions.length

    return {
      data: {
        person: id,
        weeks,
        session_type: sessionType,
        from,
        to,
        buckets,
        sessions: attendedSessions.map((session) => ({
          id: String(session.id),
          session_name: session.session_name,
          session_date: session.session_date,
          session_type: session.session_type,
          href: `/attendance/${session.id}`,
        })),
        totals: {
          sessions_held: sessionsHeld,
          sessions_attended: sessionsAttended,
          weeks_present: weeksPresent,
          rate: sessionsHeld > 0 ? sessionsAttended / sessionsHeld : null,
        },
      },
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'attendance_store', '0023')
  }
})
