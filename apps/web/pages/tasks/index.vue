<script setup lang="ts">
import { isTaskOverdue } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const status = ref('all')
const mine = ref(false)
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
const { data, pending, refresh } = await useAsyncData(
  'tasks-list',
  () =>
    api.get<{ data: Record<string, unknown>[] }>('/api/tasks', { query: query.value }),
  { watch: [query] },
)

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
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Tasks</h1>
      <button
        class="rounded bg-blue-600 px-3 py-1.5 text-white"
        @click="showForm = !showForm"
      >
        New task
      </button>
    </div>
    <div class="mt-4 flex gap-3 text-sm">
      <label
        >Status
        <select v-model="status" class="rounded border px-2 py-1">
          <option value="all">All</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select></label
      >
      <label><input v-model="mine" type="checkbox" /> Assigned to me</label>
      <a href="/api/tasks/export.csv" class="rounded border px-2 py-1">Export CSV</a>
    </div>
    <div v-if="showForm" class="mt-4 rounded border p-4">
      <div class="grid gap-2">
        <input
          v-model="form.title"
          placeholder="Title"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.assignee_user"
          placeholder="Assignee user id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.assignee_person"
          placeholder="Assignee person id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.branch"
          placeholder="Branch id"
          class="rounded border px-2 py-1"
        />
        <input v-model="form.due_date" type="date" class="rounded border px-2 py-1" />
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
      <button class="mt-2 rounded bg-blue-600 px-3 py-1.5 text-white" @click="create">
        Save
      </button>
    </div>
    <p v-if="pending" class="mt-4">Loading…</p>
    <table v-else class="mt-4 w-full text-sm">
      <thead>
        <tr class="text-left">
          <th>Title</th>
          <th>Status</th>
          <th>Due</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data?.data ?? []" :key="String(row.id)" class="border-t">
          <td class="py-2 font-medium">{{ row.title }}</td>
          <td>{{ row.status }}</td>
          <td
            :class="
              isTaskOverdue({
                due_date: (row.due_date as string | null) ?? null,
                status: String(row.status),
              })
                ? 'font-semibold text-red-600'
                : ''
            "
          >
            {{ row.due_date ?? '—' }}
          </td>
          <td>
            <NuxtLink :to="`/tasks/${String(row.id)}`" class="text-blue-600"
              >Open</NuxtLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
