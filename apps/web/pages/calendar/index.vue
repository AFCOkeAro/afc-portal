<script setup lang="ts">
import type { CalendarItemType } from '@afc/shared'
import { CALENDAR_TYPE_META, calendarDotClass, calendarPillClass } from '@afc/shared'
import {
  isCalendarView,
  isISODate,
  rangeForView,
  shiftFocused,
  todayISO,
} from '~/utils/calendar-ranges'
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
const scope = ref<'staff' | 'public'>(
  queryParam('scope') === 'public' ? 'public' : 'staff',
)
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

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query.item_type,
  (next: unknown) => {
    const value = typeof next === 'string' ? next : 'all'
    if (value !== itemType.value) itemType.value = value
  },
)

const typeOptions = [
  { label: 'All types', value: 'all' },
  { label: 'Services', value: 'service' },
  { label: 'Events', value: 'event' },
  { label: 'Programmes', value: 'programme' },
  { label: 'Celebrations', value: 'celebration' },
  { label: 'Birthdays', value: 'birthday' },
  { label: 'Anniversaries', value: 'anniversary' },
  { label: 'Tasks', value: 'task' },
  { label: 'Marriages', value: 'marriage' },
]

/* Legend chips (AFC-853): per-type counts; clicking a chip filters to
 * that type, clicking again clears back to all. */
const legendCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {
    service: 0,
    event: 0,
    programme: 0,
    celebration: 0,
    birthday: 0,
    anniversary: 0,
    task: 0,
    marriage: 0,
  }
  for (const row of rows.value) {
    if (row.item_type in counts) counts[row.item_type]! += 1
  }
  return counts
})

function toggleType(type: string): void {
  itemType.value = itemType.value === type ? 'all' : type
}

/**
 * Category checklist (AFC-879, Kargul reference): staff show/hide whole
 * categories without changing the shareable item_type link. Persisted per
 * browser; unknown stored values are dropped so a future type never
 * hides by accident.
 */
const HIDDEN_KEY = 'afc-calendar-hidden-types'
const ALL_TYPES = [
  'service',
  'event',
  'programme',
  'celebration',
  'birthday',
  'anniversary',
  'task',
  'marriage',
]
const hiddenTypes = ref<string[]>([])
if (import.meta.client) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]')
    if (Array.isArray(stored)) {
      hiddenTypes.value = stored.filter(
        (entry: unknown): entry is string =>
          typeof entry === 'string' && ALL_TYPES.includes(entry),
      )
    }
  } catch {
    hiddenTypes.value = []
  }
}

function toggleHidden(type: string): void {
  hiddenTypes.value = hiddenTypes.value.includes(type)
    ? hiddenTypes.value.filter((entry: string) => entry !== type)
    : [...hiddenTypes.value, type]
  if (import.meta.client) {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hiddenTypes.value))
    } catch {
      /* Storage full or blocked: the session choice still applies. */
    }
  }
}

/** Rows after the checklist hides categories (legend + grid follow). */
const shownRows = computed<CalendarViewItem[]>(() =>
  hiddenTypes.value.length === 0
    ? rows.value
    : rows.value.filter(
        (row: CalendarViewItem) => !hiddenTypes.value.includes(row.item_type),
      ),
)

/* Keyboard (AFC-853, Kargul reference): T today, arrows move, M/W/D/L/Y
 * switch views. Ignored while typing in a field. */
function onCalendarKeys(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  )
    return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const key = e.key.toLowerCase()
  if (key === 't') focused.value = todayISO()
  else if (key === 'arrowleft')
    focused.value = shiftFocused(view.value, focused.value, -1)
  else if (key === 'arrowright')
    focused.value = shiftFocused(view.value, focused.value, 1)
  else if (key === 'm') view.value = 'month'
  else if (key === 'w') view.value = 'week'
  else if (key === 'd') view.value = 'day'
  else if (key === 'l') view.value = 'list'
  else if (key === 'y') view.value = 'year'
}

