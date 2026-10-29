<script setup lang="ts">
/**
 * Deep-link redirect (AFC-896): Time Off and Annual Leave merged into one
 * tabbed surface. `/annual-leave` still resolves — it lands on the Time Off
 * page pre-set to the Requests tab — so bookmarks and old sidebar links
 * keep working.
 */
definePageMeta({ middleware: 'staff' })

await navigateTo(
  { path: '/time-off', query: { tab: 'requests' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
