<script setup lang="ts">
/**
 * Renders its slot only when the session holds the capability.
 *
 * Use this for controls the matrix denies, not merely to tidy the UI: a button a
 * volunteer cannot use should not be pressable into a 403. It is still not an
 * authorisation decision — the server route and the Directus policy are.
 */
import type { CollectionName, PermissionAction } from '@afc/shared'

const props = defineProps<{
  collection: CollectionName
  action: PermissionAction
}>()

const permissions = usePermissions()
const allowed = computed(() => permissions.can(props.collection, props.action))
</script>

<template>
  <template v-if="allowed">
    <slot />
  </template>
</template>
