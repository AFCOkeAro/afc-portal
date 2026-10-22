<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, DepartmentRow, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
/** Drill-down contract: branch/profile pages link here with ?branch=&status=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const branch = ref(queryParam('branch') ?? 'all')
const membership = ref(queryParam('membership_status') ?? 'all')
const department = ref(queryParam('department') ?? 'all')
const status = ref(queryParam('status') ?? 'active')
/** Dashboard deep-link filters (AFC-576): honoured by the list route. */
const gender = ref(queryParam('gender') ?? 'all')
const ageBucket = ref(queryParam('age_bucket') ?? 'all')
const householdFilter = ref(queryParam('household') ?? 'all')
const compare = ref(queryParam('compare_prior_year') === 'true')
const groupBy = ref<'branch' | 'zone'>(
  queryParam('group_by') === 'zone' ? 'zone' : 'branch',
)
const dataYear = ref(queryParam('data_year') ?? String(new Date().getFullYear() - 1))
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch(
  [branch, membership, department, status, gender, ageBucket, householdFilter, search],
  () => {
    page.value = 1
  },
)

interface PeopleCompareRow {
  group: string
  group_name: string | null
  current: number
  prior: number
  delta: number
}

interface PeopleCompareResponse {
  data: {
    group_by: 'branch' | 'zone'
    data_year: number
    rows: PeopleCompareRow[]
    totals: { current: number; prior: number }
    has_data: boolean
  }
}

const compareQuery = computed(() => ({
  group_by: groupBy.value,
  data_year: dataYear.value,
  ...(compare.value ? { compare_prior_year: 'true' } : {}),
}))

const { data: compareData } = await useAsyncData(
  'people-compare',
  () => {
    if (!compare.value) return Promise.resolve(null)
    const year = Number(dataYear.value)
    if (!Number.isInteger(year)) return Promise.resolve(null)
    return api.get<PeopleCompareResponse>('/api/people/compare', {
      query: { group_by: groupBy.value, data_year: dataYear.value },
    })
  },
  { watch: [compare, compareQuery] },
)

const compareRows = computed(() => compareData.value?.data.rows ?? [])
const compareTotals = computed(() => compareData.value?.data.totals ?? null)
const compareHasData = computed(() => compareData.value?.data.has_data ?? false)
const compareCsvHref = computed(() => {
  const params = new URLSearchParams({
    group_by: groupBy.value,
    data_year: dataYear.value,
  })
  return `/api/people/compare.csv?${params.toString()}`
})

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(membership.value !== 'all' ? { membership_status: membership.value } : {}),
  ...(department.value !== 'all' ? { department: department.value } : {}),
  ...(gender.value !== 'all' ? { gender: gender.value } : {}),
  ...(ageBucket.value !== 'all' ? { age_bucket: ageBucket.value } : {}),
  ...(householdFilter.value !== 'all' ? { household: householdFilter.value } : {}),
  status: status.value,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'people-list',
  () => api.get<Paginated<PersonRow>>('/api/people', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const branches = await useAsyncData('people-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const departments = await useAsyncData('people-departments', () =>
  api.get<{ data: DepartmentRow[] }>('/api/departments'),
)

interface PeopleSummaryBranchRow {
  branch: string
  branch_name: string | null
  people: number
  households: number
}

interface PeopleSummaryZoneRow {
  zone: string
  zone_name: string | null
  households: number
  people: number
}

interface PeopleSummary {
  total: number
  active: number
  inactive: number
  gender: { male: number; female: number; not_recorded: number }
  age_buckets: Record<string, number>
  family: { households: number; avg_members: number; unlinked_people: number }
  by_branch: PeopleSummaryBranchRow[]
  by_zone: PeopleSummaryZoneRow[]
  households_visible: boolean
}

const {
  data: summaryData,
  pending: summaryPending,
  error: summaryError,
} = await useAsyncData('people-summary', () =>
  api.get<{ data: PeopleSummary }>('/api/people/summary'),
)

const summary = computed(() => summaryData.value?.data ?? null)
const ageBucketOrder = ['0-12', '13-17', '18-25', '26-40', '41-60', '60+', 'unknown']
const ageRows = computed(() =>
  ageBucketOrder.map((bucket) => ({
    bucket,
    count: summary.value?.age_buckets[bucket] ?? 0,
  })),
)
const ageMax = computed(() =>
  Math.max(
    1,
    ...ageRows.value.map((row: { bucket: string; count: number }) => row.count),
  ),
)
const genderTotal = computed(() => {
  const g = summary.value?.gender
  return (g?.male ?? 0) + (g?.female ?? 0)
})
const genderMalePct = computed(() =>
  genderTotal.value === 0
    ? 0
    : Math.round(((summary.value?.gender.male ?? 0) / genderTotal.value) * 100),
)
const genderFemalePct = computed(() =>
  genderTotal.value === 0 ? 0 : 100 - genderMalePct.value,
)

const departmentOptions = computed(() => [
  { label: 'Any department', value: 'all' },
  ...(departments.data.value?.data ?? []).map((row) => ({
    label: row.branch_name ? `${row.name} (${row.branch_name})` : row.name,
    value: row.id,
  })),
])

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const membershipOptions = [
  { label: 'Any membership', value: 'all' },
  { label: 'Member', value: 'member' },
  { label: 'Regular attendee', value: 'regular_attendee' },
  { label: 'Visitor', value: 'visitor' },
  { label: 'Youth', value: 'youth' },
  { label: 'Child', value: 'child' },
  { label: 'Staff', value: 'staff' },
  { label: 'Inactive', value: 'inactive' },
]

const statusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All statuses', value: 'all' },
]

