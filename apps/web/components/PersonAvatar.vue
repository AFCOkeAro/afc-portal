<script setup lang="ts">
/**
 * PersonAvatar — inline person photo with an initials fallback (AFC-927).
 *
 * `photo` is the AFC-864 wire point: person photos do not exist yet, so
 * callers pass null and the avatar renders initials from `name`. When
 * photo storage lands, the list route attaches the file reference and this
 * component needs no change. `name` null renders a neutral placeholder —
 * raw ids are never rendered anywhere in this surface.
 */
const props = withDefaults(
  defineProps<{
    name?: string | null
    photo?: string | null
    size?: 'xs' | 'sm' | 'md'
  }>(),
  { name: null, photo: null, size: 'xs' },
)

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0] ?? ''
  if (first === '') return '?'
  if (parts.length === 1) return first.slice(0, 2).toUpperCase()
  const last = parts[parts.length - 1] ?? ''
  return (first.charAt(0) + last.charAt(0)).toUpperCase() || '?'
}

const initials = computed(() => initialsFor(props.name))
</script>

<template>
  <UAvatar
    :src="photo ?? undefined"
    :alt="name ?? 'Team member'"
    :text="photo ? undefined : initials"
    :size="size"
  />
</template>
