<script setup lang="ts">
import type { CalendarItemType } from '@afc/shared'
import {
  isCalendarView,
  isISODate,
  rangeForView,
  todayISO,
} from '~/utils/calendar-ranges'
import type { CalendarView, CalendarViewItem } from '~/utils/calendar-ranges'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()
const auth = useAuth()

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

/**
 * Category checklist (AFC-879): staff show/hide each feed category.
 * Persisted per staff member in localStorage under their user id — a UI
 * preference only, never a credential — so one person's hidden categories
 * never affect another's view. A legacy `?item_type=X` deep link narrows
 * the checklist to that single category.
 */
const CATEGORY_TYPES: Array<{ value: CalendarItemType; label: string }> = [
  { value: 'service', label: 'Services' },
  { value: 'event', label: 'Events' },
  { value: 'programme', label: 'Programmes' },
  { value: 'celebration', label: 'Celebrations' },
  { value: 'birthday', label: 'Birthdays' },
  { value: 'anniversary', label: 'Anniversaries' },
  { value: 'task', label: 'Tasks' },
  { value: 'meeting', label: 'Meetings' },
]
const ALL_CATEGORIES = CATEGORY_TYPES.map((entry) => entry.value)

function storageKey(): string {
  const userId = auth.user.value?.id
  return `afc:calendar-categories:${userId ?? 'anon'}`
}

function initialCategories(): CalendarItemType[] {
  const single = queryParam('item_type')
  if (single && (ALL_CATEGORIES as string[]).includes(single)) {
    return [single as CalendarItemType]
  }
  if (import.meta.client) {
    try {
      const stored = window.localStorage.getItem(storageKey())
      if (stored) {
        const parsed = JSON.parse(stored) as unknown
        if (Array.isArray(parsed)) {
          const kept = parsed.filter((value): value is CalendarItemType =>
            (ALL_CATEGORIES as string[]).includes(String(value)),
          )
          if (kept.length > 0) return kept
        }
      }
    } catch {
      // A corrupt preference never breaks the calendar: fall through to all.
    }
  }
  return [...ALL_CATEGORIES]
}

const checkedTypes = ref<CalendarItemType[]>(initialCategories())

/** Persist the checklist per staff member (AFC-879). */
watch(checkedTypes, (next: CalendarItemType[]) => {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(next))
  } catch {
    // Storage full/blocked: the checklist still works for this session.
  }
})

function toggleCategory(type: CalendarItemType, on: boolean): void {
  if (on) {
    if (!checkedTypes.value.includes(type)) {
      checkedTypes.value = [...checkedTypes.value, type]
    }
  } else {
    checkedTypes.value = checkedTypes.value.filter(
      (entry: CalendarItemType) => entry !== type,
    )
  }
}

function showAllCategories(): void {
  checkedTypes.value = [...ALL_CATEGORIES]
}

/** The feed is paged per visible range (server cap of 200 unchanged). */
const range = computed(() => rangeForView(view.value, focused.value))
const endpoint = computed(() =>
  scope.value === 'public' ? '/api/calendar/public' : '/api/calendar',
)
/** Fetch every category for the window; the checklist filters client-side so
 * legend counts and the grid always agree on the visible set. */
const query = computed(() => ({
  date_from: range.value.from,
  date_to: range.value.to,
}))
const { data, pending } = await useAsyncData(
  'calendar-feed',
  () =>
    api.get<{ data: Record<string, unknown>[] }>(endpoint.value, { query: query.value }),
  { watch: [query, endpoint] },
)

/** Keep the URL behind the state so every view is a shareable link. */
watch([view, focused, scope, checkedTypes], () => {
  router.replace({
    query: {
      view: view.value,
      date: focused.value,
      ...(scope.value === 'public' ? { scope: 'public' } : {}),
      ...(checkedTypes.value.length === 1 ? { item_type: checkedTypes.value[0] } : {}),
    },
  })
})

/** Same-page strip navigation (AFC-588): query-only link, sync the checklist. */
watch(
  () => route.query.item_type,
  (next: unknown) => {
    const value = typeof next === 'string' ? next : ''
    if (value && (ALL_CATEGORIES as string[]).includes(value)) {
      const single = value as CalendarItemType
      if (checkedTypes.value.length !== 1 || checkedTypes.value[0] !== single) {
        checkedTypes.value = [single]
      }
    }
  },
)

/** All fetched rows, before the checklist filter. */
const allRows = computed<CalendarViewItem[]>(() =>
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

/** Visible rows: the checklist filter. The renderer and its legend both read
 * this list, so legend counts always follow the visible set (AFC-879). */
const rows = computed<CalendarViewItem[]>(() => {
  if (scope.value === 'public') return allRows.value
  const visible = new Set<string>(checkedTypes.value)
  return allRows.value.filter((row: CalendarViewItem) => visible.has(row.item_type))
})

const countFor = (type: string): number =>
  allRows.value.filter((row: CalendarViewItem) => row.item_type === type).length

const stripItems = computed(() => {
  const base = `?view=${view.value}&date=${focused.value}`
  return [
    {
      label: 'Entries',
      value: allRows.value.length,
      to: `/calendar${base}`,
      hint: 'Open filtered view',
    },
    ...CATEGORY_TYPES.map((entry) => ({
      label: entry.label,
      value: countFor(entry.value),
      to: `/calendar${base}&item_type=${entry.value}`,
      hint: 'Open filtered view',
    })),
  ]
})
</script>

<template>
  <div>
    <PageHeader
      title="Calendar"
      description="Services, events, programmes, celebrations, birthdays, anniversaries, tasks and meetings in your scope. Select an entry for its detail."
    />

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="flex flex-wrap items-center gap-3">
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
            :variant="scope === 'public' ? 'ghost' : 'solid'"
            @click="scope = 'public'"
          />
        </div>
        <UButton
          v-if="scope === 'staff'"
          label="Show all categories"
          size="sm"
          color="neutral"
          variant="ghost"
          @click="showAllCategories"
        />
      </div>

      <!-- Category checklist (AFC-879): staff show/hide feed categories.
           Staff scope only — the public preview is events-only. -->
      <fieldset
        v-if="scope === 'staff'"
        class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        <legend class="sr-only">Calendar categories</legend>
        <label
          v-for="entry in CATEGORY_TYPES"
          :key="entry.value"
          class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-gray-200"
        >
          <input
            type="checkbox"
            class="size-4 rounded border-gray-300"
            :checked="checkedTypes.includes(entry.value)"
            @change="
              toggleCategory(entry.value, ($event.target as HTMLInputElement).checked)
            "
          />
          {{ entry.label }} ({{ countFor(entry.value) }})
        </label>
      </fieldset>

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
