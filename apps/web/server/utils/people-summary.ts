import type { H3Event } from 'h3'
import {
  ageFromDob,
  branchNames,
  listItems,
  scopeFilter,
  throwStoreUnavailable,
  can,
  type PortalScope,
} from './portal'

/**
 * People dashboard summary (AFC-576).
 *
 * Scoped aggregates only — no names, DOBs, addresses, or contacts cross
 * this collector. Branch/zone groups carry ids, resolved names, and counts.
 * Household distribution is by branch/zone from the households table (zone
 * is Flow-maintained); the pin map stays deferred with address text only
 * (schemas/household.ts), so no geo is promised here.
 */

export const AGE_BUCKETS = [
  '0-12',
  '13-17',
  '18-25',
  '26-40',
  '41-60',
  '60+',
  'unknown',
] as const

export type AgeBucket = (typeof AGE_BUCKETS)[number]

/** Server-side age bucket for one DOB value. Null/unparseable DOB is unknown. */
export function ageBucketFromDob(dateOfBirth: string | null | undefined): AgeBucket {
  const age = ageFromDob(dateOfBirth)
  if (age === null || age < 0) return 'unknown'
  if (age <= 12) return '0-12'
  if (age <= 17) return '13-17'
  if (age <= 25) return '18-25'
  if (age <= 40) return '26-40'
  if (age <= 60) return '41-60'
  return '60+'
}

/**
 * Calendar-exact DOB range for one age bucket, so the `?age_bucket=` filter
 * on the list route counts exactly what the summary bucket counts. Both use
 * the same month/day comparison as `ageFromDob`: age in [lo,hi] ⟺ dob in
 * (today-(hi+1)y, today-lo y]. `unknown` is a null DOB (future DOBs are
 * invalid data and match neither side — out of contract by design).
 */
export function dobRangeForBucket(
  bucket: AgeBucket,
  today: Date = new Date(),
): { _gt?: string; _lte?: string; _null?: true } {
  if (bucket === 'unknown') return { _null: true }
  const bounds: Record<Exclude<AgeBucket, 'unknown'>, [number, number | null]> = {
    '0-12': [0, 12],
    '13-17': [13, 17],
    '18-25': [18, 25],
    '26-40': [26, 40],
    '41-60': [41, 60],
    '60+': [60, null],
  }
  const [lo, hi] = bounds[bucket]
  const isoYearsAgo = (years: number): string => {
    const cut = new Date(
      Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()),
    )
    return cut.toISOString().slice(0, 10)
  }
  if (hi === null) return { _lte: isoYearsAgo(lo) }
  return { _gt: isoYearsAgo(hi + 1), _lte: isoYearsAgo(lo) }
}

export interface PeopleSummaryPerson {
  gender: string | null
  date_of_birth: string | null
  membership_status: string | null
  status: string | null
  household: string | null
  branch: string | null
}

export interface PeopleSummaryBranchRow {
  branch: string
  branch_name: string | null
  people: number
  households: number
}

export interface PeopleSummaryZoneRow {
  zone: string
  zone_name: string | null
  households: number
  people: number
}

export interface PeopleSummary {
  total: number
  active: number
  inactive: number
  gender: { male: number; female: number; not_recorded: number }
  age_buckets: Record<AgeBucket, number>
  family: {
    households: number
    avg_members: number
    unlinked_people: number
  }
  by_branch: PeopleSummaryBranchRow[]
  by_zone: PeopleSummaryZoneRow[]
  /** False when the caller may not read households: family/household figures are omitted (0/empty), people figures still hold. */
  households_visible: boolean
}

/** Pure fold over already-scoped people rows — the unit the contract tests pin. */
export function summarizePeopleRows(rows: PeopleSummaryPerson[]): {
  total: number
  active: number
  inactive: number
  gender: { male: number; female: number; not_recorded: number }
  age_buckets: Record<AgeBucket, number>
  unlinked_people: number
  linked_people: number
} {
  const age_buckets: Record<AgeBucket, number> = {
    '0-12': 0,
    '13-17': 0,
    '18-25': 0,
    '26-40': 0,
    '41-60': 0,
    '60+': 0,
    unknown: 0,
  }
  const gender = { male: 0, female: 0, not_recorded: 0 }
  let active = 0
  let unlinked_people = 0
  let linked_people = 0
  for (const row of rows) {
    if (row.status === 'active') active += 1
    if (row.gender === 'male') gender.male += 1
    else if (row.gender === 'female') gender.female += 1
    else gender.not_recorded += 1
    age_buckets[ageBucketFromDob(row.date_of_birth)] += 1
    if (row.household) linked_people += 1
    else unlinked_people += 1
  }
  return {
    total: rows.length,
    active,
    inactive: rows.length - active,
    gender,
    age_buckets,
    unlinked_people,
    linked_people,
  }
}

interface HouseholdRow {
  id: string | number
  branch: string | null
  zone: string | null
  status: string | null
}

