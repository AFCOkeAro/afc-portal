<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { AttendanceSessionRow, BranchSummary, Paginated } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const type = ref('all')
/** Drill-down contract: dashboard/branch pages link here with ?branch=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const branch = ref(queryParam('branch') ?? 'all')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([type, branch, search], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const typeNext = typeof next.session_type === 'string' ? next.session_type : null
    if (typeNext && typeNext !== type.value) type.value = typeNext
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(type.value !== 'all' ? { session_type: type.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'attendance-list',
  () =>
    api.get<Paginated<AttendanceSessionRow>>('/api/attendance', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('attendance-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countSessions(params: Record<string, string>): Promise<number> {
  const res = await api.get<Paginated<AttendanceSessionRow>>('/api/attendance', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('attendance-strip', () =>
  Promise.all([
    countSessions({}),
    countSessions({ session_type: 'sunday_service' }),
    countSessions({ session_type: 'midweek' }),
    countSessions({ session_type: 'event' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Sessions',
    value: stripCounts.value?.[0] ?? null,
    to: '/attendance',
    hint: 'Open filtered list',
  },
  {
    label: 'Sunday service',
    value: stripCounts.value?.[1] ?? null,
    to: '/attendance?session_type=sunday_service',
    hint: 'Open filtered list',
  },
  {
    label: 'Midweek',
    value: stripCounts.value?.[2] ?? null,
    to: '/attendance?session_type=midweek',
    hint: 'Open filtered list',
  },
  {
    label: 'Event sessions',
    value: stripCounts.value?.[3] ?? null,
    to: '/attendance?session_type=event',
    hint: 'Open filtered list',
  },
])

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const typeOptions = [
  { label: 'Any session type', value: 'all' },
  { label: 'Sunday service', value: 'sunday_service' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Event', value: 'event' },
  { label: 'Camp', value: 'camp' },
  { label: 'Department', value: 'department' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function typeLabel(value: string): string {
  return value.replace(/_/g, ' ')
}
</script>

<template>
  <div>
    <PageHeader
      title="Attendance"
      description="Sunday services, midweek, camps and department sessions."
    >
      <template #actions>
        <UButton
          to="/attendance/report"
          color="neutral"
          variant="outline"
          icon="i-lucide-chart-column"
          label="Reports"
        />
        <PermissionGate :collection="COLLECTIONS.attendanceSessions" action="create">
          <UButton
            label="Capture headcount"
            icon="i-lucide-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search sessions"
          aria-label="Search attendance sessions"
        />
        <USelect v-model="type" :items="typeOptions" class="w-full" />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load attendance"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No attendance sessions match these filters"
        description="Capture the first headcount for this branch."
      >
        <PermissionGate :collection="COLLECTIONS.attendanceSessions" action="create">
          <UButton class="mt-4" label="Capture headcount" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Session</th>
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Men</th>
              <th class="px-3 py-2 font-medium">Women</th>
              <th class="px-3 py-2 font-medium">Children</th>
              <th class="px-3 py-2 font-medium">Total</th>
              <th class="px-3 py-2 font-medium">Checked in</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="session in rows"
              :key="session.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/attendance/${session.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ session.session_name }}
                </NuxtLink>
                <p class="text-xs capitalize text-gray-500 dark:text-gray-400">
                  {{ typeLabel(session.session_type) }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(session.session_date) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ session.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 tabular-nums">{{ session.headcount_men ?? 0 }}</td>
              <td class="px-3 py-3 tabular-nums">{{ session.headcount_women ?? 0 }}</td>
              <td class="px-3 py-3 tabular-nums">
                {{ session.headcount_children ?? 0 }}
              </td>
              <td class="px-3 py-3 font-semibold tabular-nums">
                {{ session.headcount_total ?? 0 }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ session.records_count }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/attendance/${session.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open session"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} sessions · page {{ page }} of {{ pageCount }}
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Previous"
            :disabled="page <= 1"
            @click="page -= 1"
          />
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Next"
            :disabled="page >= pageCount"
            @click="page += 1"
          />
        </div>
      </div>
    </UCard>

    <AttendanceFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
