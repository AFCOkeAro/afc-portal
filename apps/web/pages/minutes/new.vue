<script setup lang="ts">
import { COLLECTIONS, MINUTES_SAMPLES, renderMarkdownSafe } from '@afc/shared'
import type { MinutesSample } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()
const permissions = usePermissions()

const form = ref({
  title: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  location: '',
  branch: '',
  body: '',
})
const attendeePerson = ref('')
const stagedAttendees = ref<Array<{ id: string; label: string }>>([])
const showPreview = ref(false)
const saving = ref(false)
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})

const previewHtml = computed(() => renderMarkdownSafe(form.value.body))
const isBodyEmpty = computed(() => form.value.body.trim().length === 0)

// R1 (Forgiveness): loading a sample replaces the body. Keep the previous
// body so the destructive write is undoable.
const sampleBackup = ref('')
const sampleNotice = ref('')
const justSaved = ref(false)

// R3 (permission usability): staging gates on update, saving gates on
// create. A creator without update must still see the section — otherwise
// the attendee step silently disappears.
const canCreateMinutes = computed(() =>
  permissions.can(COLLECTIONS.officeMinutes, 'create'),
)
const canUpdateMinutes = computed(() =>
  permissions.can(COLLECTIONS.officeMinutes, 'update'),
)
const canStageAttendees = computed(() => canCreateMinutes.value || canUpdateMinutes.value)

// R6 (dirty-navigation guard): the form holds unsaved user work. Warn on
// route leave while dirty; skip once the save has navigated away.
const isDirty = computed(
  () =>
    form.value.title.trim().length > 0 ||
    form.value.meeting_date.trim().length > 0 ||
    form.value.start_time.trim().length > 0 ||
    form.value.end_time.trim().length > 0 ||
    form.value.location.trim().length > 0 ||
    form.value.branch.trim().length > 0 ||
    form.value.body.trim().length > 0 ||
    stagedAttendees.value.length > 0,
)

onBeforeRouteLeave(() => {
  if (justSaved.value || !isDirty.value) return true
  return window.confirm('Leave without saving these minutes? Your changes will be lost.')
})

function stageAttendee() {
  error.value = ''
  const id = attendeePerson.value.trim()
  if (!id) return
  if (stagedAttendees.value.some((row: { id: string }) => row.id === id)) {
    attendeePerson.value = ''
    return
  }
  const label =
    personOptions.value.find(
      (option: { value: string; label: string }) => option.value === id,
    )?.label ?? id
  stagedAttendees.value.push({ id, label })
  attendeePerson.value = ''
}

function unstageAttendee(id: string) {
  stagedAttendees.value = stagedAttendees.value.filter(
    (row: { id: string }) => row.id !== id,
  )
}

function loadSample(sampleId: string) {
  const sample = MINUTES_SAMPLES.find((row: MinutesSample) => row.id === sampleId)
  if (!sample) return
  // R1: confirm before clobbering user-authored content, and always keep an
  // undo copy. Cognitive lens: Forgiveness — destructive actions need undo.
  if (!isBodyEmpty.value) {
    const ok = window.confirm(
      `Load the “${sample.title}” sample? This replaces the current body. You can undo right after.`,
    )
    if (!ok) return
    sampleBackup.value = form.value.body
  } else {
    sampleBackup.value = ''
  }
  form.value.body = sample.body
  sampleNotice.value = sample.title
}

function undoSampleLoad() {
  form.value.body = sampleBackup.value
  sampleBackup.value = ''
  sampleNotice.value = ''
}

const editor = ref<HTMLTextAreaElement | null>(null)

/** Wrap (or insert at) the textarea selection with a Markdown affix pair. */
function surround(before: string, after = '') {
  const area = editor.value
  if (!area) return
  const { selectionStart: start, selectionEnd: end, value } = area
  const selected = value.slice(start, end) || 'text'
  form.value.body = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
  nextTick(() => {
    area.focus()
    const caret = start + before.length + selected.length + after.length
    area.setSelectionRange(caret, caret)
  })
}

/** Prefix every selected line (line-prefix constructs: headings, lists, quote). */
function prefixLines(prefix: string) {
  const area = editor.value
  if (!area) return
  const { selectionStart: start, selectionEnd: end, value } = area
  const selected = value.slice(start, end) || 'text'
  const prefixed = selected
    .split('\n')
    .map((line: string) => `${prefix}${line}`)
    .join('\n')
  form.value.body = `${value.slice(0, start)}${prefixed}${value.slice(end)}`
  nextTick(() => {
    area.focus()
    area.setSelectionRange(start, start + prefixed.length)
  })
}

