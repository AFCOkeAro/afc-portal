import type { H3Event } from 'h3'
import type { Celebration, CalendarItem } from '@afc/shared'
import { CELEBRATION_TYPES, combineCalendarFeed } from '@afc/shared'
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

const CELEBRATION_FIELDS = [
  'id',
  'person',
  'type',
  'event_date',
  'is_recurring',
  'title',
  'message',
  'visibility',
  'publish_channels',
  'branch',
  'zone',
  'status',
  'guardian_consent',
  'created_by',
  'created_at',
  'updated_at',
]

/**
 * Person fields a celebration feed may embed. DOB, contact and medical
 * fields are absent by construction: the feed payload cannot leak what it
 * never reads (safeguarding lens, acceptance: "restricted DOB/medical
 * never in feed payloads"). `is_minor` rides along because the detail page
 * shows the stored guardian-consent state next to it.
 */
export const CELEBRATION_PERSON_FIELDS = [
  'id',
  'first_name',
  'last_name',
  'preferred_name',
  'is_minor',
]

export interface CelebrationFeedFilters {
  branch: string | null
  zone: string | null
  type: string | null
  visibility: string | null
  status: string | null
  month: number | null
  day: number | null
  date_from: string | null
  date_to: string | null
  page: number
  limit: number
  sort: string | null
}

export function celebrationFeedFilters(event: H3Event): CelebrationFeedFilters {
  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  const month = Number(text('month'))
  const day = Number(text('day'))
  return {
    branch: text('branch'),
    zone: text('zone'),
    type: text('type'),
    visibility: text('visibility'),
    status: text('status'),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : null,
    day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
    date_from: text('date_from'),
    date_to: text('date_to'),
    page: Math.max(1, Number(query.page) || 1),
    limit: Math.min(200, Math.max(1, Number(query.limit) || 25)),
    sort: text('sort'),
  }
}

/** Sort allowlist: the list route sorts, never an arbitrary column. */
const SORTS: Record<string, Record<string, 1 | -1>> = {
  event_date: { event_date: 1 },
  '-event_date': { event_date: -1 },
  type: { type: 1 },
  status: { status: 1 },
}

export function celebrationSortParam(sort: string | null): string {
  if (sort && sort in SORTS) return sort
  return '-event_date'
}

/**
 * The hierarchy predicate for celebrations (AFC-476, data-model-expansion
 * §10). Area staff see all; zone staff see their zone's rows; branch staff
 * see their own branches' rows. Requested values are intersected with the
 * scope predicate (empty, never foreign); an explicitly out-of-scope
 * `zone` or `branch` is a 403 (fail-closed).
 *
 * Department heads hold CRU (dept) in the matrix; celebrations carry no
 * department column, so the smallest defensible reading enforced here is
 * their branch scope. Finer dept-vs-dept separation lives in the Directus
 * policy, which is the authoritative control.
 */
export async function celebrationScopeFilter(
  event: H3Event,
  scope: PortalScope,
  filters: Pick<CelebrationFeedFilters, 'branch' | 'zone'>,
): Promise<Record<string, unknown> | undefined> {
  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, filters.zone, visibleZones)
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

/**
 * Visibility narrowing (expansion §6.2, acceptance: "visibility lifecycle
 * enforced server-side"). Visibility only ever narrows inside the caller's
 * scope, never widens it: `internal` stays inside the caller's own
 * branches, `branch` inside the visible zones, `public` adds no narrowing
 * beyond the scope predicate. The `public` matrix grant (none role) is a
 * Directus-policy matter; the portal still scopes every session.
 */
export async function celebrationVisibilityFilter(
  event: H3Event,
  scope: PortalScope,
  visibility: string | null,
): Promise<Record<string, unknown> | undefined> {
  if (!visibility) return undefined
  if (visibility === 'internal') {
    if (scope.isArea) return { visibility: { _eq: 'internal' } }
    return mergeFilters(
      { visibility: { _eq: 'internal' } },
      { branch: { _in: scope.branchIds } },
    )
  }
  if (visibility === 'branch') {
    if (scope.isArea) return { visibility: { _eq: 'branch' } }
    const visibleZones =
      scope.zoneIds.length > 0 ? scope.zoneIds : await scopeZoneIds(event, scope)
    return mergeFilters(
      { visibility: { _eq: 'branch' } },
      visibleZones.length > 0
        ? { zone: { _in: visibleZones } }
        : { branch: { _in: scope.branchIds } },
    )
  }
  return { visibility: { _eq: 'public' } }
}

