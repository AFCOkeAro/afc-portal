<script setup lang="ts">
import type { CalendarItemType } from '@afc/shared'
import { isCalendarView, isISODate, rangeForView, todayISO } from '~/utils/calendar-ranges'
import type { CalendarView, CalendarViewItem } from '~/utils/calendar-ranges'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()

function queryParam(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}

/** Month is the default view; view + focused date live in the query (deep-linkable). */
const initialView = queryParam('view')
const view = ref<CalendarView>(isCalendarView(initialView) ? initialView : 'month')
const initialDate = queryParam('date')
const focused = ref<string>(isISODate(initialDate) ? initialDate : todayISO())
/** Staff = scoped feed; Public = the session-free published-public feed preview. */
const scope = ref<'staff' | 'public'>(queryParam('scope') === 'public' ? 'public' : 'staff')
const itemType = ref(queryParam('item_type') || 'all')

/** The feed is paged per visible range (server cap of 200 unchanged). */
const range = computed(() => rangeForView(view.value, focused.value))
const endpoint = computed(() =>
  scope.value === 'public' ? '/api/calendar/public' : '/api/calendar',
)
const query = computed(() => ({
  date_from: range.value.from,
  date_to: range.value.to,
  ...(itemType.value !== 'all' ? { item_type: itemType.value as CalendarItemType } : {}),
}))
const { data, pending } = await useAsyncData(
  'calendar-feed',
  () =>
    api.get<{ data: Record<string, unknown>[] }>(endpoint.value, { query: query.value }),
  { watch: [query, endpoint] },
)

/** Keep the URL behind the state so every view is a shareable link. */
watch([view, focused, scope, itemType], () => {
  router.replace({
    query: {
      view: view.value,
      date: focused.value,
      ...(scope.value === 'public' ? { scope: 'public' } : {}),
      ...(itemType.value !== 'all' ? { item_type: itemType.value } : {}),
    },
  })
})

const typeOptions = [
  { label: 'All types', value: 'all' },
  { label: 'Services', value: 'service' },
  { label: 'Events', value: 'event' },
  { label: 'Programmes', value: 'programme' },
  { label: 'Celebrations', value: 'celebration' },
]

const rows = computed<CalendarViewItem[]>(() =>
  (data.value?.data ?? []).map((row) => ({
    id: String(row.id ?? ''),
    item_type: String(row.item_type ?? ''),
    title: String(row.title ?? 'Untitled'),
    date: String(row.date ?? ''),
    starts_at: typeof row.starts_at === 'string' ? row.starts_at : null,
    branch: typeof row.branch === 'string' ? row.branch : null,
    branch_name: typeof row.branch_name === 'string' ? row.branch_name : null,
    href: typeof row.href === 'string' ? row.href : null,
  })),
)
</script>

<template>
  <div>
    <PageHeader
      title="Calendar"
      description="Services, events, programmes and celebrations in your scope. Select an entry for its detail."
    />

    <UCard>
      <div class="flex flex-wrap items-center gap-3">
        <USelect
          v-model="itemType"
          :items="typeOptions"
          class="w-full sm:w-48"
          aria-label="Filter by entry type"
        />
        <div class="flex items-center gap-1" role="group" aria-label="Calendar scope">
          <UButton
            label="Staff"
            size="sm"
            :color="scope === 'staff' ? 'primary' : 'neutral'"
            :variant="scope === 'staff' ? 'solid' : 'ghost'"
            @click="scope = 'staff'"
          />
          <UButton
            label="Public"
            size="sm"
            :color="scope === 'public' ? 'primary' : 'neutral'"
            :variant="scope === 'public' ? 'solid' : 'ghost'"
            @click="scope = 'public'"
          />
        </div>
      </div>

      <p v-if="scope === 'public'" class="mt-3 text-sm text-gray-500 dark:text-gray-400">
        Preview of the public feed: published public items only, as a visitor without
        login sees them.
        <NuxtLink to="/calendar/public" class="text-primary-600 hover:underline dark:text-primary-400">
          Open the public calendar
        </NuxtLink>
      </p>

      <CalendarViews
        v-model:view="view"
        v-model:focused="focused"
        :items="rows"
        :pending="pending"
        class="mt-4"
      >
        <template #row="{ item }">
          <NuxtLink
            v-if="item.href"
            :to="String(item.href)"
            class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ item.title }}
          </NuxtLink>
          <span v-else class="font-medium text-gray-900 dark:text-white">
            {{ item.title }}
          </span>
        </template>
      </CalendarViews>
    </UCard>
  </div>
</template>
