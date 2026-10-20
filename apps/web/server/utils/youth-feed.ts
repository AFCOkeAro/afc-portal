import type { H3Event } from 'h3'
import type { YouthProfile } from '@afc/shared'
import {
  branchNames,
  csvEscape,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  stripHiddenMany,
  zoneScopeFilter,
  type PortalScope,
} from './portal'
import { CELEBRATION_PERSON_FIELDS } from './celebration-feed'

const YOUTH_FIELDS = [
  'id',
  'person',
  'education_level',
  'institution',
  'course',
  'study_level',
  'employment_status',
  'professional_status',
  'is_entrepreneur',
  'youth_leadership_role',
  'branch',
  'zone',
  'status',
  'created_at',
  'updated_at',
]

export interface YouthFilters {
  branch: string | null
  zone: string | null
  education_level: string | null
  employment_status: string | null
  is_entrepreneur: boolean | null
  status: string | null
  page: number
  limit: number
  sort: string | null
}

export function youthFilters(event: H3Event): YouthFilters {
  const query = getQuery(event)
  const text = (name: string): string | null => {
    const value = query[name]
    return typeof value === 'string' && value.length > 0 ? value : null
  }
  const entrepreneur = text('is_entrepreneur')
  return {
    branch: text('branch'),
    zone: text('zone'),
    education_level: text('education_level'),
    employment_status: text('employment_status'),
    is_entrepreneur:
      entrepreneur === 'true' ? true : entrepreneur === 'false' ? false : null,
    status: text('status'),
    page: Math.max(1, Number(query.page) || 1),
    limit: Math.min(200, Math.max(1, Number(query.limit) || 25)),
    sort: text('sort'),
  }
}

/** Sort allowlist: the list route sorts, never an arbitrary column. */
const SORTS: Record<string, Record<string, 1 | -1>> = {
  created_at: { created_at: 1 },
  '-created_at': { created_at: -1 },
  education_level: { education_level: 1 },
  employment_status: { employment_status: 1 },
}

export function youthSortParam(sort: string | null): string {
  if (sort && sort in SORTS) return sort
  return '-created_at'
}

/**
 * The hierarchy predicate for youth profiles (AFC-476,
 * data-model-expansion §10). Same shape as the blessings predicate: area
 * all, zone grants by zone, branch staff by branch. Household R (own) from
 * the matrix is a Directus-policy matter; the portal still scopes by
 * branch/zone here.
 */
export async function youthScopeFilter(
  event: H3Event,
  scope: PortalScope,
  filters: Pick<YouthFilters, 'branch' | 'zone'>,
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

export interface YouthRow extends YouthProfile {
  person_name: string | null
  branch_name: string | null
}

/**
 * Scoped youth collection (AFC-476, US-Y1). One filtered read feeds the
 * list, the CSV export and the detail page's sibling navigation, so the
 * three cannot drift. Youth PII (institution/course/employment detail) is
 * stripped per the role matrix before the rows leave the server
 * (stripHiddenMany against FIELD_RESTRICTIONS) -- the route returns names,
 * never contact detail.
 */
export async function collectYouth(
  event: H3Event,
  scope: PortalScope,
  filters: YouthFilters,
): Promise<{ rows: YouthRow[]; total: number }> {
  requireCan(scope, 'youth_profiles', 'read')

  const filter = mergeFilters(
    await youthScopeFilter(event, scope, filters),
    filters.education_level
      ? { education_level: { _eq: filters.education_level } }
      : undefined,
    filters.employment_status
      ? { employment_status: { _eq: filters.employment_status } }
      : undefined,
    filters.is_entrepreneur !== null
      ? { is_entrepreneur: { _eq: filters.is_entrepreneur } }
      : undefined,
    filters.status ? { status: { _eq: filters.status } } : undefined,
  )

  // Chunked (200 per page) so memory grows with the filtered set, not with
  // an unbounded single page. Same bound as the blessings collector.
  const rows: Array<Record<string, unknown>> = []
  let total = 0
  let page = 1
  for (;;) {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'youth_profiles',
      {
        filter,
        fields: YOUTH_FIELDS,
        sort: youthSortParam(filters.sort),
        page,
        limit: 200,
      },
    )
    total = result.meta.total
    rows.push(...result.data)
    if (result.data.length < 200 || rows.length >= total) break
    page += 1
  }

  const personIds = [
    ...new Set(rows.map((row) => String(row.person ?? '')).filter(Boolean)),
  ]
  const directory = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < personIds.length; i += 100) {
    const chunk = personIds.slice(i, i + 100)
    const result = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { id: { _in: chunk } },
      fields: CELEBRATION_PERSON_FIELDS,
      limit: 100,
    })
    for (const row of result.data) directory.set(String(row.id), row)
  }

  const names = await branchNames(event, scope)
  const stripped = stripHiddenMany(scope, 'youth_profiles', rows)

  const typed: YouthRow[] = stripped.map((row) => {
    const person = directory.get(String(row.person ?? ''))
    const first =
      typeof person?.first_name === 'string' ? (person.first_name as string).trim() : ''
    const last =
      typeof person?.last_name === 'string' ? (person.last_name as string).trim() : ''
    return {
      ...(row as unknown as YouthProfile),
      id: String(row.id),
      person_name: [first, last].filter(Boolean).join(' ') || null,
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    }
  })

  return { rows: typed, total }
}

/** CSV body: branch, person, education, employment, status. No contact detail. */
export function youthToCsv(rows: YouthRow[]): string[][] {
  return [
    [
      'branch',
      'person',
      'education_level',
      'employment_status',
      'entrepreneur',
      'status',
    ],
    ...rows.map((row) => [
      row.branch_name ?? String(row.branch ?? ''),
      row.person_name ?? String(row.person ?? ''),
      row.education_level ?? '',
      row.employment_status ?? '',
      row.is_entrepreneur ? 'yes' : 'no',
      row.status,
    ]),
  ]
}

export function youthCsvString(rows: YouthRow[]): string {
  return youthToCsv(rows)
    .map((row) => row.map(csvEscape).join(','))
    .join('\n')
}
