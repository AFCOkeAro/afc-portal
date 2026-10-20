<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Household profile stub (AFC-461b). The households collection exists but has
 * no detail endpoint yet; this page holds the anchor contract (`#overview`,
 * `#contact`, `#attendance`, …) so person household links do not break.
 */
definePageMeta({ middleware: 'staff' })

const route = useRoute()
const permissions = usePermissions()
const householdId = String(route.params.id)

const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  { id: 'contact', label: 'Contact' },
  ...(canAttendance.value ? [{ id: 'attendance', label: 'Attendance' }] : []),
  ...(canWelfare.value ? [{ id: 'welfare-with-scope', label: 'Welfare' }] : []),
])
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/people"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to people"
      />
    </div>

    <PageHeader
      :title="`Household ${householdId}`"
      description="Household profile (stub): full member lists and wedding-date details land with the hierarchy endpoints."
    />

    <SectionNav :sections="sections" />

    <section id="overview" class="scroll-mt-28">
      <h2 class="sr-only" tabindex="-1">Overview</h2>
      <UCard>
        <EmptyState
          title="Household members appear here"
          description="Member rows for this household render here once the household detail endpoint lands."
        />
        <p class="mt-4 font-mono text-xs text-gray-500">
          household id: {{ householdId }}
        </p>
      </UCard>
    </section>

    <section id="contact" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Contact</h2>
        </template>
        <EmptyState
          title="Household contact appears here"
          description="Shared address, contact and consent for the household render here."
        />
      </UCard>
    </section>

    <section v-if="canAttendance" id="attendance" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
        </template>
        <EmptyState
          title="Household attendance appears here"
          description="Attendance for household members renders here."
        />
      </UCard>
    </section>

    <section v-if="canWelfare" id="welfare-with-scope" class="mt-8 scroll-mt-28">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Welfare</h2>
        </template>
        <EmptyState
          title="Household welfare appears here"
          description="Welfare cases linked to this household render here. Hidden from accounts without welfare_cases:read."
        />
      </UCard>
    </section>
  </div>
</template>
