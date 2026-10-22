<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { AttendanceDetail, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const checkinError = ref('')
const savingCheckin = ref(false)
const personId = ref('manual')
const attendeeName = ref('')
const category = ref('member')

const {
  data: session,
  pending,
  error,
  refresh,
} = await useAsyncData(`attendance-${id}`, () =>
  api.get<AttendanceDetail>(`/api/attendance/${id}`),
)

const people = await useAsyncData('attendance-people', () =>
  api.get<Paginated<PersonRow>>('/api/people', {
    query: { limit: 200, status: 'active', sort: 'last_name' },
  }),
)

const canCheckin = computed(() =>
  permissions.can(COLLECTIONS.attendanceRecords, 'create'),
)
const canReadRecords = computed(() =>
  permissions.can(COLLECTIONS.attendanceRecords, 'read'),
)

const personOptions = computed(() => [
  { label: 'Type a name instead', value: 'manual' },
  ...(people.data.value?.data ?? []).map((person) => ({
    label:
      person.preferred_name ||
      [person.first_name, person.last_name].filter(Boolean).join(' '),
    value: person.id,
  })),
])

const categoryOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Visitor', value: 'visitor' },
  { label: 'Child', value: 'child' },
  { label: 'Other', value: 'other' },
]

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

async function submitCheckin(): Promise<void> {
  checkinError.value = ''
  if (personId.value === 'manual' && !attendeeName.value.trim()) {
    checkinError.value = 'Choose a person or type a name to check in.'
    return
  }
  savingCheckin.value = true
  try {
    await api.post(`/api/attendance/${id}/records`, {
      session: id,
      person: personId.value === 'manual' ? undefined : personId.value,
      attendee_name:
        personId.value === 'manual' ? attendeeName.value.trim() || undefined : undefined,
      attendance_category: category.value,
    })
    personId.value = 'manual'
    attendeeName.value = ''
    category.value = 'member'
    await refresh()
  } catch (cause) {
    checkinError.value =
      (cause as { message?: string }).message ?? 'Could not check in that person'
  } finally {
    savingCheckin.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/attendance"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to attendance"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this session"
      :description="error.message"
    />

    <template v-else-if="session">
      <PageHeader
        :title="session.session_name"
        :description="`${formatDate(session.session_date)} · ${session.branch_name || 'No branch'}`"
      />

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total"
          :value="session.headcount_total ?? 0"
          hint="Recorded headcount"
        />
        <StatCard label="Men" :value="session.headcount_men ?? 0" />
        <StatCard label="Women" :value="session.headcount_women ?? 0" />
        <StatCard label="Children" :value="session.headcount_children ?? 0" />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <UCard v-if="canCheckin" class="xl:col-span-1">
          <template #header
            ><h2 class="text-base font-semibold">Named check-in</h2></template
          >
          <form class="space-y-3" novalidate @submit.prevent="submitCheckin">
            <UAlert
              v-if="checkinError"
              color="error"
              variant="subtle"
              :description="checkinError"
            />
            <UFormField label="Person">
              <EntitySelect v-model="personId" :items="personOptions" placeholder="Select person…" class="w-full" />
            </UFormField>
            <UFormField label="Or type a name">
              <UInput
                v-model="attendeeName"
                class="w-full"
                :disabled="Boolean(personId)"
              />
            </UFormField>
            <UFormField label="Category">
              <USelect v-model="category" :items="categoryOptions" class="w-full" />
            </UFormField>
            <UButton type="submit" label="Check in" :loading="savingCheckin" />
          </form>
        </UCard>

        <UCard :class="canCheckin ? 'xl:col-span-2' : 'xl:col-span-3'">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Checked-in people</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{{ session.records.length }} records</span
              >
            </div>
          </template>

          <UAlert
            v-if="!canReadRecords"
            color="warning"
            variant="subtle"
            title="Named records not available"
            description="Your role can capture a session but does not hold a read grant on attendance records."
          />

          <EmptyState
            v-else-if="session.records.length === 0"
            title="No named check-ins yet"
            description="Use the form to check in a member, visitor or child."
          />

          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead>
                <tr
                  class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  <th class="px-3 py-2 font-medium">Name</th>
                  <th class="px-3 py-2 font-medium">Category</th>
                  <th class="px-3 py-2 font-medium">Recorded</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="record in session.records" :key="record.id">
                  <td class="px-3 py-3">
                    {{ record.person_name || record.attendee_name || '—' }}
                  </td>
                  <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                    {{ (record.attendance_category || 'member').replace(/_/g, ' ') }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{
                      record.recorded_at
                        ? new Date(record.recorded_at).toLocaleString()
                        : '—'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>
    </template>
  </div>
</template>
