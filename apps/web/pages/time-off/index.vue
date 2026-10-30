<script setup lang="ts">
import { COLLECTIONS, LEAVE_TYPES, type LeaveType } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()

/** Approvals tab is defence-in-depth: deciding officers hold the update
 *  grant; everyone else sees a restricted notice, never the queue. */
const canApprove = computed(() =>
  permissions.can(COLLECTIONS.leaveRequests, 'update'),
)

/** Drill-down contract (AFC-927): Requests answers "my leave status", so
 *  Mine is the default — `?mine=0` opts into the wider scoped view. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const mine = ref(queryParam('mine') !== '0')
const requestStatus = ref(queryParam('status') ?? 'all')
const approvalStatus = ref('pending')

/** Same-page query sync (tasks ?mine= pattern, default inverted to Mine). */
watch(
  () => route.query,
  (next: typeof route.query) => {
    mine.value = next.mine !== '0'
    requestStatus.value =
      typeof next.status === 'string' && next.status.length > 0 ? next.status : 'all'
  },
)

interface LeaveRow {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  reason?: string | null
  status: string
  requester_name: string | null
  requester_photo: string | null
  can_edit: boolean
}

const requestsQuery = computed(() => ({
  ...(requestStatus.value !== 'all' ? { status: requestStatus.value } : {}),
  ...(mine.value ? { mine: '1' } : {}),
}))

const { data: requestsData, pending: requestsPending, refresh: refreshRequests } =
  await useAsyncData('leave-requests', () =>
    api.get<{ data: LeaveRow[]; meta: { total: number } }>('/api/leave-requests', {
      query: requestsQuery.value,
    }),
  { watch: [requestsQuery] })

const approvalsQuery = computed(() => ({
  ...(approvalStatus.value !== 'all' ? { status: approvalStatus.value } : {}),
}))

const { data: approvalsData, pending: approvalsPending, refresh: refreshApprovals } =
  await useAsyncData('leave-approvals', () => {
    if (!canApprove.value) return Promise.resolve({ data: [], meta: { total: 0 } })
    return api.get<{ data: LeaveRow[]; meta: { total: number } }>('/api/leave-requests', {
      query: approvalsQuery.value,
    })
  }, { watch: [approvalsQuery, canApprove] })

const tabItems = computed(() => [
  { label: 'My requests', slot: 'requests' as const, value: 'requests' },
  ...(canApprove.value
    ? [{ label: 'Approvals', slot: 'approvals' as const, value: 'approvals' }]
    : []),
])

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

const leaveTypeOptions = (LEAVE_TYPES as readonly string[]).map((type) => ({
  label: type.charAt(0).toUpperCase() + type.slice(1),
  value: type,
}))

function statusColor(status: string): string {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'error'
  return 'warning'
}

function dateRange(row: LeaveRow): string {
  return row.start_date === row.end_date
    ? row.start_date
    : `${row.start_date} → ${row.end_date}`
}

/** Edit modal: pending rows only, requester-owned (server is truth). */
const editing = ref<LeaveRow | null>(null)
const editForm = ref({
  leave_type: 'annual' as LeaveType | string,
  start_date: '',
  end_date: '',
  reason: '',
})
const editError = ref('')
const saving = ref(false)

function openEdit(row: LeaveRow) {
  editing.value = row
  editError.value = ''
  editForm.value = {
    leave_type: row.leave_type,
    start_date: row.start_date,
    end_date: row.end_date,
    reason: row.reason ?? '',
  }
}

