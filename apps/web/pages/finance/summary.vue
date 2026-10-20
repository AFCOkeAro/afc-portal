<script setup lang="ts">
import type { FinanceSummary } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()
const route = useRoute()

function defaultPeriod(): string {
  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  return first.toISOString().slice(0, 7)
}

function queryParam(): string {
  const value = route.query.period
  return typeof value === 'string' && value.length > 0 ? value : defaultPeriod()
}

const period = ref(queryParam())

const compare = ref(route.query.compare_prior_year === 'true')

interface FinanceCompare {
  period: string
  remittance_total: string | null
  pending: number
  branches: number
  delta_remittance: string | null
  has_data: boolean
}

type FinanceSummaryWithCompare = FinanceSummary & { compare: FinanceCompare | null }

const query = computed(() => ({
  period: period.value,
  ...(compare.value ? { compare_prior_year: 'true' } : {}),
}))

const exportHref = computed(() => {
  const params = new URLSearchParams({ period: period.value })
  if (compare.value) params.set('compare_prior_year', 'true')
  return `/api/finance/returns/export.csv?${params.toString()}`
})

const { data, pending, error } = await useAsyncData(
  'finance-summary',
  () => api.get<{ data: FinanceSummaryWithCompare }>('/api/finance/summary', { query: query.value }),
  { watch: [query] },
)

const summary = computed(() => data.value?.data ?? null)
const compareSide = computed(() => data.value?.data.compare ?? null)

function formatMoney(value: string | null, isPending: boolean): string {
  if (value === null || value === undefined || value === '') {
    return isPending ? '—' : 'Restricted'
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `₦${parsed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
      title="Monthly WECA summary"
      description="The board sheet re-derived from normalized lines: MF + intervention + Faith City = total due. Area and savings are retained, never remitted."
    >
      <template #actions>
        <div class="flex items-end gap-2">
          <UInput v-model="period" type="month" aria-label="Summary period" />
          <UFormField label="Compare with prior year">
            <USwitch v-model="compare" />
          </UFormField>
          <UButton
            label="Export CSV"
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
            :to="exportHref"
            external
          />
        </div>
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load the summary"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="summary" class="grid gap-4">
      <UAlert
        v-if="!summary.amounts_visible"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Amounts hidden on this account"
        description="Computed amounts are limited to area administrators and above (data-model §11.1). Counts and pending flags are shown."
      />

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Branches in period" :value="String(summary.branches)" />
        <StatCard label="Pending board formula" :value="String(summary.pending)" />
        <StatCard
          label="Total remittance due"
          :value="formatMoney(summary.remittance_total, summary.pending > 0)"
          :hint="
            compareSide?.has_data
              ? `Prior year (${compareSide.period}): ${formatMoney(compareSide.remittance_total, false)}${compareSide.delta_remittance !== null ? ` · Δ ₦${Number(compareSide.delta_remittance).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}`
              : undefined
          "
        />
        <StatCard
          label="Formula versions"
          :value="summary.versions.length > 0 ? summary.versions.join(', ') : 'none yet'"
        />
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Remittance breakdown · {{ summary.period }}</h2>
        </template>
        <dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Ministerial Fund</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(summary.mf_total, false) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Intervention</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(summary.intervention_total, false) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Faith City</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(summary.faith_city_total, false) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Area 5% retained</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(summary.area_retained_total, false) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Savings 5% retained</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(summary.savings_retained_total, false) }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Branch lines</h2>
        </template>
        <EmptyState
          v-if="summary.lines.length === 0"
          title="No return lines for this period"
          description="Open returns from captured records to fill the sheet."
        />
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th class="px-3 py-2 font-medium">Branch</th>
                <th class="px-3 py-2 font-medium">State</th>
                <th class="px-3 py-2 font-medium">MF</th>
                <th class="px-3 py-2 font-medium">Intervention</th>
                <th class="px-3 py-2 font-medium">Faith City</th>
                <th class="px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="line in summary.lines"
                :key="line.branch"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ line.branch_name || line.branch }}
                </td>
                <td class="px-3 py-3">
                  <UBadge :color="statusColor[line.computation_status] ?? 'neutral'" variant="subtle">
                    {{ line.computation_status === 'formula_pending' ? 'Pending board formula' : line.computation_status }}
                  </UBadge>
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ formatMoney(line.mf, line.computation_status === 'formula_pending') }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ formatMoney(line.intervention, line.computation_status === 'formula_pending') }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ formatMoney(line.faith_city, line.computation_status === 'formula_pending') }}
                </td>
                <td class="px-3 py-3 font-semibold text-gray-900 dark:text-white">
                  {{ formatMoney(line.total, line.computation_status === 'formula_pending') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </div>
</template>
