<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

/**
 * Area profile stub (AFC-461b). Same contract as the zone stub: renders from
 * `/api/branches` until the hierarchy endpoints from AFC-461a land.
 */
definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const areaId = String(route.params.id)

const {
  data: branches,
  pending,
  error,
} = await useAsyncData(`area-${areaId}-branches`, () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canVisitors = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))
const canLeadership = computed(() => permissions.can(COLLECTIONS.departments, 'read'))

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  ...(canAttendance.value ? [{ id: 'attendance', label: 'Attendance' }] : []),
  ...(canVisitors.value ? [{ id: 'follow-ups', label: 'Follow-ups' }] : []),
  ...(canWelfare.value ? [{ id: 'welfare-with-scope', label: 'Welfare' }] : []),
  ...(canLeadership.value ? [{ id: 'leadership', label: 'Leadership' }] : []),
])

const rows = computed(() => branches.value ?? [])
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/dashboard#branches"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to dashboard"
      />
    </div>

    <PageHeader
      :title="`Area ${areaId}`"
      description="Area profile (stub): aggregates render from /api/branches within this account's scope until the hierarchy endpoints land."
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load branches"
      :description="error.message"
    />

    <div v-else-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else>
      <SectionNav :sections="sections" />

      <section id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <UCard>
          <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
            {{ rows.length }} branches in scope
          </p>
          <ul class="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            <li v-for="branch in rows" :key="branch.id" class="py-2">
              <NuxtLink
                :to="`/branches/${branch.id}#overview`"
                class="font-medium text-primary-600 underline hover:text-primary-700"
              >
                {{ branch.name }}
              </NuxtLink>
              <span class="ml-2 text-xs text-gray-500">{{ branch.code }}</span>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canAttendance" id="attendance" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
          </template>
          <EmptyState
            title="Area attendance aggregates here"
            description="Per-zone and per-branch attendance totals render here once the area endpoint lands."
          />
        </UCard>
      </section>

      <section v-if="canVisitors" id="follow-ups" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Follow-ups</h2>
          </template>
          <EmptyState
            title="Area follow-ups aggregate here"
            description="Open follow-up counts per zone render here once the area endpoint lands."
          />
        </UCard>
      </section>

      <section v-if="canWelfare" id="welfare-with-scope" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Welfare</h2>
          </template>
          <EmptyState
            title="Area welfare aggregates here"
            description="Open welfare counts per zone render here once the area endpoint lands. Hidden from accounts without welfare_cases:read."
          />
        </UCard>
      </section>

      <section v-if="canLeadership" id="leadership" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Leadership</h2>
          </template>
          <ManagementTeamSection level="area" :scope-id="areaId" />
        </UCard>
      </section>
    </template>
  </div>
</template>
