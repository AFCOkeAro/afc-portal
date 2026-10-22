<script setup lang="ts">
import { COLLECTIONS, SERVICE_ROLES } from '@afc/shared'
import type { BranchSummary, Paginated, PersonRow, ServiceDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)

const tab = ref('roster')
const assignError = ref('')
const savingAssign = ref(false)
const personId = ref('')
const role = ref<string>('usher')
const statusMoving = ref<string | null>(null)
const completing = ref(false)
const actionError = ref('')
const showBlessingForm = ref(false)

const {
  data: service,
  pending,
  error,
  refresh,
} = await useAsyncData(`service-${id}`, () =>
  api.get<ServiceDetail>(`/api/services/${id}`),
)

const people = await useAsyncData('service-people', () =>
  api.get<Paginated<PersonRow>>('/api/people', {
    query: { limit: 200, status: 'active', sort: 'last_name' },
  }),
)

const branches = await useAsyncData('service-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const canAssign = computed(() =>
  permissions.can(COLLECTIONS.serviceAssignments, 'create'),
)
const canMoveStatus = computed(() =>
  permissions.can(COLLECTIONS.serviceAssignments, 'update'),
)
const canComplete = computed(() => permissions.can(COLLECTIONS.sundayServices, 'update'))
const canBlessings = computed(() => permissions.can(COLLECTIONS.blessings, 'read'))
const canRecordBlessings = computed(() =>
  permissions.can(COLLECTIONS.blessings, 'create'),
)

const personOptions = computed(() => [
  { label: 'Choose a person', value: '' },
  ...(people.data.value?.data ?? []).map((person) => ({
    label:
      person.preferred_name ||
      [person.first_name, person.last_name].filter(Boolean).join(' ') ||
      person.id,
    value: person.id,
  })),
])

const roleOptions = SERVICE_ROLES.map((value) => ({
  label: value.replace(/_/g, ' '),
  value,
}))

