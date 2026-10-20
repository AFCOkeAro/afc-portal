import type { H3Event } from 'h3'
import type { Blessing } from '@afc/shared'
import { BLESSING_TYPES } from '@afc/shared'
import {
  branchNames,
  csvEscape,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  zoneScopeFilter,
  type PortalScope,
} from './portal'

const DAY_MS = 24 * 60 * 60 * 1000

const BLESSING_FIELDS = [
  'id',
  'blessing_type',
  'other_label',
  'male_count',
  'female_count',
  'total_count',
  'branch',
  'zone',
  'bsc',
  'session',
  'event',
  'sunday_service',
  'service_date',
  'recorded_by',
  'notes',
  'created_at',
  'updated_at',
]

export interface BlessingReportFilters {
  branch: string | null
  zone: string | null
  blessing_type: string | null
  session: string | null
  event: string | null
  sunday_service: string | null
  bsc: string | null
  period: string
  date_from: string | null
  date_to: string | null
  group_by: 'branch' | 'zone'
  sort: string | null
  page: number
  limit: number
}

export function blessingReportFilters(event: H3Event): BlessingReportFilters {
  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  return {
    branch: text('branch'),
    zone: text('zone'),
    blessing_type: text('blessing_type'),
    session: text('session'),
    event: text('event'),
    sunday_service: text('sunday_service') ?? text('service'),
    bsc: text('bsc'),
    period: text('period') ?? 'monthly',
    date_from: text('date_from'),
    date_to: text('date_to'),
    group_by: text('group_by') === 'zone' ? 'zone' : 'branch',
    sort: text('sort'),
    page: Math.max(1, Number(query.page) || 1),
    limit: Math.min(200, Math.max(1, Number(query.limit) || 25)),
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Period preset onto an explicit service_date range. Same bucket semantics
 * as the attendance collector (attendance-report.ts): weekly is the trailing
 * 7 days, monthly/quarterly/yearly anchor at the range start, custom needs
 * both ends. One convention for both reports so the UI period picker means
 * the same thing everywhere.
 */
export function blessingPeriodRange(
  period: string,
  from: string | null,
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
  if (period === 'weekly') {
    const anchor = new Date(`${to}T00:00:00Z`).getTime()
    return { from: new Date(anchor - 6 * DAY_MS).toISOString().slice(0, 10), to }
  }
  if (period === 'monthly') return { from: to.slice(0, 7) + '-01', to }
  if (period === 'quarterly') {
    const month = Number(to.slice(5, 7))
    const firstMonth = Math.floor((month - 1) / 3) * 3 + 1
    return { from: `${to.slice(0, 4)}-${String(firstMonth).padStart(2, '0')}-01`, to }
  }
  return { from: `${to.slice(0, 4)}-01-01`, to }
}

/** Sort allowlist: the list route sorts, never an arbitrary column. */
const SORTS: Record<string, Record<string, 1 | -1>> = {
  service_date: { service_date: 1 },
  '-service_date': { service_date: -1 },
  blessing_type: { blessing_type: 1 },
  total_count: { total_count: 1 },
  '-total_count': { total_count: -1 },
}

export function blessingSortParam(sort: string | null): string {
  if (sort && sort in SORTS) return sort
  return '-service_date'
}

async function zoneNames(
  event: H3Event,
  scope: PortalScope,
): Promise<Map<string, string>> {
  const rows = await listItems<{ id: string | number; name: string }>(
    event,
    scope,
    'zones',
    { fields: ['id', 'name'], limit: -1 },
  )
  return new Map(rows.data.map((row) => [String(row.id), row.name]))
}

/**
 * The hierarchy predicate for blessings (AFC-474, data-model-expansion §10).
 * Area staff see all; zone staff see their zone's blessings; branch staff
 * see their own branches' blessings. Requested values are intersected with
 * the scope predicate (empty, never foreign); an explicitly out-of-scope
 * `zone` or `branch` is a 403 (fail-closed). Same predicate shape as the
 * services list route.
 *
 * Department heads hold CRU (dept) in the matrix; blessings carry no
 * department column, so the smallest defensible reading enforced here is
 * their branch scope (their branches' rows). Finer dept-vs-dept separation
 * lives in the Directus policy, which is the authoritative control.
 */
export async function blessingScopeFilter(
  event: H3Event,
  scope: PortalScope,
  filters: Pick<BlessingReportFilters, 'branch' | 'zone'>,
): Promise<Record<string, unknown> | undefined> {
  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, filters.zone, visibleZones)
  // resolveBranch 403s on a branch outside the caller's scope; an
  // explicitly out-of-scope branch is a 403, never an empty list.
  const resolvedBranch = filters.branch ? resolveBranch(scope, filters.branch) : undefined
  return mergeFilters(
    filters.zone ? { zone: { _eq: filters.zone } } : undefined,
    resolvedBranch ? { branch: { _eq: resolvedBranch } } : undefined,
    scope.isArea
      ? undefined
      : scope.zoneIds.length > 0
        ? zoneScopeFilter(scope)
        : { branch: { _in: scope.branchIds } },
  )
}

export interface BlessingRow extends Blessing {
  branch_name: string | null
  zone_name: string | null
}

export interface BlessingBreakdown {
  blessing_type: string
  male: number
  female: number
  total: number
}

/**
 * Scoped blessing collection (AFC-474). One filtered read feeds the list,
 * the CSV export, and the profile roll-ups, so the three cannot drift:
 * same predicate, same fields, same scope. total_count is read, never
 * written -- Postgres derives it (migration 0011 GENERATED choice).
 */
export async function collectBlessings(
  event: H3Event,
  scope: PortalScope,
  filters: BlessingReportFilters,
): Promise<{ rows: BlessingRow[]; total: number; breakdown: BlessingBreakdown[] }> {
  requireCan(scope, 'blessings', 'read')
  const to = filters.date_to ?? todayIso()
  const { from, to: end } = blessingPeriodRange(filters.period, filters.date_from, to)

  const filter = mergeFilters(
    await blessingScopeFilter(event, scope, filters),
    { service_date: { _gte: from, _lte: end } },
    filters.blessing_type ? { blessing_type: { _eq: filters.blessing_type } } : undefined,
    filters.session ? { session: { _eq: filters.session } } : undefined,
    filters.event ? { event: { _eq: filters.event } } : undefined,
    filters.sunday_service
      ? { sunday_service: { _eq: filters.sunday_service } }
      : undefined,
    filters.bsc ? { bsc: { _eq: filters.bsc } } : undefined,
  )

  // Chunked (200 per page) so memory grows with the filtered set, not with
  // an unbounded single page. Same bound as the welfare collector.
  const rows: Array<Record<string, unknown>> = []
  let total: number
  let page = 1
  for (;;) {
    const result = await listItems<Record<string, unknown>>(event, scope, 'blessings', {
      filter,
      fields: BLESSING_FIELDS,
      sort: blessingSortParam(filters.sort),
      page,
      limit: 200,
    })
    total = result.meta.total
    rows.push(...result.data)
    if (result.data.length < 200 || rows.length >= total) break
    page += 1
  }

  const [names, zones] = await Promise.all([
    branchNames(event, scope),
    zoneNames(event, scope),
  ])
  const typed: BlessingRow[] = rows.map((row) => ({
    ...(row as unknown as Blessing),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    zone_name: row.zone ? (zones.get(String(row.zone)) ?? null) : null,
  }))

  const byType = new Map<string, BlessingBreakdown>()
  for (const row of typed) {
    const key = row.blessing_type
    const existing = byType.get(key)
    if (existing) {
      existing.male += Number(row.male_count ?? 0)
      existing.female += Number(row.female_count ?? 0)
      existing.total += Number(row.total_count ?? 0)
    } else {
      byType.set(key, {
        blessing_type: key,
        male: Number(row.male_count ?? 0),
        female: Number(row.female_count ?? 0),
        total: Number(row.total_count ?? 0),
      })
    }
  }
  const breakdown = [...BLESSING_TYPES]
    .filter((type) => byType.has(type))
    .map((type) => byType.get(type) as BlessingBreakdown)

  return { rows: typed, total, breakdown }
}

export interface BlessingCompare {
  from: string
  to: string
  total: number
  male: number
  female: number
  has_data: boolean
  delta_total: number
}

function shiftYear(date: string, delta: number): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  parsed.setUTCFullYear(parsed.getUTCFullYear() + delta)
  return parsed.toISOString().slice(0, 10)
}

