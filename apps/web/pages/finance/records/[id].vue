<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type { FinancialRecordRow } from '~/types/finance'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()
const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, pending, error, refresh } = await useAsyncData(
  'finance-record-detail',
  () => api.get<{ data: FinancialRecordRow }>(`/api/finance/records/${id.value}`),
  { watch: [id] },
)

const record = computed(() => data.value?.data ?? null)
const actionError = ref<string | null>(null)
const acting = ref(false)

const amountsVisible = computed(() =>
  usePermissions().isFieldVisible(COLLECTIONS.branchFinancialRecords, 'income'),
)

function formatMoney(value: string | null): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return '—'
  return `₦${parsed.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

async function transition(status: 'submitted' | 'confirmed') {
  actionError.value = null
  acting.value = true
  try {
    await api.patch(`/api/finance/records/${id.value}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value =
      cause instanceof ApiRequestError
        ? cause.message
        : 'Could not move the record. Try again.'
  } finally {
    acting.value = false
  }
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'warning',
  confirmed: 'success',
}
</script>

<template>
  <div>
    <PageHeader
      title="Financial record"
      :description="
        record
          ? `${record.branch_name || 'No branch'} · ${record.month.slice(0, 7)}`
          : 'A month of treasurer capture.'
      "
    >
      <template #actions>
        <UButton
          label="Back to records"
          color="neutral"
          variant="outline"
          to="/finance/records"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load the record"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="record" class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-2">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Capture</h2>
            <UBadge :color="statusColor[record.status] ?? 'neutral'" variant="subtle">
              {{ record.status }}
            </UBadge>
          </div>
        </template>

        <dl class="grid gap-3 sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Income</dt>
            <dd class="text-lg font-semibold">
              {{ amountsVisible ? formatMoney(record.income) : 'Hidden on this account' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Currency</dt>
            <dd class="text-lg font-semibold">{{ record.currency ?? 'NGN' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Intervention</dt>
            <dd class="text-lg font-semibold">
              {{
                amountsVisible
                  ? formatMoney(record.intervention)
                  : 'Hidden on this account'
              }}
            </dd>
            <p class="text-xs text-gray-500">
              Manual input, never derived (ADR-0008 R3).
            </p>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Faith City</dt>
            <dd class="text-lg font-semibold">
              {{
                amountsVisible ? formatMoney(record.faith_city) : 'Hidden on this account'
              }}
            </dd>
            <p class="text-xs text-gray-500">
              Manual input, never derived (ADR-0008 R3).
            </p>
          </div>
        </dl>

        <p v-if="record.notes" class="mt-4 text-sm text-gray-600 dark:text-gray-300">
          {{ record.notes }}
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Lifecycle</h2>
        </template>

        <ol class="grid gap-2 text-sm">
          <li>
            <span class="font-medium">Submitted by:</span>
            {{ record.submitted_by ?? '—' }}
          </li>
          <li>
            <span class="font-medium">Confirmed by:</span>
            {{ record.confirmed_by ?? '—' }}
          </li>
          <li>
            <span class="font-medium">Updated:</span> {{ record.updated_at ?? '—' }}
          </li>
        </ol>
        <p class="mt-3 text-xs text-gray-500">
          Submission and confirmation are audited: the actor is stamped on the record and
          the Directus activity log holds the transition.
        </p>

        <UAlert
          v-if="actionError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Could not move the record"
          :description="actionError"
        />

        <PermissionGate :collection="COLLECTIONS.branchFinancialRecords" action="update">
          <div class="mt-4 flex gap-2">
            <UButton
              v-if="record.status === 'draft'"
              label="Submit"
              icon="i-lucide-send"
              :loading="acting"
              @click="transition('submitted')"
            />
            <UButton
              v-if="record.status === 'submitted'"
              label="Confirm"
              icon="i-lucide-badge-check"
              :loading="acting"
              @click="transition('confirmed')"
            />
            <p v-if="record.status === 'confirmed'" class="text-sm text-gray-500">
              Confirmed records cannot be edited in place.
            </p>
          </div>
        </PermissionGate>
      </UCard>
    </div>
  </div>
</template>
