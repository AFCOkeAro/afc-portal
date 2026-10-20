<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const person = ref('')
const error = ref('')

const {
  data,
  pending,
  error: loadError,
  refresh,
} = await useAsyncData(`minutes-${id}`, () =>
  api.get<{
    data: Record<string, unknown>
    attendees: Record<string, unknown>[]
    audit: Record<string, unknown>[]
  }>(`/api/minutes/${id}`),
)

async function addAttendee() {
  error.value = ''
  try {
    await api.post(`/api/minutes/${id}/attendees`, { person: person.value })
    person.value = ''
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not add the attendee'
  }
}

const title = computed(() => String(data.value?.data?.title ?? 'Minutes'))
const attendees = computed(() => data.value?.attendees ?? [])
</script>

<template>
  <div>
    <PageHeader
      :title="title"
      description="File, attendees and audit trail. Writes are area-scoped per the matrix."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Minutes"
          to="/minutes"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      title="Could not load these minutes"
      :description="loadError.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Meeting</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Meeting date</dt>
            <dd>{{ data.data.meeting_date }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Body</dt>
            <dd class="mt-1">{{ data.data.body ?? '—' }}</dd>
          </div>
          <div v-if="data.data.file" class="col-span-2">
            <dt class="text-gray-500">File</dt>
            <dd class="mt-1 font-mono text-xs">{{ data.data.file }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Attendees ({{ attendees.length }})</h2>
        </template>
        <ul
          v-if="attendees.length > 0"
          class="divide-y divide-gray-100 text-sm dark:divide-gray-800"
        >
          <li
            v-for="row in attendees"
            :key="String(row.id)"
            class="py-1.5 text-gray-600 dark:text-gray-300"
          >
            {{ row.person ?? row.attendee_user }}
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No attendees recorded.</p>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <UInput
              v-model="person"
              class="w-full"
              placeholder="Person id"
              aria-label="Person id"
            />
            <UButton
              label="Add attendee"
              color="neutral"
              variant="outline"
              icon="i-lucide-user-plus"
              @click="addAttendee"
            />
          </div>
        </PermissionGate>
        <UAlert
          v-if="error"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Could not add the attendee"
          :description="error"
        />
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
      title="Minutes not found"
      description="They do not exist or are outside your scope."
    />
  </div>
</template>
