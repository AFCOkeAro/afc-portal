<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated, PersonRow, WelfareCaseRow } from '~/types/portal'

definePageMeta({ middleware: ['staff', 'welfare'] })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
/** Drill-down contract: dashboard/branch pages link here with ?status=&branch=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const status = ref(queryParam('status') ?? 'open')
const branch = ref(queryParam('branch') ?? 'all')
const category = ref('all')
const priority = ref('all')
const confidentiality = ref('all')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([status, branch, category, priority, confidentiality, search], () => {
  page.value = 1
})

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    if (statusNext && statusNext !== status.value) status.value = statusNext
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  status: status.value,
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(category.value !== 'all' ? { category: category.value } : {}),
  ...(priority.value !== 'all' ? { priority: priority.value } : {}),
  ...(confidentiality.value !== 'all' ? { confidentiality: confidentiality.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'welfare-list',
  () => api.get<Paginated<WelfareCaseRow>>('/api/welfare', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('welfare-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const people = await useAsyncData('welfare-people', () =>
  api.get<Paginated<PersonRow>>('/api/people', {
    query: { limit: 200, status: 'active', sort: 'last_name' },
  }),
)

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countWelfare(params: Record<string, string>): Promise<number> {
  const res = await api.get<Paginated<WelfareCaseRow>>('/api/welfare', {
    query: { page: 1, limit: 1, ...params },
  })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('welfare-strip', () =>
  Promise.all([
    countWelfare({ status: 'open' }),
    countWelfare({ status: 'in_progress' }),
    countWelfare({ status: 'resolved' }),
    countWelfare({ status: 'all' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Open cases',
    value: stripCounts.value?.[0] ?? null,
    to: '/welfare?status=open',
    hint: 'Open + in progress',
  },
  {
    label: 'In progress',
    value: stripCounts.value?.[1] ?? null,
    to: '/welfare?status=in_progress',
    hint: 'Open filtered list',
  },
  {
    label: 'Resolved',
    value: stripCounts.value?.[2] ?? null,
    to: '/welfare?status=resolved',
    hint: 'Open filtered list',
  },
  {
    label: 'All cases',
    value: stripCounts.value?.[3] ?? null,
    to: '/welfare?status=all',
    hint: 'Open filtered list',
  },
])

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const statusOptions = [
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
  { label: 'All statuses', value: 'all' },
]

const categoryOptions = [
  { label: 'Any category', value: 'all' },
  { label: 'Medical', value: 'medical' },
  { label: 'Financial', value: 'financial' },
  { label: 'Bereavement', value: 'bereavement' },
  { label: 'Education', value: 'education' },
  { label: 'Other', value: 'other' },
]

const priorityOptions = [
  { label: 'Any priority', value: 'all' },
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

const confidentialityOptions = [
  { label: 'Any confidentiality', value: 'all' },
  { label: 'Branch', value: 'branch' },
  { label: 'Area', value: 'area' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const restricted = computed(() => permissions.hiddenFields(COLLECTIONS.welfareCases))

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  open: 'warning',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
}

const priorityColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'warning',
  urgent: 'error',
}
</script>

<template>
  <div>
    <PageHeader
      title="Welfare"
      description="Cases, contributions and outcomes for the branches this account can see."
    >
      <template #actions>
        <div class="flex gap-2">
          <UButton
            label="Reports"
            icon="i-lucide-chart-column"
            color="neutral"
            variant="outline"
            to="/welfare/reports"
          />
          <PermissionGate :collection="COLLECTIONS.welfareCases" action="create">
            <UButton label="Open case" icon="i-lucide-plus" @click="showForm = true" />
          </PermissionGate>
        </div>
      </template>
    </PageHeader>

    <UAlert
      v-if="restricted.length"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Restricted on this account"
      :description="`Not shown here: ${restricted.join(', ')}. Case details and outcome notes are limited to branch, area and super administrators (data-model §10.1).`"
    />

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search cases"
          aria-label="Search welfare cases"
        />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
        <USelect v-model="category" :items="categoryOptions" class="w-full" />
        <USelect v-model="priority" :items="priorityOptions" class="w-full" />
        <EntitySelect v-model="branch" :items="branchOptions" placeholder="Select branch…" class="w-full" />
        <USelect
          v-model="confidentiality"
          :items="confidentialityOptions"
          class="w-full"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load welfare cases"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No welfare cases match these filters"
        description="Open a case when a member needs practical support."
      >
        <PermissionGate :collection="COLLECTIONS.welfareCases" action="create">
          <UButton class="mt-4" label="Open case" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Case</th>
              <th class="px-3 py-2 font-medium">Person</th>
              <th class="px-3 py-2 font-medium">Category</th>
              <th class="px-3 py-2 font-medium">Priority</th>
              <th class="px-3 py-2 font-medium">Assistance</th>
              <th class="px-3 py-2 font-medium">Activity</th>
              <th class="px-3 py-2 font-medium">Opened</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="welfareCase in rows"
              :key="welfareCase.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/welfare/${welfareCase.id}`"
                  class="font-mono text-xs font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ welfareCase.case_ref }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ welfareCase.branch_name || 'No branch' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ welfareCase.person_name || '—' }}
              </td>
              <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                {{ welfareCase.category }}
              </td>
              <td class="px-3 py-3">
                <UBadge
                  :color="priorityColor[welfareCase.priority ?? 'normal'] ?? 'neutral'"
                  variant="subtle"
                >
                  {{ welfareCase.priority ?? 'normal' }}
                </UBadge>
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                <p>{{ welfareCase.amount_assisted || '0.00' }} assisted</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ welfareCase.contribution_total }} contributed
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ welfareCase.event_count }} entries
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(welfareCase.opened_at) }}
              </td>
              <td class="px-3 py-3">
                <UBadge
                  :color="statusColor[welfareCase.status ?? 'open'] ?? 'neutral'"
                  variant="subtle"
                >
                  {{ (welfareCase.status ?? 'open').replace(/_/g, ' ') }}
                </UBadge>
                <UBadge
                  v-if="welfareCase.confidentiality === 'area'"
                  class="ml-1"
                  color="info"
                  variant="subtle"
                >
                  area
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/welfare/${welfareCase.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open case"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} cases · page {{ page }} of {{ pageCount }}
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

    <WelfareFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      :people="people.data.value?.data ?? []"
      @saved="refresh()"
    />
  </div>
</template>
