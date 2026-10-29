<script setup lang="ts">
/**
 * Deep-link redirect (AFC-895): the welfare report is a tab on the Welfare
 * page now. `/welfare/reports` still resolves — it lands on the tabbed page
 * pre-set to the reports tab — so bookmarks and old links keep working.
 */
definePageMeta({ middleware: ['staff', 'welfare'] })

const route = useRoute()

await navigateTo(
  { path: '/welfare', query: { ...route.query, tab: 'reports' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
