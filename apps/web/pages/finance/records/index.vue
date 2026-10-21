<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated } from '~/types/portal'
import type { FinancialRecordRow } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const status = ref(queryParam('status') ?? 'all')
const branch = ref(queryParam('branch') ?? 'all')
const month = ref(queryParam('month') ?? '')
const page = ref(1)
const limit = 25

watch([status, branch, month], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filters. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    if (statusNext && statusNext !== status.value) status.value = statusNext
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(month.value ? { month: month.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'finance-records-list',
  () =>
    api.get<Paginated<FinancialRecordRow>>('/api/finance/records', {
      query: query.value,
    }),
  { watch: [query] },
)

const branches = await useAsyncData('finance-records-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countRecords(params: Record<string, string>): Promise<number> {
  const res = await api.get<Paginated<FinancialRecordRow>>('/api/finance/records', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('finance-records-strip', () =>
  Promise.all([
    countRecords({}),
    countRecords({ status: 'draft' }),
    countRecords({ status: 'submitted' }),
    countRecords({ status: 'confirmed' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Records',
    value: stripCounts.value?.[0] ?? null,
    to: '/finance/records',
    hint: 'Open filtered list',
  },
  {
    label: 'Draft',
    value: stripCounts.value?.[1] ?? null,
    to: '/finance/records?status=draft',
    hint: 'Open filtered list',
  },
  {
    label: 'Submitted',
    value: stripCounts.value?.[2] ?? null,
    to: '/finance/records?status=submitted',
    hint: 'Open filtered list',
  },
  {
    label: 'Confirmed',
    value: stripCounts.value?.[3] ?? null,
    to: '/finance/records?status=confirmed',
    hint: 'Open filtered list',
  },
])

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Submitted', value: 'submitted' },
  { label: 'Confirmed', value: 'confirmed' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const amountsVisible = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.branchFinancialRecords, 'income'),
)

function formatMoney(value: string | null): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `₦${parsed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatMonth(value: string): string {
  return value.slice(0, 7)
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  draft: 'neutral',
  submitted: 'warning',
  confirmed: 'success',
}
</script>

<template>
  <div>
    <PageHeader
      title="Monthly financial records"
      description="Treasurer capture per branch and month: income, intervention and Faith City. MF and the 5% lines are computed, never typed."
    >
      <template #actions>
        <div class="flex gap-2">
          <UButton
            label="WECA returns"
            icon="i-lucide-receipt-text"
            color="neutral"
            variant="outline"
            to="/finance/returns"
          />
          <UButton
            label="Monthly summary"
            icon="i-lucide-table-properties"
            color="neutral"
            variant="outline"
            to="/finance/summary"
          />
          <PermissionGate
            :collection="COLLECTIONS.branchFinancialRecords"
            action="create"
          >
            <UButton label="New record" icon="i-lucide-plus" to="/finance/records/new" />
          </PermissionGate>
        </div>
      </template>
    </PageHeader>

    <UAlert
      v-if="!amountsVisible"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Amounts hidden on this account"
      description="Capture amounts are limited to branch, area and super administrators (data-model §11.1). This account sees statuses and its own rows."
    />

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
        <USelect
          v-model="branch"
          :items="branchOptions"
          class="w-full"
          aria-label="Filter by branch"
        />
        <UInput v-model="month" type="month" aria-label="Filter by month" />
        <UButton
          label="Export CSV"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :to="{ path: '/api/finance/records/export.csv', query: query }"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load financial records"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No financial records match these filters"
        description="Capture a month's income and allocations to open the record."
      >
        <PermissionGate :collection="COLLECTIONS.branchFinancialRecords" action="create">
          <UButton class="mt-4" label="New record" to="/finance/records/new" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Month</th>
              <th v-if="amountsVisible" class="px-3 py-2 font-medium">Income</th>
              <th v-if="amountsVisible" class="px-3 py-2 font-medium">Intervention</th>
              <th v-if="amountsVisible" class="px-3 py-2 font-medium">Faith City</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="record in rows"
              :key="record.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ record.branch_name || 'No branch' }}
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ formatMonth(record.month) }}
              </td>
              <td
                v-if="amountsVisible"
                class="px-3 py-3 text-gray-600 dark:text-gray-300"
              >
                {{ formatMoney(record.income) }}
              </td>
              <td
                v-if="amountsVisible"
                class="px-3 py-3 text-gray-600 dark:text-gray-300"
              >
                {{ formatMoney(record.intervention) }}
              </td>
              <td
                v-if="amountsVisible"
                class="px-3 py-3 text-gray-600 dark:text-gray-300"
              >
                {{ formatMoney(record.faith_city) }}
              </td>
              <td class="px-3 py-3">
                <UBadge :color="statusColor[record.status] ?? 'neutral'" variant="subtle">
                  {{ record.status }}
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/finance/records/${record.id}`"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-chevron-right"
                  aria-label="Open record"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="pageCount > 1" class="mt-4 flex items-center justify-between">
        <p class="text-sm text-gray-500">{{ total }} records</p>
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
