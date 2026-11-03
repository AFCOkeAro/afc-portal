<script setup lang="ts">
import {
  COLLECTIONS,
  TASK_TEMPLATES,
  expandTaskTemplate,
  getTaskTemplate,
} from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const { branchOptions } = useBranchOptions()
const route = useRoute()
const router = useRouter()

const TABS = [
  { id: 'workflows', label: 'Workflows', icon: 'i-lucide-git-branch' },
  { id: 'tasks', label: 'Tasks', icon: 'i-lucide-list-checks' },
] as const
type TabId = (typeof TABS)[number]['id']

const tab = ref<TabId>((route.query.tab as TabId) ?? 'workflows')

function goTab(next: TabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

// --- Workflows tab ---
const canCreate = computed(() => permissions.can(COLLECTIONS.tasks, 'create'))
const openTemplate = ref<string | null>(null)
const applyForm = ref<Record<string, { branch: string; baseDate: string }>>({})
const applying = ref(false)
const applyError = ref('')
const applyDone = ref('')

function draftFor(id: string): { branch: string; baseDate: string } {
  const found = applyForm.value[id]
  if (found) return found
  const draft = { branch: '', baseDate: '' }
  applyForm.value = { ...applyForm.value, [id]: draft }
  return draft
}

function stepsOf(id: string) {
  const template = getTaskTemplate(id)
  if (!template) return []
  return expandTaskTemplate(template, null)
}

async function applyTemplate(id: string): Promise<void> {
  const draft = draftFor(id)
  if (draft.branch === '') {
    applyError.value = 'Choose the branch the tasks belong to.'
    return
  }
  applying.value = true
  applyError.value = ''
  applyDone.value = ''
  try {
    const res = await api.post<{ data: { created: number } }>(
      '/api/tasks/from-template',
      {
        template: id,
        branch: draft.branch,
        base_date: draft.baseDate === '' ? null : draft.baseDate,
      },
    )
    applyDone.value = `Created ${res.data.created} tasks.`
  } catch (cause) {
    applyError.value =
      (cause as { message?: string }).message ?? 'Could not apply the template'
  } finally {
    applying.value = false
  }
}

// --- Tasks tab ---
const status = ref('all')
const showForm = ref(false)
const form = ref({
  title: '',
  assignee_user: '',
  assignee_person: '',
  branch: '',
  due_date: '',
  priority: 'normal',
  blocked_by: '',
})
const error = ref('')
const { data, pending, refresh } = await useAsyncData('tasks-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/tasks'),
)
const rows = computed(() => (data.value?.data ?? []) as Record<string, unknown>[])

const taskStatusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'To do', value: 'todo' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Blocked', value: 'blocked' },
  { label: 'Done', value: 'done' },
]

const taskPriorityOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

async function createTask(): Promise<void> {
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
      ...(form.value.blocked_by ? { blocked_by: form.value.blocked_by } : {}),
    })
    showForm.value = false
    form.value = {
      title: '',
      assignee_user: '',
      assignee_person: '',
      branch: '',
      due_date: '',
      priority: 'normal',
      blocked_by: '',
    }
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not create task'
  }
}

function isBlocked(row: Record<string, unknown>): boolean {
  return (
    row.blocked_by !== null &&
    row.blocked_by !== undefined &&
    String(row.blocked_by).length > 0
  )
}

onMounted(() => {
  if (route.query.new !== undefined) showForm.value = true
})
</script>

