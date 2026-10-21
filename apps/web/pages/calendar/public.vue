<script setup lang="ts">
import {
  isCalendarView,
  isISODate,
  rangeForView,
  todayISO,
} from '~/utils/calendar-ranges'
import type { CalendarView, CalendarViewItem } from '~/utils/calendar-ranges'

/**
 * Public calendar (AFC-575). No session, no staff middleware: renders under
 * the public layout from the session-free `/api/calendar/public` feed, which
 * carries published public items only (title/date/branch-name, no hrefs, so
 * titles render as plain text via the renderer's default row).
 */
definePageMeta({ layout: 'public' })

const api = useApi()
const route = useRoute()
const router = useRouter()

function queryParam(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}

const initialView = queryParam('view')
const view = ref<CalendarView>(isCalendarView(initialView) ? initialView : 'month')
const initialDate = queryParam('date')
const focused = ref<string>(isISODate(initialDate) ? initialDate : todayISO())
const itemType = ref(queryParam('item_type') || 'all')

const range = computed(() => rangeForView(view.value, focused.value))
const query = computed(() => ({
  date_from: range.value.from,
  date_to: range.value.to,
  ...(itemType.value !== 'all' ? { item_type: itemType.value } : {}),
}))
const { data, pending } = await useAsyncData(
  'public-calendar-feed',
  () =>
    api.get<{ data: Record<string, unknown>[] }>('/api/calendar/public', {
      query: query.value,
    }),
  { watch: [query] },
)

watch([view, focused, itemType], () => {
  router.replace({
    query: {
      view: view.value,
      date: focused.value,
      ...(itemType.value !== 'all' ? { item_type: itemType.value } : {}),
    },
  })
})

const typeOptions = [
  { label: 'All types', value: 'all' },
  { label: 'Events', value: 'event' },
]

const rows = computed<CalendarViewItem[]>(() =>
  (data.value?.data ?? []).map((row) => ({
    id: String(row.id ?? ''),
    item_type: String(row.item_type ?? ''),
    title: String(row.title ?? 'Untitled'),
    date: String(row.date ?? ''),
    starts_at: null,
    branch: null,
    branch_name: typeof row.branch_name === 'string' ? row.branch_name : null,
    href: null,
  })),
)
</script>

<template>
  <div>
    <PageHeader
      title="Calendar"
      description="Published public programmes and services. No account needed — to join an event, use the registration form."
    />

    <UCard>
      <div class="flex flex-wrap items-center gap-3">
        <USelect
          v-model="itemType"
          :items="typeOptions"
          class="w-full sm:w-48"
          aria-label="Filter by entry type"
        />
        <UButton
          to="/register"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Register for an event"
        />
      </div>

      <CalendarViews
        v-model:view="view"
        v-model:focused="focused"
        :items="rows"
        :pending="pending"
        class="mt-4"
      />
    </UCard>
  </div>
</template>