/**
 * Prior-year compare (AFC-485, US-A4). Re-runs the same scoped collection
 * over the same predicate shifted one year back and returns side-by-side
 * totals plus the delta — the blessings analogue of the attendance
 * `compare_prior_year` toggle (attendance-report.ts). Same grouping as the
 * report (branch|zone via the scope filter, blessing_type breakdown, service
 * date bucket); permission scope is identical because it is the same
 * collector with the same scope.
 */
export async function collectBlessingsCompare(
  event: H3Event,
  scope: PortalScope,
  filters: BlessingReportFilters,
  current: { total: number; breakdown: BlessingBreakdown[] },
): Promise<BlessingCompare | null> {
  const query = getQuery(event)
  const raw = query.compare_prior_year
  const wantsCompare = raw === true || raw === 'true' || raw === '1'
  if (!wantsCompare) return null
  const to = filters.date_to ?? todayIso()
  const { from, to: end } = blessingPeriodRange(filters.period, filters.date_from, to)
  const prior = await collectBlessings(event, scope, {
    ...filters,
    date_from: shiftYear(from, -1),
    date_to: shiftYear(end, -1),
    page: 1,
    limit: 200,
  })
  const male = prior.breakdown.reduce((sum, line) => sum + line.male, 0)
  const female = prior.breakdown.reduce((sum, line) => sum + line.female, 0)
  return {
    from: shiftYear(from, -1),
    to: shiftYear(end, -1),
    total: prior.total,
    male,
    female,
    has_data: prior.rows.length > 0,
    delta_total: current.total - prior.total,
  }
}

