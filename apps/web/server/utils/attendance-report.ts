import type { H3Event } from 'h3'
import { attendanceReportQuerySchema, optionalText } from '@afc/shared'
import type { AttendanceReport, AttendanceSplitRow } from '../../types/portal'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  scopeFilter,
  scopeZoneIds,
  throwStoreUnavailable,
  throwValidation,
  zoneScopeFilter,
  type PortalScope,
} from './portal'

/**
 * Split-contract report (AFC-468 US-A3). Aggregates branch|zone x category x
 * sex x date bucket over `attendance_sessions` joined to `attendance_counts`
 * in the route layer: sessions are read in bounded chunks (200 per page, the
 * chunked cursor the CSV shares), counts are read per chunk, and grouping
 * happens in memory over the grouped cardinality — never over a full-buffer
 * of both tables at once.
 *
 * Permission scope is fail-closed via getPortalScope/scopeFilter: a branch
 * admin's report holds only their own branch (a foreign `branch` is a 403, a
 * foreign `zone` is a 403), a zone grant holds only its zone, area sees all.
 * The HTTP 403/empty half lives here, not in SQL (suite 71 states the split).
 */

interface SessionRow {
  id: string | number
  branch: string | null
  zone: string | null
  session_date: string
  session_type: string
}

interface CountRow {
  session: string | number
  category: string
  sex: string
  count: number | null
}

interface ZoneRow {
  id: string | number
  name: string
}

const SESSION_CHUNK = 200
const DAY_MS = 86_400_000

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function parseDay(value: string): Date {
  return new Date(`${value}T00:00:00Z`)
}

function shiftYear(value: string, delta: number): string {
  const date = parseDay(value)
  date.setUTCFullYear(date.getUTCFullYear() + delta)
  return isoDay(date)
}

/** Period preset onto an explicit range anchored at `to`. */
function periodRange(
  period: string,
  from: string | undefined,
  to: string,
): { from: string; to: string } {
  if (period === 'custom') {
    if (!from) {
      throw createError({
        statusCode: 400,
        statusMessage: 'A custom period needs both date_from and date_to',
        data: { code: 'validation_error' },
      })
    }
    if (from > to) {
      throw createError({
        statusCode: 400,
        statusMessage: 'date_from must be on or before date_to',
        data: { code: 'validation_error' },
      })
    }
    return { from, to }
  }
  const anchor = parseDay(to)
  if (period === 'weekly') {
    return { from: isoDay(new Date(anchor.getTime() - 6 * DAY_MS)), to }
  }
  if (period === 'monthly') {
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    return { from: isoDay(first), to }
  }
  if (period === 'quarterly') {
    const firstMonth = Math.floor(anchor.getUTCMonth() / 3) * 3
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), firstMonth, 1))
    return { from: isoDay(first), to }
  }
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))
  return { from: isoDay(first), to }
}

/** Date bucket key for the period (weekly buckets start Monday). */
function bucketFor(date: string, period: string): string {
  if (period === 'monthly') return date.slice(0, 7)
  if (period === 'yearly') return date.slice(0, 4)
  if (period === 'quarterly') {
    const month = Number(date.slice(5, 7))
    return `${date.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`
  }
  if (period === 'weekly') {
    const day = parseDay(date)
    const offset = (day.getUTCDay() + 6) % 7
    return isoDay(new Date(day.getTime() - offset * DAY_MS))
  }
  return date
}

async function zoneNames(
  event: H3Event,
  scope: PortalScope,
): Promise<Map<string, string>> {
  const rows = await listItems<ZoneRow>(event, scope, 'zones', {
    fields: ['id', 'name'],
    limit: -1,
  })
  return new Map(rows.data.map((row) => [String(row.id), row.name]))
}

export interface SplitAggregateOptions {
  scope?: PortalScope
  groupBy: 'branch' | 'zone'
  sessionType?: string
  branch?: string | null
  zone?: string | null
  from: string
  to: string
  period: string
}

/** Unhandled grouped rows plus the distinct session count behind them. */
export interface SplitAggregate {
  rows: AttendanceSplitRow[]
  sessions: number
}

/**
 * The one filtered aggregate the report and the CSV share: same sessions
 * predicate, same chunked reads, same grouping. Row-equality between the two
 * outputs is structural — the CSV serialises exactly these rows.
 */
