<script setup lang="ts">
import { renderMarkdownSafe } from '@afc/shared'

const props = defineProps<{
  modelValue: string
  textareaId?: string
  fieldError?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const mode = ref<'raw' | 'preview'>('raw')

const previewHtml = computed(() => renderMarkdownSafe(props.modelValue ?? ''))

function surround(before: string, after: string): void {
  const textarea = document.getElementById(
    props.textareaId ?? 'minutes-body',
  ) as HTMLTextAreaElement | null
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = props.modelValue ?? ''
  const selected = value.slice(start, end)
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  emit('update:modelValue', next)
  nextTick(() => {
    textarea.focus()
    textarea.setSelectionRange(start + before.length, end + before.length)
  })
}

function insertTable(): void {
  const table =
    '\n| Column 1 | Column 2 |\n|----------|----------|\n|          |          |\n'
  const value = props.modelValue ?? ''
  emit('update:modelValue', value + table)
}

function insertLink(): void {
  const link = '[text](url)'
  const value = props.modelValue ?? ''
  emit('update:modelValue', value + link)
}
</script>

<template>
  <div>
    <div class="mb-2 flex items-center justify-between">
      <label
        :for="textareaId ?? 'minutes-body'"
        class="text-sm font-medium text-gray-700 dark:text-gray-200"
        >Body</label
      >
      <div
        role="group"
        class="flex rounded-md border border-gray-200 dark:border-gray-800"
      >
        <UButton
          size="xs"
          :color="mode === 'raw' ? 'primary' : 'neutral'"
          :variant="mode === 'raw' ? 'solid' : 'ghost'"
          label="Raw"
          :aria-pressed="mode === 'raw'"
          @click="mode = 'raw'"
        />
        <UButton
          size="xs"
          :color="mode === 'preview' ? 'primary' : 'neutral'"
          :variant="mode === 'preview' ? 'solid' : 'ghost'"
          label="Preview"
          :aria-pressed="mode === 'preview'"
          @click="mode = 'preview'"
        />
      </div>
    </div>
    <div v-if="mode === 'raw'">
      <div role="toolbar" class="mb-2 flex flex-wrap gap-1">
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="B"
          title="Bold"
          @click="surround('**', '**')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="I"
          title="Italic"
          @click="surround('*', '*')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="U"
          title="Underline"
          @click="surround('++', '++')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="S"
          title="Strikethrough"
          @click="surround('~~', '~~')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="H1"
          @click="surround('# ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="H2"
          @click="surround('## ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="H3"
          @click="surround('### ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="•"
          @click="surround('- ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="1."
          @click="surround('1. ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label=">"
          @click="surround('> ', '')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="`</>"
          @click="surround('`', '`')"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="Table"
          @click="insertTable"
        />
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          label="Link"
          @click="insertLink"
        />
      </div>
      <UTextarea
        :id="textareaId ?? 'minutes-body'"
        :model-value="modelValue"
        class="w-full"
        :rows="12"
        :error="fieldError"
        @update:model-value="emit('update:modelValue', String($event))"
      />
    </div>
    <div
      v-else
      class="min-h-[200px] rounded-md border border-gray-200 p-3 dark:border-gray-800"
    >
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div v-if="modelValue" class="markdown-body" v-html="previewHtml" />
      <p v-else class="text-sm text-gray-500">Nothing to preview.</p>
    </div>
    <p v-if="fieldError" class="mt-1 text-sm text-red-600 dark:text-red-400">
      {{ fieldError }}
    </p>
  </div>
</template>
