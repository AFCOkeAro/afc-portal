<script setup lang="ts">
/**
 * DashboardStrip (AFC-588): shared strip of 3-5 linked StatCard figures
 * rendered above every staff list page, with the list table under it.
 *
 * Pattern contract (people-page drill-down is the reference):
 * - Each figure deep-links to its filtered list via query params the list
 *   route already honours (e.g. `/visitors?status=open`). Figures without a
 *   honoured target use `to: null` and render as a plain (unlinked) card.
 * - Figures come from existing summary endpoints or list-meta `total`
 *   counts (parallel `limit: 1` count queries). No new backend per figure;
 *   a figure that cannot be derived is left out and flagged on the issue.
 * - Mobile: single column, stacks above the list. Dark mode inherits from
 *   StatCard (border-gray-200/dark:border-gray-800). Cap at 5 items.
 */
export interface DashboardStripItem {
  label: string
  value: string | number | null
  /** Filtered-list href, or null for a display-only figure. */
  to: string | null
  hint?: string
}

defineProps<{
  items: DashboardStripItem[]
}>()
</script>

<template>
  <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <template v-for="item in items" :key="item.label">
      <NuxtLink
        v-if="item.to"
        :to="item.to"
        class="block transition hover:-translate-y-0.5"
      >
        <StatCard :label="item.label" :value="item.value" :hint="item.hint" />
      </NuxtLink>
      <StatCard v-else :label="item.label" :value="item.value" :hint="item.hint" />
    </template>
  </div>
</template>