/** CSV body (US-B2 AC2): branch, zone, service, date, type, male, female, total. */
export function blessingsToCsv(rows: BlessingRow[]): string[][] {
  const serviceOf = (row: BlessingRow): string =>
    (row.sunday_service ?? row.event ?? row.session ?? '') as string
  return [
    ['branch', 'zone', 'service', 'date', 'blessing_type', 'male', 'female', 'total'],
    ...rows.map((row) => [
      row.branch_name ?? String(row.branch ?? ''),
      row.zone_name ?? (row.zone ? String(row.zone) : ''),
      serviceOf(row) ? String(serviceOf(row)) : '',
      row.service_date,
      row.other_label && row.blessing_type === 'other'
        ? `other:${row.other_label}`
        : row.blessing_type,
      String(row.male_count ?? 0),
      String(row.female_count ?? 0),
      String(row.total_count ?? 0),
    ]),
  ]
}

export function blessingsCsvString(rows: BlessingRow[]): string {
  return blessingsToCsv(rows)
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
}

/**
 * Profile roll-up (prd-expansion §1.1 analytics-with-drill-down). Sums one
 * branch/zone/BSC scope over an optional range; the caller renders each
 * count as a link to the filtered blessings list, which is the UI contract.
 */
export async function blessingsRollup(
  event: H3Event,
  scope: PortalScope,
  where: { branch?: string; zone?: string; bsc?: string },
  range?: { from?: string | null; to?: string | null },
): Promise<{ total: number; breakdown: BlessingBreakdown[] }> {
  const to = range?.to ?? todayIso()
  const from = range?.from ?? undefined
  const filter = mergeFilters(
    await blessingScopeFilter(event, scope, {
      branch: where.branch ?? null,
      zone: where.zone ?? null,
    }),
    where.bsc ? { bsc: { _eq: where.bsc } } : undefined,
    from ? { service_date: { _gte: from, _lte: to } } : undefined,
  )
  let counted = 0
  const byType = new Map<string, BlessingBreakdown>()
  let page = 1
  for (;;) {
    const result = await listItems<{
      blessing_type: string
      male_count: number | null
      female_count: number | null
      total_count: number | null
    }>(event, scope, 'blessings', {
      filter,
      fields: ['blessing_type', 'male_count', 'female_count', 'total_count'],
      page,
      limit: 200,
    })
    for (const row of result.data) {
      counted += Number(row.total_count ?? 0)
      const key = row.blessing_type
      const existing = byType.get(key)
      if (existing) {
        existing.male += Number(row.male_count ?? 0)
        existing.female += Number(row.female_count ?? 0)
        existing.total += Number(row.total_count ?? 0)
      } else {
        byType.set(key, {
          blessing_type: key,
          male: Number(row.male_count ?? 0),
          female: Number(row.female_count ?? 0),
          total: Number(row.total_count ?? 0),
        })
      }
    }
    if (result.data.length < 200 || page * 200 >= result.meta.total) break
    page += 1
  }
  return {
    total: counted,
    breakdown: [...BLESSING_TYPES]
      .filter((type) => byType.has(type))
      .map((type) => byType.get(type) as BlessingBreakdown),
  }
}