/**
 * Scope rule: `inactive` is every non-active status (archived today). The
 * membership_status `inactive` value is a lifecycle label, not the
 * active/inactive split — the split follows the retention-closed `status`
 * field, so the figures match the `?status=` filter on the list route.
 */
export async function collectPeopleSummary(
  event: H3Event,
  scope: PortalScope,
): Promise<PeopleSummary> {
  const filter = scopeFilter(scope)
  const people: PeopleSummaryPerson[] = []
  let page = 1
  for (;;) {
    const result = await listItems<PeopleSummaryPerson>(event, scope, 'people', {
      filter,
      fields: [
        'gender',
        'date_of_birth',
        'membership_status',
        'status',
        'household',
        'branch',
      ],
      limit: 200,
      page,
    })
    people.push(...result.data)
    if (result.data.length < 200) break
    page += 1
  }

  const folded = summarizePeopleRows(people)
  const peopleByBranch = new Map<string, number>()
  const peopleByZone = new Map<string, number>()
  const branchZone = new Map<string, string>()
  const names = await branchNames(event, scope)

  // Branch -> zone map so people counts can be zoned without assuming a
  // `people.zone` column (the Person type carries branch only).
  try {
    const branches = await listItems<{ id: string | number; zone: string | null }>(
      event,
      scope,
      'branches',
      { fields: ['id', 'zone'], limit: -1 },
    )
    for (const branch of branches.data) {
      if (branch.zone) branchZone.set(String(branch.id), String(branch.zone))
    }
  } catch {
    // Branch enrichment is best-effort: counts still hold, zone mapping falls
    // back to unassigned.
  }

  for (const row of people) {
    const branchKey = row.branch ? String(row.branch) : 'unassigned'
    peopleByBranch.set(branchKey, (peopleByBranch.get(branchKey) ?? 0) + 1)
    const zoneKey = row.branch
      ? (branchZone.get(String(row.branch)) ?? 'unassigned')
      : 'unassigned'
    peopleByZone.set(zoneKey, (peopleByZone.get(zoneKey) ?? 0) + 1)
  }

  const households_visible = can(scope, 'households', 'read')
  const households: HouseholdRow[] = []
  if (households_visible) {
    try {
      let householdPage = 1
      for (;;) {
        const result = await listItems<HouseholdRow>(event, scope, 'households', {
          filter,
          fields: ['id', 'branch', 'zone', 'status'],
          limit: 200,
          page: householdPage,
        })
        households.push(...result.data)
        if (result.data.length < 200) break
        householdPage += 1
      }
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throwStoreUnavailable(error, 'household_store', '0020')
    }
  }

  const activeHouseholds = households.filter((row) => row.status === 'active')
  const householdsByBranch = new Map<string, number>()
  const householdsByZone = new Map<string, number>()
  for (const row of activeHouseholds) {
    const branchKey = row.branch ? String(row.branch) : 'unassigned'
    householdsByBranch.set(branchKey, (householdsByBranch.get(branchKey) ?? 0) + 1)
    const zoneKey = row.zone
      ? String(row.zone)
      : row.branch
        ? (branchZone.get(String(row.branch)) ?? 'unassigned')
        : 'unassigned'
    householdsByZone.set(zoneKey, (householdsByZone.get(zoneKey) ?? 0) + 1)
  }

  let zoneNames: Map<string, string> = new Map()
  if (households_visible) {
    try {
      const zones = await listItems<{ id: string | number; name: string }>(
        event,
        scope,
        'zones',
        { fields: ['id', 'name'], limit: -1 },
      )
      zoneNames = new Map(zones.data.map((row) => [String(row.id), row.name]))
    } catch {
      // Zone names are best-effort; ids still identify the groups.
    }
  }

  const branchKeys = new Set([...peopleByBranch.keys(), ...householdsByBranch.keys()])
  const by_branch: PeopleSummaryBranchRow[] = [...branchKeys].sort().map((branch) => ({
    branch,
    branch_name: branch === 'unassigned' ? null : (names.get(branch) ?? null),
    people: peopleByBranch.get(branch) ?? 0,
    households: householdsByBranch.get(branch) ?? 0,
  }))
  const zoneKeys = new Set([...peopleByZone.keys(), ...householdsByZone.keys()])
  const by_zone: PeopleSummaryZoneRow[] = [...zoneKeys].sort().map((zone) => ({
    zone,
    zone_name: zone === 'unassigned' ? null : (zoneNames.get(zone) ?? null),
    households: householdsByZone.get(zone) ?? 0,
    people: peopleByZone.get(zone) ?? 0,
  }))

  const householdCount = activeHouseholds.length
  return {
    total: folded.total,
    active: folded.active,
    inactive: folded.inactive,
    gender: folded.gender,
    age_buckets: folded.age_buckets,
    family: {
      households: householdCount,
      avg_members:
        householdCount === 0
          ? 0
          : Math.round((folded.linked_people / householdCount) * 10) / 10,
      unlinked_people: folded.unlinked_people,
    },
    by_branch,
    by_zone,
    households_visible,
  }
}
