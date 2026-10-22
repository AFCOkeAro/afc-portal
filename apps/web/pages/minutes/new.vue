<script setup lang="ts">
import { COLLECTIONS, MINUTES_SAMPLES, renderMarkdownSafe } from '@afc/shared'
import type { MinutesSample } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

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
  if (sample) form.value.body = sample.body
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
    if (failed.length > 0) {
      error.value = `Minutes saved, but these attendees could not be added: ${failed.join(', ')}. Add them again on the detail page.`
      await navigateTo(`/minutes/${id}`)
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
            placeholder="e.g. Branch council meeting"
          />
        </UFormField>
        <UFormField label="Meeting date" required :error="fieldErrors.meeting_date">
          <UInput v-model="form.meeting_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Branch" :error="fieldErrors.branch">
          <EntitySelect
            v-model="form.branch"
            :items="branchOptions"
            placeholder="Select branch…"
            :loading="branchesPending"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Start time" :error="fieldErrors.start_time">
          <UInput v-model="form.start_time" type="time" class="w-full" />
        </UFormField>
        <UFormField label="End time" :error="fieldErrors.end_time">
          <UInput v-model="form.end_time" type="time" class="w-full" />
        </UFormField>
        <UFormField label="Location" class="sm:col-span-2" :error="fieldErrors.location">
          <UInput
            v-model="form.location"
            class="w-full"
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
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-bold"
              aria-label="Bold"
              @click="surround('**', '**')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-italic"
              aria-label="Italic"
              @click="surround('*', '*')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-underline"
              aria-label="Underline"
              @click="surround('++', '++')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-strikethrough"
              aria-label="Strikethrough"
              @click="surround('~~', '~~')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-1"
              aria-label="Heading 1"
              @click="prefixLines('# ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-2"
              aria-label="Heading 2"
              @click="prefixLines('## ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-heading-3"
              aria-label="Heading 3"
              @click="prefixLines('### ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-list"
              aria-label="Bulleted list"
              @click="prefixLines('- ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-list-ordered"
              aria-label="Numbered list"
              @click="prefixLines('1. ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-quote"
              aria-label="Quote"
              @click="prefixLines('> ')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-code"
              aria-label="Code"
              @click="surround('`', '`')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-table"
              aria-label="Table"
              @click="insertTable"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-link"
              aria-label="Link"
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
            class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            placeholder="Write the minutes in Markdown — select text and use the toolbar to style it."
          />
          <!-- previewHtml comes from the shared XSS-safe renderer
            (escape-first, allowlisted tags), never from raw user HTML. -->
          <!-- eslint-disable vue/no-v-html -->
          <div
            v-else
            class="markdown-body min-h-56 rounded-md border border-gray-200 p-4 text-sm dark:border-gray-800"
            v-html="previewHtml"
          />
          <!-- eslint-enable vue/no-v-html -->
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
              @click="loadSample(sample.id)"
            />
          </div>
        </div>

        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="sm:col-span-2">
            <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              Attendees
            </span>
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
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Remove ${row.label}`"
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
                @click="stageAttendee"
              />
            </div>
            <p class="mt-1 text-xs text-gray-500">
              People are searched from the directory — no manual IDs. Staff-user attendees
              stay API-supported and are attached from the detail page once a scoped staff
              directory exists.
            </p>
          </div>
        </PermissionGate>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
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
