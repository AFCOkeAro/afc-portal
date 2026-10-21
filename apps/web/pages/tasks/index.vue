<script setup lang="ts">
import { COLLECTIONS, isTaskOverdue } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()

/** Drill-down contract (AFC-588): dashboard strip links here with ?status=&mine=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const status = ref(queryParam('status') ?? 'all')
const mine = ref(queryParam('mine') === '1')
const showForm = ref(false)
const form = ref({
  title: '',
  assignee_user: '',
  assignee_person: '',
  branch: '',
  due_date: '',
  priority: 'normal',
})
const error = ref('')

const query = computed(() => ({
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(mine.value ? { mine: '1' } : {}),
}))

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    status.value = statusNext ?? 'all'
    mine.value = next.mine === '1'
  },
)
const { data, pending, refresh } = await useAsyncData(
  'tasks-list',
  () =>
    api.get<{ data: Record<string, unknown>[]; meta: { total: number } }>('/api/tasks', {
      query: query.value,
    }),
  { watch: [query] },
)

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countTasks(params: Record<string, string>): Promise<number> {
  const res = await api.get<{ data: Record<string, unknown>[]; meta: { total: number } }>(
    '/api/tasks',
    { query: { page: 1, limit: 1, ...params } },
  )
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('tasks-strip', () =>
  Promise.all([
    countTasks({}),
    countTasks({ status: 'todo' }),
    countTasks({ status: 'in_progress' }),
    countTasks({ status: 'blocked' }),
    countTasks({ status: 'done' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Tasks',
    value: stripCounts.value?.[0] ?? null,
    to: '/tasks?status=all',
    hint: 'Open filtered list',
  },
  {
    label: 'To do',
    value: stripCounts.value?.[1] ?? null,
    to: '/tasks?status=todo',
    hint: 'Open filtered list',
  },
  {
    label: 'In progress',
    value: stripCounts.value?.[2] ?? null,
    to: '/tasks?status=in_progress',
    hint: 'Open filtered list',
  },
  {
    label: 'Blocked',
    value: stripCounts.value?.[3] ?? null,
    to: '/tasks?status=blocked',
    hint: 'Open filtered list',
  },
  {
    label: 'Done',
    value: stripCounts.value?.[4] ?? null,
    to: '/tasks?status=done',
    hint: 'Open filtered list',
  },
])

async function create() {
  error.value = ''
  try {
    await api.post('/api/tasks', {
      title: form.value.title,
      ...(form.value.assignee_user ? { assignee_user: form.value.assignee_user } : {}),
      ...(form.value.assignee_person
        ? { assignee_person: form.value.assignee_person }
        : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      ...(form.value.due_date ? { due_date: form.value.due_date } : {}),
      priority: form.value.priority,
    })
    showForm.value = false
    form.value = {
      title: '',
      assignee_user: '',
      assignee_person: '',
      branch: '',
      due_date: '',
      priority: 'normal',
    }
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not create the task'
  }
}

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'To do', value: 'todo' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
]

const priorityOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

const rows = computed(() => data.value?.data ?? [])

function isOverdue(row: Record<string, unknown>): boolean {
  return isTaskOverdue({
    due_date: (row.due_date as string | null) ?? null,
    status: String(row.status),
  })
}
</script>

<template>
  <div>
    <PageHeader
      title="Tasks"
      description="Own-branch and assigned work with due dates and an audit trail."
    >
      <template #actions>
        <UButton
          to="/api/tasks/export.csv"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
        <PermissionGate :collection="COLLECTIONS.tasks" action="create">
          <UButton label="New task" icon="i-lucide-plus" @click="showForm = !showForm" />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard v-if="showForm" class="mb-4">
      <template #header>
        <h2 class="font-semibold">New task</h2>
      </template>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Title" class="sm:col-span-2">
          <UInput v-model="form.title" class="w-full" placeholder="Title" />
        </UFormField>
        <UFormField label="Assignee user id">
          <UInput
            v-model="form.assignee_user"
            class="w-full"
            placeholder="Assignee user id"
          />
        </UFormField>
        <UFormField label="Assignee person id">
          <UInput
            v-model="form.assignee_person"
            class="w-full"
            placeholder="Assignee person id"
          />
        </UFormField>
        <UFormField label="Branch id">
          <UInput v-model="form.branch" class="w-full" placeholder="Branch id" />
        </UFormField>
        <UFormField label="Due date">
          <UInput v-model="form.due_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Priority" class="sm:col-span-2">
          <USelect v-model="form.priority" :items="priorityOptions" class="w-full" />
        </UFormField>
      </div>
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not create the task"
        :description="error"
      />
      <div class="mt-4">
        <UButton label="Save" icon="i-lucide-check" @click="create" />
      </div>
    </UCard>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-[220px_1fr]">
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
        <UCheckbox v-model="mine" label="Assigned to me" name="mine" />
      </div>

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No tasks match these filters"
        description="Create the first task for this scope."
      >
        <PermissionGate :collection="COLLECTIONS.tasks" action="create">
          <UButton class="mt-4" label="New task" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Title</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Due</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/tasks/${String(row.id)}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ row.title }}
                </NuxtLink>
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td
                class="px-3 py-3 text-gray-600 dark:text-gray-300"
                :class="
                  isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''
                "
              >
                {{ row.due_date ?? '—' }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/tasks/${String(row.id)}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open task"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
