<script setup lang="ts">
import { COLLECTIONS, renderMarkdownSafe } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const id = String(route.params.id)

const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

const {
  data,
  pending,
  error: loadError,
  refresh,
} = await useAsyncData(
  () => `minutes-${id}`,
  () =>
    api.get<{
      data: Record<string, unknown>
      attendees: Record<string, unknown>[]
      audit: Record<string, unknown>[]
    }>(`/api/minutes/${id}`),
)

const attendees = computed(
  () => (data.value?.attendees ?? []) as Record<string, unknown>[],
)
const person = ref('')
const error = ref('')
const addSaving = ref(false)

async function addAttendee() {
  error.value = ''
  const pid = person.value.trim()
  if (!pid) return
  addSaving.value = true
  try {
    await api.post(`/api/minutes/${id}/attendees`, { person: pid })
    person.value = ''
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not add the attendee'
  } finally {
    addSaving.value = false
  }
}

function timeRange(row: Record<string, unknown>): string {
  const start = typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : ''
  const end = typeof row.end_time === 'string' ? row.end_time.slice(0, 5) : ''
  if (start && end) return `${start}–${end}`
  return start || end || '—'
}

const hasBody = computed(
  () =>
    typeof data.value?.data?.body === 'string' &&
    String(data.value.data.body).trim().length > 0,
)
const bodyHtml = computed(() =>
  hasBody.value ? renderMarkdownSafe(String(data.value?.data?.body)) : '',
)

// Status
const statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Review', value: 'review' },
  { label: 'Accepted', value: 'accepted' },
]
const newStatus = ref(String(data.value?.data?.status ?? 'draft'))
const statusSaving = ref(false)
const statusError = ref('')

async function updateStatus() {
  statusError.value = ''
  statusSaving.value = true
  try {
    await api.patch(`/api/minutes/${id}/status`, { status: newStatus.value })
    await refresh()
  } catch (cause) {
    statusError.value =
      (cause as { message?: string }).message ?? 'Could not update status'
  } finally {
    statusSaving.value = false
  }
}

// Edit
const editing = ref(false)
const editSaving = ref(false)
const editError = ref('')
const editFieldErrors = ref<Record<string, string>>({})
const editForm = ref({
  title: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  location: '',
  branch: '',
  body: '',
})

function startEdit() {
  const row = data.value?.data ?? {}
  editForm.value = {
    title: String(row.title ?? ''),
    meeting_date: String(row.meeting_date ?? ''),
    start_time: row.start_time ? String(row.start_time).slice(0, 5) : '',
    end_time: row.end_time ? String(row.end_time).slice(0, 5) : '',
    location: String(row.location ?? ''),
    branch: String(row.branch ?? ''),
    body: String(row.body ?? ''),
  }
  editFieldErrors.value = {}
  editError.value = ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function saveEdit() {
  editError.value = ''
  editFieldErrors.value = {}
  if (
    editForm.value.start_time &&
    editForm.value.end_time &&
    editForm.value.end_time <= editForm.value.start_time
  ) {
    editFieldErrors.value = { end_time: 'The end time must be after the start time' }
    return
  }
  editSaving.value = true
  try {
    await api.patch(`/api/minutes/${id}`, {
      title: editForm.value.title,
      meeting_date: editForm.value.meeting_date,
      start_time: editForm.value.start_time || null,
      end_time: editForm.value.end_time || null,
      location: editForm.value.location || null,
      branch: editForm.value.branch || null,
      body: editForm.value.body || null,
    })
    editing.value = false
    await refresh()
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      editFieldErrors.value = cause.fields
      editError.value = cause.message
    } else {
      editError.value =
        (cause as { message?: string }).message ?? 'Could not save changes'
    }
  } finally {
    editSaving.value = false
  }
}

// Meeting officers
const officers = ref({
  chairman: '',
  opening_prayer: '',
  closing_prayer: '',
  minutes_read_by: '',
  minutes_moved_by: '',
  minutes_seconded_by: '',
  adjourn_moved_by: '',
  adjourn_seconded_by: '',
})
const officersSaving = ref(false)
const officersError = ref('')