const genderOptions = [
  { label: 'Any gender', value: 'all' },
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
  { label: 'Not recorded', value: 'unspecified' },
]

const ageBucketOptions = [
  { label: 'Any age', value: 'all' },
  ...ageBucketOrder.map((bucket) => ({
    label: bucket === 'unknown' ? 'Age unknown' : `Age ${bucket}`,
    value: bucket,
  })),
]

const restricted = computed(() => permissions.hiddenFields(COLLECTIONS.people))
const showDob = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.people, 'date_of_birth'),
)

function fullName(person: PersonRow): string {
  return (
    person.preferred_name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ')
  )
}
</script>

<template>
  <div>
    <PageHeader
      title="People"
      description="Members, visitors, youth and children across the branches this account can see."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.people" action="create">
          <UButton
            label="Add person"
            icon="i-lucide-user-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UAlert
      v-if="restricted.length"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Restricted on this account"
      :description="`Not shown here: ${restricted.join(', ')}. Access is limited to branch, area and super administrators (data-model §10.1).`"
    />

    <UCard class="mb-4">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-base font-semibold">People dashboard</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Scoped to the branches this account can see · every figure links to its filtered
          list
        </p>
      </div>

      <div v-if="summaryPending" class="mt-4 flex justify-center py-6">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <UAlert
        v-else-if="summaryError"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load the dashboard"
        :description="summaryError.message"
      />

      <div v-else-if="summary" class="mt-4 space-y-6">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NuxtLink to="/people?status=all">
            <StatCard
              label="Members"
              :value="summary.total"
              :hint="`${summary.active} active · ${summary.inactive} archived`"
            />
          </NuxtLink>
          <NuxtLink to="/people?gender=male&status=all">
            <StatCard
              label="Male"
              :value="summary.gender.male"
              hint="Open filtered list"
            />
          </NuxtLink>
          <NuxtLink to="/people?gender=female&status=all">
            <StatCard
              label="Female"
              :value="summary.gender.female"
              hint="Open filtered list"
            />
          </NuxtLink>
          <NuxtLink v-if="summary.households_visible" to="/households">
            <StatCard
              label="Households"
              :value="summary.family.households"
              :hint="`Avg ${summary.family.avg_members} members · ${summary.family.unlinked_people} unlinked`"
            />
          </NuxtLink>
          <StatCard
            v-else
            label="Households"
            value="—"
            hint="Hidden: this account cannot read households"
          />
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold">Gender</h3>
            <div
              class="mt-2 flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
              role="img"
              :aria-label="`${summary.gender.male} male, ${summary.gender.female} female`"
            >
              <div class="bg-sky-500" :style="{ width: `${genderMalePct}%` }" />
              <div class="flex-1 bg-rose-400" />
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Male {{ genderMalePct }}% · Female {{ genderFemalePct }}%
              <span v-if="summary.gender.not_recorded > 0">
                · {{ summary.gender.not_recorded }} not recorded (data-quality footnote —
                the form defaults to unspecified)
              </span>
            </p>
          </div>

          <div>
            <h3 class="text-sm font-semibold">Age distribution</h3>
            <ul class="mt-2 space-y-1.5">
              <li
                v-for="row in ageRows"
                :key="row.bucket"
                class="flex items-center gap-2 text-sm"
              >
                <NuxtLink
                  :to="`/people?age_bucket=${encodeURIComponent(row.bucket)}&status=all`"
                  class="w-16 shrink-0 font-medium text-gray-700 hover:text-primary-600 dark:text-gray-300"
                >
                  {{ row.bucket === 'unknown' ? 'Unknown' : row.bucket }}
                </NuxtLink>
                <div
                  class="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                >
                  <div
                    class="h-full rounded-full bg-primary-500"
                    :style="{ width: `${Math.round((row.count / ageMax) * 100)}%` }"
                  />
                </div>
                <span
                  class="w-12 shrink-0 text-right tabular-nums text-gray-600 dark:text-gray-300"
                >
                  {{ row.count }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold">Households by branch</h3>
            <p v-if="!summary.households_visible" class="mt-1 text-xs text-gray-500">
              Hidden: this account cannot read households — people counts still hold.
            </p>
            <table
              v-else-if="summary.by_branch.length > 0"
              class="mt-2 min-w-full text-sm"
            >
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="py-1 font-medium">Branch</th>
                  <th class="py-1 text-right font-medium">People</th>
                  <th class="py-1 text-right font-medium">Households</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="row in summary.by_branch" :key="row.branch">
                  <td class="py-1.5 font-medium">
                    {{ row.branch_name ?? 'Unassigned' }}
                  </td>
                  <td class="py-1.5 text-right tabular-nums">
                    <NuxtLink
                      :to="`/people?branch=${encodeURIComponent(row.branch)}&status=all`"
                      class="hover:text-primary-600"
                    >
                      {{ row.people }}
                    </NuxtLink>
                  </td>
                  <td class="py-1.5 text-right tabular-nums">
                    <NuxtLink
                      :to="`/households?branch=${encodeURIComponent(row.branch)}`"
                      class="hover:text-primary-600"
                    >
                      {{ row.households }}
                    </NuxtLink>
                  </td>
                </tr>
              </tbody>
            </table>
            <p v-else class="mt-1 text-sm text-gray-500">No scoped records yet.</p>
          </div>

          <div>
            <h3 class="text-sm font-semibold">Households by zone</h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Pin map deferred — address text only, so zone counts stand in for the map
              (schemas/household.ts).
            </p>
            <table v-if="summary.by_zone.length > 0" class="mt-2 min-w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="py-1 font-medium">Zone</th>
                  <th class="py-1 text-right font-medium">People</th>
                  <th class="py-1 text-right font-medium">Households</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="row in summary.by_zone" :key="row.zone">
                  <td class="py-1.5 font-medium">
                    <NuxtLink
                      v-if="row.zone !== 'unassigned'"
                      :to="`/zones/${encodeURIComponent(row.zone)}`"
                      class="hover:text-primary-600"
                    >
                      {{ row.zone_name ?? row.zone }}
                    </NuxtLink>
                    <span v-else>Unassigned</span>
                  </td>
                  <td class="py-1.5 text-right tabular-nums">{{ row.people }}</td>
                  <td class="py-1.5 text-right tabular-nums">{{ row.households }}</td>
                </tr>
              </tbody>
            </table>
            <p v-else class="mt-1 text-sm text-gray-500">No scoped records yet.</p>
          </div>
        </div>

        <p class="text-xs text-gray-500 dark:text-gray-400">
          <NuxtLink
            to="/people?household=unlinked&status=all"
            class="hover:text-primary-600"
          >
            {{ summary.family.unlinked_people }} people are not linked to any household
          </NuxtLink>
          · aggregates only, no names, birth dates, addresses or contacts in this payload.
        </p>
      </div>
    </UCard>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search name, phone or email"
          aria-label="Search people"
        />
        <EntitySelect v-model="branch" :items="branchOptions" placeholder="Select branch…" class="w-full" />
        <USelect v-model="membership" :items="membershipOptions" class="w-full" />
        <EntitySelect v-model="department" :items="departmentOptions" placeholder="Select department…" class="w-full" />
        <USelect v-model="gender" :items="genderOptions" class="w-full" />
        <USelect v-model="ageBucket" :items="ageBucketOptions" class="w-full" />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
        <UFormField label="Compare with prior year">
          <USwitch v-model="compare" />
        </UFormField>
        <UFormField v-if="compare" label="Group by">
          <USelect
            v-model="groupBy"
            :items="[
              { label: 'By branch', value: 'branch' },
              { label: 'By zone', value: 'zone' },
            ]"
            class="w-full"
          />
        </UFormField>
        <UFormField v-if="compare" label="Prior-year snapshot (YYYY)">
          <UInput
            v-model="dataYear"
            inputmode="numeric"
            class="w-full"
            aria-label="Prior-year snapshot"
          />
        </UFormField>
      </div>

      <div v-if="compare" class="mt-4">
        <div class="flex items-center justify-between">
          <h2 class="text-base font-semibold">
            Prior-year compare ·
            {{
              compareTotals
                ? `${compareTotals.current} now vs ${compareTotals.prior} in ${dataYear}`
                : `snapshot ${dataYear}`
            }}
          </h2>
          <UButton
            :to="compareCsvHref"
            external
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-download"
            label="Export compare CSV"
          />
        </div>
        <p v-if="compareData && !compareHasData" class="mt-2 text-sm text-gray-500">
          No prior-year snapshot for {{ dataYear }} yet — current headcounts only.
        </p>
        <div v-else-if="compareRows.length > 0" class="mt-2 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Group</th>
                <th class="px-3 py-2 font-medium">Current</th>
                <th class="px-3 py-2 font-medium">Prior ({{ dataYear }})</th>
                <th class="px-3 py-2 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="row in compareRows" :key="row.group">
                <td class="px-3 py-2 font-medium">{{ row.group_name ?? row.group }}</td>
                <td class="px-3 py-2 tabular-nums">{{ row.current }}</td>
                <td class="px-3 py-2 tabular-nums">{{ row.prior }}</td>
                <td class="px-3 py-2 font-semibold tabular-nums">
                  {{ row.delta >= 0 ? `+${row.delta}` : row.delta }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load people"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No people match these filters"
        description="Clear a filter or add the first person for this branch."
      >
        <PermissionGate :collection="COLLECTIONS.people" action="create">
          <UButton class="mt-4" label="Add person" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Person</th>
              <th class="px-3 py-2 font-medium">Contact</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Membership</th>
              <th v-if="showDob" class="px-3 py-2 font-medium">Age</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="person in rows"
              :key="person.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/people/${person.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ fullName(person) }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ person.gender }}<span v-if="person.is_minor"> · minor</span>
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                <p>{{ person.phone || '—' }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ person.email || '' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ person.branch_name || '—' }}
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">
                  {{ person.membership_status.replace(/_/g, ' ') }}
                </UBadge>
              </td>
              <td
                v-if="showDob"
                class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300"
              >
                {{ person.age ?? '—' }}
              </td>
              <td class="px-3 py-3">
                <UBadge
                  :color="person.status === 'active' ? 'success' : 'neutral'"
                  variant="subtle"
                >
                  {{ person.status }}
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/people/${person.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open person"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} people · page {{ page }} of {{ pageCount }}
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

    <PeopleFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      :show-dob="showDob"
      @saved="refresh()"
    />
  </div>
</template>
