<script setup lang="ts">
/**
 * Root component.
 *
 * `<UApp>` is Nuxt UI's provider — it owns the toast, tooltip and overlay
 * context. It has to wrap the router view, not sit inside a layout, or a toast
 * raised from a layout or a page is rendered outside the provider it needs.
 */
useHead({
  titleTemplate: (title) =>
    title ? `${title} · AFC Church Portal` : 'AFC Church Portal',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
