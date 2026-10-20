<script setup lang="ts">
import { BLESSING_TYPES, COLLECTIONS } from '@afc/shared'
import type { BlessingBreakdownRow, BlessingRow, BranchSummary } from '~/types/portal'

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
const blessingType = ref(queryParam('blessing_type') ?? queryParam('type') ?? 'all')
const period = ref(queryParam('period') ?? 'monthly')
const dateFrom = ref(queryParam('date_from') ?? '')
const dateTo = ref(queryParam('date_to') ?? '')
const sort = ref(queryParam('sort') ?? '-service_date')
const compare = ref(queryParam('compare_prior_year') === 'true')
const page = ref(1)
const limit = 25

watch([branch, zone, blessingType, period, dateFrom, dateTo, sort, compare], () => {
  page.value = 1
})

interface BlessingsCompare {
  from: string
  to: string
  total: number
  male: number
  female: number
  has_data: boolean
  delta_total: number
}

interface BlessingsResponse {
  data: BlessingRow[]
  meta: { total: number; page: number; limit: number }
  breakdown: BlessingBreakdownRow[]
  compare: BlessingsCompare | null
}

const query = computed(() => ({
  page: page.value,
  limit,
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(zone.value !== 'all' ? { zone: zone.value } : {}),
  ...(blessingType.value !== 'all' ? { blessing_type: blessingType.value } : {}),
  period: period.value,
  ...(dateFrom.value ? { date_from: dateFrom.value } : {}),
  ...(dateTo.value ? { date_to: dateTo.value } : {}),
  sort: sort.value,
  ...(compare.value ? { compare_prior_year: 'true' } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'blessings-list',
  () => api.get<BlessingsResponse>('/api/blessings', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('blessings-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const zones = await useAsyncData('blessings-zones', () =>
  api.get<Array<{ id: string; name: string }>>('/api/zones'),
)

const csvHref = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.value)) {
    if (key === 'page' || key === 'limit') continue
    params.set(key, String(value))
  }
  return `/api/blessings/reports.csv?${params.toString()}`
})

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const breakdown = computed(() => data.value?.breakdown ?? [])
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))
const grandTotal = computed(() =>
  breakdown.value.reduce(
    (sum: number, group: BlessingBreakdownRow) => sum + group.total,
    0,
  ),
)

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const zoneOptions = computed(() => [
  { label: 'All zones', value: 'all' },
  ...(zones.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const typeOptions = [
  { label: 'Any blessing type', value: 'all' },
  ...BLESSING_TYPES.map((value) => ({ label: value.replace(/_/g, ' '), value })),
]

const periodOptions = [
  { label: 'This week', value: 'weekly' },
  { label: 'This month', value: 'monthly' },
  { label: 'This quarter', value: 'quarterly' },
  { label: 'This year', value: 'yearly' },
  { label: 'Custom range', value: 'custom' },
]

const sortOptions = [
  { label: 'Newest first', value: '-service_date' },
  { label: 'Oldest first', value: 'service_date' },
  { label: 'Largest total', value: '-total_count' },
  { label: 'Smallest total', value: 'total_count' },
  { label: 'By type', value: 'blessing_type' },
]

function typeLabel(row: BlessingRow): string {
  if (row.blessing_type === 'other' && row.other_label) return row.other_label
  return row.blessing_type.replace(/_/g, ' ')
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      title="Blessings"
      description="Salvation, sanctification, Holy-Ghost baptism, reanointing, healing and other blessings per service."
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
        <PermissionGate :collection="COLLECTIONS.blessings" action="create">
          <UButton
            label="Record blessings"
            icon="i-lucide-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <div
      v-if="breakdown.length > 0"
      class="mb-4 grid gap-4 sm:grid-cols-3 xl:grid-cols-6"
    >
      <StatCard
        label="Total"
        :value="grandTotal"
        :hint="
          data?.compare?.has_data
            ? `Prior year: ${data.compare.total} (${data.compare.from} to ${data.compare.to}, Δ ${data.compare.delta_total >= 0 ? '+' : ''}${data.compare.delta_total})`
            : `${total} records in this filter`
        "
      />
      <StatCard
        v-for="group in breakdown"
        :key="group.blessing_type"
        :label="group.blessing_type.replace(/_/g, ' ')"
        :value="group.total"
        :hint="`${group.male} male · ${group.female} female`"
      />
    </div>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
          v-model="blessingType"
          :items="typeOptions"
          class="w-full"
          aria-label="Filter by blessing type"
        />
        <USelect
          v-model="period"
          :items="periodOptions"
          class="w-full"
          aria-label="Filter by period"
        />
        <USelect
          v-model="sort"
          :items="sortOptions"
          class="w-full"
          aria-label="Sort blessings"
        />
        <UInput
          v-model="dateFrom"
          type="date"
          class="w-full"
          aria-label="Custom range start"
          :disabled="period !== 'custom'"
        />
        <UInput
          v-model="dateTo"
          type="date"
          class="w-full"
          aria-label="Custom range end"
          :disabled="period !== 'custom'"
        />
        <UFormField label="Compare with prior year">
          <USwitch v-model="compare" />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load blessings"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No blessings match these filters"
        description="Record the first blessing for this service."
      >
        <PermissionGate :collection="COLLECTIONS.blessings" action="create">
          <UButton class="mt-4" label="Record blessings" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Blessing</th>
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Male</th>
              <th class="px-3 py-2 font-medium">Female</th>
              <th class="px-3 py-2 font-medium">Total</th>
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
                  :to="`/blessings/${row.id}`"
                  class="font-medium capitalize text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ typeLabel(row) }}
                </NuxtLink>
                <p
                  v-if="row.blessing_type === 'other'"
                  class="text-xs text-gray-500 dark:text-gray-400"
                >
                  other blessing
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(row.service_date) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ row.male_count }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ row.female_count }}
              </td>
              <td class="px-3 py-3 font-medium tabular-nums">{{ row.total_count }}</td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/blessings/${row.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open blessing record"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} records · page {{ page }} of {{ pageCount }}
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

    <BlessingFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