onMounted(() => {
  window.addEventListener('keydown', onCalendarKeys)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onCalendarKeys)
})

/** Dashboard strip (AFC-588): client-side range totals, no new backend. */
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

const stripItems = computed(() => {
  const all = shownRows.value
  const count = (type: string) =>
    all.filter((row: CalendarViewItem) => row.item_type === type).length
  const base = `?view=${view.value}&date=${focused.value}`
  return [
    {
      label: 'Entries',
      value: all.length,
      to: `/calendar${base}`,
      hint: 'Open filtered view',
    },
    {
      label: 'Services',
      value: count('service'),
      to: `/calendar${base}&item_type=service`,
      hint: 'Open filtered view',
    },
    {
      label: 'Events',
      value: count('event'),
      to: `/calendar${base}&item_type=event`,
      hint: 'Open filtered view',
    },
    {
      label: 'Celebrations',
      value: count('celebration'),
      to: `/calendar${base}&item_type=celebration`,
      hint: 'Open filtered view',
    },
  ]
})
</script>

<template>
  <div>
    <PageHeader
      title="Calendar"
      description="Services, events, programmes and celebrations in your scope. Select an entry for its detail."
    />

    <DashboardStrip :items="stripItems" />

    <div class="mt-3 flex flex-wrap items-center gap-1.5" aria-label="Entry type legend">
      <button
        v-for="(meta, type) in CALENDAR_TYPE_META"
        :key="type"
        type="button"
        class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
        :class="
          itemType === type
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
            : 'border-gray-200 dark:border-gray-800'
        "
        :aria-pressed="itemType === type"
        @click="toggleType(type)"
      >
        <span :class="['size-2 rounded-full', calendarDotClass(type)]" />
        {{ meta.label }}
        <span class="text-gray-500 dark:text-gray-400">{{
          legendCounts[type] ?? 0
        }}</span>
      </button>
      <span class="ml-auto hidden text-[11px] text-gray-400 sm:inline">
        T today · ←/→ move · M/W/D/L/Y views
      </span>
    </div>

    <div
      class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300"
      aria-label="Show or hide categories"
    >
      <span class="font-medium text-gray-500 dark:text-gray-400">Show:</span>
      <label
        v-for="type in ALL_TYPES"
        :key="type"
        class="inline-flex cursor-pointer items-center gap-1.5"
      >
        <input
          type="checkbox"
          :checked="!hiddenTypes.includes(type)"
          class="size-3.5 accent-primary-600"
          :aria-label="`Show ${CALENDAR_TYPE_META[type]?.label ?? type}`"
          @change="toggleHidden(type)"
        />
        <span
          class="inline-block size-2 rounded-full"
          :class="calendarDotClass(type)"
          aria-hidden="true"
        />
        {{ CALENDAR_TYPE_META[type]?.label ?? type }}
      </label>
    </div>

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
        <NuxtLink
          to="/calendar/public"
          class="text-primary-600 hover:underline dark:text-primary-400"
        >
          Open the public calendar
        </NuxtLink>
      </p>

      <CalendarViews
        v-model:view="view"
        v-model:focused="focused"
        :items="shownRows"
        :pending="pending"
        class="mt-4"
      >
        <template #row="{ item }">
          <NuxtLink
            v-if="item.href"
            :to="String(item.href)"
            :class="[
              'block truncate rounded px-1.5 py-0.5 font-medium hover:underline',
              calendarPillClass(item.item_type),
            ]"
          >
            {{ item.title }}
          </NuxtLink>
          <span
            v-else
            :class="[
              'block truncate rounded px-1.5 py-0.5 font-medium',
              calendarPillClass(item.item_type),
            ]"
          >
            {{ item.title }}
          </span>
        </template>
      </CalendarViews>
    </UCard>
  </div>
</template>
