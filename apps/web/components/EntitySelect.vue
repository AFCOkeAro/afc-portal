<script setup lang="ts">
/**
 * EntitySelect — shared searchable entity picker (AFC-631).
 *
 * Wraps the Nuxt UI searchable select (USelectMenu): label/value items,
 * type-to-filter, keyboard navigation, loading and empty states.
 *
 * Permission rule: this component never fetches. The caller passes only the
 * caller-scoped rows it already holds (e.g. `branches` from /api/branches),
 * so the option list cannot widen data exposure.
 *
 * Filtering policy:
 * - Default: client-side filter over the preloaded `items` (fine for short
 *   lists — branches, zones, departments, programmes).
 * - For long lists (people, students), pass `server-search` and handle
 *   `@update:search-term` with a debounced query against an existing
 *   list endpoint that supports text search (e.g. /api/people?search=).
 *   No new endpoints were added in this slice.
 */

export interface EntityOption {
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    items: EntityOption[]
    placeholder?: string
    searchPlaceholder?: string
    emptyText?: string
    loading?: boolean
    disabled?: boolean
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
    /** Pass-through aria label for filter selects without a visible label. */
    ariaLabel?: string
    /**
     * When true, the built-in client filter is disabled (`ignore-filter`)
     * and the typed term is emitted via `update:search-term` for a
     * caller-driven server query. Documented for long lists; default
     * client filtering covers every list preloaded in this slice.
     */
    serverSearch?: boolean
  }>(),
  {
    placeholder: 'Select…',
    searchPlaceholder: 'Type to filter…',
    emptyText: 'No matches found.',
    loading: false,
    disabled: false,
    size: 'md',
    ariaLabel: undefined,
    serverSearch: false,
  },
)

defineOptions({ inheritAttrs: false })

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:searchTerm': [term: string]
}>()

const selected = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
</script>

<template>
  <div class="w-full">
    <USelectMenu
      v-model="selected"
      :items="items"
      value-key="value"
      label-key="label"
      :placeholder="loading ? 'Loading…' : placeholder"
      :search-input="{ placeholder: searchPlaceholder }"
      :filter-fields="['label']"
      :ignore-filter="serverSearch"
      :loading="loading"
      :disabled="disabled || loading"
      :size="size"
      :aria-label="ariaLabel"
      v-bind="$attrs"
      class="w-full"
      @update:search-term="emit('update:searchTerm', $event)"
    >
      <template #empty="{ searchTerm }">
        <slot name="empty">
          <span class="text-sm text-gray-500 dark:text-gray-400">
            {{ searchTerm ? `${emptyText} (“${searchTerm}”)` : emptyText }}
          </span>
        </slot>
      </template>
    </USelectMenu>
    <slot name="error" />
  </div>
</template>