function insertTable() {
  const area = editor.value
  const table = '\n| Name | Role | Present |\n| ---- | ---- | ------- |\n|  |  |  |\n'
  if (!area) {
    form.value.body += table
    return
  }
  const { selectionStart: start, value } = area
  form.value.body = `${value.slice(0, start)}${table}${value.slice(start)}`
  nextTick(() => {
    area.focus()
    area.setSelectionRange(start + table.length, start + table.length)
  })
}

function insertLink() {
  surround('[', '](https://)')
}

async function save() {
  error.value = ''
  fieldErrors.value = {}
  if (
    form.value.start_time &&
    form.value.end_time &&
    form.value.end_time <= form.value.start_time
  ) {
    fieldErrors.value = { end_time: 'The end time must be after the start time' }
    return
  }
  saving.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/minutes', {
      title: form.value.title,
      meeting_date: form.value.meeting_date,
      ...(form.value.start_time ? { start_time: form.value.start_time } : {}),
      ...(form.value.end_time ? { end_time: form.value.end_time } : {}),
      ...(form.value.location.trim() ? { location: form.value.location.trim() } : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      ...(form.value.body.trim() ? { body: form.value.body } : {}),
    })
    const id = String(created.data.id)
    const failed: string[] = []
    for (const row of stagedAttendees.value) {
      try {
        await api.post(`/api/minutes/${id}/attendees`, { person: row.id })
      } catch {
        failed.push(row.label)
      }
    }
    // R2 (Peak-End / error recovery): error.value set just before
    // navigateTo never renders — the create page unmounts. Carry the
    // partial-attendee failure across navigation as a query flag the detail
    // page consumes and renders as a warning.
    justSaved.value = true
    if (failed.length > 0) {
      await navigateTo({
        path: `/minutes/${id}`,
        query: { attendeesFailed: failed.join(' | ') },
      })
      return
    }
    await navigateTo(`/minutes/${id}`)
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      fieldErrors.value = cause.fields
      error.value = cause.message
    } else {
      error.value = 'Could not save the minutes. Try again.'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="New minutes"
      description="Record a meeting with its time, venue, attendees and a styled Markdown body."
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

    <UCard>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Title"
          required
          class="sm:col-span-2"
          :error="fieldErrors.title"
        >
          <UInput
            v-model="form.title"
            class="w-full"
            :disabled="saving"
            placeholder="e.g. Branch council meeting"
          />
        </UFormField>
        <UFormField label="Meeting date" required :error="fieldErrors.meeting_date">
          <UInput
            v-model="form.meeting_date"
            type="date"
            class="w-full"
            :disabled="saving"
          />
        </UFormField>
        <UFormField label="Branch" :error="fieldErrors.branch">
          <EntitySelect
            v-model="form.branch"
            :items="branchOptions"
            placeholder="Select branch…"
            :loading="branchesPending"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Start time" :error="fieldErrors.start_time">
          <UInput
            v-model="form.start_time"
            type="time"
            class="w-full"
            :disabled="saving"
          />
        </UFormField>
        <UFormField label="End time" :error="fieldErrors.end_time">
          <UInput v-model="form.end_time" type="time" class="w-full" :disabled="saving" />
        </UFormField>
        <UFormField label="Location" class="sm:col-span-2" :error="fieldErrors.location">
          <UInput
            v-model="form.location"
            class="w-full"
            :disabled="saving"
            placeholder="e.g. Anthony Village Tabernacle, Main Hall"
          />
        </UFormField>

        <div class="sm:col-span-2">
          <div class="mb-1 flex items-center justify-between gap-2">
            <label
              class="text-sm font-medium text-gray-700 dark:text-gray-200"
              for="minutes-body"
            >
              Body (Markdown)
            </label>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :icon="showPreview ? 'i-lucide-pencil' : 'i-lucide-eye'"
              :label="showPreview ? 'Edit' : 'Preview'"
              @click="showPreview = !showPreview"
            />
          </div>
          <div
            v-if="!showPreview"
            class="mb-2 flex flex-wrap gap-1"
            role="toolbar"
            aria-label="Markdown formatting"
          >
            <!-- R4 (motor accessibility): sm targets + visible title tooltips.
              xs icon buttons sit below comfortable touch size. -->
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-bold"
              aria-label="Bold"
              title="Bold"
              :disabled="saving"
              @click="surround('**', '**')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-italic"
              aria-label="Italic"
              title="Italic"
              :disabled="saving"
              @click="surround('*', '*')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-underline"
              aria-label="Underline"
              title="Underline"
              :disabled="saving"
              @click="surround('++', '++')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-strikethrough"
              aria-label="Strikethrough"
              title="Strikethrough"
              :disabled="saving"
              @click="surround('~~', '~~')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-1"
              aria-label="Heading 1"
              title="Heading 1"
              :disabled="saving"
              @click="prefixLines('# ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-2"
              aria-label="Heading 2"
              title="Heading 2"
              :disabled="saving"
              @click="prefixLines('## ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-3"
              aria-label="Heading 3"
              title="Heading 3"
              :disabled="saving"
              @click="prefixLines('### ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-list"
              aria-label="Bulleted list"
              title="Bulleted list"
              :disabled="saving"
              @click="prefixLines('- ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-list-ordered"
              aria-label="Numbered list"
              title="Numbered list"
              :disabled="saving"
              @click="prefixLines('1. ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-quote"
              aria-label="Quote"
              title="Quote"
              :disabled="saving"
              @click="prefixLines('> ')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-code"
              aria-label="Code"
              title="Code"
              :disabled="saving"
              @click="surround('`', '`')"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-table"
              aria-label="Table"
              title="Table"
              :disabled="saving"
              @click="insertTable"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-link"
              aria-label="Link"
              title="Link"
              :disabled="saving"
              @click="insertLink"
            />
          </div>
          <!-- Native textarea: the toolbar needs selectionStart/End, which a
            wrapped component ref cannot promise. -->
          <textarea
            v-if="!showPreview"
            id="minutes-body"
            ref="editor"
            v-model="form.body"
            rows="14"
            :disabled="saving"
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            placeholder="Write the minutes in Markdown — select text and use the toolbar to style it."
          />
          <!-- previewHtml comes from the shared XSS-safe renderer
            (escape-first, allowlisted tags), never from raw user HTML. -->
          <!-- eslint-disable vue/no-v-html -->
          <div
            v-else-if="!isBodyEmpty"
            class="markdown-body min-h-56 rounded-md border border-gray-200 p-4 text-sm dark:border-gray-800"
            v-html="previewHtml"
          />
          <!-- eslint-enable vue/no-v-html -->
          <!-- R5: empty-preview hint — a blank preview panel reads as broken. -->
          <p
            v-else
            class="min-h-56 rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
          >
            Nothing to preview yet — write Markdown above or load a sample below.
          </p>
          <!-- R1 undo: the sample load replaced body content; one tap restores it. -->
          <UAlert
            v-if="sampleNotice"
            class="mt-2"
            color="neutral"
            variant="subtle"
            :title="`Sample “${sampleNotice}” loaded`"
            description="The previous body was replaced."
          >
            <template #actions>
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                label="Undo"
                icon="i-lucide-undo-2"
                @click="undoSampleLoad"
              />
            </template>
          </UAlert>
          <p v-if="fieldErrors.body" class="mt-1 text-sm text-red-600">
            {{ fieldErrors.body }}
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>Samples (replace the body):</span>
            <UButton
              v-for="sample in MINUTES_SAMPLES"
              :key="sample.id"
              size="xs"
              color="neutral"
              variant="outline"
              :label="sample.title"
              :title="sample.description"
              :disabled="saving"
              @click="loadSample(sample.id)"
            />
          </div>
        </div>

        <!-- R3: creators without update must still see this section. Staging
          gates on update server-side would silently drop it; surfacing it
          here with a note keeps the loss visible. Server route still owns
          the real permission (update on office_minutes). -->
        <div v-if="canStageAttendees" class="sm:col-span-2">
          <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
            Attendees
          </span>
          <UAlert
            v-if="!canUpdateMinutes"
            class="mb-2"
            color="warning"
            variant="subtle"
            title="Attendee attach needs update permission"
            description="You can stage attendees, but they attach after save through an update-gated route. Any that fail will be flagged on the detail page."
          />
          <ul
            v-if="stagedAttendees.length > 0"
            class="mb-2 divide-y divide-gray-100 rounded-md border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-800"
          >
            <li
              v-for="row in stagedAttendees"
              :key="row.id"
              class="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <span class="text-gray-700 dark:text-gray-200">{{ row.label }}</span>
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :aria-label="`Remove ${row.label}`"
                :title="`Remove ${row.label}`"
                :disabled="saving"
                @click="unstageAttendee(row.id)"
              />
            </li>
          </ul>
          <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
            <EntitySelect
              v-model="attendeePerson"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              :disabled="saving"
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
              :disabled="saving"
              @click="stageAttendee"
            />
          </div>
          <p class="mt-1 text-xs text-gray-500">
            People are searched from the directory — no manual IDs. Staff-user attendees
            stay API-supported and are attached from the detail page once a scoped staff
            directory exists.
          </p>
        </div>
      </div>

      <!-- R6: save errors are announced to assistive tech. -->
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        role="alert"
        aria-live="assertive"
        title="Could not save the minutes"
        :description="error"
      />
      <div class="mt-4 flex gap-2">
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="create">
          <UButton
            label="Save minutes"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="saving"
            @click="save"
          />
        </PermissionGate>
      </div>
    </UCard>
  </div>
</template>
