<script setup lang="ts">
import {
  countByType,
  dayNumber,
  isSameMonth,
  monthDays,
  monthGrid,
  monthLeadingOffset,
  monthTitle,
  parseISODate,
  shiftFocused,
  todayISO,
  weekDays,
  yearMonths,
} from '~/utils/calendar-ranges'
import type { CalendarView, CalendarViewItem } from '~/utils/calendar-ranges'

/**
 * Shared calendar renderer for the staff (/calendar) and public
 * (/calendar/public) pages (AFC-575).
 *
 * The page owns the state (view + focused date, deep-linked in the query)
 * and the feed; this component owns only rendering. `v-model:view` and
 * `v-model:focused` carry the switcher and prev/today/next navigation back
 * to the page, which refetches the feed for the new window.
 *
 * Row rendering is a scoped `row` slot so each page keeps its own link
 * policy: staff rows link to detail pages via `href`, public rows are plain
 * text (the public feed carries no hrefs). The default slot content renders
 * a link when `href` is present and plain text otherwise.
 */
const props = defineProps<{
  view: CalendarView
  focused: string
  items: CalendarViewItem[]
  pending: boolean
}>()

const emit = defineEmits<{
  'update:view': [view: CalendarView]
  'update:focused': [focused: string]
}>()

const viewOptions = [
  { label: 'Year', value: 'year' },
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
  { label: 'Day', value: 'day' },
  { label: 'List', value: 'list' },
]

const selectedView = computed({
  get: () => props.view,
  set: (value: CalendarView) => emit('update:view', value),
})

function go(dir: -1 | 1): void {
  emit('update:focused', shiftFocused(props.view, props.focused, dir))
}

function goToday(): void {
  emit('update:focused', todayISO())
}

function openDay(iso: string): void {
  emit('update:focused', iso)
  emit('update:view', 'day')
}

function openMonth(monthStart: string): void {
  emit('update:focused', monthStart)
  emit('update:view', 'month')
}

const byDate = computed(() => {
  const map = new Map<string, CalendarViewItem[]>()
  for (const item of props.items) {
    const list = map.get(item.date) ?? []
    list.push(item)
    map.set(item.date, list)
  }
  return map
})

function itemsOn(iso: string): CalendarViewItem[] {
  return byDate.value.get(iso) ?? []
}

function countInMonth(monthStart: string): number {
  const prefix = monthStart.slice(0, 7)
  return props.items.filter((item) => item.date.startsWith(prefix)).length
}

/**
 * Colour by calendar/item_type (AFC-865, Tithe.ly-style coloured blocks +
 * week pastel pills). One map owns every coloured surface — legend dots,
 * month blocks, week pills, day badges and year mini-month dots — so the
 * legend can never drift from the grid.
 */
const TYPE_META: Record<string, { label: string; dot: string; pill: string; bar: string }> = {
  service: {
    label: 'Services',
    dot: 'bg-blue-500',
    pill: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    bar: 'border-blue-500',
  },
  event: {
    label: 'Events',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    bar: 'border-emerald-500',
  },
  programme: {
    label: 'Programmes',
    dot: 'bg-amber-500',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    bar: 'border-amber-500',
  },
  celebration: {
    label: 'Celebrations',
    dot: 'bg-rose-500',
    pill: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
    bar: 'border-rose-500',
  },
}

const TYPE_ORDER = ['service', 'event', 'programme', 'celebration']

function typeMeta(type: string): { label: string; dot: string; pill: string; bar: string } {
  return (
    TYPE_META[type] ?? {
      label: type,
      dot: 'bg-gray-400',
      pill: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
      bar: 'border-gray-400',
    }
  )
}

/** Legend counts across the whole fetched window. */
const legendCounts = computed(() => countByType(props.items))

/** Distinct item types scheduled on one date (stable order for dots). */
function typesOn(iso: string): string[] {
  const seen = new Set<string>()
  for (const item of itemsOn(iso)) seen.add(item.item_type)
  return TYPE_ORDER.filter((type: string) => seen.has(type))
}

