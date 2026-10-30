<script setup lang="ts">
import { COLLECTIONS, renderMarkdownSafe } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const person = ref('')
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()
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

/**
 * The body is stored as Markdown and rendered through the shared XSS-safe
 * renderer: raw HTML in the source is escaped before any Markdown construct
 * is recognised, so this v-html can only emit the allowlisted tags.
 */
const bodyHtml = computed(() => renderMarkdownSafe(String(data.value?.data?.body ?? '')))
const hasBody = computed(() => String(data.value?.data?.body ?? '').trim().length > 0)
function timeRange(row: Record<string, unknown>): string {
  const start = typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : ''
  const end = typeof row.end_time === 'string' ? row.end_time.slice(0, 5) : ''
  if (start && end) return `${start}–${end}`
  return start || end || '—'
}

/**
 * Edit form (AFC-912): same fields as minutes/new.vue, validated by the same
 * minutesFormSchema (partial) on PATCH /api/minutes/:id. The body editor is
 * the shared MinutesBodyEditor, so the Raw | Preview toggle and the toolbar
 * cannot drift from the create page.
 */
const editing = ref(false)
const editForm = ref({
  title: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  location: '',
  branch: '',
  body: '',
})
const editSaving = ref(false)
const editError = ref('')
const editFieldErrors = ref<Record<string, string>>({})

function startEdit() {
  const row = data.value?.data
  if (!row) return
  editError.value = ''
  editFieldErrors.value = {}
  editForm.value = {
    title: String(row.title ?? ''),
    meeting_date: String(row.meeting_date ?? '').slice(0, 10),
    start_time: typeof row.start_time === 'string' ? row.start_time.slice(0, 5) : '',
    end_time: typeof row.end_time === 'string' ? row.end_time.slice(0, 5) : '',
    location: String(row.location ?? ''),
    branch: typeof row.branch === 'string' ? row.branch : '',
    body: String(row.body ?? ''),
  }
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  editError.value = ''
  editFieldErrors.value = {}
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
      location: editForm.value.location.trim() || null,
      body: editForm.value.body || null,
      ...(editForm.value.branch ? { branch: editForm.value.branch } : {}),
    })
    editing.value = false
    await refresh()
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      editFieldErrors.value = cause.fields
      editError.value = cause.message
    } else {
      editError.value = 'Could not save the minutes. Try again.'
    }
  } finally {
    editSaving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      :title="title"
      description="File, attendees and audit trail. Writes are area-scoped per the matrix."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <UButton
            v-if="!editing"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-pencil"
            label="Edit"
            @click="startEdit"
          />
        </PermissionGate>
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
      <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
        <UCard v-if="editing">
          <template #header>
            <h2 class="font-semibold">Edit minutes</h2>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
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
          <div class="mt-4 flex gap-2">
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
            <!-- bodyHtml comes from the shared XSS-safe renderer
              (escape-first, allowlisted tags), never from raw user HTML. -->
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
            {{ row.person ?? row.attendee_user }}
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
.markdown-body :deep(code) {
  font-family: ui-monospace, monospace;
  font-size: 0.875em;
}
.markdown-body :deep(pre) {
  overflow-x: auto;
  padding: 0.625rem;
  border-radius: 0.375rem;
}
.markdown-body :deep(a) {
  text-decoration: underline;
}
</style>
