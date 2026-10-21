<script setup lang="ts">
import { CELEBRATION_TYPES, CELEBRATION_VISIBILITIES, COLLECTIONS } from '@afc/shared'
import type { BranchSummary, CelebrationRow, Paginated } from '~/types/portal'

/**
 * Celebrations feed (AFC-538 finding 4, US-C4 AC1, owner: CTO MediaTech).
 * The US-C4 7-day lookahead has no dedicated feed UI in this slice: the
 * lookahead reads the existing unified calendar (/calendar) and the
 * GET /api/celebrations/calendar window (date_from/date_to, approved +
 * published only). The link below presets the next 7 days so preparation
 * does not need a new endpoint or a new send path. A dedicated lookahead
 * panel is tracked against the member-role enablement work, not built here.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const branch = ref(queryParam('branch') ?? 'all')
const zone = ref(queryParam('zone') ?? 'all')
const type = ref(queryParam('type') ?? queryParam('celebration_type') ?? 'all')
const visibility = ref(queryParam('visibility') ?? 'all')
const status = ref(queryParam('status') ?? 'all')
const month = ref(queryParam('month') ?? '')
const sort = ref(queryParam('sort') ?? '-event_date')
const page = ref(1)
const limit = 25

watch([branch, zone, type, visibility, status, month, sort], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    status.value = statusNext ?? 'all'
  },
)

interface CelebrationsResponse extends Paginated<CelebrationRow> {
  filters: Record<string, unknown>
}

const query = computed(() => ({
  page: page.value,
  limit,
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(zone.value !== 'all' ? { zone: zone.value } : {}),
  ...(type.value !== 'all' ? { type: type.value } : {}),
  ...(visibility.value !== 'all' ? { visibility: visibility.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(month.value ? { month: month.value } : {}),
  sort: sort.value,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'celebrations-list',
  () => api.get<CelebrationsResponse>('/api/celebrations', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('celebrations-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const zones = await useAsyncData('celebrations-zones', () =>
  api.get<Array<{ id: string; name: string }>>('/api/zones'),
)

const csvHref = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.value)) {
    if (key === 'page' || key === 'limit') continue
    params.set(key, String(value))
  }
  return `/api/celebrations/reports.csv?${params.toString()}`
})

function isoDate(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}
const lookaheadHref = computed(
  () => `/calendar?item_type=celebration&date_from=${isoDate(0)}&date_to=${isoDate(7)}`,
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countCelebrations(params: Record<string, string>): Promise<number> {
  const res = await api.get<CelebrationsResponse>('/api/celebrations', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('celebrations-strip', () =>
  Promise.all([
    countCelebrations({}),
    countCelebrations({ status: 'approved' }),
    countCelebrations({ status: 'published' }),
    countCelebrations({ status: 'draft' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Celebrations',
    value: stripCounts.value?.[0] ?? null,
    to: '/celebrations?status=all',
    hint: 'Open filtered list',
  },
  {
    label: 'Approved',
    value: stripCounts.value?.[1] ?? null,
    to: '/celebrations?status=approved',
    hint: 'Open filtered list',
  },
  {
    label: 'Published',
    value: stripCounts.value?.[2] ?? null,
    to: '/celebrations?status=published',
    hint: 'Open filtered list',
  },
  {
    label: 'Draft',
    value: stripCounts.value?.[3] ?? null,
    to: '/celebrations?status=draft',
    hint: 'Open filtered list',
  },
])

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const zoneOptions = computed(() => [
  { label: 'All zones', value: 'all' },
  ...(zones.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const typeOptions = [
  { label: 'Any type', value: 'all' },
  ...CELEBRATION_TYPES.map((value) => ({ label: value.replace(/_/g, ' '), value })),
]

const visibilityOptions = [
  { label: 'Any visibility', value: 'all' },
  ...CELEBRATION_VISIBILITIES.map((value) => ({ label: value, value })),
]

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Approved', value: 'approved' },
  { label: 'Published', value: 'published' },
  { label: 'Archived', value: 'archived' },
]

const monthOptions = [
  { label: 'Any month', value: '' },
  ...Array.from({ length: 12 }, (_, index) => {
    const value = String(index + 1)
    const label = new Date(2026, index, 1).toLocaleString(undefined, { month: 'long' })
    return { label: `${label} (recurring)`, value }
  }),
]

const sortOptions = [
  { label: 'Newest first', value: '-event_date' },
  { label: 'Oldest first', value: 'event_date' },
  { label: 'By type', value: 'type' },
  { label: 'By status', value: 'status' },
]

function typeLabel(row: CelebrationRow): string {
  if (row.title) return row.title
  return row.type.replace(/_/g, ' ')
}

function formatDate(value: string, recurring: boolean): string {
  // Recurring greetings celebrate a month/day every year: show "03-14",
  // not a year that never comes back.
  if (recurring && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5)
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      title="Celebrations"
      description="Birthdays, anniversaries and shout-outs: the feed, the lifecycle and the calendar."
    >
      <template #actions>
        <UButton
          :to="csvHref"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
        <UButton
          :to="lookaheadHref"
          color="neutral"
          variant="outline"
          icon="i-lucide-calendar-days"
          label="Next 7 days"
        />
        <PermissionGate :collection="COLLECTIONS.celebrations" action="create">
          <UButton
            label="Record celebration"
            icon="i-lucide-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
        <USelect
          v-model="branch"
          :items="branchOptions"
          class="w-full"
          aria-label="Filter by branch"
        />
        <USelect
          v-model="zone"
          :items="zoneOptions"
          class="w-full"
          aria-label="Filter by zone"
        />
        <USelect
          v-model="type"
          :items="typeOptions"
          class="w-full"
          aria-label="Filter by celebration type"
        />
        <USelect
          v-model="visibility"
          :items="visibilityOptions"
          class="w-full"
          aria-label="Filter by visibility"
        />
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
        <USelect
          v-model="month"
          :items="monthOptions"
          class="w-full"
          aria-label="Filter recurring greetings by month"
        />
        <USelect
          v-model="sort"
          :items="sortOptions"
          class="w-full"
          aria-label="Sort celebrations"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load celebrations"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No celebrations match these filters"
        description="Record the first greeting or shout-out."
      >
        <PermissionGate :collection="COLLECTIONS.celebrations" action="create">
          <UButton class="mt-4" label="Record celebration" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Celebration</th>
              <th class="px-3 py-2 font-medium">Person</th>
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Visibility</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/celebrations/${row.id}`"
                  class="font-medium capitalize text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ typeLabel(row) }}
                </NuxtLink>
                <p class="text-xs capitalize text-gray-500 dark:text-gray-400">
                  {{ row.type.replace(/_/g, ' ')
                  }}{{ row.is_recurring ? ' · yearly' : '' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.person_name || '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(row.event_date, row.is_recurring) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.visibility }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.status }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/celebrations/${row.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open celebration"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} celebrations · page {{ page }} of {{ pageCount }}
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

    <CelebrationFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
