<script setup lang="ts">
import type { PersonTimelineItem } from '~/types/portal'

defineProps<{
  items: PersonTimelineItem[]
  emptyTitle: string
  emptyDescription: string
}>()

const iconFor: Record<PersonTimelineItem['kind'], string> = {
  attendance: 'i-lucide-clipboard-check',
  registration: 'i-lucide-ticket',
  visitor: 'i-lucide-user-plus',
  welfare: 'i-lucide-heart-handshake',
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
</script>

<template>
  <EmptyState
    v-if="items.length === 0"
    :title="emptyTitle"
    :description="emptyDescription"
  />
  <ol
    v-else
    class="relative space-y-4 border-l border-gray-200 pl-6 dark:border-gray-800"
  >
    <li v-for="item in items" :key="item.id" class="relative">
      <span
        class="absolute -left-[31px] flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700"
      >
        <UIcon :name="iconFor[item.kind]" class="size-3.5 text-gray-500" />
      </span>
      <p class="text-sm font-medium">{{ item.title }}</p>
      <p v-if="item.detail" class="text-sm text-gray-600 dark:text-gray-300">
        {{ item.detail }}
      </p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {{ formatDateTime(item.at) }}
      </p>
    </li>
  </ol>
</template>
