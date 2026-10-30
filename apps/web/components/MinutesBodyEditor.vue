<script setup lang="ts">
import { renderMarkdownSafe } from '@afc/shared'

/**
 * MinutesBodyEditor — shared Markdown body editor for minutes (AFC-912).
 *
 * Used by both minutes/new.vue and minutes/[id].vue so the toolbar set,
 * the Raw | Preview segmented toggle and the safe preview renderer cannot
 * drift between create and edit. The preview renders through the shared
 * XSS-safe renderer (escape-first, allowlisted tags), never raw user HTML.
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    textareaId?: string
    fieldError?: string
  }>(),
  {
    textareaId: 'minutes-body',
    fieldError: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

type EditorMode = 'raw' | 'preview'
const mode = ref<EditorMode>('raw')

const previewHtml = computed(() => renderMarkdownSafe(props.modelValue))

function setBody(value: string) {
  emit('update:modelValue', value)
}

const editor = ref<HTMLTextAreaElement | null>(null)

/** Wrap (or insert at) the textarea selection with a Markdown affix pair. */
function surround(before: string, after = '') {
  const area = editor.value
  if (!area) return
  const { selectionStart: start, selectionEnd: end, value } = area
  const selected = value.slice(start, end) || 'text'
  setBody(`${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`)
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
  setBody(`${value.slice(0, start)}${prefixed}${value.slice(end)}`)
  nextTick(() => {
    area.focus()
    area.setSelectionRange(start, start + prefixed.length)
  })
}

function insertTable() {
  const area = editor.value
  const table = '\n| Name | Role | Present |\n| ---- | ---- | ------- |\n|  |  |  |\n'
  if (!area) {
    setBody(`${props.modelValue}${table}`)
    return
  }
  const { selectionStart: start, value } = area
  setBody(`${value.slice(0, start)}${table}${value.slice(start)}`)
  nextTick(() => {
    area.focus()
    area.setSelectionRange(start + table.length, start + table.length)
  })
}

function insertLink() {
  surround('[', '](https://)')
}
</script>

<template>
  <div>
    <div class="mb-1 flex items-center justify-between gap-2">
      <label
        class="text-sm font-medium text-gray-700 dark:text-gray-200"
        :for="textareaId"
      >
        Body (Markdown)
      </label>
      <div
        class="inline-flex overflow-hidden rounded-md border border-gray-200 dark:border-gray-800"
        role="group"
        aria-label="Editor view"
      >
        <UButton
          size="xs"
          :color="mode === 'raw' ? 'primary' : 'neutral'"
          :variant="mode === 'raw' ? 'solid' : 'ghost'"
          class="rounded-none"
          label="Raw"
          icon="i-lucide-code"
          :aria-pressed="mode === 'raw'"
          @click="mode = 'raw'"
        />
        <UButton
          size="xs"
          :color="mode === 'preview' ? 'primary' : 'neutral'"
          :variant="mode === 'preview' ? 'solid' : 'ghost'"
          class="rounded-none"
          label="Preview"
          icon="i-lucide-eye"
          :aria-pressed="mode === 'preview'"
          @click="mode = 'preview'"
        />
      </div>
    </div>
    <div
      v-if="mode === 'raw'"
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
      v-if="mode === 'raw'"
      :id="textareaId"
      ref="editor"
      :value="modelValue"
      rows="14"
      class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      placeholder="Write the minutes in Markdown — select text and use the toolbar to style it."
      @input="setBody(($event.target as HTMLTextAreaElement).value)"
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
    <p v-if="fieldError" class="mt-1 text-sm text-red-600">
      {{ fieldError }}
    </p>
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
