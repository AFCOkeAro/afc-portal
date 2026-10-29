<script setup lang="ts">
/**
 * Deep-link redirect (AFC-898): the merged Marriage section owns the
 * conducted-marriages report now. `/marriage-cases/report` still resolves —
 * it lands on the Marriage page pre-set to the Report tab — so bookmarks and
 * old links keep working.
 */
definePageMeta({ middleware: 'staff' })

await navigateTo(
  { path: '/marriage', query: { tab: 'report' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
