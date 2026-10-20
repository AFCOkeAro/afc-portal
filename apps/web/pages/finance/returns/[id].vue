<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type { WecaReturnRow } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = await useAsyncData(
  'weca-return-detail',
  () => api.get<{ data: WecaReturnRow }>(`/api/finance/returns/${id.value}`),
  { watch: [id] },
)

const row = computed(() => data.value?.data ?? null)
const isPending = computed(() => row.value?.computation_status === 'formula_pending')
const actionError = ref<string | null>(null)
const acting = ref(false)

const computedVisible = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.wecaReturns, 'total_due'),
)

function formatMoney(value: string | null): string {
  if (value === null || value === undefined || value === '') {
    return isPending.value ? 'Pending board formula' : 'Restricted'
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `₦${parsed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function transition(status: 'submitted' | 'confirmed') {
  actionError.value = null
  acting.value = true
  try {
    await api.patch(`/api/finance/returns/${id.value}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not move the return. Try again.'
  } finally {
    acting.value = false
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
      title="WECA return"
      :description="row ? `${row.branch_name || 'No branch'} · ${row.period}` : 'One branch period under the board formula.'"
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
      title="Could not load the return"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="row" class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Computed lines</h2>
            <UBadge :color="statusColor[row.computation_status] ?? 'neutral'" variant="subtle">
              {{ row.computation_status === 'formula_pending' ? 'Pending board formula' : row.computation_status }}
            </UBadge>
          </div>
        </template>

        <UAlert
          v-if="isPending"
          color="warning"
          variant="subtle"
          icon="i-lucide-hourglass"
          title="Pending board formula"
          description="No formula version is effective for this period yet, so no figures are shown. Nothing is guessed."
        />

        <dl v-if="computedVisible" class="grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Ministerial Fund</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.computed_mf) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Intervention</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.computed_intervention) }}</dd>
            <p class="text-xs text-gray-500">Copied from capture, never derived.</p>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Faith City</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.computed_faith_city) }}</dd>
            <p class="text-xs text-gray-500">Copied from capture, never derived.</p>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Total due</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.total_due) }}</dd>
            <p class="text-xs text-gray-500">MF + intervention + Faith City.</p>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Area 5% (retained)</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.computed_area) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Savings 5% (retained)</dt>
            <dd class="text-lg font-semibold">{{ formatMoney(row.computed_savings) }}</dd>
          </div>
        </dl>
        <p v-else class="text-sm text-gray-500">
          Computed amounts are limited to area administrators and above (data-model §11.1).
        </p>
        <p class="mt-4 text-xs text-gray-500">
          Area and savings lines are retained, never remitted (ADR-0008 R2).
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Lifecycle</h2>
        </template>

        <ol class="grid gap-2 text-sm">
          <li><span class="font-medium">Formula:</span> {{ row.formula_version ?? 'none yet' }}</li>
          <li><span class="font-medium">Captured:</span> {{ row.record_month ?? '—' }}</li>
          <li><span class="font-medium">Submitted:</span> {{ row.submitted_at ?? '—' }}</li>
          <li><span class="font-medium">Confirmed:</span> {{ row.confirmed_at ?? '—' }}</li>
        </ol>
        <p class="mt-3 text-xs text-gray-500">
          Submission and confirmation are audited through the Directus activity log.
        </p>

        <UAlert
          v-if="actionError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Could not move the return"
          :description="actionError"
        />

        <PermissionGate :collection="COLLECTIONS.wecaReturns" action="update">
          <div class="mt-4 flex gap-2">
            <UButton
              v-if="row.computation_status === 'calculated'"
              label="Submit"
              icon="i-lucide-send"
              :loading="acting"
              @click="transition('submitted')"
            />
            <UButton
              v-if="row.computation_status === 'submitted'"
              label="Confirm"
              icon="i-lucide-badge-check"
              :loading="acting"
              @click="transition('confirmed')"
            />
            <p v-if="isPending" class="text-sm text-gray-500">
              Returns submit once the formula computes them.
            </p>
            <p v-if="row.computation_status === 'confirmed'" class="text-sm text-gray-500">
              Confirmed returns cannot move again.
            </p>
          </div>
        </PermissionGate>
      </UCard>
    </div>
  </div>
</template>
