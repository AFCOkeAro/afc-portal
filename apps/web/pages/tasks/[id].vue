<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const { data, pending, refresh } = await useAsyncData(`task-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/tasks/${id}`,
  ),
)

async function setStatus(status: string) {
  error.value = ''
  try {
    await api.patch(`/api/tasks/${id}`, { status })
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not update the task'
  }
}

const title = computed(() => String(data.value?.data?.title ?? 'Task'))
</script>

<template>
  <div>
    <PageHeader :title="title" description="Status, priority, due date and audit trail.">
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Tasks"
          to="/tasks"
        />
      </template>
    </PageHeader>

    <div v-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Task</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Priority</dt>
            <dd>{{ data.data.priority }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Due</dt>
            <dd>{{ data.data.due_date ?? '—' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Description</dt>
            <dd class="mt-1">{{ data.data.description ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Move status</h2>
        </template>
        <UAlert
          v-if="error"
          class="mb-3"
          color="error"
          variant="subtle"
          :description="error"
        />
        <PermissionGate :collection="COLLECTIONS.tasks" action="update">
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Start"
              color="neutral"
              variant="outline"
              icon="i-lucide-play"
              @click="setStatus('in_progress')"
            />
            <UButton
              label="Block"
              color="neutral"
              variant="outline"
              icon="i-lucide-octagon-pause"
              @click="setStatus('blocked')"
            />
            <UButton label="Done" icon="i-lucide-check" @click="setStatus('done')" />
          </div>
        </PermissionGate>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Audit trail</h2>
        </template>
        <ul v-if="(data.audit ?? []).length > 0" class="space-y-2 text-sm">
          <li v-for="row in data.audit ?? []" :key="String(row.id)">
            <span class="font-medium">{{ row.event_type }}</span>
            <span v-if="row.detail" class="text-gray-500"> · {{ row.detail }}</span>
            <span class="text-gray-400"> ({{ row.created_at }})</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No audit rows.</p>
      </UCard>
    </div>
  </div>
</template>
