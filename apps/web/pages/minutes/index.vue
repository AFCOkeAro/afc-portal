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

/** Dashboard strip (AFC-588): no server filters — display-only total, no new backend. */
const stripItems = computed(() => [
  { label: 'Minutes', value: rows.value.length, to: null, hint: 'Total in view' },
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

    <UCard>
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Could not load minutes"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No minutes yet"
        description="Minutes are recorded by area staff with a file and attendees."
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
              <th class="px-3 py-2 font-medium">Title</th>
              <th class="px-3 py-2 font-medium">Meeting date</th>
              <th class="px-3 py-2 font-medium">Time</th>
              <th class="px-3 py-2 font-medium">Location</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/minutes/${String(row.id)}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ row.title }}
                </NuxtLink>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.meeting_date }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ timeRange(row) }}
              </td>
              <td class="max-w-48 truncate px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.location ?? '—' }}
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/minutes/${String(row.id)}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open minutes"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
