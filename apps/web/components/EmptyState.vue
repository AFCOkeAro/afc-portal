<script setup lang="ts">
/**
 * Shown instead of a table when a collection query returns nothing.
 *
 * `reason` distinguishes "no records yet" from "no permission to see records".
 * They look identical in the DOM and mean very different things to a branch
 * admin who is wondering where their data went.
 */
withDefaults(
  defineProps<{
    title: string
    description?: string
    reason?: 'empty' | 'forbidden' | 'unscoped'
  }>(),
  { description: undefined, reason: 'empty' },
)
</script>

<template>
  <div
    class="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-700 dark:bg-gray-900"
  >
    <UIcon
      :name="
        reason === 'forbidden'
          ? 'i-lucide-lock'
          : reason === 'unscoped'
            ? 'i-lucide-map-pin-off'
            : 'i-lucide-inbox'
      "
      class="mx-auto size-8 text-gray-400"
    />
    <p class="mt-3 font-medium text-gray-900 dark:text-white">{{ title }}</p>
    <p v-if="description" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
