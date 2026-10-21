<script setup lang="ts">
import type { BranchSummary, ServiceRow, Paginated } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const type = ref(queryParam('service_type') ?? 'all')
const status = ref(queryParam('status') ?? 'all')

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

watch([type, status, branch, search], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filters. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const typeNext = typeof next.service_type === 'string' ? next.service_type : null
    if (typeNext && typeNext !== type.value) type.value = typeNext
    const statusNext = typeof next.status === 'string' ? next.status : null
    if (statusNext && statusNext !== status.value) status.value = statusNext
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(type.value !== 'all' ? { service_type: type.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'services-list',
  () => api.get<Paginated<ServiceRow>>('/api/services', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('services-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countServices(params: Record<string, string>): Promise<number> {
  const res = await api.get<Paginated<ServiceRow>>('/api/services', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('services-strip', () =>
  Promise.all([
    countServices({}),
    countServices({ service_type: 'sunday' }),
    countServices({ service_type: 'midweek' }),
    countServices({ status: 'planned' }),
    countServices({ status: 'completed' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Services',
    value: stripCounts.value?.[0] ?? null,
    to: '/services',
    hint: 'Open filtered list',
  },
  {
    label: 'Sunday',
    value: stripCounts.value?.[1] ?? null,
    to: '/services?service_type=sunday',
    hint: 'Open filtered list',
  },
  {
    label: 'Midweek',
    value: stripCounts.value?.[2] ?? null,
    to: '/services?service_type=midweek',
    hint: 'Open filtered list',
  },
  {
    label: 'Planned',
    value: stripCounts.value?.[3] ?? null,
    to: '/services?status=planned',
    hint: 'Open filtered list',
  },
  {
    label: 'Completed',
    value: stripCounts.value?.[4] ?? null,
    to: '/services?status=completed',
    hint: 'Open filtered list',
  },
])

const typeOptions = [
  { label: 'Any service type', value: 'all' },
  { label: 'Sunday', value: 'sunday' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Special', value: 'special' },
  { label: 'Camp', value: 'camp' },
]

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Planned', value: 'planned' },
  { label: 'Completed', value: 'completed' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      title="Sunday services"
      description="Planned and completed services with their rosters."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.sundayServices" action="create">
          <UButton label="Plan a service" icon="i-lucide-plus" @click="showForm = true" />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-4">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search services"
          aria-label="Search services"
        />
        <USelect v-model="type" :items="typeOptions" class="w-full" />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load services"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No services match these filters"
        description="Plan the first service for this branch."
      >
        <PermissionGate :collection="COLLECTIONS.sundayServices" action="create">
          <UButton class="mt-4" label="Plan a service" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Service</th>
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Type</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="service in rows"
              :key="service.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/services/${service.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ service.theme || 'Service' }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ service.service_time || '—' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(service.service_date) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ service.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                {{ service.service_type }}
              </td>
              <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                {{ service.status }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/services/${service.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open service"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} services · page {{ page }} of {{ pageCount }}
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

    <ServiceFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
