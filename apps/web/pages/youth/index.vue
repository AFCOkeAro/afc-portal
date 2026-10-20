<script setup lang="ts">
import {
  COLLECTIONS,
  YOUTH_EDUCATION_LEVELS,
  YOUTH_EMPLOYMENT_STATUSES,
} from '@afc/shared'
import type { BranchSummary, Paginated, YouthRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const branch = ref(queryParam('branch') ?? 'all')
const zone = ref(queryParam('zone') ?? 'all')
const education = ref(queryParam('education_level') ?? 'all')
const employment = ref(queryParam('employment_status') ?? 'all')
const entrepreneur = ref(queryParam('is_entrepreneur') ?? 'all')
const status = ref(queryParam('status') ?? 'all')
const page = ref(1)
const limit = 25

watch([branch, zone, education, employment, entrepreneur, status], () => {
  page.value = 1
})

interface YouthResponse extends Paginated<YouthRow> {
  filters: Record<string, unknown>
}

const query = computed(() => ({
  page: page.value,
  limit,
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(zone.value !== 'all' ? { zone: zone.value } : {}),
  ...(education.value !== 'all' ? { education_level: education.value } : {}),
  ...(employment.value !== 'all' ? { employment_status: employment.value } : {}),
  ...(entrepreneur.value !== 'all' ? { is_entrepreneur: entrepreneur.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'youth-list',
  () => api.get<YouthResponse>('/api/youth', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('youth-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const zones = await useAsyncData('youth-zones', () =>
  api.get<Array<{ id: string; name: string }>>('/api/zones'),
)

const csvHref = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.value)) {
    if (key === 'page' || key === 'limit') continue
    params.set(key, String(value))
  }
  return `/api/youth/reports.csv?${params.toString()}`
})

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const zoneOptions = computed(() => [
  { label: 'All zones', value: 'all' },
  ...(zones.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const educationOptions = [
  { label: 'Any education', value: 'all' },
  ...YOUTH_EDUCATION_LEVELS.map((value) => ({ label: value, value })),
]

const employmentOptions = [
  { label: 'Any employment', value: 'all' },
  ...YOUTH_EMPLOYMENT_STATUSES.map((value) => ({
    label: value.replace(/_/g, ' '),
    value,
  })),
]

const entrepreneurOptions = [
  { label: 'Entrepreneur: any', value: 'all' },
  { label: 'Entrepreneurs', value: 'true' },
  { label: 'Not entrepreneurs', value: 'false' },
]

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
]
</script>

<template>
  <div>
    <PageHeader
      title="Youth"
      description="The shared church database, youth segment: education, employment and care."
    >
      <template #actions>
        <UButton
          :to="csvHref"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
        <PermissionGate :collection="COLLECTIONS.youthProfiles" action="create">
          <UButton
            label="Link youth profile"
            icon="i-lucide-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <USelect
          v-model="branch"
          :items="branchOptions"
          class="w-full"
          aria-label="Filter by branch"
        />
        <USelect
          v-model="zone"
          :items="zoneOptions"
          class="w-full"
          aria-label="Filter by zone"
        />
        <USelect
          v-model="education"
          :items="educationOptions"
          class="w-full"
          aria-label="Filter by education level"
        />
        <USelect
          v-model="employment"
          :items="employmentOptions"
          class="w-full"
          aria-label="Filter by employment status"
        />
        <USelect
          v-model="entrepreneur"
          :items="entrepreneurOptions"
          class="w-full"
          aria-label="Filter by entrepreneur"
        />
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load youth profiles"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No youth profiles match these filters"
        description="Link the first youth profile to a person in the church database."
      >
        <PermissionGate :collection="COLLECTIONS.youthProfiles" action="create">
          <UButton class="mt-4" label="Link youth profile" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Youth</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Education</th>
              <th class="px-3 py-2 font-medium">Employment</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/youth/${row.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ row.person_name || 'Unnamed' }}
                </NuxtLink>
                <p
                  v-if="row.youth_leadership_role"
                  class="text-xs text-gray-500 dark:text-gray-400"
                >
                  {{ row.youth_leadership_role }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.education_level || '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ (row.employment_status || '—').replace(/_/g, ' ') }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.status }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/youth/${row.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open youth profile"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} profiles · page {{ page }} of {{ pageCount }}
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

    <YouthProfileFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
