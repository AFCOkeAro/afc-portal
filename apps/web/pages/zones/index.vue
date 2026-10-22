<script setup lang="ts">
import type { ZoneSummary } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const search = ref('')

const { data, pending, error } = await useAsyncData('zones-list', () =>
  api.get<ZoneSummary[]>('/api/zones'),
)

const rows = computed(() => {
  const term = search.value.trim().toLowerCase()
  const list = data.value ?? []
  if (!term) return list
  return list.filter((zone) =>
    [zone.name, zone.code].filter(Boolean).some((value) =>
      String(value).toLowerCase().includes(term),
    ),
  )
})

const stripItems = computed(() => {
  const all = data.value ?? []
  const active = all.filter((zone) => zone.status === 'active').length
  return [
    { label: 'Zones', value: all.length, to: null, hint: 'Total in view' },
    { label: 'Active', value: active, to: null, hint: 'Client-side count' },
    {
      label: 'Shown',
      value: rows.value.length,
      to: null,
      hint: 'Matches current search',
    },
  ]
})
</script>

<template>
  <div>
    <PageHeader
      title="Zones"
      description="Every zone this account can see, with the branches it contains one click away."
    />

    <DashboardStrip :items="stripItems" />

    <UCard>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search zones"
        aria-label="Search zones"
      />

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load zones"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No zones in scope"
        description="This account has no zone grant, or no zone matches the search."
      />

      <div v-else class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="zone in rows"
          :key="zone.id"
          :to="`/zones/${zone.id}`"
          class="rounded-lg border border-gray-200 p-4 transition hover:border-primary-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-gray-900/60"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium text-gray-900 dark:text-white">{{ zone.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">{{ zone.code }}</p>
            </div>
            <UBadge
              :color="zone.status === 'active' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ zone.status }}
            </UBadge>
          </div>
        </NuxtLink>
      </div>
    </UCard>
  </div>
</template>
