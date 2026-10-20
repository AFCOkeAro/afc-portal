<script setup lang="ts">
import type { CalendarItemType } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
function queryParam(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}
const itemType = ref(queryParam('item_type') || 'all')
const dateFrom = ref(queryParam('date_from'))
const dateTo = ref(queryParam('date_to'))

const query = computed(() => ({
  ...(itemType.value !== 'all' ? { item_type: itemType.value as CalendarItemType } : {}),
  ...(dateFrom.value ? { date_from: dateFrom.value } : {}),
  ...(dateTo.value ? { date_to: dateTo.value } : {}),
}))
const { data, pending } = await useAsyncData(
  'calendar-feed',
  () =>
    api.get<{ data: Record<string, unknown>[] }>(`/api/calendar`, { query: query.value }),
  { watch: [query] },
)

const typeOptions = [
  { label: 'All types', value: 'all' },
  { label: 'Services', value: 'service' },
  { label: 'Events', value: 'event' },
  { label: 'Programmes', value: 'programme' },
  { label: 'Celebrations', value: 'celebration' },
]

const rows = computed(() => data.value?.data ?? [])
</script>

<template>
  <div>
    <PageHeader
      title="Calendar"
      description="Services, events, programmes and celebrations in your scope. Select an entry for its detail."
    />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3">
        <USelect
          v-model="itemType"
          :items="typeOptions"
          class="w-full"
          aria-label="Filter by entry type"
        />
        <UInput v-model="dateFrom" type="date" class="w-full" aria-label="From date" />
        <UInput v-model="dateTo" type="date" class="w-full" aria-label="To date" />
      </div>

      <div v-if="pending" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No calendar entries in this window"
        description="Widen the dates or pick another entry type."
      />

      <ul v-else class="mt-4 divide-y divide-gray-100 dark:divide-gray-800">
        <li
          v-for="row in rows"
          :key="`${row.item_type}-${String(row.id)}`"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
        >
          <UBadge color="neutral" variant="subtle">{{ row.item_type }}</UBadge>
          <NuxtLink
            :to="String(row.href ?? '#')"
            class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ row.title }}
          </NuxtLink>
          <span class="text-gray-500 dark:text-gray-400">{{ row.date }}</span>
        </li>
      </ul>
    </UCard>
  </div>
</template>
