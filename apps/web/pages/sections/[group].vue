<script setup lang="ts">
import { NAVIGATION, NAVIGATION_GROUPS } from '~/utils/navigation'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const permissions = usePermissions()

const groupKey = String(route.params.group ?? '')
const group = NAVIGATION_GROUPS.find((entry) => entry.key === groupKey)
if (!group) {
  throw createError({ statusCode: 404, statusMessage: 'Section not found' })
}

/** Same capability gate as the sidebar: the landing page never lists more. */
const items = computed(() =>
  NAVIGATION.filter(
    (item) => item.group === group.key && permissions.can(...item.requires),
  ),
)
</script>

<template>
  <div>
    <PageHeader
      :title="group.label"
      :description="`Every ${group.label} page this account may open.`"
    />

    <div v-if="items.length === 0">
      <EmptyState
        title="Nothing in this section"
        description="This account has no capability for the pages grouped here."
      />
    </div>

    <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <NuxtLink
        v-for="(item, index) in items"
        :key="`${index}:${item.to}`"
        :to="item.to"
        class="flex items-start gap-3 rounded-lg border border-gray-200 p-4 transition hover:border-primary-300 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-gray-900/60"
      >
        <UIcon :name="item.icon" class="mt-0.5 size-5 shrink-0 text-primary-500" />
        <span class="min-w-0">
          <span class="block font-medium text-gray-900 dark:text-white">
            {{ item.label }}
          </span>
          <span class="mt-0.5 block truncate text-xs text-gray-500 dark:text-gray-400">
            {{ item.to }}
          </span>
        </span>
      </NuxtLink>
    </div>
  </div>
</template>
