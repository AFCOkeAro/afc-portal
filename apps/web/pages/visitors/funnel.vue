<script setup lang="ts">
import type { BranchSummary } from '~/types/portal'
import type { JourneyFunnel } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const branch = ref('all')

const query = computed(() => ({
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'visitors-funnel',
  () => api.get<JourneyFunnel>('/api/visitors/funnel', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('visitors-funnel-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const csvUrl = computed(() => {
  const params = new URLSearchParams(query.value)
  return `/api/visitors/funnel.csv?${params.toString()}`
})

function prettyKey(value: string | null): string {
  if (!value) return 'Unassigned'
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
</script>

<template>
  <div>
    <PageHeader
      title="Newcomer funnel"
      description="Stage counts, conversion, days in stage and overdue follow-ups per officer."
    >
      <template #actions>
        <UButton
          to="/visitors"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Visitors"
        />
        <UButton
          :to="csvUrl"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Branch">
          <USelect v-model="branch" :items="branchOptions" class="w-full" />
        </UFormField>
        <div class="flex items-end">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            label="Refresh"
            @click="refresh()"
          />
        </div>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not build the funnel"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <template v-else-if="data">
        <div class="mt-6 grid gap-3 sm:grid-cols-3">
          <StatCard label="Newcomers" :value="String(data.totals.visitors)" />
          <StatCard label="Overdue in stage" :value="String(data.totals.overdue)" />
          <StatCard
            label="Unassigned over 3 days"
            :value="String(data.totals.unassignedOver3d)"
          />
        </div>

        <h2 class="mb-2 mt-6 text-base font-semibold">Stages</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="py-2 pr-4 font-medium">Stage</th>
                <th class="py-2 pr-4 font-medium">Visitors</th>
                <th class="py-2 pr-4 font-medium">New this week</th>
                <th class="py-2 pr-4 font-medium">Avg days</th>
                <th class="py-2 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="stage in data.stages"
                :key="stage.key"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td class="py-2 pr-4 font-medium">{{ prettyKey(stage.key) }}</td>
                <td class="py-2 pr-4">{{ stage.visitors }}</td>
                <td class="py-2 pr-4">{{ stage.newThisWeek }}</td>
                <td class="py-2 pr-4">{{ stage.avgDaysInStage ?? '—' }}</td>
                <td class="py-2">
                  <UBadge
                    :color="stage.overdue > 0 ? 'warning' : 'neutral'"
                    variant="subtle"
                  >
                    {{ stage.overdue }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2 class="mb-2 mt-6 text-base font-semibold">Officers</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700">
                <th class="py-2 pr-4 font-medium">Officer</th>
                <th class="py-2 pr-4 font-medium">Due today</th>
                <th class="py-2 pr-4 font-medium">Overdue</th>
                <th class="py-2 font-medium">Unassigned 3d+</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in data.officers"
                :key="row.officer ?? 'unassigned'"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td class="py-2 pr-4 font-medium">{{ prettyKey(row.officer) }}</td>
                <td class="py-2 pr-4">{{ row.dueToday }}</td>
                <td class="py-2 pr-4">
                  <UBadge :color="row.overdue > 0 ? 'error' : 'neutral'" variant="subtle">
                    {{ row.overdue }}
                  </UBadge>
                </td>
                <td class="py-2">{{ row.unassignedOver3d }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="data.officers.length === 0" class="mt-2 text-sm text-gray-500">
          No follow-up load recorded for this scope yet.
        </p>
      </template>
    </UCard>
  </div>
</template>