async function saveEdit() {
  if (!editing.value) return
  editError.value = ''
  if (editForm.value.start_date > editForm.value.end_date) {
    editError.value = 'The end date must be on or after the start date.'
    return
  }
  saving.value = true
  try {
    await api.patch(`/api/leave-requests/${editing.value.id}`, {
      leave_type: editForm.value.leave_type,
      start_date: editForm.value.start_date,
      end_date: editForm.value.end_date,
      reason: editForm.value.reason,
    })
    editing.value = null
    await Promise.all([refreshRequests(), refreshApprovals()])
  } catch (cause) {
    editError.value =
      (cause as { message?: string }).message ?? 'Could not save the changes'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Time Off"
      description="Your leave requests, and the deciding-officer queue for approvals."
    />

    <UTabs :items="tabItems" default-value="requests">
      <template #requests>
        <UCard>
          <div class="grid gap-3 sm:grid-cols-[220px_1fr]">
            <USelect
              v-model="requestStatus"
              :items="statusOptions"
              class="w-full"
              aria-label="Filter by status"
            />
            <UCheckbox v-model="mine" label="Mine only" name="mine" />
          </div>

          <div v-if="requestsPending" class="mt-8 flex justify-center py-10">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
          </div>

          <EmptyState
            v-else-if="(requestsData?.data ?? []).length === 0"
            title="No leave requests match these filters"
            description="Requests you make will appear here with their current status."
          />

          <div v-else class="mt-4 overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead>
                <tr
                  class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  <th class="px-3 py-2 font-medium">Requester</th>
                  <th class="px-3 py-2 font-medium">Type</th>
                  <th class="px-3 py-2 font-medium">Dates</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Reason</th>
                  <th class="px-3 py-2"><span class="sr-only">Edit</span></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr
                  v-for="row in requestsData?.data ?? []"
                  :key="row.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
                >
                  <td class="px-3 py-3">
                    <span class="flex items-center gap-2">
                      <PersonAvatar :name="row.requester_name" :photo="row.requester_photo" />
                      <span class="font-medium text-gray-900 dark:text-white">
                        {{ row.requester_name ?? '—' }}
                      </span>
                    </span>
                  </td>
                  <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                    {{ row.leave_type }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 tabular-nums dark:text-gray-300">
                    {{ dateRange(row) }}
                  </td>
                  <td class="px-3 py-3">
                    <UBadge :color="statusColor(row.status)" variant="subtle">
                      {{ row.status }}
                    </UBadge>
                  </td>
                  <td class="max-w-64 truncate px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ row.reason ?? '—' }}
                  </td>
                  <td class="px-3 py-3 text-right">
                    <UButton
                      v-if="row.can_edit"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      icon="i-lucide-pencil"
                      aria-label="Edit request"
                      @click="openEdit(row)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </template>

      <template #approvals>
        <UCard v-if="canApprove">
          <div class="grid gap-3 sm:grid-cols-[220px_1fr]">
            <USelect
              v-model="approvalStatus"
              :items="statusOptions"
              class="w-full"
              aria-label="Filter by status"
            />
          </div>

          <div v-if="approvalsPending" class="mt-8 flex justify-center py-10">
            <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
          </div>

          <EmptyState
            v-else-if="(approvalsData?.data ?? []).length === 0"
            title="The approvals queue is clear"
            description="Pending requests in your scope will appear here for decision."
          />

          <div v-else class="mt-4 overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead>
                <tr
                  class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  <th class="px-3 py-2 font-medium">Requester</th>
                  <th class="px-3 py-2 font-medium">Type</th>
                  <th class="px-3 py-2 font-medium">Dates</th>
                  <th class="px-3 py-2 font-medium">Status</th>
                  <th class="px-3 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr
                  v-for="row in approvalsData?.data ?? []"
                  :key="row.id"
                  class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
                >
                  <td class="px-3 py-3">
                    <span class="flex items-center gap-2">
                      <PersonAvatar :name="row.requester_name" :photo="row.requester_photo" />
                      <span class="font-medium text-gray-900 dark:text-white">
                        {{ row.requester_name ?? '—' }}
                      </span>
                    </span>
                  </td>
                  <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                    {{ row.leave_type }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 tabular-nums dark:text-gray-300">
                    {{ dateRange(row) }}
                  </td>
                  <td class="px-3 py-3">
                    <UBadge :color="statusColor(row.status)" variant="subtle">
                      {{ row.status }}
                    </UBadge>
                  </td>
                  <td class="max-w-64 truncate px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ row.reason ?? '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <UAlert
          v-else
          color="warning"
          variant="subtle"
          title="Restricted"
          description="The approvals queue is visible to deciding officers only. Your own requests are on the Requests tab."
        />
      </template>
    </UTabs>

    <UModal
      :open="editing !== null"
      title="Edit leave request"
      description="Only pending requests can be edited. The end date must be on or after the start date."
      @update:open="editing = $event ? editing : null"
    >
      <template #body>
        <div class="grid gap-3">
          <UFormField label="Leave type">
            <USelect
              v-model="editForm.leave_type"
              :items="leaveTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Start date">
            <UInput v-model="editForm.start_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="End date">
            <UInput v-model="editForm.end_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Reason">
            <UTextarea v-model="editForm.reason" class="w-full" :rows="3" />
          </UFormField>
        </div>
        <UAlert
          v-if="editError"
          class="mt-4"
          color="error"
          variant="subtle"
          title="Could not save the changes"
          :description="editError"
        />
        <div class="mt-4 flex justify-end gap-2">
          <UButton label="Cancel" color="neutral" variant="ghost" @click="editing = null" />
          <UButton
            label="Save changes"
            icon="i-lucide-check"
            :loading="saving"
            @click="saveEdit"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
