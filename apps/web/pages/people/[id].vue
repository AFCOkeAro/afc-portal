<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, PersonDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const savingStatus = ref(false)
const actionError = ref('')

const {
  data: person,
  pending,
  error,
  refresh,
} = await useAsyncData(`person-${id}`, () => api.get<PersonDetail>(`/api/people/${id}`))

const branches = await useAsyncData('people-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const showDob = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.people, 'date_of_birth'),
)

const restrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.people)
  if (hidden.length === 0) return ''
  return `Not shown on this account: ${hidden.join(', ')}.`
})

const displayName = computed(() => {
  const row = person.value
  if (!row) return 'Person'
  return row.preferred_name || [row.first_name, row.last_name].filter(Boolean).join(' ')
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const attendanceItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'attendance') ?? [],
)
const eventItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'registration') ?? [],
)
const visitorItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'visitor') ?? [],
)
const welfareItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'welfare') ?? [],
)

/**
 * Anchor sections per prd-addendum-v4 §1 + wireframes-v3 screen 1. Gates are
 * capabilities, never role names (data-model §13 rule 7): a section the
 * session cannot read is absent from the nav and the page (US-S1 AC4 — a
 * volunteer sees no welfare section).
 */
const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canRegistrations = computed(() => permissions.can(COLLECTIONS.events, 'read'))
const canFollowUps = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))
const canLeadership = computed(() => permissions.can(COLLECTIONS.departments, 'read'))

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  ...(canAttendance.value ? [{ id: 'attendance', label: 'Attendance' }] : []),
  ...(canRegistrations.value ? [{ id: 'registrations', label: 'Registrations' }] : []),
  ...(canFollowUps.value ? [{ id: 'follow-ups', label: 'Follow-ups' }] : []),
  ...(canWelfare.value ? [{ id: 'welfare-with-scope', label: 'Welfare' }] : []),
  ...(canLeadership.value ? [{ id: 'leadership', label: 'Leadership' }] : []),
  { id: 'timeline', label: 'Full timeline' },
])

async function toggleStatus(): Promise<void> {
  if (!person.value) return
  savingStatus.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/people/${person.value.id}`, {
      status: person.value.status === 'active' ? 'archived' : 'active',
    })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update status'
  } finally {
    savingStatus.value = false
  }
}
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

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this person"
      :description="error.message"
    />

    <template v-else-if="person">
      <PageHeader
        :title="displayName"
        :description="`${person.membership_status.replace(/_/g, ' ')} · ${person.branch_name || 'No branch'}`"
      >
        <template #actions>
          <PermissionGate :collection="COLLECTIONS.people" action="update">
            <UButton
              color="neutral"
              variant="outline"
              :label="person.status === 'active' ? 'Archive' : 'Restore'"
              :loading="savingStatus"
              @click="toggleStatus"
            />
            <UButton
              label="Edit person"
              icon="i-lucide-pencil"
              @click="showEdit = true"
            />
          </PermissionGate>
        </template>
      </PageHeader>

      <UAlert
        v-if="actionError"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />
      <UAlert
        v-if="restrictedMessage"
        class="mb-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Restricted on this account"
        :description="restrictedMessage"
      />

      <SectionNav :sections="sections" />

      <section id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <div class="grid gap-6 xl:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold" tabindex="-1">Profile</h2>
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Status</dt>
                <dd>
                  <UBadge
                    :color="person.status === 'active' ? 'success' : 'neutral'"
                    variant="subtle"
                  >
                    {{ person.status }}
                  </UBadge>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Gender</dt>
                <dd class="capitalize">{{ person.gender }}</dd>
              </div>
              <div v-if="showDob" class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Age</dt>
                <dd class="tabular-nums">{{ person.age ?? '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
                <dd>{{ person.phone || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Email</dt>
                <dd class="break-all text-right">{{ person.email || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Member since</dt>
                <dd>{{ formatDate(person.member_since) }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="text-base font-semibold" tabindex="-1">Household and consent</h2>
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Household</dt>
                <dd class="text-right">{{ person.household || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Guardian</dt>
                <dd class="text-right">{{ person.guardian || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Data consent</dt>
                <dd>{{ person.consent_data ? 'Yes' : 'No' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Media consent</dt>
                <dd>{{ person.consent_media ? 'Yes' : 'No' }}</dd>
              </div>
            </dl>
            <div
              v-if="person.safeguarding_flag"
              class="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            >
              <UIcon name="i-lucide-shield-alert" class="size-4" />
              Safeguarding flag is set
            </div>
            <div
              v-if="person.address"
              class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800"
            >
              <p class="text-gray-500 dark:text-gray-400">Address</p>
              <p class="mt-1 whitespace-pre-line">{{ person.address }}</p>
            </div>
            <div
              v-if="person.notes"
              class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800"
            >
              <p class="text-gray-500 dark:text-gray-400">Notes</p>
              <p class="mt-1 whitespace-pre-line">{{ person.notes }}</p>
            </div>
          </UCard>
        </div>
      </section>

      <section v-if="canAttendance" id="attendance" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ attendanceItems.length }} sessions
              </span>
            </div>
          </template>
          <ActivityList
            :items="attendanceItems"
            empty-title="No attendance recorded"
            empty-description="Named check-ins for this person will appear here."
          />
        </UCard>
      </section>

      <section v-if="canRegistrations" id="registrations" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Registrations</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ eventItems.length }} registrations
              </span>
            </div>
          </template>
          <ActivityList
            :items="eventItems"
            empty-title="No event registrations"
            empty-description="Registrations and attendance for events will appear here."
          />
        </UCard>
      </section>

      <section v-if="canFollowUps" id="follow-ups" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Follow-ups</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ visitorItems.length }} visits
              </span>
            </div>
          </template>
          <ActivityList
            :items="visitorItems"
            empty-title="No newcomer journey"
            empty-description="Visitor intake, follow-up and connection steps will appear here."
          />
        </UCard>
      </section>

      <section v-if="canWelfare" id="welfare-with-scope" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Welfare</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ welfareItems.length }} cases
              </span>
            </div>
          </template>
          <ActivityList
            :items="welfareItems"
            empty-title="No welfare involvement"
            empty-description="Cases linked to this person will appear here for permitted staff."
          />
        </UCard>
      </section>

      <section v-if="canLeadership" id="leadership" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Leadership</h2>
            </div>
          </template>
          <EmptyState
            title="Leadership assignments appear here"
            description="Department and position assignments for this person render here once the hierarchy endpoints from AFC-461a land. Gated on departments:read so volunteers never see it."
          />
        </UCard>
      </section>

      <section id="timeline" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Full timeline</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ person.timeline.length }} events
              </span>
            </div>
          </template>
          <ActivityList
            :items="person.timeline"
            empty-title="No activity yet"
            empty-description="Attendance, event registrations, visitor follow-ups and welfare cases will appear here."
          />
        </UCard>
      </section>

      <PeopleFormModal
        v-model:open="showEdit"
        :person="person"
        :branches="branches.data.value ?? []"
        :show-dob="showDob"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
