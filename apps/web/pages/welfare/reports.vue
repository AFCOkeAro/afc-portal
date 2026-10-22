<script setup lang="ts">
import type { BranchSummary, WelfareReport } from '~/types/portal'

definePageMeta({ middleware: ['staff', 'welfare'] })

const api = useApi()

const status = ref('all')
const branch = ref('all')
const category = ref('all')
const priority = ref('all')
const confidentiality = ref('all')

const query = computed(() => ({
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(category.value !== 'all' ? { category: category.value } : {}),
  ...(priority.value !== 'all' ? { priority: priority.value } : {}),
  ...(confidentiality.value !== 'all' ? { confidentiality: confidentiality.value } : {}),
}))

const csvHref = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.value)) {
    if (value) params.set(key, String(value))
  }
  const suffix = params.toString()
  return `/api/welfare/reports.csv${suffix ? `?${suffix}` : ''}`
})

const { data, pending, error } = await useAsyncData(
  'welfare-reports',
  () => api.get<WelfareReport>('/api/welfare/reports', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('welfare-report-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const groups = computed(() => data.value?.groups ?? [])
const totals = computed(() => data.value?.totals ?? { cases: 0, open: 0 })

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
]

const categoryOptions = [
  { label: 'Any category', value: 'all' },
  { label: 'Medical', value: 'medical' },
  { label: 'Financial', value: 'financial' },
  { label: 'Food', value: 'food' },
  { label: 'Housing', value: 'housing' },
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
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/welfare"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to welfare"
      />
    </div>

    <PageHeader
      title="Welfare reports"
      :description="`Counts by status, category and priority for the branches this account can see. ${totals.cases} cases · ${totals.open} open.`"
    >
      <template #actions>
        <UButton
          label="Export CSV"
          icon="i-lucide-download"
          color="neutral"
          variant="outline"
          :href="csvHref"
        />
      </template>
    </PageHeader>

    <UCard>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Reports carry counts only. Case descriptions and outcome notes never enter this
        payload or its export (data-model §10.1).
      </p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <USelect v-model="status" :items="statusOptions" class="w-full" />
        <USelect v-model="category" :items="categoryOptions" class="w-full" />
        <USelect v-model="priority" :items="priorityOptions" class="w-full" />
        <EntitySelect
          v-model="branch"
          :items="branchOptions"
          placeholder="Select branch…"
          class="w-full"
        />
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
        title="Could not load the report"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="groups.length === 0"
        title="No cases match these filters"
        description="Widen the filters to see the breakdown."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Category</th>
              <th class="px-3 py-2 font-medium">Priority</th>
              <th class="px-3 py-2 font-medium">Cases</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="group in groups"
              :key="`${group.status}|${group.category}|${group.priority}`"
            >
              <td class="px-3 py-3 capitalize">{{ group.status.replace(/_/g, ' ') }}</td>
              <td class="px-3 py-3 capitalize">{{ group.category }}</td>
              <td class="px-3 py-3 capitalize">{{ group.priority }}</td>
              <td class="px-3 py-3 tabular-nums">{{ group.count }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
