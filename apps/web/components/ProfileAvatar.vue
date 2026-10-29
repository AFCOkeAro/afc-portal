<script setup lang="ts">
/**
 * Profile avatar (AFC-864, Kargul personal-details header).
 *
 * Photo when the row has one, initials when it does not (or while the
 * photo fails to load — fail-closed to initials, never a broken image).
 * Initials come from the display name: first letters of the first two
 * words, upper-cased.
 */
interface Props {
  name: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
}

const props = withDefaults(defineProps<Props>(), { photoUrl: null, size: 'md' })

const failed = ref(false)

watch(
  () => props.photoUrl,
  () => {
    failed.value = false
  },
)

const initials = computed(() => {
  const words = props.name.trim().split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map((word) => word[0]!.toUpperCase())
  return letters.length > 0 ? letters.join('') : '?'
})

const sizeClass = computed(() =>
  props.size === 'lg'
    ? 'size-20 text-2xl'
    : props.size === 'sm'
      ? 'size-8 text-xs'
      : 'size-11 text-base',
)

const showPhoto = computed(
  () => props.photoUrl !== null && props.photoUrl !== '' && !failed.value,
)
</script>

<template>
  <img
    v-if="showPhoto"
    :src="props.photoUrl ?? ''"
    :alt="`${props.name} photo`"
    :class="[sizeClass, 'shrink-0 rounded-full object-cover']"
    @error="failed = true"
  />
  <span
    v-else
    :class="[
      sizeClass,
      'inline-flex shrink-0 items-center justify-center rounded-full bg-primary-100 font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-300',
    ]"
    aria-hidden="true"
  >
    {{ initials }}
  </span>
</template>
