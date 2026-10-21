<script setup lang="ts">
import type {
  AttendanceReport,
  AttendanceReportGroup,
  AttendanceReportPeriod,
  BranchSummary,
} from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

const groupBy = ref<AttendanceReportGroup>('branch')
const sessionType = ref('all')
const period = ref<AttendanceReportPeriod>('monthly')
const dateFrom = ref(isoDaysAgo(90))
const dateTo = ref(isoToday())
const branch = ref('all')
const zone = ref('all')
const compare = ref(false)
const page = ref(1)
const limit = 25

const query = computed(() => ({
  group_by: groupBy.value,
  period: period.value,
  ...(sessionType.value !== 'all' ? { session_type: sessionType.value } : {}),
  ...(period.value === 'custom'
    ? { date_from: dateFrom.value, date_to: dateTo.value }
    : { date_to: dateTo.value }),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(zone.value !== 'all' ? { zone: zone.value } : {}),
  ...(compare.value ? { compare_prior_year: 'true' } : {}),
  page: page.value,
  limit,
}))

watch([groupBy, sessionType, period, dateFrom, dateTo, branch, zone, compare], () => {
  page.value = 1
})

const { data, pending, error, refresh } = await useAsyncData(
  'attendance-report',
  () => api.get<AttendanceReport>('/api/attendance/report', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('attendance-report-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const zoneOptions = computed(() => {
  const zones = new Map<string, string>()
  for (const row of branches.data.value ?? []) {
    if (row.zone) zones.set(row.zone, row.zone)
  }
  return [
    { label: 'All zones', value: 'all' },
    ...[...zones].map(([value]) => ({ label: value, value })),
  ]
})

const typeOptions = [
  { label: 'Any service type', value: 'all' },
  { label: 'Sunday School', value: 'sunday_school' },
  { label: 'Elementary', value: 'elementary' },
  { label: 'Devotional', value: 'devotional' },
  { label: 'Youth Service', value: 'youth_service' },
  { label: 'Revival Service', value: 'revival_service' },
  { label: 'Sunday Service', value: 'sunday_service' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Event', value: 'event' },
  { label: 'Camp', value: 'camp' },
  { label: 'Department', value: 'department' },
  { label: 'Special', value: 'special' },
]

const periodOptions = [
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Quarterly', value: 'quarterly' },
  { label: 'Yearly', value: 'yearly' },
  { label: 'Custom range', value: 'custom' },
]

const groupOptions = [
  { label: 'By branch', value: 'branch' },
  { label: 'By zone', value: 'zone' },
]

const totalPages = computed(() =>
  Math.max(1, Math.ceil((data.value?.meta.total ?? 0) / limit)),
)

const csvUrl = computed(() => {
  const params = new URLSearchParams(
    Object.fromEntries(
      Object.entries(query.value).map(([key, value]) => [key, String(value)]),
    ),
  )
  params.delete('page')
  params.delete('limit')
  return `/api/attendance/report.csv?${params.toString()}`
})

function groupLabel(row: AttendanceReport['rows'][number]): string {
  return groupBy.value === 'zone'
    ? (row.zone_name ?? 'Unassigned')
    : (row.branch_name ?? 'Unassigned')
}
</script>

<template>
  <div>
    <PageHeader
      title="Attendance report"
      description="Male/female totals by branch or zone, service, period and category."
    >
      <template #actions>
        <UButton
          to="/attendance"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="Sessions"
        />
        <UButton
          :to="csvUrl"
          target="_blank"
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UFormField label="Group by">
          <USelect v-model="groupBy" :items="groupOptions" class="w-full" />
        </UFormField>
        <UFormField label="Period">
          <USelect v-model="period" :items="periodOptions" class="w-full" />
        </UFormField>
        <UFormField label="Session type">
          <USelect v-model="sessionType" :items="typeOptions" class="w-full" />
        </UFormField>
        <UFormField label="Branch">
          <EntitySelect v-model="branch" :items="branchOptions" placeholder="Select branch…" class="w-full" />
        </UFormField>
        <UFormField label="Zone">
          <EntitySelect v-model="zone" :items="zoneOptions" placeholder="Select zone…" class="w-full" />
        </UFormField>
        <UFormField v-if="period === 'custom'" label="From">
          <UInput v-model="dateFrom" type="date" class="w-full" />
        </UFormField>
        <UFormField label="To">
          <UInput v-model="dateTo" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Compare with prior year">
          <USwitch v-model="compare" />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not build the report"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <template v-else-if="data">
        <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Sessions" :value="data.totals.sessions" />
          <StatCard label="Male" :value="data.totals.male" />
          <StatCard label="Female" :value="data.totals.female" />
          <StatCard
            label="Total"
            :value="data.totals.total"
            :hint="
              data.compare?.has_data
                ? `Prior year: ${data.compare.total} (${data.compare.from} to ${data.compare.to})`
                : undefined
            "
          />
        </div>

        <div class="mt-6 flex items-center justify-between">
          <h2 class="text-base font-semibold">Breakdown</h2>
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-refresh-cw"
            label="Refresh"
            @click="refresh()"
          />
        </div>

        <EmptyState
          v-if="data.rows.length === 0"
          class="mt-4"
          title="No attendance in this range"
          description="Widen the date range or choose another branch."
        />

        <div v-else class="mt-4 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">
                  {{ groupBy === 'zone' ? 'Zone' : 'Branch' }}
                </th>
                <th class="px-3 py-2 font-medium">Service</th>
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Category</th>
                <th class="px-3 py-2 font-medium">Male</th>
                <th class="px-3 py-2 font-medium">Female</th>
                <th class="px-3 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="row in data.rows"
                :key="`${row.branch ?? row.zone}-${row.service}-${row.date}-${row.category}`"
              >
                <td class="px-3 py-3 font-medium">{{ groupLabel(row) }}</td>
                <td class="px-3 py-3 capitalize">{{ row.service.replace(/_/g, ' ') }}</td>
                <td class="px-3 py-3 tabular-nums">{{ row.date }}</td>
                <td class="px-3 py-3 capitalize">
                  {{ row.category.replace(/_/g, ' ') }}
                </td>
                <td class="px-3 py-3 tabular-nums">{{ row.male }}</td>
                <td class="px-3 py-3 tabular-nums">{{ row.female }}</td>
                <td class="px-3 py-3 font-semibold tabular-nums">{{ row.total }}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="border-t border-gray-200 dark:border-gray-700">
                <td class="px-3 py-3 font-semibold" colspan="4">Total</td>
                <td class="px-3 py-3 font-semibold tabular-nums">
                  {{ data.totals.male }}
                </td>
                <td class="px-3 py-3 font-semibold tabular-nums">
                  {{ data.totals.female }}
                </td>
                <td class="px-3 py-3 font-semibold tabular-nums">
                  {{ data.totals.total }}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div v-if="totalPages > 1" class="mt-4 flex items-center justify-between text-sm">
          <p class="text-gray-500 dark:text-gray-400">
            {{ data.meta.total }} groups · page {{ data.meta.page }} of {{ totalPages }}
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
              :disabled="page >= totalPages"
              @click="page += 1"
            />
          </div>
        </div>
      </template>
    </UCard>
  </div>
</template>
