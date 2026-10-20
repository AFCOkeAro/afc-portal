<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

/**
 * BSC (Bible Study Centre) profile stub (AFC-461b). Renders from
 * `/api/branches` when the id matches a branch, otherwise as a named stub.
 */
definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const bscId = String(route.params.id)

const { data: branches } = await useAsyncData('bsc-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const match = computed(() => (branches.value ?? []).find((row) => row.id === bscId))

const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canEvents = computed(() => permissions.can(COLLECTIONS.events, 'read'))
const canVisitors = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  ...(canAttendance.value ? [{ id: 'attendance', label: 'Attendance' }] : []),
  ...(canEvents.value ? [{ id: 'registrations', label: 'Registrations' }] : []),
  ...(canVisitors.value ? [{ id: 'follow-ups', label: 'Follow-ups' }] : []),
])
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
      :title="match ? match.name : `BSC ${bscId}`"
      :description="
        match
          ? `${match.code} · Bible Study Centre`
          : 'BSC profile (stub): no dedicated BSC endpoint yet; this page resolves against /api/branches.'
      "
    />

    <SectionNav :sections="sections" />

    <section id="overview" class="scroll-mt-28">
      <h2 class="sr-only" tabindex="-1">Overview</h2>
      <UCard>
        <p v-if="match" class="text-sm text-gray-600 dark:text-gray-300">
          {{ match.name }} ({{ match.code }}) ·
          <NuxtLink
            :to="`/branches/${match.id}#overview`"
            class="text-primary-600 underline hover:text-primary-700"
          >
            open full branch profile
          </NuxtLink>
        </p>
        <EmptyState
          v-else
          title="No branch matches this BSC id"
          description="The BSC collection has no endpoint yet. This stub stays reachable so deep links do not break; it gains real data with the hierarchy endpoints."
        />
      </UCard>
    </section>

    <section v-if="canAttendance" id="attendance" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
        </template>
        <EmptyState
          title="BSC attendance appears here"
          description="Attendance sessions for this centre render here once the hierarchy endpoints land."
        />
      </UCard>
    </section>

    <section v-if="canEvents" id="registrations" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Registrations</h2>
        </template>
        <EmptyState
          title="BSC registrations appear here"
          description="Event registrations for this centre render here once the hierarchy endpoints land."
        />
      </UCard>
    </section>

    <section v-if="canVisitors" id="follow-ups" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Follow-ups</h2>
        </template>
        <EmptyState
          title="BSC follow-ups appear here"
          description="Visitor follow-ups for this centre render here once the hierarchy endpoints land."
        />
      </UCard>
    </section>
  </div>
</template>
