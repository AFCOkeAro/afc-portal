<script setup lang="ts">
import type { CalendarItemType } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const itemType = ref('all')
const dateFrom = ref('')
const dateTo = ref('')

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
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="text-2xl font-semibold">Calendar</h1>
    <p class="mt-2 text-sm text-gray-600">
      Services, events, programmes and celebrations in your scope. Click an entry for its
      detail.
    </p>
    <div class="mt-4 flex gap-2 text-sm">
      <select v-model="itemType" class="rounded border px-2 py-1">
        <option value="all">All types</option>
        <option value="service">Services</option>
        <option value="event">Events</option>
        <option value="programme">Programmes</option>
        <option value="celebration">Celebrations</option>
      </select>
      <input v-model="dateFrom" type="date" class="rounded border px-2 py-1" />
      <input v-model="dateTo" type="date" class="rounded border px-2 py-1" />
    </div>
    <p v-if="pending" class="mt-4">Loading…</p>
    <ul v-else class="mt-4">
      <li
        v-for="row in data?.data ?? []"
        :key="`${row.item_type}-${String(row.id)}`"
        class="border-t py-2 text-sm"
      >
        <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{{ row.item_type }}</span>
        <NuxtLink :to="String(row.href ?? '#')" class="ml-2 font-medium text-blue-600">{{
          row.title
        }}</NuxtLink>
        <span class="ml-2 text-gray-500">{{ row.date }}</span>
      </li>
    </ul>
  </div>
</template>
