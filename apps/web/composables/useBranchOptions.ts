import type { BranchSummary } from '~/types/portal'

/**
 * useBranchOptions — caller-scoped branch list for EntitySelect (AFC-631).
 *
 * Fetches the existing GET /api/branches (same rows the branch filter
 * selects already use) and maps to label/value items. No new endpoints,
 * no new data exposure.
 */
export function useBranchOptions() {
  const api = useApi()

  const { data, pending } = useAsyncData('entity-select-branches', () =>
    api.get<BranchSummary[]>('/api/branches'),
  )

  const branchOptions = computed(() =>
    (data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
  )

  return { branchOptions, branchesPending: pending }
}
