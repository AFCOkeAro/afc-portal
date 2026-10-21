<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const status = ref(queryParam('status') ?? 'all')

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    if (statusNext && statusNext !== status.value) status.value = statusNext
  },
)
const showForm = ref(false)
const form = ref({
  person: '',
  from_branch: '',
  to_branch: '',
  reason: '',
  effective_date: '',
})
const error = ref('')

const query = computed(() => ({
  ...(status.value !== 'all' ? { status: status.value } : {}),
}))
const { data, pending, refresh } = await useAsyncData(
  'transfers-list',
  () =>
    api.get<{ data: Record<string, unknown>[] }>('/api/transfers', {
      query: query.value,
    }),
  { watch: [query] },
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/transfers', {
      person: form.value.person,
      from_branch: form.value.from_branch,
      to_branch: form.value.to_branch,
      ...(form.value.reason ? { reason: form.value.reason } : {}),
      ...(form.value.effective_date ? { effective_date: form.value.effective_date } : {}),
    })
    showForm.value = false
    form.value = {
      person: '',
      from_branch: '',
      to_branch: '',
      reason: '',
      effective_date: '',
    }
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not record the transfer'
  }
}

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Requested', value: 'requested' },
  { label: 'Approved', value: 'approved' },
  { label: 'Completed', value: 'completed' },
  { label: 'Rejected', value: 'rejected' },
]

const rows = computed(() => data.value?.data ?? [])

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countTransfers(params: Record<string, string>): Promise<number> {
  const res = await api.get<{
    data: Record<string, unknown>[]
    meta: { total: number }
  }>('/api/transfers', { query: { page: 1, limit: 1, ...params } })
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('transfers-strip', () =>
  Promise.all([
    countTransfers({}),
    countTransfers({ status: 'requested' }),
    countTransfers({ status: 'approved' }),
    countTransfers({ status: 'completed' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Transfers',
    value: stripCounts.value?.[0] ?? null,
    to: '/transfers?status=all',
    hint: 'Open filtered list',
  },
  {
    label: 'Requested',
    value: stripCounts.value?.[1] ?? null,
    to: '/transfers?status=requested',
    hint: 'Open filtered list',
  },
  {
    label: 'Approved',
    value: stripCounts.value?.[2] ?? null,
    to: '/transfers?status=approved',
    hint: 'Open filtered list',
  },
  {
    label: 'Completed',
    value: stripCounts.value?.[3] ?? null,
    to: '/transfers?status=completed',
    hint: 'Open filtered list',
  },
])
</script>

<template>
  <div>
    <PageHeader
      title="Transfers"
      description="Branch-to-branch moves. Approval moves the home branch."
    >
      <template #actions>
        <UButton
          to="/api/transfers/export.csv"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
        <PermissionGate :collection="COLLECTIONS.transfers" action="create">
          <UButton
            label="Record transfer"
            icon="i-lucide-plus"
            @click="showForm = !showForm"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard v-if="showForm" class="mb-4">
      <template #header>
        <h2 class="font-semibold">New transfer</h2>
      </template>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Person id">
          <UInput v-model="form.person" class="w-full" placeholder="Person id" />
        </UFormField>
        <UFormField label="Effective date">
          <UInput v-model="form.effective_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="From branch id">
          <UInput
            v-model="form.from_branch"
            class="w-full"
            placeholder="From branch id"
          />
        </UFormField>
        <UFormField label="To branch id">
          <UInput v-model="form.to_branch" class="w-full" placeholder="To branch id" />
        </UFormField>
        <UFormField label="Reason" class="sm:col-span-2">
          <UTextarea v-model="form.reason" class="w-full" placeholder="Reason" />
        </UFormField>
      </div>
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not record the transfer"
        :description="error"
      />
      <div class="mt-4">
        <UButton label="Save" icon="i-lucide-check" @click="create" />
      </div>
    </UCard>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3">
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
      </div>

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No transfers match these filters"
        description="Record the first branch-to-branch move."
      >
        <PermissionGate :collection="COLLECTIONS.transfers" action="create">
          <UButton class="mt-4" label="Record transfer" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Person</th>
              <th class="px-3 py-2 font-medium">From → To</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">{{ row.person }}</td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.from_branch }} → {{ row.to_branch }}
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/transfers/${String(row.id)}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open transfer"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
