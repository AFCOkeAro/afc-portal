<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type { Paginated } from '~/types/portal'
import type { FinancialRecordRow, WecaReturnRow } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const period = ref(queryParam('period') ?? '')
const computationStatus = ref(queryParam('status') ?? 'all')
const branch = ref(queryParam('branch') ?? 'all')
const page = ref(1)
const limit = 25

watch([period, computationStatus, branch], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filters. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    computationStatus.value = statusNext ?? 'all'
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  ...(period.value ? { period: period.value } : {}),
  ...(computationStatus.value !== 'all' ? { status: computationStatus.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'weca-returns-list',
  () => api.get<Paginated<WecaReturnRow>>('/api/finance/returns', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countReturns(params: Record<string, string>): Promise<number> {
  const res = await api.get<Paginated<WecaReturnRow>>('/api/finance/returns', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('weca-returns-strip', () =>
  Promise.all([
    countReturns({}),
    countReturns({ status: 'calculated' }),
    countReturns({ status: 'submitted' }),
    countReturns({ status: 'confirmed' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Returns',
    value: stripCounts.value?.[0] ?? null,
    to: '/finance/returns?status=all',
    hint: 'Open filtered list',
  },
  {
    label: 'Calculated',
    value: stripCounts.value?.[1] ?? null,
    to: '/finance/returns?status=calculated',
    hint: 'Open filtered list',
  },
  {
    label: 'Submitted',
    value: stripCounts.value?.[2] ?? null,
    to: '/finance/returns?status=submitted',
    hint: 'Open filtered list',
  },
  {
    label: 'Confirmed',
    value: stripCounts.value?.[3] ?? null,
    to: '/finance/returns?status=confirmed',
    hint: 'Open filtered list',
  },
])

const statusOptions = [
  { label: 'All states', value: 'all' },
  { label: 'Pending board formula', value: 'formula_pending' },
  { label: 'Calculated', value: 'calculated' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Confirmed', value: 'confirmed' },
]

const computedVisible = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.wecaReturns, 'total_due'),
)
const canCreate = computed(() => permissions.can(COLLECTIONS.wecaReturns, 'create'))

const records = await useAsyncData('weca-returns-records', () =>
  canCreate.value
    ? api.get<Paginated<FinancialRecordRow>>('/api/finance/records', {
        query: { limit: 200, status: 'all' },
      })
    : Promise.resolve(null),
)

const recordOptions = computed(() => [
  { label: 'Choose a captured record', value: '' },
  ...(records.data.value?.data ?? []).map((row) => ({
    label: `${row.branch_name ?? 'No branch'} · ${row.month.slice(0, 7)} (${row.status})`,
    value: row.id,
  })),
])

const openRecordId = ref('')
const openError = ref<string | null>(null)
const opening = ref(false)

function formatMoney(value: string | null, isPending: boolean): string {
  if (value === null || value === undefined || value === '') {
    return isPending ? 'Pending board formula' : 'Restricted'
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `₦${parsed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function openReturn() {
  openError.value = null
  const chosen = (records.data.value?.data ?? []).find(
    (row) => row.id === openRecordId.value,
  )
  if (!chosen) {
    openError.value = 'Choose a captured record first.'
    return
  }
  opening.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/finance/returns', {
      financial_record: chosen.id,
      period: chosen.month.slice(0, 7),
    })
    openRecordId.value = ''
    await navigateTo(`/finance/returns/${created.data.id}`)
  } catch (cause) {
    openError.value =
      cause instanceof ApiRequestError
        ? cause.message
        : 'Could not open the return. Try again.'
  } finally {
    opening.value = false
  }
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  formula_pending: 'warning',
  calculated: 'info',
  submitted: 'warning',
  confirmed: 'success',
}
</script>

<template>
  <div>
    <PageHeader
      title="WECA returns"
      description="One computed return per branch and period. Pending lines show no figures until the board formula computes them."
    >
      <template #actions>
        <div class="flex gap-2">
          <UButton
            label="Monthly summary"
            icon="i-lucide-table-properties"
            color="neutral"
            variant="outline"
            to="/finance/summary"
          />
          <UButton
            label="Formula versions"
            icon="i-lucide-book-marked"
            color="neutral"
            variant="outline"
            to="/finance/formulas"
          />
        </div>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <PermissionGate :collection="COLLECTIONS.wecaReturns" action="create">
      <UCard class="mb-4">
        <h2 class="font-semibold">Open a return</h2>
        <p class="mt-1 text-sm text-gray-500">
          Links a captured record to its period. The portal never computes: the return
          stays pending until the effective formula version computes it.
        </p>
        <div class="mt-3 flex flex-col gap-2 sm:flex-row">
          <USelect
            v-model="openRecordId"
            :items="recordOptions"
            class="w-full sm:max-w-md"
            aria-label="Captured record"
          />
          <UButton
            label="Open return"
            icon="i-lucide-plus"
            :loading="opening"
            @click="openReturn"
          />
        </div>
        <UAlert
          v-if="openError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Could not open the return"
          :description="openError"
        />
      </UCard>
    </PermissionGate>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UInput v-model="period" type="month" aria-label="Filter by period" />
        <USelect
          v-model="computationStatus"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by state"
        />
        <UInput
          v-model="branch"
          placeholder="Branch id (optional)"
          aria-label="Filter by branch"
        />
        <UButton
          label="Export CSV"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :to="{
            path: '/api/finance/returns/export.csv',
            query: period ? { period } : {},
          }"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load WECA returns"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No WECA returns match these filters"
        description="Open a return from a captured record to begin the period."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Period</th>
              <th class="px-3 py-2 font-medium">State</th>
              <th class="px-3 py-2 font-medium">Formula</th>
              <th v-if="computedVisible" class="px-3 py-2 font-medium">Total due</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.branch_name || 'No branch' }}
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ row.period }}
              </td>
              <td class="px-3 py-3">
                <UBadge
                  :color="statusColor[row.computation_status] ?? 'neutral'"
                  variant="subtle"
                >
                  {{
                    row.computation_status === 'formula_pending'
                      ? 'Pending board formula'
                      : row.computation_status
                  }}
                </UBadge>
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ row.formula_version ?? '—' }}
              </td>
              <td
                v-if="computedVisible"
                class="px-3 py-3 text-gray-600 dark:text-gray-300"
              >
                {{
                  formatMoney(row.total_due, row.computation_status === 'formula_pending')
                }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/finance/returns/${row.id}`"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-chevron-right"
                  aria-label="Open return"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pageCount > 1" class="mt-4 flex items-center justify-between">
        <p class="text-sm text-gray-500">{{ total }} returns</p>
        <UPagination
          v-model:page="page"
          :total="total"
          :page-count="limit"
          @update:page="refresh"
        />
      </div>
    </UCard>
  </div>
</template>
