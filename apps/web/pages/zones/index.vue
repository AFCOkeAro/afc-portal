<script setup lang="ts">
/**
 * Deep-link redirect (AFC-672): the merged Churches surface owns the list UI
 * now. `/zones` still resolves — it lands on the Churches page pre-set to
 * the Zones kind — so bookmarks and old sidebar links keep working.
 */
definePageMeta({ middleware: 'staff' })

await navigateTo(
  { path: '/churches', query: { kind: 'zones' } },
  { replace: true, redirectCode: 301 },
)
</script>

<template>
  <div />
</template>
