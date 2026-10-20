import type { H3Event } from 'h3'
import {
  branchNames,
  listItems,
  mergeFilters,
  scopeFilter,
  zoneScopeFilter,
  type PortalScope,
} from './portal'

/**
 * People compare collectors (AFC-485, US-A4). One grouped read feeds the
 * compare view and its CSV export, so the two cannot drift: same grouping
 * (branch|zone), same scope, same prior-year ledger snapshot.
 *
 * No PII crosses these collectors — groups carry ids, names, and counts.
 */

interface PeopleRow {
  branch: string | null
  zone: string | null
  status: string | null
}

export interface PeopleCompareRow {
  group: string
  group_name: string | null
  current: number
  prior: number
  delta: number
}

export async function collectPeopleGroups(
  event: H3Event,
  scope: PortalScope,
  groupBy: 'branch' | 'zone',
): Promise<Map<string, number>> {
  const groups = new Map<string, number>()
  let page = 1
  for (;;) {
    const result = await listItems<PeopleRow>(event, scope, 'people', {
      filter: mergeFilters(scopeFilter(scope), zoneScopeFilter(scope)),
      fields: ['branch', 'zone', 'status'],
      limit: 200,
      page,
    })
    for (const row of result.data) {
      const key =
        groupBy === 'zone' ? (row.zone ?? 'unassigned') : (row.branch ?? 'unassigned')
      groups.set(String(key), (groups.get(String(key)) ?? 0) + 1)
    }
    if (result.data.length < 200) break
    page += 1
  }
  return groups
}

export async function collectPriorYearGroups(
  event: H3Event,
  scope: PortalScope,
  groupBy: 'branch' | 'zone',
  dataYear: number,
): Promise<Map<string, number>> {
  const groups = new Map<string, number>()
  try {
    let page = 1
    for (;;) {
      const result = await listItems<{ branch: string | null; zone: string | null }>(
        event,
        scope,
        'prior_year_import_items',
        {
          filter: {
            data_year: { _eq: dataYear },
            status: { _in: ['imported', 'skipped', 'updated'] },
          },
          fields: ['branch', 'zone'],
          limit: 200,
          page,
        },
      )
      for (const row of result.data) {
        const key =
          groupBy === 'zone' ? (row.zone ?? 'unassigned') : (row.branch ?? 'unassigned')
        groups.set(String(key), (groups.get(String(key)) ?? 0) + 1)
      }
      if (result.data.length < 200) break
      page += 1
    }
  } catch {
    // Migration 0014 not applied yet: no snapshot, not an error.
  }
  if (!scope.isArea && groups.size > 0) {
    // Intersect with scope — the ledger carries no policy of its own.
    const allowed = groupBy === 'zone' ? new Set(scope.zoneIds) : new Set(scope.branchIds)
    if (allowed.size > 0) {
      for (const key of [...groups.keys()]) {
        if (!allowed.has(key)) groups.delete(key)
      }
    }
  }
  return groups
}

export async function collectPeopleCompare(
  event: H3Event,
  scope: PortalScope,
  groupBy: 'branch' | 'zone',
  dataYear: number,
): Promise<{
  rows: PeopleCompareRow[]
  current: number
  prior: number
  has_data: boolean
}> {
  const [current, prior] = await Promise.all([
    collectPeopleGroups(event, scope, groupBy),
    collectPriorYearGroups(event, scope, groupBy, dataYear),
  ])
  const delta = new Map<string, number>()
  for (const [key, count] of current) {
    delta.set(key, count - (prior.get(key) ?? 0))
  }
  for (const [key, count] of prior) {
    if (!delta.has(key)) delta.set(key, -count)
  }
  const names = groupBy === 'branch' ? await branchNames(event, scope) : null
  const rows = [...delta.entries()]
    .map(([key, change]) => ({
      group: key,
      group_name: names ? (names.get(key) ?? null) : key,
      current: current.get(key) ?? 0,
      prior: prior.get(key) ?? 0,
      delta: change,
    }))
    .sort((left, right) => left.group.localeCompare(right.group))
  return {
    rows,
    current: [...current.values()].reduce((sum, count) => sum + count, 0),
    prior: [...prior.values()].reduce((sum, count) => sum + count, 0),
    has_data: prior.size > 0,
  }
}

export function parsePeopleCompareQuery(event: H3Event): {
  groupBy: 'branch' | 'zone'
  dataYear: number
} {
  const query = getQuery(event)
  const groupBy = query.group_by === 'zone' ? 'zone' : 'branch'
  const dataYear = typeof query.data_year === 'string' ? Number(query.data_year) : NaN
  if (!Number.isInteger(dataYear) || dataYear < 2000 || dataYear > 2100) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A data_year (YYYY) is required to pick the prior-year snapshot',
      data: { code: 'data_year_required' },
    })
  }
  return { groupBy, dataYear }
}