<template>
  <div>
    <PageHeader
      title="Workflows & Tasks"
      description="Task templates and individual tasks in one place."
    />
    <nav aria-label="Workflows sections" class="mt-4">
      <div
        class="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          v-for="entry in TABS"
          :key="entry.id"
          type="button"
          :aria-current="tab === entry.id ? 'page' : undefined"
          :class="[
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm',
            tab === entry.id
              ? 'bg-primary-950 font-medium text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
          ]"
          @click="goTab(entry.id)"
        >
          <UIcon :name="entry.icon" class="size-4" />{{ entry.label }}
        </button>
      </div>
    </nav>

    <!-- WORKFLOWS TAB -->
    <section v-if="tab === 'workflows'" aria-label="Workflows" class="mt-4">
      <div class="grid gap-3 lg:grid-cols-2">
        <UCard v-for="template in TASK_TEMPLATES" :key="template.id">
          <template #header>
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left"
              @click="openTemplate = openTemplate === template.id ? null : template.id"
            >
              <span class="font-semibold">{{ template.label }}</span>
              <UBadge color="neutral" variant="subtle" class="ml-auto">
                {{ template.steps.length }} steps
              </UBadge>
              <UIcon
                :name="
                  openTemplate === template.id
                    ? 'i-lucide-chevron-up'
                    : 'i-lucide-chevron-down'
                "
                class="size-4 text-gray-400"
              />
            </button>
          </template>
          <p class="text-sm text-gray-500">{{ template.description }}</p>
          <ol v-if="openTemplate === template.id" class="mt-3 space-y-1.5">
            <li
              v-for="(step, index) in stepsOf(template.id)"
              :key="index"
              class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900"
            >
              <span class="font-mono text-xs text-gray-500">{{ index + 1 }}</span>
              <span class="min-w-0 flex-1 truncate">{{ step.title }}</span>
              <UBadge color="neutral" variant="subtle" size="xs">{{
                step.priority
              }}</UBadge>
              <span v-if="step.assignee_person" class="text-xs text-gray-500"
                >→ {{ step.assignee_person }}</span
              >
            </li>
          </ol>
          <div v-if="canCreate" class="mt-3 flex flex-wrap items-end gap-2">
            <UFormField label="Branch" class="min-w-40 flex-1">
              <USelect
                v-model="draftFor(template.id).branch"
                :items="branchOptions"
                placeholder="Choose a branch…"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Base date" class="w-40">
              <UInput
                v-model="draftFor(template.id).baseDate"
                type="date"
                class="w-full"
              />
            </UFormField>
            <UButton
              label="Use template"
              icon="i-lucide-play"
              :loading="applying"
              @click="applyTemplate(template.id)"
            />
          </div>
        </UCard>
      </div>
      <p v-if="applyDone !== ''" class="mt-3 text-sm text-green-700">{{ applyDone }}</p>
      <p v-if="applyError !== ''" class="mt-3 text-sm text-red-600">{{ applyError }}</p>
    </section>

    <!-- TASKS TAB -->
    <section v-else-if="tab === 'tasks'" aria-label="Tasks" class="mt-4">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Status" class="w-52">
          <USelect v-model="status" :items="taskStatusOptions" class="w-full" />
        </UFormField>
      </div>
      <p v-if="pending" class="mt-3 text-sm text-gray-500">Loading tasks…</p>
      <div v-else-if="rows.length === 0" class="mt-3">
        <UCard>
          <EmptyState title="No tasks" description="Create a task or apply a template." />
        </UCard>
      </div>
      <div v-else class="mt-3 space-y-2">
        <UCard v-for="row in rows" :key="String(row.id)">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <NuxtLink
              :to="`/tasks/${row.id}`"
              class="font-semibold text-primary-600 hover:underline"
              >{{ row.title }}</NuxtLink
            >
            <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
            <UBadge color="neutral" variant="subtle">{{ row.priority }}</UBadge>
            <span v-if="row.due_date" class="text-gray-500">{{ row.due_date }}</span>
            <span v-if="isBlocked(row)" class="text-xs text-red-500"
              >Blocked by: {{ row.blocked_by }}</span
            >
            <span v-if="row.assignee_person" class="text-xs text-gray-500"
              >→ {{ row.assignee_person }}</span
            >
          </div>
          <p v-if="row.description" class="mt-1 text-sm text-gray-600">
            {{ row.description }}
          </p>
        </UCard>
      </div>
      <UCard v-if="canCreate" class="mt-4">
        <template #header>
          <h3 class="font-semibold">Create task</h3>
        </template>
        <div class="grid gap-2 sm:grid-cols-2">
          <UFormField label="Title" class="sm:col-span-2">
            <UInput v-model="form.title" class="w-full" />
          </UFormField>
          <UFormField label="Priority">
            <USelect
              v-model="form.priority"
              :items="taskPriorityOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Due date">
            <UInput v-model="form.due_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Blocked by (task ID)">
            <UInput
              v-model="form.blocked_by"
              class="w-full"
              placeholder="Optional task ID"
            />
          </UFormField>
        </div>
        <UButton
          class="mt-3"
          label="Create task"
          icon="i-lucide-plus"
          @click="createTask"
        />
        <p v-if="error !== ''" class="mt-2 text-sm text-red-600">{{ error }}</p>
      </UCard>
    </section>
  </div>
</template>
