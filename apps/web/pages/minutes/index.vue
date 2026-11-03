<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { data, pending, error } = await useAsyncData('minutes-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/minutes'),
)

const rows = computed(() => data.value?.data ?? [])

function timeRange(row: Record<string, unknown>): string {
  const start = typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : ''
  const end = typeof row.end_time === 'string' ? row.end_time.slice(0, 5) : ''
  if (start && end) return `${start}–${end}`
  return start || end || '—'
}

const statusCounts = computed(() => {
  const counts = { draft: 0, review: 0, accepted: 0, total: rows.value.length }
  for (const row of rows.value) {
    const s = String(row.status ?? '').toLowerCase()
    if (s in counts) counts[s as keyof typeof counts]++
  }
  return counts
})

const stripItems = computed(() => [
  { label: 'Total', value: statusCounts.value.total },
  { label: 'Draft', value: statusCounts.value.draft },
  { label: 'Review', value: statusCounts.value.review },
  { label: 'Accepted', value: statusCounts.value.accepted },
])
</script>

<template>
  <div>
    <PageHeader
      title="Minutes"
      description="Minutes attach a file and attendees; writes are area-scoped per the matrix."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="create">
          <UButton label="New minutes" icon="i-lucide-plus" to="/minutes/new" />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard class="mt-4">
      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No minutes yet"
        description="Record the first meeting minutes for this scope."
      >
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="create">
          <UButton class="mt-4" label="New minutes" to="/minutes/new" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-4 py-2">Title</th>
              <th class="px-4 py-2">Date</th>
              <th class="px-4 py-2">Time</th>
              <th class="px-4 py-2">Location</th>
              <th class="px-4 py-2">Status</th>
              <th class="px-4 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="row in rows" :key="String(row.id)">
              <td class="px-4 py-2 font-medium text-gray-900 dark:text-white">
                {{ row.title }}
              </td>
              <td class="px-4 py-2 text-gray-600 dark:text-gray-300">
                {{ row.meeting_date }}
              </td>
              <td class="px-4 py-2 text-gray-600 dark:text-gray-300">
                {{ timeRange(row) }}
              </td>
              <td class="px-4 py-2 text-gray-600 dark:text-gray-300">
                {{ row.location ?? '—' }}
              </td>
              <td class="px-4 py-2">
                <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td class="px-4 py-2 text-right">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  label="View"
                  :to="`/minutes/${row.id}`"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load minutes"
        :description="error.message"
      />
    </UCard>
  </div>
</template>
