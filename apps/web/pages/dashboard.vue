<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Dashboard.
 *
 * The counts are placeholders, not zeroes. A dashboard that shows `0` for
 * attendance when no query has run is a dashboard that has lied to a branch
 * admin, and zeroes look like data. `—` reads as "not measured yet", which is
 * what it is.
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()

const cards = computed(() =>
  [
    {
      label: 'People',
      to: '/people',
      icon: 'i-lucide-users',
      allowed: permissions.can(COLLECTIONS.people, 'read'),
    },
    {
      label: 'Events',
      to: '/events',
      icon: 'i-lucide-calendar-days',
      allowed: permissions.can(COLLECTIONS.events, 'read'),
    },
    {
      label: 'Attendance',
      to: '/attendance',
      icon: 'i-lucide-clipboard-check',
      allowed: permissions.can(COLLECTIONS.attendanceSessions, 'read'),
    },
    {
      label: 'Visitors',
      to: '/visitors',
      icon: 'i-lucide-user-plus',
      allowed: permissions.can(COLLECTIONS.visitors, 'read'),
    },
  ].filter((card) => card.allowed),
)
</script>

<template>
  <div>
    <PageHeader
      title="Dashboard"
      description="Lagos North Area. Records are scoped to the branches this account can see."
    />

    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <NuxtLink
        v-for="card in cards"
        :key="card.to"
        :to="card.to"
        class="block rounded-lg transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <StatCard
          :label="card.label"
          value="—"
          :hint="`Not wired yet · ${card.label.toLowerCase()} collection`"
        />
      </NuxtLink>
    </div>

    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold">Sections</h2>
        </template>
        <ul class="space-y-2">
          <li v-for="item in NAVIGATION" :key="item.to">
            <NuxtLink
              v-if="permissions.can(...item.requires)"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <UIcon :name="item.icon" class="size-5 text-gray-500" />
              {{ item.label }}
              <UIcon name="i-lucide-arrow-right" class="ml-auto size-4 text-gray-400" />
            </NuxtLink>
          </li>
        </ul>
      </UCard>

      <CapabilitySummary />
    </div>
  </div>
</template>