export interface CelebrationRow extends Celebration {
  person_name: string | null
  person_is_minor: boolean | null
  branch_name: string | null
  zone_name: string | null
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

async function personDirectory(
  event: H3Event,
  scope: PortalScope,
  personIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const unique = [...new Set(personIds.filter(Boolean))]
  const directory = new Map<string, Record<string, unknown>>()
  // Chunked so a large window cannot build an unbounded `_in` list.
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100)
    const result = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { id: { _in: chunk } },
      fields: CELEBRATION_PERSON_FIELDS,
      limit: 100,
    })
    for (const row of result.data) directory.set(String(row.id), row)
  }
  return directory
}

function monthDayOf(date: string): { month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return null
  return { month: Number(match[2]), day: Number(match[3]) }
}

/**
 * Scoped celebration collection (AFC-476). One filtered read feeds the
 * list, the CSV export, the calendar contribution and the profile roll-up,
 * so the four cannot drift: same predicate, same fields, same scope.
 *
 * Recurring handling: Directus filters cannot express EXTRACT(month/day),
 * so a month/day request reads the scoped recurring set (chunked, bounded)
 * and matches month/day in code. That set is the birthday/anniversary
 * population, not the whole table; the `(month, day)` partial index in
 * migration 0012 serves the same predicate for direct-SQL consumers
 * (reports, the reminder Flow) without a full-table scan (cost lens).
 */
export async function collectCelebrations(
  event: H3Event,
  scope: PortalScope,
  filters: CelebrationFeedFilters,
): Promise<{ rows: CelebrationRow[]; total: number }> {
  requireCan(scope, 'celebrations', 'read')

  const filter = mergeFilters(
    await celebrationScopeFilter(event, scope, filters),
    await celebrationVisibilityFilter(event, scope, filters.visibility),
    filters.type ? { type: { _eq: filters.type } } : undefined,
    filters.status ? { status: { _eq: filters.status } } : undefined,
    filters.month !== null || filters.day !== null
      ? { is_recurring: { _eq: true } }
      : undefined,
    filters.date_from ? { event_date: { _gte: filters.date_from } } : undefined,
    filters.date_to ? { event_date: { _lte: filters.date_to } } : undefined,
  )

  // Chunked (200 per page) so memory grows with the filtered set, not with
  // an unbounded single page. Same bound as the blessings collector.
  const rows: Array<Record<string, unknown>> = []
  let page = 1
  for (;;) {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'celebrations',
      {
        filter,
        fields: CELEBRATION_FIELDS,
        sort: celebrationSortParam(filters.sort),
        page,
        limit: 200,
      },
    )
    rows.push(...result.data)
    if (result.data.length < 200 || rows.length >= result.meta.total) break
    page += 1
  }

  // Recurring month/day match in code (see docstring): a (month, day) pair
  // means "this year's occurrence falls on month/day", the US-Y2 upcoming
  // list. No month/day pair means no recurring narrowing.
  const narrowed =
    filters.month !== null || filters.day !== null
      ? rows.filter((row) => {
          const md = monthDayOf(String(row.event_date ?? ''))
          if (!md) return false
          if (filters.month !== null && md.month !== filters.month) return false
          if (filters.day !== null && md.day !== filters.day) return false
          return true
        })
      : rows

  const [names, zones, directory] = await Promise.all([
    branchNames(event, scope),
    zoneNames(event, scope),
    personDirectory(
      event,
      scope,
      narrowed.map((row) => String(row.person ?? '')),
    ),
  ])

  const typed: CelebrationRow[] = narrowed.map((row) => {
    const person = directory.get(String(row.person ?? ''))
    return {
      ...(row as unknown as Celebration),
      id: String(row.id),
      person_name: person ? personDisplayName(person) : null,
      person_is_minor:
        typeof person?.is_minor === 'boolean' ? (person.is_minor as boolean) : null,
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      zone_name: row.zone ? (zones.get(String(row.zone)) ?? null) : null,
    }
  })

  return { rows: typed, total: typed.length }
}

/** CSV body: branch, zone, celebration, date, visibility, status. */
export function celebrationsToCsv(rows: CelebrationRow[]): string[][] {
  return [
    ['branch', 'zone', 'person', 'celebration', 'date', 'visibility', 'status'],
    ...rows.map((row) => [
      row.branch_name ?? String(row.branch ?? ''),
      row.zone_name ?? (row.zone ? String(row.zone) : ''),
      row.person_name ?? String(row.person ?? ''),
      row.title || String(row.type).replace(/_/g, ' '),
      row.event_date,
      row.visibility,
      row.status,
    ]),
  ]
}