/** Per-type chips for one Year mini-month (type + count, non-empty only). */
function monthChips(monthStart: string): { type: string; count: number }[] {
  const counts = countByType(props.items, monthStart.slice(0, 7))
  return TYPE_ORDER.filter((type: string) => (counts[type] ?? 0) > 0).map(
    (type: string) => ({ type, count: counts[type] ?? 0 }),
  )
}

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const shortFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
})

function formatLong(iso: string): string {
  return dayFormatter.format(parseISODate(iso))
}

function formatShort(iso: string): string {
  return shortFormatter.format(parseISODate(iso))
}

function formatTime(startsAt: string | null | undefined): string | null {
  if (!startsAt || startsAt.length < 16) return null
  return startsAt.slice(11, 16)
}

const viewTitle = computed(() => {
  if (props.view === 'year') return props.focused.slice(0, 4)
  if (props.view === 'month') return monthTitle(props.focused)
  if (props.view === 'day') return formatLong(props.focused)
  if (props.view === 'week') {
    const days = weekDays(props.focused)
    const first = days[0] ?? props.focused
    const last = days[6] ?? props.focused
    return `${formatShort(first)} – ${formatShort(last)} ${props.focused.slice(0, 4)}`
  }
  return `From ${formatShort(props.focused)} · 30 days`
})

const listGroups = computed(() => {
  const groups = new Map<string, CalendarViewItem[]>()
  for (const item of [...props.items].sort((a, b) => a.date.localeCompare(b.date))) {
    const list = groups.get(item.date) ?? []
    list.push(item)
    groups.set(item.date, list)
  }
  return [...groups.entries()]
})

const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthShort = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

