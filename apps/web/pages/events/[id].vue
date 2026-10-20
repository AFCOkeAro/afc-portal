<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, EventDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const savingStatus = ref(false)
const actionError = ref('')

const {
  data: event,
  pending,
  error,
  refresh,
} = await useAsyncData(`event-${id}`, () => api.get<EventDetail>(`/api/events/${id}`))

const branches = await useAsyncData('events-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const canEdit = computed(() => permissions.can(COLLECTIONS.events, 'update'))
const canReadRegistrations = computed(() =>
  permissions.can(COLLECTIONS.eventRegistrations, 'read'),
)
const canExport = computed(
  () =>
    canReadRegistrations.value &&
    permissions.can(COLLECTIONS.events, 'read') &&
    event.value !== null,
)
const medicalVisible = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.eventRegistrations, 'medical_notes'),
)

const restrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.eventRegistrations)
  if (hidden.length === 0) return ''
  return `Registration fields not shown on this account: ${hidden.join(', ')}.`
})

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

const registrationColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  confirmed: 'success',
  attended: 'success',
  pending: 'warning',
  waitlisted: 'warning',
  cancelled: 'error',
  no_show: 'error',
}

async function setStatus(status: 'published' | 'closed' | 'cancelled'): Promise<void> {
  savingStatus.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/events/${id}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update event'
  } finally {
    savingStatus.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/events"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to events"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this event"
      :description="error.message"
    />

    <template v-else-if="event">
      <PageHeader
        :title="event.title"
        :description="`${event.event_type} · ${event.branch_name || 'Area-wide'}`"
      >
        <template #actions>
          <UButton
            v-if="canExport"
            :to="`/api/events/${event.id}/registrations.csv`"
            external
            color="neutral"
            variant="outline"
            icon="i-lucide-download"
            label="Export CSV"
          />
          <PermissionGate :collection="COLLECTIONS.events" action="update">
            <UButton label="Edit event" icon="i-lucide-pencil" @click="showEdit = true" />
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

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Registered"
          :value="event.registered_count"
          :hint="event.capacity ? `Capacity ${event.capacity}` : 'Unlimited capacity'"
        />
        <StatCard
          label="Confirmed"
          :value="event.confirmed_count"
          hint="Confirmed registrations"
        />
        <StatCard label="Attended" :value="event.attended_count" hint="Marked attended" />
        <StatCard label="Status" :value="event.status" :hint="event.visibility" />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Schedule</h2></template>
          <dl class="space-y-3 text-sm">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Starts</dt>
              <dd>{{ formatDateTime(event.start_at) }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Ends</dt>
              <dd>{{ formatDateTime(event.end_at) }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Location</dt>
              <dd>{{ event.location || '—' }}</dd>
            </div>
            <div v-if="event.address">
              <dt class="text-gray-500 dark:text-gray-400">Address</dt>
              <dd class="whitespace-pre-line">{{ event.address }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header
            ><h2 class="text-base font-semibold">Registration</h2></template
          >
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Registration open</dt>
              <dd>{{ event.registration_open ? 'Yes' : 'No' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Opens</dt>
              <dd class="text-right">
                {{ formatDateTime(event.registration_opens_at) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Closes</dt>
              <dd class="text-right">
                {{ formatDateTime(event.registration_closes_at) }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Fee</dt>
              <dd>
                {{
                  event.fee_amount
                    ? `${event.fee_amount} ${event.currency ?? ''}`
                    : 'Free'
                }}
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Waitlist</dt>
              <dd>{{ event.waitlist_enabled ? 'Enabled' : 'Off' }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header
            ><h2 class="text-base font-semibold">Eligibility</h2></template
          >
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Age range</dt>
              <dd>{{ event.age_min ?? 'Any' }} – {{ event.age_max ?? 'Any' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Guardian consent</dt>
              <dd>{{ event.requires_guardian_consent ? 'Required' : 'Not required' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Medical data</dt>
              <dd>{{ event.collect_medical ? 'Collected' : 'Not collected' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Visibility</dt>
              <dd class="capitalize">{{ event.visibility }}</dd>
            </div>
          </dl>
          <div
            v-if="canEdit"
            class="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <UButton
              v-if="event.status !== 'published'"
              size="xs"
              label="Publish"
              :loading="savingStatus"
              @click="setStatus('published')"
            />
            <UButton
              v-if="event.status === 'published'"
              size="xs"
              color="neutral"
              variant="outline"
              label="Close registration"
              :loading="savingStatus"
              @click="setStatus('closed')"
            />
            <UButton
              v-if="event.status !== 'cancelled'"
              size="xs"
              color="error"
              variant="outline"
              label="Cancel event"
              :loading="savingStatus"
              @click="setStatus('cancelled')"
            />
          </div>
        </UCard>
      </div>

      <UCard class="mt-6">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">Registrations</h2>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ event.registrations.length }} records
            </span>
          </div>
        </template>

        <UAlert
          v-if="!canReadRegistrations"
          color="warning"
          variant="subtle"
          title="Registration list not available"
          description="Your role can see the event but does not hold a read grant on registrations."
        />

        <EmptyState
          v-else-if="event.registrations.length === 0"
          title="No registrations yet"
          description="Share the public registration link to start collecting sign-ups."
        />

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Ticket</th>
                <th class="px-3 py-2 font-medium">Name</th>
                <th class="px-3 py-2 font-medium">Contact</th>
                <th class="px-3 py-2 font-medium">Age group</th>
                <th v-if="medicalVisible" class="px-3 py-2 font-medium">Medical</th>
                <th class="px-3 py-2 font-medium">Payment</th>
                <th class="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="registration in event.registrations" :key="registration.id">
                <td class="px-3 py-3 font-mono text-xs">
                  {{ registration.ticket_code || '—' }}
                </td>
                <td class="px-3 py-3">
                  <p class="font-medium">{{ registration.person_name }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ registration.email || registration.phone || '' }}
                  </p>
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ registration.guardian_name || '—' }}
                </td>
                <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                  {{ registration.age_group }}
                </td>
                <td
                  v-if="medicalVisible"
                  class="px-3 py-3 text-gray-600 dark:text-gray-300"
                >
                  <p>{{ registration.allergies || 'No allergies' }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ registration.medical_notes || '' }}
                  </p>
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ registration.payment_status || '—' }}
                  <span v-if="registration.amount_paid">
                    · {{ registration.amount_paid }}</span
                  >
                </td>
                <td class="px-3 py-3">
                  <UBadge
                    :color="
                      registrationColor[registration.registration_status] ?? 'neutral'
                    "
                    variant="subtle"
                  >
                    {{ registration.registration_status.replace(/_/g, ' ') }}
                  </UBadge>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <EventFormModal
        v-model:open="showEdit"
        :event="event"
        :branches="branches.data.value ?? []"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
