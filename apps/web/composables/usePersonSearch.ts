import type { Paginated, PersonRow } from '~/types/portal'

/**
 * usePersonSearch — debounced server-side person lookup for EntitySelect
 * (AFC-631).
 *
 * For forms that do not already hold a people list (modals, minutes,
 * transfers, tasks, marriage). Queries the existing GET /api/people
 * `search` filter — no new endpoints. Options are the same caller-scoped
 * rows the People directory shows, so no new data exposure.
 *
 * Usage:
 * ```vue
 * <EntitySelect
 *   v-model="form.person"
 *   :items="personOptions"
 *   placeholder="Type a name to search…"
 *   :loading="personPending"
 *   server-search
 *   @update:search-term="onPersonSearch"
 * />
 * ```
 */
export function usePersonSearch() {
  const api = useApi()
  const term = ref('')

  const { data, pending } = useAsyncData(
    () =>
      term.value.trim()
        ? api.get<Paginated<PersonRow>>('/api/people', {
            query: { search: term.value.trim(), limit: 25 },
          })
        : Promise.resolve({
            data: [],
            meta: { total: 0, page: 1, limit: 25 },
          }),
    { watch: [term] },
  )

  const personOptions = computed(() =>
    (data.value?.data ?? []).map((row) => ({
      label: [row.preferred_name || row.first_name, row.last_name]
        .filter(Boolean)
        .join(' '),
      value: row.id,
    })),
  )

  let timer: ReturnType<typeof setTimeout> | null = null
  function onPersonSearch(value: string): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      term.value = value
    }, 250)
  }

  return { personOptions, personPending: pending, onPersonSearch }
}
