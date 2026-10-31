<script setup lang="ts">
/**
 * AfcSuggestRow — state-6 suggest row (AFC-994).
 *
 * The search worked and the set is empty: never a dead end. Renders the
 * label plus alternate-spelling / recent / clear / create chips. Vue port
 * of `AfcErrorCard.mountSuggest` in the vanilla helper.
 */
export interface SuggestChip {
  label: string
  kind?: 'default' | 'create'
}

defineProps<{
  label?: string
  chips: SuggestChip[]
}>()

const emit = defineEmits<{
  select: [chip: SuggestChip]
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <span v-if="label" class="text-sm text-gray-500 dark:text-gray-400">
      {{ label }}
    </span>
    <UButton
      v-for="chip in chips"
      :key="chip.label"
      :label="chip.label"
      size="sm"
      :color="chip.kind === 'create' ? 'primary' : 'neutral'"
      :variant="chip.kind === 'create' ? 'solid' : 'outline'"
      icon="i-lucide-sparkles"
      @click="emit('select', chip)"
    />
  </div>
</template>
