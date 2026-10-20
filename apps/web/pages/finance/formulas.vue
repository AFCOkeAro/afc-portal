<script setup lang="ts">
import type { WecaFormulaRow } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()

const { data, pending, error } = await useAsyncData('weca-formulas', () =>
  api.get<{ data: WecaFormulaRow[] }>('/api/finance/formulas'),
)

const versions = computed(() => data.value?.data ?? [])

/**
 * Rates and thresholds are read from the version row, never written here.
 * Percent labels multiply the stored fraction at render time; the `100`
 * below is unit conversion, not a board rate.
 */
function percent(rate: number): string {
  return `${(rate * 100).toLocaleString('en-US', { maximumFractionDigits: 4 })}%`
}

function moneyFloor(value: number): string {
  return `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`
}

function rulesText(row: WecaFormulaRow): string[] {
  const rules = row.rules
  return [
    `Ministerial Fund low band: ${percent(rules.mf_low_rate)} of income from ${moneyFloor(rules.mf_low_min)}`,
    `Ministerial Fund high band: ${percent(rules.mf_high_rate)} of income from ${moneyFloor(rules.mf_high_min)}`,
    `Below ${moneyFloor(rules.mf_low_min)}: no MF line`,
    `Area projects retained: ${percent(rules.area_rate)} of income (not remitted)`,
    `Savings fund retained: ${percent(rules.savings_rate)} of income (not remitted)`,
    'Intervention and Faith City: treasurer inputs, copied never derived',
    'Remittance total: MF + intervention + Faith City',
  ]
}
</script>

<template>
  <div>
    <PageHeader
      title="Formula versions"
      description="Board-ratified WECA formula schedule. Versions arrive as reviewed rows, and returns record the version they computed under."
    >
      <template #actions>
        <UButton
          label="Back to returns"
          color="neutral"
          variant="outline"
          to="/finance/returns"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load formula versions"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <EmptyState
      v-else-if="versions.length === 0"
      title="No formula version is effective"
      description="Returns stay pending board formula until the board ratifies a version."
    />

    <div v-else class="grid gap-4">
      <UCard v-for="row in versions" :key="row.version">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="font-mono font-semibold">{{ row.version }}</h2>
            <UBadge color="info" variant="subtle">
              effective {{ row.effective_from }}
            </UBadge>
          </div>
        </template>
        <ul class="grid gap-1 text-sm text-gray-600 dark:text-gray-300">
          <li v-for="line in rulesText(row)" :key="line">{{ line }}</li>
        </ul>
        <p v-if="row.notes" class="mt-3 text-xs text-gray-500">
          {{ row.notes }}
        </p>
      </UCard>
    </div>
  </div>
</template>
