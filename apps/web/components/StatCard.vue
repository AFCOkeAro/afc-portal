<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string | number | null
    hint?: string
  }>(),
  { hint: undefined },
)
</script>

<template>
  <div
    class="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
  >
    <p class="text-sm text-gray-500 dark:text-gray-400">{{ label }}</p>
    <p class="mt-1 text-2xl font-semibold tabular-nums text-gray-900 dark:text-white">
      {{ value ?? '—' }}
    </p>
    <p v-if="hint" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
      {{ hint }}
    </p>
  </div>
</template>
