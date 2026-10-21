<script setup lang="ts">
import {
  dayNumber,
  isSameMonth,
  monthGrid,
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

    <EmptyState
      v-else-if="items.length === 0"
      title="No calendar entries in this window"
      description="Move to another period or pick another entry type."
    />

    <template v-else>
      <!-- Year: twelve month buttons with counts, drilling into month view. -->
      <div
        v-if="view === 'year'"
        class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      >
        <button
          v-for="monthStart in yearMonths(focused)"
          :key="monthStart"
          type="button"
          class="rounded-lg border border-gray-200 p-4 text-left hover:border-primary-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:border-gray-800 dark:hover:border-primary-500"
          @click="openMonth(monthStart)"
        >
          <span class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ monthShort[Number(monthStart.slice(5, 7)) - 1] }}
          </span>
          <span class="mt-1 block text-xs text-gray-500 dark:text-gray-400">
            {{ countInMonth(monthStart) }} entries
          </span>
        </button>
      </div>

      <!-- Month: Monday-first grid, padded weeks share the feed window. -->
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
                  class="truncate text-xs"
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

      <!-- Week: seven day columns. -->
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
                class="text-xs"
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
            <UBadge color="neutral" variant="subtle">{{ item.item_type }}</UBadge>
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

      <!-- List: grouped by date, the previous default rendering. -->
      <div v-else class="mt-4 space-y-5">
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
              <UBadge color="neutral" variant="subtle">{{ item.item_type }}</UBadge>
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