async function saveOfficers() {
  officersError.value = ''
  officersSaving.value = true
  try {
    await api.patch(`/api/minutes/${id}/officers`, officers.value)
    await refresh()
  } catch (cause) {
    officersError.value =
      (cause as { message?: string }).message ?? 'Could not save officers'
  } finally {
    officersSaving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Minutes detail"
      description="Read-only view; attendees managed below."
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

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="mt-4 space-y-4">
      <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Edit minutes</h2>
              <UButton
                v-if="!editing"
                size="xs"
                label="Edit"
                icon="i-lucide-pencil"
                @click="startEdit"
              />
            </div>
          </template>
          <div v-if="editing" class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Title"
              required
              class="sm:col-span-2"
              :error="editFieldErrors.title"
            >
              <UInput v-model="editForm.title" class="w-full" />
            </UFormField>
            <UFormField
              label="Meeting date"
              required
              :error="editFieldErrors.meeting_date"
            >
              <UInput v-model="editForm.meeting_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Branch" :error="editFieldErrors.branch">
              <EntitySelect
                v-model="editForm.branch"
                :items="branchOptions"
                placeholder="Select branch…"
                :loading="branchesPending"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Start time" :error="editFieldErrors.start_time">
              <UInput v-model="editForm.start_time" type="time" class="w-full" />
            </UFormField>
            <UFormField label="End time" :error="editFieldErrors.end_time">
              <UInput v-model="editForm.end_time" type="time" class="w-full" />
            </UFormField>
            <UFormField
              label="Location"
              class="sm:col-span-2"
              :error="editFieldErrors.location"
            >
              <UInput v-model="editForm.location" class="w-full" />
            </UFormField>
            <div class="sm:col-span-2">
              <MinutesBodyEditor
                v-model="editForm.body"
                textarea-id="minutes-edit-body"
                :field-error="editFieldErrors.body"
              />
            </div>
          </div>
          <UAlert
            v-if="editError"
            class="mt-4"
            color="error"
            variant="subtle"
            title="Could not save the minutes"
            :description="editError"
          />
          <div v-if="editing" class="mt-4 flex gap-2">
            <UButton
              label="Save changes"
              icon="i-lucide-check"
              :loading="editSaving"
              :disabled="editSaving"
              @click="saveEdit"
            />
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              :disabled="editSaving"
              @click="cancelEdit"
            />
          </div>
        </UCard>
      </PermissionGate>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Status</h2>
        </template>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="flex items-center gap-2">
            <USelect v-model="newStatus" :items="statusOptions" class="w-48" />
            <UButton
              label="Update status"
              :loading="statusSaving"
              @click="updateStatus"
            />
          </div>
        </PermissionGate>
        <UAlert
          v-if="statusError"
          class="mt-3"
          color="error"
          variant="subtle"
          :description="statusError"
        />
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Meeting officers & actions</h2>
        </template>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Chairman">
              <EntitySelect
                v-model="officers.chairman"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Opening prayer">
              <EntitySelect
                v-model="officers.opening_prayer"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Closing prayer">
              <EntitySelect
                v-model="officers.closing_prayer"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Reading of minutes">
              <EntitySelect
                v-model="officers.minutes_read_by"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Minutes acceptance - Moved by">
              <EntitySelect
                v-model="officers.minutes_moved_by"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Minutes acceptance - Seconded by">
              <EntitySelect
                v-model="officers.minutes_seconded_by"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Motion to adjourn - Moved by">
              <EntitySelect
                v-model="officers.adjourn_moved_by"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Motion to adjourn - Seconded by">
              <EntitySelect
                v-model="officers.adjourn_seconded_by"
                :items="personOptions"
                placeholder="Select person…"
                server-search
                :loading="personPending"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
          </div>
          <p class="mt-2 text-xs text-gray-500">
            Selected officers will be automatically added to the attendees list.
          </p>
          <div class="mt-3">
            <UButton
              label="Save officers"
              icon="i-lucide-check"
              :loading="officersSaving"
              @click="saveOfficers"
            />
          </div>
        </PermissionGate>
        <UAlert
          v-if="officersError"
          class="mt-3"
          color="error"
          variant="subtle"
          :description="officersError"
        />
      </UCard>

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
            <dt class="text-gray-500">Time</dt>
            <dd>{{ timeRange(data.data) }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Location</dt>
            <dd>{{ data.data.location ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Body</dt>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <dd v-if="hasBody" class="markdown-body mt-1" v-html="bodyHtml" />
            <dd v-else class="mt-1">—</dd>
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
            {{ row.person ?? row.attendee_user ?? row.id }}
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No attendees recorded.</p>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <EntitySelect
              v-model="person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              aria-label="Person to add as attendee"
              @update:search-term="onPersonSearch"
            />
            <UButton
              label="Add attendee"
              color="neutral"
              variant="outline"
              icon="i-lucide-user-plus"
              :loading="addSaving"
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

<style scoped>
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3) {
  font-weight: 700;
  margin: 0.75rem 0 0.375rem;
}
.markdown-body :deep(h1) {
  font-size: 1.25rem;
}
.markdown-body :deep(h2) {
  font-size: 1.125rem;
}
.markdown-body :deep(h3) {
  font-size: 1rem;
}
.markdown-body :deep(p) {
  margin: 0.375rem 0;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 0.375rem 0 0.375rem 1.25rem;
}
.markdown-body :deep(ul) {
  list-style: disc;
}
.markdown-body :deep(ol) {
  list-style: decimal;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid var(--ui-border-accented);
  padding-left: 0.75rem;
  color: var(--ui-text-muted);
  margin: 0.5rem 0;
}
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 0.5rem 0;
  font-size: 0.875rem;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--ui-border);
  padding: 0.375rem 0.625rem;
  text-align: left;
}
.markdown-body :deep(th) {
  font-weight: 600;
}
</style>
