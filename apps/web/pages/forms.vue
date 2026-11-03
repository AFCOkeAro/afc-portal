<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { CollectionName, PermissionAction } from '@afc/shared'
import type { CustomFormRow } from '~/types/portal'

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

const api = useApi()
const permissions = usePermissions()

interface FormCard {
  title: string
  description: string
  to: string
  requires: readonly [CollectionName, PermissionAction] | null
  icon: string
}

const CARDS: FormCard[] = [
  {
    title: 'Visitor intake',
    description: 'Record a first-time visitor and start the follow-up journey.',
    to: '/visitors?new=1',
    requires: [COLLECTIONS.visitors, 'create'],
    icon: 'i-lucide-user-plus',
  },
  {
    title: 'Event registration',
    description: 'Public form — register yourself or someone else for an event.',
    to: '/register',
    requires: null,
    icon: 'i-lucide-calendar-check',
  },
  {
    title: 'Person record',
    description: 'Add a person to the directory.',
    to: '/people?new=1',
    requires: [COLLECTIONS.people, 'create'],
    icon: 'i-lucide-user',
  },
  {
    title: 'Household',
    description: 'Register a family household.',
    to: '/households?new=1',
    requires: [COLLECTIONS.households, 'create'],
    icon: 'i-lucide-home',
  },
  {
    title: 'Marriage matter',
    description: 'Open a marriage file.',
    to: '/marriage?new=1',
    requires: [COLLECTIONS.marriageMatters, 'create'],
    icon: 'i-lucide-heart',
  },
  {
    title: 'Welfare case',
    description: 'Open a welfare case.',
    to: '/welfare?new=1',
    requires: [COLLECTIONS.welfareCases, 'create'],
    icon: 'i-lucide-hand-heart',
  },
  {
    title: 'Blessing',
    description: 'Record a blessing.',
    to: '/blessings?new=1',
    requires: [COLLECTIONS.blessings, 'create'],
    icon: 'i-lucide-sparkles',
  },
  {
    title: 'Announcement',
    description: 'Publish an announcement.',
    to: '/announcements?new=1',
    requires: [COLLECTIONS.announcements, 'create'],
    icon: 'i-lucide-megaphone',
  },
  {
    title: 'Task',
    description: 'Create a task directly.',
    to: '/tasks?new=1',
    requires: [COLLECTIONS.tasks, 'create'],
    icon: 'i-lucide-check-square',
  },
  {
    title: 'Minutes',
    description: 'Record meeting minutes with attendees and officers.',
    to: '/minutes?new=1',
    requires: [COLLECTIONS.officeMinutes, 'create'],
    icon: 'i-lucide-file-text',
  },
  {
    title: 'Custom form',
    description: 'Build a new form linked to a module from live database columns.',
    to: '/custom-forms?new=1',
    requires: [COLLECTIONS.customForms, 'create'],
    icon: 'i-lucide-plus-circle',
  },
]

const visibleCards = computed(() =>
  CARDS.filter(
    (card) =>
      card.requires === null || permissions.can(card.requires[0], card.requires[1]),
  ),
)

// Existing custom forms
const { data: customFormsData } = await useAsyncData('forms-custom-list', () =>
  api.get<{ data: CustomFormRow[] }>('/api/custom-forms'),
)
const customForms = computed(() => customFormsData.value?.data ?? [])

const canManageCustomForms = computed(() =>
  permissions.can(COLLECTIONS.customForms, 'create'),
)
</script>

<template>
  <div>
    <PageHeader
      title="Forms"
      description="Every form in the portal, in one place. Each card opens the new form itself."
    >
      <template #actions>
        <UButton
          v-if="canManageCustomForms"
          label="New custom form"
          icon="i-lucide-plus"
          to="/custom-forms"
        />
      </template>
    </PageHeader>

    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <UCard v-for="card in visibleCards" :key="card.to">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="card.icon" class="size-5 text-gray-500" />
            <span class="font-semibold">{{ card.title }}</span>
          </div>
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

    <!-- Existing custom forms -->
    <section v-if="customForms.length > 0" class="mt-6">
      <h2 class="mb-3 text-lg font-semibold">Custom forms</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="form in customForms" :key="form.id">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold">{{ form.name }}</span>
              <UBadge color="neutral" variant="subtle">{{ form.module }}</UBadge>
            </div>
          </template>
          <p class="text-sm text-gray-500">
            {{ form.schema?.fields?.length ?? 0 }} fields
          </p>
          <div class="mt-3 flex gap-2">
            <UButton
              :to="`/custom-forms?fill=${form.id}`"
              label="Fill"
              color="neutral"
              variant="outline"
              icon="i-lucide-pencil"
              size="sm"
            />
          </div>
        </UCard>
      </div>
    </section>
  </div>
</template>
