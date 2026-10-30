<script setup lang="ts">
import type { PersonAttendanceHistory } from '~/types/portal'

/**
 * Per-person attendance history chart (AFC-597).
 *
 * Plain SVG bars over GET /api/people/:id/attendance — no chart
 * dependency. Defaults to the Sunday School filter (the user ask); the
 * select offers the full service-type set plus All. A bar links to its
 * session page only when the week holds exactly one attended session;
 * multi-session weeks render unlinked and the session links live in the
 * list under the chart.
 */
const props = defineProps<{
  personId: string
  /**
   * Compact chart with an external Enlarge affordance (AFC-929, approved
   * mockup v3). False keeps the 120px compact bar chart; true grows it to
   * 190px and reveals the per-week present/absent counts. Owned by the
   * profile page header button so the control sits beside the card title.
   */
  expanded?: boolean
}>()

const api = useApi()

const filterOptions = [
  { label: 'Sunday School', value: 'sunday_school' },
  { label: 'All types', value: 'all' },
  { label: 'Elementary', value: 'elementary' },
  { label: 'Devotional', value: 'devotional' },
  { label: 'Youth service', value: 'youth_service' },
  { label: 'Revival service', value: 'revival_service' },
  { label: 'Sunday service', value: 'sunday_service' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Event', value: 'event' },
  { label: 'Camp', value: 'camp' },
  { label: 'Department', value: 'department' },
  { label: 'Special', value: 'special' },
] as const

const filter = ref<string>('sunday_school')
const weeks = ref<number>(12)

const weekOptions = [
  { label: 'Last 6 weeks', value: 6 },
  { label: 'Last 12 weeks', value: 12 },
  { label: 'Last 26 weeks', value: 26 },
]

const query = computed(() => ({
  weeks: weeks.value,
  ...(filter.value !== 'all' ? { session_type: filter.value } : {}),
}))

const { data, pending, error } = await useAsyncData(
  `person-attendance-${props.personId}`,
  () =>
    api
      .get<{ data: PersonAttendanceHistory }>(
        `/api/people/${props.personId}/attendance`,
        {
          query: query.value,
        },
      )
      .then((res) => res.data),
  { watch: [query] },
)

const maxHeld = computed(() =>
  Math.max(1, ...(data.value?.buckets.map((bucket) => bucket.sessions_held) ?? [1])),
)

function barHeight(bucket: { sessions_held: number }): number {
  return Math.max(
    bucket.sessions_held > 0 ? 12 : 4,
    (bucket.sessions_held / maxHeld.value) * 96,
  )
}

/** Session href for a week with exactly one attended session, else null. */
function weekHref(weekStart: string): string | null {
  const rows = (data.value?.sessions ?? []).filter(
    (session) => mondayOf(session.session_date) === weekStart,
  )
  if (rows.length !== 1) return null
  const only = rows[0]
  return only ? only.href : null
}

function mondayOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return day
  const offset = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - offset * 86_400_000).toISOString().slice(0, 10)
}

function shortLabel(weekStart: string): string {
  return weekStart.slice(5)
}

const summary = computed(() => {
  const totals = data.value?.totals
  if (!totals) return ''
  if (totals.sessions_held === 0) return 'No sessions held in scope for this window.'
  const pct = totals.rate === null ? '—' : `${Math.round(totals.rate * 100)}%`
  return `${totals.sessions_attended} of ${totals.sessions_held} sessions · ${totals.weeks_present} weeks present (${pct})`
})
</script>

<template>
  <div id="person-attendance-chart">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <USelect
        v-model="filter"
        :items="filterOptions"
        size="xs"
        aria-label="Session type filter"
        class="w-40"
      />
      <USelect
        v-model="weeks"
        :items="weekOptions"
        size="xs"
        aria-label="Week window"
        class="w-36"
      />
      <span class="ml-auto text-xs tabular-nums text-gray-500 dark:text-gray-400">
        {{ summary }}
      </span>
    </div>

    <div v-if="pending" class="flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load attendance history"
      :description="error.message"
    />

    <template v-else-if="data">
      <EmptyState
        v-if="data.totals.sessions_held === 0"
        title="No sessions in this window"
        description="No scoped sessions of this type were held in the selected weeks."
      />
      <figure v-else role="img" :aria-label="`Weekly attendance: ${summary}`">
        <svg
          viewBox="0 0 360 120"
          class="w-full"
          :style="{ height: props.expanded ? '190px' : '120px' }"
          role="presentation"
          data-testid="person-attendance-chart"
        >
          <g v-for="(bucket, index) in data.buckets" :key="bucket.week_start">
            <a
              v-if="weekHref(bucket.week_start)"
              :href="weekHref(bucket.week_start) ?? undefined"
            >
              <rect
                :x="8 + index * (344 / data.buckets.length)"
                :y="110 - barHeight(bucket)"
                :width="Math.max(4, 344 / data.buckets.length - 4)"
                :height="barHeight(bucket)"
                rx="2"
                :class="
                  bucket.present ? 'fill-primary-500' : 'fill-gray-200 dark:fill-gray-700'
                "
              >
                <title>
                  {{ shortLabel(bucket.week_start) }}:
                  {{ bucket.present ? 'present' : 'absent' }} ({{ bucket.sessions_held }}
                  held)
                </title>
              </rect>
            </a>
            <rect
              v-else
              :x="8 + index * (344 / data.buckets.length)"
              :y="110 - barHeight(bucket)"
              :width="Math.max(4, 344 / data.buckets.length - 4)"
              :height="barHeight(bucket)"
              rx="2"
              :class="
                bucket.present ? 'fill-primary-500' : 'fill-gray-200 dark:fill-gray-700'
              "
            >
              <title>
                {{ shortLabel(bucket.week_start) }}:
                {{ bucket.present ? 'present' : 'absent' }} ({{ bucket.sessions_held }}
                held)
              </title>
            </rect>
          </g>
        </svg>
        <figcaption
          class="mt-1 flex justify-between text-[11px] text-gray-500 dark:text-gray-400"
        >
          <span>{{ shortLabel(data.buckets[0]?.week_start ?? '') }}</span>
          <span>{{
            shortLabel(data.buckets[data.buckets.length - 1]?.week_start ?? '')
          }}</span>
        </figcaption>
      </figure>

      <ul
        v-if="props.expanded && data.totals.sessions_held > 0"
        aria-label="Per-week detail (expanded view)"
        class="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800"
      >
        <li
          v-for="bucket in data.buckets"
          :key="`count-${bucket.week_start}`"
          class="flex items-center justify-between gap-3 py-1.5"
        >
          <span class="text-gray-600 dark:text-gray-300">
            Week of {{ bucket.week_start }}
          </span>
          <span
            class="text-xs font-medium tabular-nums"
            :class="
              bucket.present
                ? 'text-green-700 dark:text-green-300'
                : 'text-gray-500 dark:text-gray-400'
            "
          >
            {{ bucket.present ? 'Present' : 'Absent' }}
          </span>
        </li>
      </ul>

      <ul v-if="data.sessions.length > 0" class="mt-3 space-y-1">
        <li
          v-for="session in data.sessions.slice(-5).reverse()"
          :key="session.id"
          class="flex items-center justify-between gap-3 text-sm"
        >
          <NuxtLink
            :to="session.href"
            class="truncate text-primary-600 hover:underline dark:text-primary-400"
          >
            {{ session.session_name }}
          </NuxtLink>
          <span class="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {{ session.session_date }}
          </span>
        </li>
      </ul>
    </template>
  </div>
</template>