export async function collectSplitAggregate(
  event: H3Event,
  scope: PortalScope,
  options: Omit<SplitAggregateOptions, 'scope'>,
): Promise<SplitAggregate> {
  const names = await branchNames(event, scope)
  const zones = await zoneNames(event, scope)

  const grouped = new Map<string, AttendanceSplitRow>()
  const seenSessions = new Set<string>()
  let page = 1

  for (;;) {
    // AFC-566: the chunked reads below hit the 0023 sessions register
    // (counts ride the 0003 table). A missing/unreadable store maps to
    // the named error, never a bare 500 -- this hardens report.get,
    // report.csv.get and every future caller of the shared collector.
    let sessions: { data: SessionRow[] }
    let counts: { data: CountRow[] }
    try {
      sessions = await listItems<SessionRow>(event, scope, 'attendance_sessions', {
        filter: mergeFilters(
          { session_date: { _gte: options.from, _lte: options.to } },
          options.sessionType ? { session_type: { _eq: options.sessionType } } : undefined,
          options.branch ? { branch: { _eq: options.branch } } : undefined,
          options.zone ? { zone: { _eq: options.zone } } : undefined,
          scopeFilter(scope),
          zoneScopeFilter(scope),
        ),
        fields: ['id', 'branch', 'zone', 'session_date', 'session_type'],
        sort: 'session_date,id',
        page,
        limit: SESSION_CHUNK,
      })
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throwStoreUnavailable(error, 'attendance_store', '0023')
    }
    if (sessions.data.length === 0) break

    const ids = sessions.data.map((row) => String(row.id))
    const byId = new Map(sessions.data.map((row) => [String(row.id), row]))
    for (const id of ids) seenSessions.add(id)

    try {
      counts = await listItems<CountRow>(event, scope, 'attendance_counts', {
        filter: { session: { _in: ids } },
        fields: ['session', 'category', 'sex', 'count'],
        limit: -1,
      })
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throwStoreUnavailable(error, 'attendance_store', '0023')
    }
    for (const count of counts.data) {
      const session = byId.get(String(count.session))
      if (!session) continue
      const groupId =
        options.groupBy === 'zone'
          ? (session.zone ?? 'unassigned')
          : (session.branch ?? 'unassigned')
      const key = [
        groupId,
        session.session_type,
        bucketFor(session.session_date, options.period),
        count.category,
      ].join('|')
      const row = grouped.get(key) ?? {
        branch: session.branch,
        branch_name: session.branch ? (names.get(String(session.branch)) ?? null) : null,
        zone: session.zone,
        zone_name: session.zone ? (zones.get(String(session.zone)) ?? null) : null,
        service: session.session_type,
        date: bucketFor(session.session_date, options.period),
        category: count.category,
        male: 0,
        female: 0,
        total: 0,
      }
      const value = Number(count.count ?? 0)
      // Historical backfilled rows carry sex = unspecified (suite 71 §71.3):
      // they count toward the category total but toward neither sex column.
      if (count.sex === 'male') row.male += value
      else if (count.sex === 'female') row.female += value
      row.total += value
      grouped.set(key, row)
    }

    if (sessions.data.length < SESSION_CHUNK) break
    page += 1
  }

  const rowKey = (row: AttendanceSplitRow): string =>
    [row.branch ?? row.zone ?? '', row.service, row.date, row.category].join('|')
  const rows = [...grouped.values()].sort((left, right) =>
    rowKey(left).localeCompare(rowKey(right)),
  )
  return { rows, sessions: seenSessions.size }
}

export async function buildAttendanceReport(
  event: H3Event,
  scope?: PortalScope,
): Promise<AttendanceReport> {
  const activeScope = scope ?? (await getPortalScope(event))
  requireCan(activeScope, 'attendance_sessions', 'read')
  requireCan(activeScope, 'attendance_counts', 'read')

  const raw = getQuery(event)
  const compareRaw = raw.compare_prior_year
  const parsed = attendanceReportQuerySchema
    .extend({ branch: optionalText(36), zone: optionalText(36) })
    .safeParse({
      ...raw,
      branch: raw.branch === 'all' ? undefined : raw.branch,
      zone: raw.zone === 'all' ? undefined : raw.zone,
      compare_prior_year:
        compareRaw === true || compareRaw === 'true' || compareRaw === '1',
    })
  if (!parsed.success) throwValidation(parsed.error)
  const query = parsed.data as typeof parsed.data & {
    branch?: unknown
    zone?: unknown
  }
  const requestedBranch =
    typeof query.branch === 'string' && query.branch.length > 0 ? query.branch : null
  const requestedZone =
    typeof query.zone === 'string' && query.zone.length > 0 ? query.zone : null

  if (
    requestedBranch &&
    !activeScope.isArea &&
    !activeScope.branchIds.includes(requestedBranch)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That branch is outside your scope',
      data: { code: 'branch_out_of_scope' },
    })
  }
  const visibleZones = await scopeZoneIds(event, activeScope)
  requireZoneInScope(activeScope, requestedZone, visibleZones)

  const today = isoDay(new Date())
  const to = query.date_to ?? today
  const { from } = periodRange(query.period, query.date_from, to)

  const aggregate = await collectSplitAggregate(event, activeScope, {
    groupBy: query.group_by,
    sessionType: query.session_type,
    branch: requestedBranch,
    zone: requestedZone,
    from,
    to,
    period: query.period,
  })

  let compare: AttendanceReport['compare'] = null
  if (query.compare_prior_year) {
    const prior = await collectSplitAggregate(event, activeScope, {
      groupBy: query.group_by,
      sessionType: query.session_type,
      branch: requestedBranch,
      zone: requestedZone,
      from: shiftYear(from, -1),
      to: shiftYear(to, -1),
      period: query.period,
    })
    const male = prior.rows.reduce((sum, row) => sum + row.male, 0)
    const female = prior.rows.reduce((sum, row) => sum + row.female, 0)
    const total = prior.rows.reduce((sum, row) => sum + row.total, 0)
    compare = {
      from: shiftYear(from, -1),
      to: shiftYear(to, -1),
      sessions: prior.sessions,
      male,
      female,
      total,
      has_data: prior.sessions > 0,
    }
  }

  const male = aggregate.rows.reduce((sum, row) => sum + row.male, 0)
  const female = aggregate.rows.reduce((sum, row) => sum + row.female, 0)
  const total = aggregate.rows.reduce((sum, row) => sum + row.total, 0)

  const start = (query.page - 1) * query.limit
  const rows = aggregate.rows.slice(start, start + query.limit)

  return {
    rows,
    totals: { sessions: aggregate.sessions, male, female, total },
    compare,
    meta: { total: aggregate.rows.length, page: query.page, limit: query.limit },
    filters: {
      from,
      to,
      branch: requestedBranch,
      zone: requestedZone,
      session_type: query.session_type ?? null,
      group_by: query.group_by,
      period: query.period,
    },
  }
}
