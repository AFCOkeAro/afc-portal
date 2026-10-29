<script setup lang="ts">
/**
 * Deep-link redirect (AFC-898): the merged Marriage section owns the pipeline
 * UI now. `/marriage-cases` still resolves — it lands on the Marriage page
 * pre-set to the Pipeline tab — so bookmarks and old links keep working.
 */
definePageMeta({ middleware: 'staff' })

await navigateTo(
  { path: '/marriage', query: { tab: 'pipeline' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
