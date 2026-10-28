<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { CollectionName, PermissionAction } from '@afc/shared'

/**
 * Forms hub (AFC-840 phase 1): every data-entry point in one directory.
 *
 * Each card links to the page that hosts the form and renders only when
 * the session holds the matching create grant (the public registration
 * card renders for everyone). A custom form builder is an explicit
 * non-goal for phase 1 (recorded on AFC-840).
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()

interface FormCard {
  title: string
  description: string
  to: string
  requires: readonly [CollectionName, PermissionAction] | null
}

const CARDS: FormCard[] = [
  {
    title: 'Visitor intake',
    description: 'Record a first-time visitor and start the follow-up journey.',
    to: '/visitors',
    requires: [COLLECTIONS.visitors, 'create'],
  },
  {
    title: 'Event registration',
    description: 'Public form — register yourself or someone else for an event.',
    to: '/register',
    requires: null,
  },
  {
    title: 'Person record',
    description: 'Add a person to the directory.',
    to: '/people',
    requires: [COLLECTIONS.people, 'create'],
  },
  {
    title: 'Household',
    description: 'Register a family household.',
    to: '/households',
    requires: [COLLECTIONS.households, 'create'],
  },
  {
    title: 'Marriage matter',
    description: 'Open a marriage file.',
    to: '/marriage',
    requires: [COLLECTIONS.marriageMatters, 'create'],
  },
  {
    title: 'Welfare case',
    description: 'Open a welfare case.',
    to: '/welfare',
    requires: [COLLECTIONS.welfareCases, 'create'],
  },
  {
    title: 'Blessing',
    description: 'Record a blessing.',
    to: '/blessings',
    requires: [COLLECTIONS.blessings, 'create'],
  },
  {
    title: 'Announcement',
    description: 'Publish an announcement.',
    to: '/announcements',
    requires: [COLLECTIONS.announcements, 'create'],
  },
  {
    title: 'Task',
    description: 'Create a task directly.',
    to: '/tasks',
    requires: [COLLECTIONS.tasks, 'create'],
  },
]

const visibleCards = computed(() =>
  CARDS.filter(
    (card) =>
      card.requires === null || permissions.can(card.requires[0], card.requires[1]),
  ),
)
</script>

<template>
  <div>
    <PageHeader
      title="Forms"
      description="Every form in the portal, in one place. Each card opens the page that hosts the form."
    />
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <UCard v-for="card in visibleCards" :key="card.to">
        <template #header>
          <span class="font-semibold">{{ card.title }}</span>
        </template>
        <p class="text-sm text-gray-500">{{ card.description }}</p>
        <UButton
          class="mt-3"
          :to="card.to"
          label="Open form"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-right"
          size="sm"
        />
      </UCard>
    </div>
  </div>
</template>
