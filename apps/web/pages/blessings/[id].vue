<script setup lang="ts">
import type { BlessingDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const id = String(route.params.id)
const api = useApi()

const {
  data: blessing,
  pending,
  error,
} = await useAsyncData(`blessing-${id}`, () =>
  api.get<BlessingDetail>(`/api/blessings/${id}`),
)

function typeLabel(): string {
  const row = blessing.value
  if (!row) return 'Blessing'
  if (row.blessing_type === 'other' && row.other_label) return row.other_label
  return row.blessing_type.replace(/_/g, ' ')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

function eventLabel(eventType: string): string {
  return eventType.replace(/_/g, ' ')
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/blessings"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to blessings"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this blessing record"
      :description="error.message"
    />

    <template v-else-if="blessing">
      <PageHeader
        :title="typeLabel()"
        :description="`${formatDate(blessing.service_date)} · ${blessing.branch_name || 'No branch'}`"
      />

      <div class="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Male"
          :value="blessing.male_count"
          hint="Male blessings recorded"
        />
        <StatCard
          label="Female"
          :value="blessing.female_count"
          hint="Female blessings recorded"
        />
        <StatCard
          label="Total"
          :value="blessing.total_count"
          hint="Derived male plus female"
        />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Record</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Type</dt>
              <dd class="text-right capitalize">
                {{ blessing.blessing_type.replace(/_/g, ' ') }}
              </dd>
            </div>
            <div v-if="blessing.other_label" class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Other label</dt>
              <dd class="text-right">{{ blessing.other_label }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
              <dd class="text-right">{{ blessing.branch_name || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Notes</dt>
              <dd class="text-right whitespace-pre-line">{{ blessing.notes || '—' }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Audit trail</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ blessing.events.length }} events
              </span>
            </div>
          </template>

          <EmptyState
            v-if="blessing.events.length === 0"
            title="No audit events"
            description="Recording and edits are recorded here."
          />

          <ol v-else class="space-y-3">
            <li
              v-for="item in blessing.events"
              :key="item.id"
              class="flex items-start gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
            >
              <UIcon
                name="i-lucide-history"
                class="mt-0.5 size-4 shrink-0 text-gray-400"
              />
              <div>
                <p class="text-sm font-medium capitalize">
                  {{ eventLabel(item.event_type) }}
                </p>
                <p class="text-sm text-gray-600 dark:text-gray-300">
                  {{ item.detail || '—' }}
                </p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ item.created_at ? new Date(item.created_at).toLocaleString() : '—' }}
                </p>
              </div>
            </li>
          </ol>
        </UCard>
      </div>
    </template>
  </div>
</template>