function formatDate(value: string | null): string {
  if (!value) return '—'
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

function eventLabel(eventType: string): string {
  return eventType.replace(/_/g, ' ')
}

async function submitAssign(): Promise<void> {
  assignError.value = ''
  if (!personId.value) {
    assignError.value = 'Choose a person to roster.'
    return
  }
  savingAssign.value = true
  try {
    await api.post(`/api/services/${id}/assignments`, {
      service: id,
      person: personId.value,
      role: role.value,
    })
    personId.value = ''
    role.value = 'usher'
    await refresh()
  } catch (cause) {
    assignError.value =
      (cause as { message?: string }).message ?? 'Could not roster that person'
  } finally {
    savingAssign.value = false
  }
}

async function moveAssignment(assignmentId: string, next: string): Promise<void> {
  actionError.value = ''
  statusMoving.value = assignmentId
  try {
    await api.patch(`/api/services/assignments/${assignmentId}`, { status: next })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not move that roster status'
  } finally {
    statusMoving.value = null
  }
}

async function markCompleted(): Promise<void> {
  actionError.value = ''
  completing.value = true
  try {
    await api.patch(`/api/services/${id}`, { status: 'completed' })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not complete that service'
  } finally {
    completing.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/services"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to services"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this service"
      :description="error.message"
    />

    <template v-else-if="service">
      <PageHeader
        :title="service.theme || 'Service'"
        :description="`${formatDate(service.service_date)}${service.service_time ? ` · ${service.service_time}` : ''} · ${service.branch_name || 'No branch'}`"
      >
        <template #actions>
          <span
            class="rounded-full px-3 py-1 text-xs font-medium capitalize"
            :class="
              service.status === 'completed'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
            "
          >
            {{ service.status }}
          </span>
          <UButton
            v-if="canComplete && service.status !== 'completed'"
            label="Mark completed"
            color="neutral"
            variant="outline"
            :loading="completing"
            @click="markCompleted"
          />
        </template>
      </PageHeader>

      <UAlert
        v-if="actionError"
        color="error"
        variant="subtle"
        :description="actionError"
      />

      <div class="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Type"
          :value="service.service_type"
          hint="Sunday, midweek, special or camp"
        />
        <StatCard
          label="Expected"
          :value="service.expected_attendance ?? 0"
          hint="Planned attendance"
        />
        <StatCard
          label="Recorded"
          :value="service.total_attendance ?? 0"
          hint="Copied from the linked session"
        />
      </div>

      <div class="mt-6 flex gap-2" role="tablist" aria-label="Service sections">
        <UButton
          label="Roster"
          :color="tab === 'roster' ? 'primary' : 'neutral'"
          :variant="tab === 'roster' ? 'solid' : 'outline'"
          role="tab"
          :aria-selected="tab === 'roster'"
          @click="tab = 'roster'"
        />
        <UButton
          label="Audit trail"
          :color="tab === 'audit' ? 'primary' : 'neutral'"
          :variant="tab === 'audit' ? 'solid' : 'outline'"
          role="tab"
          :aria-selected="tab === 'audit'"
          @click="tab = 'audit'"
        />
        <UButton
          v-if="canBlessings"
          label="Blessings"
          :color="tab === 'blessings' ? 'primary' : 'neutral'"
          :variant="tab === 'blessings' ? 'solid' : 'outline'"
          role="tab"
          :aria-selected="tab === 'blessings'"
          @click="tab = 'blessings'"
        />
      </div>

      <div v-if="tab === 'roster'" class="mt-4 grid gap-6 xl:grid-cols-3">
        <UCard v-if="canAssign" class="xl:col-span-1">
          <template #header>
            <h2 class="text-base font-semibold">Assign a role</h2>
          </template>
          <form class="space-y-3" novalidate @submit.prevent="submitAssign">
            <UAlert
              v-if="assignError"
              color="error"
              variant="subtle"
              :description="assignError"
            />
            <UFormField label="Person">
              <EntitySelect
                v-model="personId"
                :items="personOptions"
                placeholder="Select person…"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Role">
              <USelect v-model="role" :items="roleOptions" class="w-full" />
            </UFormField>
            <UButton type="submit" label="Assign" :loading="savingAssign" />
          </form>
        </UCard>

        <UCard :class="canAssign ? 'xl:col-span-2' : 'xl:col-span-3'">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Roster</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ service.assignment_count }} assigned
              </span>
            </div>
          </template>

          <EmptyState
            v-if="service.assignments.length === 0"
            title="No roster yet"
            description="Assign worship, ushering, media and the other roles for this service."
          />

          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead>
                <tr
                  class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  <th class="px-3 py-2 font-medium">Person</th>
                  <th class="px-3 py-2 font-medium">Role</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2"><span class="sr-only">Move</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="assignment in service.assignments" :key="assignment.id">
                  <td class="px-3 py-3">{{ assignment.person_name || '—' }}</td>
                  <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                    {{ assignment.role.replace(/_/g, ' ') }}
                  </td>
                  <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                    {{ assignment.status }}
                  </td>
                  <td class="px-3 py-3 text-right">
                    <div
                      v-if="canMoveStatus && statusMoving !== assignment.id"
                      class="flex justify-end gap-1"
                    >
                      <UButton
                        v-if="assignment.status !== 'confirmed'"
                        size="xs"
                        color="neutral"
                        variant="outline"
                        label="Confirm"
                        @click="moveAssignment(assignment.id, 'confirmed')"
                      />
                      <UButton
                        v-if="assignment.status !== 'declined'"
                        size="xs"
                        color="neutral"
                        variant="ghost"
                        label="Decline"
                        @click="moveAssignment(assignment.id, 'declined')"
                      />
                    </div>
                    <UIcon
                      v-else-if="statusMoving === assignment.id"
                      name="i-lucide-loader-circle"
                      class="size-4 animate-spin text-gray-400"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </div>

      <UCard v-if="tab === 'audit'" class="mt-4">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">Audit trail</h2>
            <span class="text-xs text-gray-500 dark:text-gray-400">
              {{ service.events.length }} events
            </span>
          </div>
        </template>

        <EmptyState
          v-if="service.events.length === 0"
          title="No audit events"
          description="Planning, roster and status changes are recorded here."
        />

        <ol v-else class="space-y-3">
          <li
            v-for="item in service.events"
            :key="item.id"
            class="flex items-start gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
          >
            <UIcon name="i-lucide-history" class="mt-0.5 size-4 shrink-0 text-gray-400" />
            <div>
              <p class="text-sm font-medium capitalize">
                {{ eventLabel(item.event_type) }}
              </p>
              <p class="text-sm text-gray-600 dark:text-gray-300">
                {{ item.detail || '—' }}
              </p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {{ item.created_at ? new Date(item.created_at).toLocaleString() : '—' }}
              </p>
            </div>
          </li>
        </ol>
      </UCard>

      <UCard v-if="tab === 'blessings' && canBlessings" class="mt-4">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">Blessings</h2>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ service.blessings_total }} total ·
                {{ service.blessings.length }} records
              </span>
              <UButton
                v-if="canRecordBlessings"
                size="xs"
                color="neutral"
                variant="outline"
                label="Record blessings"
                icon="i-lucide-plus"
                @click="showBlessingForm = true"
              />
            </div>
          </div>
        </template>

        <EmptyState
          v-if="service.blessings.length === 0"
          title="No blessings recorded"
          description="Record salvation, healing and the other blessing types for this service."
        />

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Blessing</th>
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Count</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="blessing in service.blessings" :key="blessing.id">
                <td class="px-3 py-3">
                  <NuxtLink
                    :to="`/blessings/${blessing.id}`"
                    class="font-medium capitalize hover:text-primary-600"
                  >
                    {{
                      blessing.blessing_type === 'other' && blessing.other_label
                        ? blessing.other_label
                        : blessing.blessing_type.replace(/_/g, ' ')
                    }}
                  </NuxtLink>
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ blessing.service_date }}
                </td>
                <td class="px-3 py-3 font-medium tabular-nums">
                  {{ blessing.count ?? blessing.total_count }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <BlessingFormModal
        v-if="service"
        v-model:open="showBlessingForm"
        :branches="branches.data.value ?? []"
        :preset="{
          sunday_service: service.id,
          branch: service.branch,
          service_date: service.service_date,
        }"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
