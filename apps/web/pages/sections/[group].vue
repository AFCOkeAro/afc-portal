<script setup lang="ts">
import { NAVIGATION_GROUPS } from '~/utils/navigation'

definePageMeta({ middleware: 'staff' })

const route = useRoute()

const groupKey = String(route.params.group ?? '')
const group = NAVIGATION_GROUPS.find((entry) => entry.key === groupKey)
if (!group) {
  throw createError({ statusCode: 404, statusMessage: 'Section not found' })
}

/**
 * Section headers link straight to the group's canonical page, so the old
 * `/sections/<key>` URLs redirect there and bookmarks keep working.
 */
await navigateTo(group.to, { replace: true })
</script>

<template>
  <div />
</template>
