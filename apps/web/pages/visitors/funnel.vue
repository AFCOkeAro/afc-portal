<script setup lang="ts">
/**
 * Deep-link redirect (AFC-895): the newcomer funnel is a tab on the Visitors
 * page now. `/visitors/funnel` still resolves — it lands on the tabbed page
 * pre-set to the funnel tab — so bookmarks and old links keep working.
 */
definePageMeta({ middleware: 'staff' })

const route = useRoute()

await navigateTo(
  { path: '/visitors', query: { ...route.query, tab: 'funnel' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
