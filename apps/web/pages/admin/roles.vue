<script setup lang="ts">
/**
 * Roles and permissions are owned by Directus. The portal does not reimplement
 * the policy editor; this page only bridges to the Directus admin surface.
 */
definePageMeta({ middleware: 'staff' })

const config = useRuntimeConfig()
const target = `${String(config.public.directusUrl ?? '').replace(/\/$/, '')}/admin/settings/roles`

await navigateTo(target, { external: true })
</script>

<template>
  <div />
</template>
