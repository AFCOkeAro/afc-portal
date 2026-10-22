<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, EventRow, Paginated } from '~/types/portal'

/**
 * Programmes list (AFC-649 §A): card grid matching the reference —
 * Upcoming / Past sections, search + series/year filters, scope pill,
 * registration state + counts per card.
 *
 * Data path unchanged: GET /api/events (when/search/event_type/branch/
 * status, scope-filtered server-side). "Series" reuses the existing
 * `event_type` field and "year" is derived client-side from `start_at` —
 * no schema change (staging DDL is frozen, do not re-migrate).
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const series = ref('all')
const year = ref('all')
/* US-3 AC5: type (series), branch, status and date (Upcoming/Past) filters. */
const status = ref('all')
const branch = ref(
  typeof route.query.branch === 'string' && route.query.branch.length > 0
    ? route.query.branch
    : 'all',
)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

const baseQuery = computed(() => ({
  limit: 50,
  ...(search.value ? { search: search.value } : {}),
  ...(series.value !== 'all' ? { event_type: series.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
}))

const { data: upcoming, pending: upcomingPending } = await useAsyncData(
  'programmes-upcoming',
  () =>
    api.get<Paginated<EventRow>>('/api/events', {
      query: { ...baseQuery.value, page: 1, when: 'upcoming' },
    }),
  { watch: [baseQuery] },
)

const { data: past, pending: pastPending } = await useAsyncData(
  'programmes-past',
  () =>
    api.get<Paginated<EventRow>>('/api/events', {
      query: { ...baseQuery.value, page: 1, when: 'past' },
    }),
  { watch: [baseQuery] },
)

const branches = await useAsyncData('events-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'All in scope', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const seriesOptions = [
  { label: 'All series', value: 'all' },
  { label: 'Service', value: 'service' },
  { label: 'Summit', value: 'summit' },
  { label: 'Camp', value: 'camp' },
  { label: 'Training', value: 'training' },
  { label: 'Outreach', value: 'outreach' },
  { label: 'Social', value: 'social' },
  { label: 'Other', value: 'other' },
]

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Closed', value: 'closed' },
  { label: 'Cancelled', value: 'cancelled' },
]

function eventYear(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : String(date.getFullYear())
}

/** Year options come from the loaded rows — no new endpoint. */
const yearOptions = computed(() => {
  const years = new Set<string>()
  for (const row of [...(upcoming.value?.data ?? []), ...(past.value?.data ?? [])]) {
    const y = eventYear(row.start_at)
    if (y) years.add(y)
  }
  const sorted = [...years].sort().reverse()
  return [
    { label: 'Any year', value: 'all' },
    ...sorted.map((y) => ({ label: y, value: y })),
  ]
})

function inYear(row: EventRow): boolean {
  return year.value === 'all' || eventYear(row.start_at) === year.value
}

const upcomingRows = computed(() => (upcoming.value?.data ?? []).filter(inYear))
const pastRows = computed(() => (past.value?.data ?? []).filter(inYear))

const scopeLabel = computed(() => {
  if (branch.value === 'all') return 'Showing all in your scope'
  const match = (branches.data.value ?? []).find((row) => row.id === branch.value)
  return `Showing ${match?.name ?? 'selected branch'}`
})

function formatDates(row: EventRow): string {
  const start = new Date(row.start_at)
  const end = row.end_at ? new Date(row.end_at) : null
  const day = (date: Date): string =>
    date.toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  if (Number.isNaN(start.getTime())) return row.start_at
  if (!end || Number.isNaN(end.getTime()) || day(start) === day(end)) return day(start)
  const sameMonth =
    start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    return `${start.getDate()} – ${day(end)}`
  }
  return `${day(start)} – ${day(end)}`
}

/** "Tomorrow" badge (review item 7): starts within the next 30h, so the
 * day after tomorrow never reads "Tomorrow". */
function isImminent(row: EventRow): boolean {
  const start = new Date(row.start_at).getTime()
  if (Number.isNaN(start)) return false
  const delta = start - Date.now()
  return delta > 0 && delta < 30 * 3600 * 1000
}

function registrationState(row: EventRow): { label: string; open: boolean } {
  if (row.status === 'cancelled') return { label: 'Cancelled', open: false }
  if (row.status === 'closed') return { label: 'Registration closed', open: false }
  if (row.registration_open) return { label: 'Registration open', open: true }
  return { label: 'No registration', open: false }
}

function seriesLine(row: EventRow): string {
  const type = row.event_type
    ? row.event_type.charAt(0).toUpperCase() + row.event_type.slice(1)
    : 'Event'
  const y = eventYear(row.start_at)
  return y ? `${y} ${type}` : type
}

