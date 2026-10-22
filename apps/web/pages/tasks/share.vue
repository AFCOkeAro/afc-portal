<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Share target (AFC-686): Web Share Target API entry point. The OS hands
 * shared title/text/url over as query params; the user picks a branch and
 * saves it as an ordinary task through the same POST /api/tasks path.
 *
 * Manifest: share_target action /tasks/share, method GET, title/text/url.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

function queryParam(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}

const form = ref({
  title: queryParam('title'),
  description: [queryParam('text'), queryParam('url')].filter((part) => part !== '').join('\n'),
  assignee_user: '',
  assignee_person: '',
  branch: '',
  due_date: '',
  priority: 'normal',
})
const error = ref('')
const saving = ref(false)

const priorityOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

async function save() {
  error.value = ''
  saving.value = true
  try {
    await api.post('/api/tasks', {
      title: form.value.title,
      ...(form.value.description === '' ? {} : { description: form.value.description }),
      ...(form.value.assignee_user === '' ? {} : { assignee_user: form.value.assignee_user }),
      ...(form.value.assignee_person === '' ? {} : { assignee_person: form.value.assignee_person }),
      ...(form.value.branch === '' ? {} : { branch: form.value.branch }),
      ...(form.value.due_date === '' ? {} : { due_date: form.value.due_date }),
      priority: form.value.priority,
    })
    await router.push('/tasks')
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not save the task'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Save shared item"
      description="Turn what was shared with AFC Portal into a task."
    >
      <template #actions>
        <UButton label="Cancel" color="neutral" variant="ghost" to="/tasks" />
        <PermissionGate :collection="COLLECTIONS.tasks" action="create">
          <UButton label="Save task" icon="i-lucide-check" :loading="saving" @click="save()" />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Title" class="sm:col-span-2">
          <UInput v-model="form.title" class="w-full" placeholder="Task title" />
        </UFormField>
        <UFormField label="Details" class="sm:col-span-2">
          <UTextarea v-model="form.description" class="w-full" placeholder="Shared text and link land here" :rows="4" />
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
        v-if="error !== ''"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not save the task"
        :description="error"
      />
    </UCard>
  </div>
</template>
