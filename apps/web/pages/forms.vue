<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { CollectionName, PermissionAction } from '@afc/shared'

/**
 * Forms hub (AFC-840 phase 1, AFC-897): every data-entry point in one directory.
 *
 * Each card links to the page that hosts the form WITH `?new=1`, so the
 * entry opens the create form itself, not the parent list (chairman ask
 * 2026-10-29). The pages honour the query by opening their create
 * affordance on mount; `/register` is already the form, so it links bare.
 * The Custom forms card opens the builder register, whose fills write
 * through each linked module's own create grant.
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
    to: '/visitors?new=1',
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
    to: '/people?new=1',
    requires: [COLLECTIONS.people, 'create'],
  },
  {
    title: 'Household',
    description: 'Register a family household.',
    to: '/households?new=1',
    requires: [COLLECTIONS.households, 'create'],
  },
  {
    title: 'Marriage matter',
    description: 'Open a marriage file.',
    to: '/marriage?new=1',
    requires: [COLLECTIONS.marriageMatters, 'create'],
  },
  {
    title: 'Welfare case',
    description: 'Open a welfare case.',
    to: '/welfare?new=1',
    requires: [COLLECTIONS.welfareCases, 'create'],
  },
  {
    title: 'Blessing',
    description: 'Record a blessing.',
    to: '/blessings?new=1',
    requires: [COLLECTIONS.blessings, 'create'],
  },
  {
    title: 'Announcement',
    description: 'Publish an announcement.',
    to: '/announcements?new=1',
    requires: [COLLECTIONS.announcements, 'create'],
  },
  {
    title: 'Task',
    description: 'Create a task directly.',
    to: '/tasks?new=1',
    requires: [COLLECTIONS.tasks, 'create'],
  },
  {
    title: 'Custom forms',
    description: 'Build module-linked forms from live database columns, and fill them.',
    to: '/custom-forms',
    requires: [COLLECTIONS.customForms, 'read'],
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
      description="Every form in the portal, in one place. Each card opens the new form itself."
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