async function refreshAll(): Promise<void> {
  await Promise.all([
    refreshNuxtData('programmes-upcoming'),
    refreshNuxtData('programmes-past'),
  ])
}
</script>

<template>
  <div>
    <PageHeader
      title="Programmes"
      description="Plan, register, check in and report on every programme in one place."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.events" action="create">
          <UButton label="New programme" icon="i-lucide-plus" @click="showForm = true" />
        </PermissionGate>
      </template>
    </PageHeader>

    <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
      <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />{{ scopeLabel }}
    </p>

    <UCard>
      <div class="flex flex-col gap-3 lg:flex-row">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search by theme, name or code"
          aria-label="Search programmes"
          class="flex-1"
        />
        <div class="flex gap-3">
          <USelect
            v-model="series"
            :items="seriesOptions"
            aria-label="Filter by series"
          />
          <USelect v-model="year" :items="yearOptions" aria-label="Filter by year" />
          <USelect
            v-model="status"
            :items="statusOptions"
            aria-label="Filter by status"
          />
        </div>
      </div>
      <div class="mt-3">
        <EntitySelect
          v-model="branch"
          :items="branchOptions"
          placeholder="Select branch…"
          class="w-full sm:max-w-xs"
        />
      </div>
    </UCard>

    <div v-if="upcomingPending || pastPending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else>
      <section aria-label="Upcoming programmes" class="mt-6">
        <h2
          class="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          <UIcon name="i-lucide-calendar-days" class="size-4" />Upcoming
          <UBadge color="neutral" variant="subtle">{{ upcomingRows.length }}</UBadge>
        </h2>
        <EmptyState
          v-if="upcomingRows.length === 0"
          title="No upcoming programmes"
          description="Publish an event with a future start date and it will appear here."
        />
        <div v-else class="grid gap-4 md:grid-cols-2">
          <NuxtLink
            v-for="row in upcomingRows"
            :key="row.id"
            :to="`/events/${row.id}`"
            class="overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
          >
            <div
              class="relative h-24 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-950"
            >
              <UBadge
                v-if="isImminent(row)"
                color="neutral"
                variant="solid"
                size="xs"
                class="absolute right-3 top-3"
              >
                Tomorrow
              </UBadge>
            </div>
            <div class="space-y-1.5 p-4">
              <p class="font-semibold text-gray-900 dark:text-white">{{ row.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ seriesLine(row) }}
              </p>
              <p class="text-xs text-gray-600 dark:text-gray-300">
                <UIcon name="i-lucide-calendar" class="mr-1 inline size-3" />{{
                  formatDates(row)
                }}
              </p>
              <div
                class="flex items-center justify-between border-t border-gray-100 pt-2 text-xs dark:border-gray-800"
              >
                <UBadge
                  :color="registrationState(row).open ? 'success' : 'neutral'"
                  variant="subtle"
                >
                  {{ registrationState(row).label }}
                </UBadge>
                <p class="text-gray-500 dark:text-gray-400">
                  <span class="font-medium tabular-nums">{{ row.registered_count }}</span>
                  registered
                  <span class="ml-2 font-medium tabular-nums">{{
                    row.attended_count
                  }}</span>
                  in
                </p>
              </div>
            </div>
          </NuxtLink>
        </div>
      </section>

      <section aria-label="Past programmes" class="mt-8">
        <h2
          class="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-300"
        >
          <UIcon name="i-lucide-history" class="size-4" />Past
          <UBadge color="neutral" variant="subtle">{{ pastRows.length }}</UBadge>
        </h2>
        <EmptyState
          v-if="pastRows.length === 0"
          title="No past programmes"
          description="Finished programmes will appear here for reporting."
        />
        <div v-else class="grid gap-4 md:grid-cols-2">
          <NuxtLink
            v-for="row in pastRows"
            :key="row.id"
            :to="`/events/${row.id}`"
            class="overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
          >
            <div
              class="h-24 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-950"
            />
            <div class="space-y-1.5 p-4">
              <p class="font-semibold text-gray-900 dark:text-white">{{ row.title }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ seriesLine(row) }}
              </p>
              <p class="text-xs text-gray-600 dark:text-gray-300">
                <UIcon name="i-lucide-calendar" class="mr-1 inline size-3" />{{
                  formatDates(row)
                }}
              </p>
              <div class="border-t border-gray-100 pt-2 text-xs dark:border-gray-800">
                <UBadge color="neutral" variant="subtle">{{
                  registrationState(row).label
                }}</UBadge>
              </div>
            </div>
          </NuxtLink>
        </div>
      </section>
    </template>

    <EventFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refreshAll()"
    />
  </div>
</template>
