<script setup lang="ts">
import { COLLECTIONS, LEAVE_STATUSES, LEAVE_TYPES } from '@afc/shared'

/**
 * Annual Leave (AFC-842): Church Office leave requests.
 *
 * File a request (person, dates, type, reason — days count start..end
 * inclusive, stamped server-side), correct pending requests, and record
 * decisions (approve/decline/cancel) on the same row. Scoped to the
 * caller's branch/zone server-side.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

interface LeaveRequest {
  id: string
  person: string | null
  start_date: string
  end_date: string
  days: number
  leave_type: string
  reason: string | null
  status: string
}

const canCreate = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'create'))
const canDecide = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'update'))

const TYPE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  maternity: 'Maternity',
  compassionate: 'Compassionate',
  unpaid: 'Unpaid',
  other: 'Other',
}

const statusFilter = ref('all')
const requests = ref<LeaveRequest[]>([])
const requestsPending = ref(false)
const requestsError = ref('')
const personNames = ref<Record<string, string>>({})
const newRequest = ref({
  person: '',
  start_date: '',
  end_date: '',
  leave_type: 'annual',
  reason: '',
})
const requestSaving = ref(false)
const requestError = ref('')
const actionError = ref('')

const statusItems = computed(() => [
  { label: 'All statuses', value: 'all' },
  ...LEAVE_STATUSES.map((status: string) => ({ label: status, value: status })),
])

async function loadRequests(): Promise<void> {
  requestsPending.value = true
  requestsError.value = ''
  try {
    const res = await api.get<{ data: LeaveRequest[] }>('/api/leave-requests', {
      query: statusFilter.value === 'all' ? {} : { status: statusFilter.value },
    })
    requests.value = res.data ?? []
    await resolveNames()
  } catch (cause) {
    requestsError.value =
      (cause as { message?: string }).message ?? 'Could not load requests'
  } finally {
    requestsPending.value = false
  }
}

async function resolveNames(): Promise<void> {
  const ids = [
    ...new Set(requests.value.map((row: LeaveRequest) => row.person).filter(Boolean)),
  ] as string[]
  const missing = ids.filter((id) => !personNames.value[id])
  if (missing.length === 0) return
  const settled = await Promise.all(
    missing.map((id) =>
      api
        .get<{ data: Record<string, unknown> }>(`/api/people/${id}`)
        .then((res) => ({ id, row: res.data }))
        .catch(() => ({ id, row: null })),
    ),
  )
  const names: Record<string, string> = {}
  for (const { id, row } of settled) {
    if (!row) continue
    const full =
      `${String(row.first_name ?? '').trim()} ${String(row.last_name ?? '').trim()}`.trim()
    names[id] = String(row.preferred_name ?? '').trim() || full || 'Unnamed member'
  }
  personNames.value = { ...personNames.value, ...names }
}

async function createRequest(): Promise<void> {
  if (newRequest.value.person === '') {
    requestError.value = 'Choose who the leave is for.'
    return
  }
  if (newRequest.value.start_date === '' || newRequest.value.end_date === '') {
    requestError.value = 'Give the leave a start and an end date.'
    return
  }
  requestSaving.value = true
  requestError.value = ''
  try {
    await api.post('/api/leave-requests', {
      person: newRequest.value.person,
      start_date: newRequest.value.start_date,
      end_date: newRequest.value.end_date,
      leave_type: newRequest.value.leave_type,
      ...(newRequest.value.reason.trim() === ''
        ? {}
        : { reason: newRequest.value.reason.trim() }),
    })
    newRequest.value = {
      person: '',
      start_date: '',
      end_date: '',
      leave_type: 'annual',
      reason: '',
    }
    await loadRequests()
  } catch (cause) {
    requestError.value =
      (cause as { message?: string }).message ?? 'Could not file the request'
  } finally {
    requestSaving.value = false
  }
}

async function decide(
  id: string,
  status: 'approved' | 'declined' | 'cancelled',
): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/leave-requests/${id}`, { status })
    await loadRequests()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not record the decision'
  }
}

async function withdraw(id: string): Promise<void> {
  actionError.value = ''
  try {
    await api.remove(`/api/leave-requests/${id}`)
    await loadRequests()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not withdraw the request'
  }
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

function personLabel(id: string | null): string {
  if (!id) return '—'
  return personNames.value[id] ?? id.slice(0, 8)
}

onMounted(() => {
  void loadRequests()
})

watch(statusFilter, () => {
  void loadRequests()
})
</script>

<template>
  <div>
    <PageHeader
      title="Annual Leave"
      description="Leave requests for the Church Office — file, correct pending requests, and record decisions."
    />
    <div class="mt-4 flex flex-wrap items-end gap-2">
      <UFormField label="Status" class="w-52">
        <USelect v-model="statusFilter" :items="statusItems" class="w-full" />
      </UFormField>
    </div>
    <p v-if="requestsPending" class="mt-3 text-sm text-gray-500">Loading requests…</p>
    <p v-else-if="requestsError !== ''" class="mt-3 text-sm text-red-600">
      {{ requestsError }}
    </p>
    <div v-else-if="requests.length === 0" class="mt-3">
      <UCard>
        <EmptyState
          title="No leave requests"
          description="File the first request below."
        />
      </UCard>
    </div>
    <div v-else class="mt-3 space-y-2">
      <UCard v-for="row in requests" :key="row.id">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="font-semibold">{{ personLabel(row.person) }}</span>
          <UBadge color="neutral" variant="subtle">{{
            typeLabel(row.leave_type)
          }}</UBadge>
          <UBadge
            :color="
              row.status === 'approved'
                ? 'success'
                : row.status === 'pending'
                  ? 'neutral'
                  : 'error'
            "
            variant="subtle"
          >
            {{ row.status }}
          </UBadge>
          <span class="text-gray-500"
            >{{ row.start_date }} → {{ row.end_date }} ({{ row.days }}d)</span
          >
          <span class="ml-auto flex gap-1">
            <template v-if="canDecide && row.status === 'pending'">
              <UButton
                size="xs"
                color="success"
                variant="soft"
                label="Approve"
                @click="decide(row.id, 'approved')"
              />
              <UButton
                size="xs"
                color="error"
                variant="soft"
                label="Decline"
                @click="decide(row.id, 'declined')"
              />
            </template>
            <UButton
              v-if="canDecide && row.status === 'approved'"
              size="xs"
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="decide(row.id, 'cancelled')"
            />
            <UButton
              v-if="row.status === 'pending'"
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              :aria-label="`Withdraw request`"
              @click="withdraw(row.id)"
            />
          </span>
        </div>
        <p v-if="row.reason" class="mt-1 text-sm text-gray-600">{{ row.reason }}</p>
      </UCard>
    </div>
    <p v-if="actionError !== ''" class="mt-3 text-sm text-red-600">{{ actionError }}</p>
    <UCard v-if="canCreate" class="mt-4">
      <template #header>
        <h3 class="font-semibold">File a request</h3>
      </template>
      <div class="grid gap-2 sm:grid-cols-2">
        <UFormField label="Who is the leave for" class="sm:col-span-2">
          <EntitySelect
            v-model="newRequest.person"
            :items="personOptions"
            placeholder="Type a name to search…"
            :loading="personPending"
            server-search
            class="w-full"
            @update:search-term="onPersonSearch"
          />
        </UFormField>
        <UFormField label="Start date">
          <UInput v-model="newRequest.start_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="End date">
          <UInput v-model="newRequest.end_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Type">
          <USelect
            v-model="newRequest.leave_type"
            :items="
              LEAVE_TYPES.map((type: string) => ({ label: typeLabel(type), value: type }))
            "
            class="w-full"
          />
        </UFormField>
        <UFormField label="Reason">
          <UInput v-model="newRequest.reason" placeholder="Optional" class="w-full" />
        </UFormField>
      </div>
      <UButton
        class="mt-3"
        label="File request"
        icon="i-lucide-plus"
        :loading="requestSaving"
        @click="createRequest"
      />
      <p v-if="requestError !== ''" class="mt-2 text-sm text-red-600">
        {{ requestError }}
      </p>
    </UCard>
  </div>
</template>