function isToday(iso: string): boolean {
  return iso === todayISO()
}
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="selectedView"
        :items="viewOptions"
        class="w-32"
        aria-label="Calendar view"
      />
      <div class="flex items-center gap-1">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-left"
          aria-label="Previous period"
          @click="go(-1)"
        />
        <UButton color="neutral" variant="ghost" label="Today" @click="goToday" />
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-chevron-right"
          aria-label="Next period"
          @click="go(1)"
        />
      </div>
      <h2 class="ml-1 text-sm font-semibold text-gray-700 dark:text-gray-200">
        {{ viewTitle }}
      </h2>
    </div>

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else>
      <!-- Legend: colour key by calendar/item_type with window totals. -->
      <div
        class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300"
        aria-label="Calendar colour legend"
      >
        <span
          v-for="type in TYPE_ORDER"
          :key="type"
          class="inline-flex items-center gap-1.5"
        >
          <span
            class="inline-block size-2.5 rounded-full"
            :class="typeMeta(type).dot"
            aria-hidden="true"
          />
          {{ typeMeta(type).label }} ({{ legendCounts[type] ?? 0 }})
        </span>
      </div>

      <!-- Year: twelve full-month grids (every day 1–31 with its number;
           event days carry colourful per-type dots). -->
      <div
        v-if="view === 'year'"
        class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        <section
          v-for="monthStart in yearMonths(focused)"
          :key="monthStart"
          class="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          :aria-label="`${monthTitle(monthStart)} full calendar`"
        >
          <div class="flex items-baseline justify-between gap-2">
            <button
              type="button"
              class="text-sm font-semibold text-gray-900 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-primary-500 dark:text-white"
              @click="openMonth(monthStart)"
            >
              {{ monthShort[Number(monthStart.slice(5, 7)) - 1] }}
              {{ monthStart.slice(0, 4) }}
            </button>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ countInMonth(monthStart) }} entries
            </span>
          </div>
          <div
            class="mt-2 grid grid-cols-7 text-center text-[10px] font-medium text-gray-400"
          >
            <span v-for="day in weekdayNames" :key="day" class="py-0.5">{{
              day.slice(0, 1)
            }}</span>
          </div>
          <div class="grid grid-cols-7 text-center">
            <span
              v-for="blank in monthLeadingOffset(monthStart)"
              :key="`blank-${blank}`"
              aria-hidden="true"
            />
            <button
              v-for="iso in monthDays(monthStart)"
              :key="iso"
              type="button"
              class="flex flex-col items-center py-0.5 text-[11px] leading-tight text-gray-700 hover:text-primary-600 focus-visible:outline-2 focus-visible:outline-primary-500 dark:text-gray-200"
              :class="[
                isToday(iso)
                  ? 'rounded bg-primary-50 font-bold text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                  : '',
              ]"
              :aria-label="`Open ${iso} (${itemsOn(iso).length} entries)`"
              @click="openDay(iso)"
            >
              <span>{{ dayNumber(iso) }}</span>
              <span
                v-if="typesOn(iso).length > 0"
                class="flex items-center gap-0.5"
                aria-hidden="true"
              >
                <span
                  v-for="type in typesOn(iso)"
                  :key="type"
                  class="inline-block size-1.5 rounded-full"
                  :class="typeMeta(type).dot"
                />
              </span>
              <span v-else class="h-1.5" aria-hidden="true" />
            </button>
          </div>
          <div
            v-if="countInMonth(monthStart) > 0"
            class="mt-2 flex flex-wrap gap-1"
            aria-hidden="true"
          >
            <span
              v-for="chip in monthChips(monthStart)"
              :key="chip.type"
              class="inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px]"
              :class="typeMeta(chip.type).pill"
            >
              <span
                class="inline-block size-1.5 rounded-full"
                :class="typeMeta(chip.type).dot"
              />
              {{ chip.count }}
            </span>
          </div>
        </section>
      </div>

      <!-- Month: Monday-first grid, every date cell renders its number even
           when empty (AFC-865). Coloured left-border blocks per calendar. -->
      <div v-else-if="view === 'month'" class="mt-4 overflow-x-auto">
        <div class="min-w-[560px]">
          <div
            class="grid grid-cols-7 text-center text-xs font-medium text-gray-500 dark:text-gray-400"
          >
            <span v-for="day in weekdayNames" :key="day" class="py-1">{{ day }}</span>
          </div>
          <div
            v-for="(week, weekIndex) in monthGrid(focused)"
            :key="weekIndex"
            class="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800"
          >
            <div
              v-for="iso in week"
              :key="iso"
              class="min-h-20 bg-white p-1.5 dark:bg-gray-950"
              :class="{ 'opacity-50': !isSameMonth(iso, focused) }"
            >
              <button
                type="button"
                class="text-xs font-medium focus-visible:outline-2 focus-visible:outline-primary-500"
                :class="
                  isToday(iso)
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-700 dark:text-gray-200'
                "
                :aria-label="`Open ${iso}`"
                @click="openDay(iso)"
              >
                {{ dayNumber(iso) }}
              </button>
              <ul class="mt-1 space-y-0.5">
                <li
                  v-for="item in itemsOn(iso).slice(0, 3)"
                  :key="`${item.item_type}-${item.id}`"
                  class="truncate rounded border-l-2 px-1 text-xs"
                  :class="typeMeta(item.item_type).bar"
                >
                  <slot name="row" :item="item">
                    <NuxtLink
                      v-if="item.href"
                      :to="item.href"
                      class="hover:text-primary-600 dark:hover:text-primary-400"
                    >
                      {{ item.title }}
                    </NuxtLink>
                    <span v-else>{{ item.title }}</span>
                  </slot>
                </li>
              </ul>
              <button
                v-if="itemsOn(iso).length > 3"
                type="button"
                class="mt-0.5 text-[11px] text-primary-600 hover:underline dark:text-primary-400"
                @click="openDay(iso)"
              >
                +{{ itemsOn(iso).length - 3 }} more
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Week: seven day columns; every day renders, empty days keep their
           number with a "No entries" note (AFC-865). Pastel pills per type. -->
      <div v-else-if="view === 'week'" class="mt-4 overflow-x-auto">
        <div class="grid min-w-[640px] grid-cols-7 gap-2">
          <div
            v-for="(iso, dayIndex) in weekDays(focused)"
            :key="iso"
            class="rounded-lg border border-gray-200 p-2 dark:border-gray-800"
            :class="{ 'border-primary-400 dark:border-primary-500': isToday(iso) }"
          >
            <button
              type="button"
              class="text-xs font-semibold focus-visible:outline-2 focus-visible:outline-primary-500"
              :class="
                isToday(iso)
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-700 dark:text-gray-200'
              "
              @click="openDay(iso)"
            >
              {{ weekdayNames[dayIndex] }} {{ dayNumber(iso) }}
            </button>
            <ul class="mt-2 space-y-1">
              <li
                v-for="item in itemsOn(iso)"
                :key="`${item.item_type}-${item.id}`"
                class="rounded-md px-1.5 py-1 text-xs"
                :class="typeMeta(item.item_type).pill"
              >
                <span
                  v-if="formatTime(item.starts_at)"
                  class="font-mono text-gray-500 dark:text-gray-400"
                >
                  {{ formatTime(item.starts_at) }}
                </span>
                <slot name="row" :item="item">
                  <NuxtLink
                    v-if="item.href"
                    :to="item.href"
                    class="hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    {{ item.title }}
                  </NuxtLink>
                  <span v-else>{{ item.title }}</span>
                </slot>
              </li>
            </ul>
            <p v-if="itemsOn(iso).length === 0" class="mt-2 text-[11px] text-gray-400">
              No entries
            </p>
          </div>
        </div>
      </div>

      <!-- Day: one column with times. -->
      <div v-else-if="view === 'day'" class="mt-4">
        <p class="text-sm text-gray-500 dark:text-gray-400">{{ formatLong(focused) }}</p>
        <ul class="mt-2 divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="item in itemsOn(focused)"
            :key="`${item.item_type}-${item.id}`"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
          >
            <UBadge variant="subtle" :class="typeMeta(item.item_type).pill">{{
              typeMeta(item.item_type).label
            }}</UBadge>
            <span
              v-if="formatTime(item.starts_at)"
              class="font-mono text-gray-500 dark:text-gray-400"
            >
              {{ formatTime(item.starts_at) }}
            </span>
            <slot name="row" :item="item">
              <NuxtLink
                v-if="item.href"
                :to="item.href"
                class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
              >
                {{ item.title }}
              </NuxtLink>
              <span v-else class="font-medium text-gray-900 dark:text-white">{{
                item.title
              }}</span>
            </slot>
          </li>
        </ul>
        <p
          v-if="itemsOn(focused).length === 0"
          class="mt-2 text-sm text-gray-500 dark:text-gray-400"
        >
          Nothing scheduled this day.
        </p>
      </div>

      <!-- List: grouped by date. Only this view keeps the empty state —
           month/week/day/year always render every date cell (AFC-865). -->
      <div v-else class="mt-4 space-y-5">
        <EmptyState
          v-if="listGroups.length === 0"
          title="No calendar entries in this window"
          description="Move to another period or pick another entry type."
        />
        <section v-for="[date, group] in listGroups" :key="date">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {{ formatLong(date) }}
          </h3>
          <ul class="mt-1 divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="item in group"
              :key="`${item.item_type}-${item.id}`"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
            >
              <UBadge variant="subtle" :class="typeMeta(item.item_type).pill">{{
                typeMeta(item.item_type).label
              }}</UBadge>
              <span
                v-if="formatTime(item.starts_at)"
                class="font-mono text-gray-500 dark:text-gray-400"
              >
                {{ formatTime(item.starts_at) }}
              </span>
              <slot name="row" :item="item">
                <NuxtLink
                  v-if="item.href"
                  :to="item.href"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ item.title }}
                </NuxtLink>
                <span v-else class="font-medium text-gray-900 dark:text-white">{{
                  item.title
                }}</span>
              </slot>
              <span v-if="item.branch_name" class="text-gray-500 dark:text-gray-400">
                {{ item.branch_name }}
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>
