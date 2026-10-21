<script setup lang="ts">
import type { BranchSummary, HouseholdRow, Paginated } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')

/** Drill-down contract: branch pages link here with ?branch=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const branch = ref(queryParam('branch') ?? 'all')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([branch, search], () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'households-list',
  () => api.get<Paginated<HouseholdRow>>('/api/households', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const branches = await useAsyncData('households-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      title="Households"
      description="Family units across the branches this account can see. Members link both ways with the person profile."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.households" action="create">
          <UButton to="/households/new" label="New family" icon="i-lucide-users" />
          <UButton
            label="Add household"
            icon="i-lucide-house-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search household name"
          aria-label="Search households"
        />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load households"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No households match these filters"
        description="Clear a filter or add the first household for this branch."
      >
        <PermissionGate :collection="COLLECTIONS.households" action="create">
          <UButton class="mt-4" label="Add household" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Household</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Members</th>
              <th class="px-3 py-2 font-medium">Wedding date</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="household in rows"
              :key="household.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/households/${household.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ household.name || 'Unnamed household' }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ household.phone || 'No phone' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ household.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ household.member_count }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(household.wedding_date) }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/households/${household.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open household"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} households · page {{ page }} of {{ pageCount }}
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Previous"
            :disabled="page <= 1"
            @click="page -= 1"
          />
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Next"
            :disabled="page >= pageCount"
            @click="page += 1"
          />
        </div>
      </div>
    </UCard>

    <HouseholdFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
