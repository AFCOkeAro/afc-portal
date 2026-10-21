import type { Household } from '@afc/shared'
import {
  branchNames,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

const HOUSEHOLD_FIELDS = [
  'id',
  'name',
  'branch',
  'address',
  'phone',
  'wedding_date',
  'household_head',
  'primary_contact',
  'notes',
]

export interface HouseholdRow extends Household {
  branch_name: string | null
  member_count: number
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined

  // AFC-566: the household read hits a 0020 collection. A missing table
  // and a missing read grant both arrive as DirectusAuthError — map to the
  // named store error, never a bare 500. The member-count read targets the
  // snapshot-owned people table, so it stays inside the same try only for
  // the deliberate-4xx passthrough: a scope 404 from findScopedItem must
  // never be renamed into pending_migration_0020.
  let result: {
    data: Record<string, unknown>[]
    meta: { total: number; page: number; limit: number }
  }
  const counts = new Map<string, number>()
  try {
    result = await listItems<Record<string, unknown>>(event, scope, 'households', {
      filter: mergeFilters(
        branch ? { branch: { _eq: branch } } : undefined,
        scopeFilter(scope),
      ),
      fields: HOUSEHOLD_FIELDS,
      sort: 'name',
      page,
      limit,
      search: search || undefined,
    })

    const ids = result.data.map((row) => String(row.id))
    if (ids.length > 0) {
      const members = await listItems<{
        id: string | number
        household: string | null
      }>(event, scope, 'people', {
        filter: mergeFilters(
          { household: { _in: ids } },
          { status: { _eq: 'active' } },
          scopeFilter(scope),
        ),
        fields: ['id', 'household'],
        limit: -1,
      })
      for (const member of members.data) {
        if (!member.household) continue
        const key = String(member.household)
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'household_store', '0020')
  }

  const names = await branchNames(event, scope)
  const rows: HouseholdRow[] = result.data.map((row) => ({
    ...(row as unknown as Household),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    member_count: counts.get(String(row.id)) ?? 0,
  }))

  return { data: rows, meta: result.meta }
})