export function celebrationsCsvString(rows: CelebrationRow[]): string {
  return celebrationsToCsv(rows)
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
}

/**
 * Celebration contribution to the unified calendar (office-feed helper,
 * US-U3). Pure mapping over pre-scoped rows: the caller (the calendar
 * route) guarantees every input row is already inside the caller's scope.
 * Recurring rows project one occurrence per matching month/day inside the
 * window; one-off rows appear on their event_date when it falls inside.
 */
export function celebrationsToCalendarItems(
  rows: CelebrationRow[],
  window: { from: string; to: string },
): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const row of rows) {
    const md = monthDayOf(row.event_date)
    if (!md) continue
    if (row.is_recurring) {
      const fromYear = Number(window.from.slice(0, 4))
      const toYear = Number(window.to.slice(0, 4))
      for (let year = fromYear; year <= toYear; year += 1) {
        const occurrence = `${year}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}`
        if (occurrence < window.from || occurrence > window.to) continue
        items.push({
          id: row.id,
          item_type: 'celebration',
          title:
            row.title ||
            `${String(row.type).replace(/_/g, ' ')} — ${row.person_name ?? ''}`,
          date: occurrence,
          starts_at: null,
          branch: row.branch,
          zone: row.zone,
          href: `/celebrations/${row.id}`,
        })
      }
    } else if (row.event_date >= window.from && row.event_date <= window.to) {
      items.push({
        id: row.id,
        item_type: 'celebration',
        title:
          row.title ||
          `${String(row.type).replace(/_/g, ' ')} — ${row.person_name ?? ''}`,
        date: row.event_date,
        starts_at: null,
        branch: row.branch,
        zone: row.zone,
        href: `/celebrations/${row.id}`,
      })
    }
  }
  return combineCalendarFeed({ celebration: items })
}

/**
 * Profile roll-up: approved/published celebrations in one branch/zone/BSC
 * scope over an optional range; the caller renders each count as a link to
 * the filtered feed (analytics-with-drill-down, prd-expansion §1).
 */
export async function celebrationsRollup(
  event: H3Event,
  scope: PortalScope,
  where: { branch?: string; zone?: string },
  range?: { from?: string | null; to?: string | null },
): Promise<{ total: number; by_type: Array<{ type: string; count: number }> }> {
  const filter = mergeFilters(
    await celebrationScopeFilter(event, scope, {
      branch: where.branch ?? null,
      zone: where.zone ?? null,
    }),
    { status: { _in: ['approved', 'published'] } },
    range?.from ? { event_date: { _gte: range.from } } : undefined,
    range?.to ? { event_date: { _lte: range.to } } : undefined,
  )
  let total = 0
  const byType = new Map<string, number>()
  let page = 1
  for (;;) {
    const result = await listItems<{ type: string }>(event, scope, 'celebrations', {
      filter,
      fields: ['type'],
      page,
      limit: 200,
    })
    total += result.data.length
    for (const row of result.data) byType.set(row.type, (byType.get(row.type) ?? 0) + 1)
    if (result.data.length < 200 || page * 200 >= result.meta.total) break
    page += 1
  }
  return {
    total,
    by_type: [...CELEBRATION_TYPES]
      .filter((type) => byType.has(type))
      .map((type) => ({ type, count: byType.get(type) as number })),
  }
}

/**
 * Read one person for the minor safeguard. Only the fields the safeguard
 * needs: id + is_minor. DOB is never read here (is_minor is Flow-derived;
 * reading DOB into a celebrations request would put a restricted field in
 * a feed-adjacent payload for no reason).
 */
export async function readCelebrationPerson(
  event: H3Event,
  scope: PortalScope,
  personId: string,
): Promise<{ id: string; is_minor: boolean | null }> {
  const result = await listItems<{ id: string | number; is_minor: boolean | null }>(
    event,
    scope,
    'people',
    { filter: { id: { _eq: personId } }, fields: ['id', 'is_minor'], limit: 1 },
  )
  const row = result.data[0]
  if (!row) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That person was not found in your scope',
      data: { code: 'not_found' },
    })
  }
  return { id: String(row.id), is_minor: row.is_minor ?? null }
}
