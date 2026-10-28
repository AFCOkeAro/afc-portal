<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const {
  data,
  pending,
  error: loadError,
  refresh,
} = await useAsyncData(`task-${id}`, () =>
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

/* RACI ring (AFC-833): four person seats, saved to the dedicated endpoint
 * (null clears a seat). Initialised from the loaded row on every refresh. */
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const raci = ref({
  raci_responsible: '',
  raci_accountable: '',
  raci_consulted: '',
  raci_informed: '',
})
const raciError = ref('')
const raciSaving = ref(false)
const RACI_SEATS = [
  { key: 'raci_responsible', label: 'Responsible (does the work)' },
  { key: 'raci_accountable', label: 'Accountable (owns the outcome)' },
  { key: 'raci_consulted', label: 'Consulted (two-way input)' },
  { key: 'raci_informed', label: 'Informed (one-way update)' },
] as const

function resetRaci(): void {
  const row = (data.value?.data ?? {}) as Record<string, unknown>
  raci.value = {
    raci_responsible:
      typeof row.raci_responsible === 'string' ? row.raci_responsible : '',
    raci_accountable:
      typeof row.raci_accountable === 'string' ? row.raci_accountable : '',
    raci_consulted: typeof row.raci_consulted === 'string' ? row.raci_consulted : '',
    raci_informed: typeof row.raci_informed === 'string' ? row.raci_informed : '',
  }
}

watch(
  () => data.value?.data,
  () => resetRaci(),
  { immediate: true },
)

async function saveRaci(): Promise<void> {
  raciError.value = ''
  raciSaving.value = true
  try {
    const body: Record<string, string | null> = {}
    for (const seat of RACI_SEATS) {
      const value = raci.value[seat.key]
      body[seat.key] = value === '' ? null : value
    }
    await api.patch(`/api/tasks/${id}/raci`, body)
    await refresh()
  } catch (cause) {
    raciError.value =
      (cause as { message?: string }).message ?? 'Could not save the RACI ring'
  } finally {
    raciSaving.value = false
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

    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      title="Could not load this task"
      :description="loadError.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
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
          title="Could not update the task"
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
          <h2 class="font-semibold">RACI ring</h2>
        </template>
        <UAlert
          v-if="raciError"
          class="mb-3"
          color="error"
          variant="subtle"
          title="Could not save the RACI ring"
          :description="raciError"
        />
        <PermissionGate :collection="COLLECTIONS.tasks" action="update">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField v-for="seat in RACI_SEATS" :key="seat.key" :label="seat.label">
              <div class="flex items-center gap-1">
                <EntitySelect
                  v-model="raci[seat.key]"
                  :items="personOptions"
                  placeholder="Type a name to search…"
                  :loading="personPending"
                  server-search
                  class="w-full"
                  @update:search-term="onPersonSearch"
                />
                <UButton
                  v-if="raci[seat.key]"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  icon="i-lucide-x"
                  aria-label="Clear seat"
                  @click="raci[seat.key] = ''"
                />
              </div>
            </UFormField>
          </div>
          <div class="mt-3 flex justify-end">
            <UButton label="Save RACI" :loading="raciSaving" @click="saveRaci()" />
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
        <p v-else class="text-sm text-gray-500 dark:text-gray-400">No audit rows.</p>
      </UCard>
    </div>

    <EmptyState
      v-else-if="!loadError"
      title="Task not found"
      description="It does not exist or is outside your scope."
    />
  </div>
</template>
