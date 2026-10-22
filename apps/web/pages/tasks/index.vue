<script setup lang="ts">
import {
  COLLECTIONS,
  isTaskOverdue,
  TASK_TEMPLATES,
  expandTaskTemplate,
  getTaskTemplate,
} from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()
const route = useRoute()

/** Drill-down contract (AFC-588): dashboard strip links here with ?status=&mine=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const status = ref(queryParam('status') ?? 'all')
const mine = ref(queryParam('mine') === '1')
/** Branch drill-down (AFC-666): event Tasks tab links here with ?branch=. */
const branch = ref(queryParam('branch') ?? '')
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

/** Recurring checklist templates (AFC-668): one modal fans a template out
 *  to ordinary task rows via POST /api/tasks/from-template. */
const showTemplate = ref(false)
const templateForm = ref({
  template: 'event_programme',
  branch: '',
  base_date: '',
  assignee_user: '',
  assignee_person: '',
})
const templateError = ref('')
const templateCreated = ref<number | null>(null)

const templateOptions = TASK_TEMPLATES.map((entry) => ({
  label: entry.label,
  value: entry.id,
  description: entry.description,
}))

const templatePreview = computed(() => {
  const template = getTaskTemplate(templateForm.value.template)
  if (!template) return []
  return expandTaskTemplate(
    template,
    templateForm.value.base_date === '' ? null : templateForm.value.base_date,
  )
})

async function applyTemplate() {
  templateError.value = ''
  templateCreated.value = null
  try {
    const res = await api.post<{ data: { created: number; ids: string[] } }>(
      '/api/tasks/from-template',
      {
        template: templateForm.value.template,
        branch: templateForm.value.branch === '' ? undefined : templateForm.value.branch,
        base_date:
          templateForm.value.base_date === '' ? null : templateForm.value.base_date,
        assignee_user:
          templateForm.value.assignee_user.trim() === ''
            ? null
            : templateForm.value.assignee_user.trim(),
        assignee_person:
          templateForm.value.assignee_person === ''
            ? null
            : templateForm.value.assignee_person,
      },
    )
    templateCreated.value = res.data.created
    showTemplate.value = false
    await refresh()
  } catch (cause) {
    templateError.value =
      (cause as { message?: string }).message ?? 'Could not apply the template'
  }
}

const query = computed(() => ({
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(mine.value ? { mine: '1' } : {}),
  ...(branch.value !== '' ? { branch: branch.value } : {}),
}))

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    status.value = statusNext ?? 'all'
    mine.value = next.mine === '1'
    branch.value = typeof next.branch === 'string' ? next.branch : ''
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
          <UButton
            label="From template"
            icon="i-lucide-clipboard-list"
            color="neutral"
            variant="outline"
            class="ml-2"
            @click="showTemplate = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <div
      v-if="templateCreated !== null"
      class="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
    >
      <UIcon name="i-lucide-check" class="size-4 shrink-0" />
      <span>{{ templateCreated }} tasks created from template.</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="i-lucide-x"
        aria-label="Dismiss"
        class="ml-auto"
        @click="templateCreated = null"
      />
    </div>

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
        <UFormField label="Assignee person">
          <EntitySelect
            v-model="form.assignee_person"
            :items="personOptions"
            placeholder="Type a name to search…"
            :loading="personPending"
            server-search
            class="w-full"
            @update:search-term="onPersonSearch"
          />
        </UFormField>
        <UFormField label="Branch">
          <EntitySelect
            v-model="form.branch"
            :items="branchOptions"
            placeholder="Select branch…"
            :loading="branchesPending"
            class="w-full"
          />
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

    <UModal
      :open="showTemplate"
      title="New tasks from template"
      description="Pick a recurring checklist, a branch and a base date — every step becomes a task."
      @update:open="showTemplate = $event"
    >
      <template #body>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Template" class="sm:col-span-2">
            <USelect
              v-model="templateForm.template"
              :items="templateOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Branch">
            <EntitySelect
              v-model="templateForm.branch"
              :items="branchOptions"
              placeholder="Select branch…"
              :loading="branchesPending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Base date">
            <UInput v-model="templateForm.base_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Assignee user id (optional — defaults to you)">
            <UInput
              v-model="templateForm.assignee_user"
              class="w-full"
              placeholder="Assignee user id"
            />
          </UFormField>
          <UFormField label="Assignee person (optional)">
            <EntitySelect
              v-model="templateForm.assignee_person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
        </div>
        <ul
          class="mt-4 space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-900/40"
        >
          <li
            v-for="(step, index) in templatePreview"
            :key="index"
            class="flex items-center gap-2"
          >
            <span class="text-gray-400 tabular-nums">{{ index + 1 }}.</span>
            <span
              class="min-w-0 flex-1 truncate font-medium text-gray-900 dark:text-white"
            >
              {{ step.title }}
            </span>
            <UBadge color="neutral" variant="subtle" size="xs">{{
              step.priority
            }}</UBadge>
            <span class="text-xs text-gray-500 tabular-nums">{{
              step.due_date ?? 'no date'
            }}</span>
          </li>
        </ul>
        <UAlert
          v-if="templateError"
          class="mt-4"
          color="error"
          variant="subtle"
          title="Could not apply the template"
          :description="templateError"
        />
        <div class="mt-4 flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="showTemplate = false"
          />
          <UButton label="Create tasks" icon="i-lucide-check" @click="applyTemplate" />
        </div>
      </template>
    </UModal>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-[220px_220px_1fr]">
        <USelect
          v-model="status"
          :items="statusOptions"
          class="w-full"
          aria-label="Filter by status"
        />
        <EntitySelect
          v-model="branch"
          :items="[{ label: 'All branches', value: '' }, ...branchOptions]"
          placeholder="All branches"
          :loading="branchesPending"
          class="w-full"
          aria-label="Filter by branch"
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
