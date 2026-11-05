<script setup lang="ts">
import { COLLECTIONS, LEAVE_TYPES, workingDaysBetween } from '@afc/shared'
import type { LeaveType } from '@afc/shared'

/**
 * Time Off (AFC-1058 cutover over AFC-896 + AFC-927): Time Off and Annual
 * Leave are the same subject, so they live in one section with Balances /
 * Requests / Approvals tabs instead of separate menu entries.
 *
 * Balances tab (AFC-854): annual allowances per person per year, plus a
 * working-day calculator for planning leave (Mon–Fri; public holidays are
 * not subtracted yet — no holiday register). Used and remaining days
 * compute server-side against approved leave_requests.
 *
 * Requests tab: answers "my leave status", so Mine is the default —
 * `?mine=0` opts into the wider scoped view. Filing stamps the session
 * user as the requester server-side (no client user id, no client day
 * count); an optional person link covers HR filing on behalf. Pending-only
 * edit modal via the existing PATCH (server enforces pending + requester
 * + date order and audits the edit). Names resolve route-side; avatars
 * render initials until person photos land (AFC-864 wire point).
 *
 * Approvals tab: the deciding-officer queue — the same endpoint with no
 * `mine` filter — gated on the update grant; everyone else sees a
 * restricted notice, never the queue. Decisions (approved/rejected) stamp
 * decided_by/at from the session and write the audit row.
 *
 * Tab is `?tab=` so each tab deep-links (events detail precedent); the old
 * `/annual-leave` route redirects to `?tab=requests` so bookmarks keep
 * working.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const router = useRouter()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

const TABS = [
  { id: 'balances', label: 'Balances', icon: 'i-lucide-wallet' },
  { id: 'requests', label: 'Requests', icon: 'i-lucide-inbox' },
  { id: 'approvals', label: 'Approvals', icon: 'i-lucide-check-check' },
] as const

type TabId = (typeof TABS)[number]['id']

const canManage = computed(() => permissions.can(COLLECTIONS.leaveBalances, 'create'))
const canSeeBalances = computed(() => permissions.can(COLLECTIONS.leaveBalances, 'read'))
const canCreate = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'create'))
const canSeeRequests = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'read'))
/** Approvals tab is defence in depth: deciding officers hold the update
 *  grant; everyone else sees a restricted notice, never the queue. */
const canApprove = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'update'))

interface LeaveBalance {
  id: string
  person: string | null
  name: string | null
  year: number
  allowance_days: number
  used_days: number | null
  remaining_days: number | null
}

const yearFilter = ref(String(new Date().getFullYear()))
const balances = ref<LeaveBalance[]>([])
const balancesPending = ref(false)
const balancesError = ref('')
const newBalance = ref({
  person: '',
  year: String(new Date().getFullYear()),
  allowance: '21',
})
const balanceSaving = ref(false)
const balanceError = ref('')
const calcStart = ref('')
const calcEnd = ref('')

const yearItems = computed(() => {
  const current = new Date().getFullYear()
  return [current - 1, current + 1].map((year) => ({
    label: String(year),
    value: String(year),
  }))
})

/** Working days in the calculator range, null until both dates parse. */
const calcDays = computed(() => {
  if (calcStart.value === '' || calcEnd.value === '') return null
  return workingDaysBetween(calcStart.value, calcEnd.value)
})

async function loadBalances(): Promise<void> {
  balancesPending.value = true
  balancesError.value = ''
  try {
    const res = await api.get<{ data: LeaveBalance[] }>('/api/leave-balances', {
      query: yearFilter.value === '' ? {} : { year: yearFilter.value },
    })
    balances.value = res.data ?? []
  } catch (cause) {
    balancesError.value =
      (cause as { message?: string }).message ?? 'Could not load allowances'
  } finally {
    balancesPending.value = false
  }
}

async function setAllowance(): Promise<void> {
  if (newBalance.value.person === '') {
    balanceError.value = 'Choose who the allowance is for.'
    return
  }
  balanceSaving.value = true
  balanceError.value = ''
  try {
    await api.post('/api/leave-balances', {
      person: newBalance.value.person,
      year: Number(newBalance.value.year),
      allowance_days: Number(newBalance.value.allowance),
    })
    newBalance.value = {
      person: '',
      year: String(new Date().getFullYear()),
      allowance: '21',
    }
    await loadBalances()
  } catch (cause) {
    balanceError.value =
      (cause as { message?: string }).message ?? 'Could not set the allowance'
  } finally {
    balanceSaving.value = false
  }
}

async function removeBalance(id: string): Promise<void> {
  balanceError.value = ''
  try {
    await api.remove(`/api/leave-balances/${id}`)
    await loadBalances()
  } catch (cause) {
    balanceError.value =
      (cause as { message?: string }).message ?? 'Could not remove the allowance'
  }
}

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

const TYPE_LABELS: Record<string, string> = {
  annual: 'Annual',
  sick: 'Sick',
  compassionate: 'Compassionate',
  study: 'Study',
  unpaid: 'Unpaid',
  other: 'Other',
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type
}

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

function rowDays(row: LeaveRow): number | null {
  return workingDaysBetween(row.start_date, row.end_date)
}

/** Drill-down contract: Requests answers "my leave status", so Mine is
 *  the default — `?mine=0` opts into the wider scoped view. */
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

const requestsQuery = computed(() => ({
  ...(requestStatus.value !== 'all' ? { status: requestStatus.value } : {}),
  ...(mine.value ? { mine: '1' } : {}),
}))

const requests = ref<LeaveRow[]>([])
const requestsPending = ref(false)
const requestsError = ref('')

const approvalsQuery = computed(() => ({
  ...(approvalStatus.value !== 'all' ? { status: approvalStatus.value } : {}),
}))

const approvals = ref<LeaveRow[]>([])
const approvalsPending = ref(false)
const approvalsError = ref('')
const actionError = ref('')

const statusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

const leaveTypeOptions = (LEAVE_TYPES as readonly string[]).map((type) => ({
  label: typeLabel(type),
  value: type,
}))

async function loadRequests(): Promise<void> {
  requestsPending.value = true
  requestsError.value = ''
  try {
    const res = await api.get<{ data: LeaveRow[] }>('/api/leave-requests', {
      query: requestsQuery.value,
    })
    requests.value = res.data ?? []
  } catch (cause) {
    requestsError.value =
      (cause as { message?: string }).message ?? 'Could not load requests'
  } finally {
    requestsPending.value = false
  }
}

async function loadApprovals(): Promise<void> {
  if (!canApprove.value) {
    approvals.value = []
    return
  }
  approvalsPending.value = true
  approvalsError.value = ''
  try {
    const res = await api.get<{ data: LeaveRow[] }>('/api/leave-requests', {
      query: approvalsQuery.value,
    })
    approvals.value = res.data ?? []
  } catch (cause) {
    approvalsError.value =
      (cause as { message?: string }).message ?? 'Could not load the approvals queue'
  } finally {
    approvalsPending.value = false
  }
}

/* Balance preview (AFC-854 phase 2): allowance, used and the cost of the
 * draft dates, so a request is filed with eyes open. Unknown until a person
 * link and both dates are chosen. */
const previewBalance = ref<{
  allowance: number
  used: number | null
} | null>(null)
const previewPending = ref(false)

const newRequest = ref({
  person: '',
  start_date: '',
  end_date: '',
  leave_type: 'annual',
  reason: '',
})
const requestSaving = ref(false)
const requestError = ref('')

const previewDays = computed(() => {
  if (newRequest.value.start_date === '' || newRequest.value.end_date === '') return null
  return workingDaysBetween(newRequest.value.start_date, newRequest.value.end_date)
})

async function loadPreview(): Promise<void> {
  previewBalance.value = null
  if (newRequest.value.person === '' || newRequest.value.start_date === '') return
  const year = newRequest.value.start_date.slice(0, 4)
  previewPending.value = true
  try {
    const res = await api.get<{ data: Array<Record<string, unknown>> }>(
      '/api/leave-balances',
      {
        query: { person: newRequest.value.person, year },
      },
    )
    const row = (res.data ?? [])[0]
    previewBalance.value = row
      ? {
          allowance: Number(row.allowance_days ?? 0),
          used: row.used_days === null ? null : Number(row.used_days),
        }
      : { allowance: 0, used: null }
  } catch {
    previewBalance.value = null
  } finally {
    previewPending.value = false
  }
}

watch(
  () => [newRequest.value.person, newRequest.value.start_date],
  () => {
    void loadPreview()
  },
)

async function createRequest(): Promise<void> {
  if (newRequest.value.start_date === '' || newRequest.value.end_date === '') {
    requestError.value = 'Give the leave a start and an end date.'
    return
  }
  if (newRequest.value.reason.trim() === '') {
    requestError.value = 'Give a reason for the leave.'
    return
  }
  requestSaving.value = true
  requestError.value = ''
  try {
    await api.post('/api/leave-requests', {
      ...(newRequest.value.person === ''
        ? {}
        : { requester_person: newRequest.value.person }),
      start_date: newRequest.value.start_date,
      end_date: newRequest.value.end_date,
      leave_type: newRequest.value.leave_type,
      reason: newRequest.value.reason.trim(),
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

async function decide(id: string, status: 'approved' | 'rejected'): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/leave-requests/${id}`, { status })
    await loadApprovals()
    await loadRequests()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not record the decision'
  }
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
    await loadRequests()
  } catch (cause) {
    editError.value =
      (cause as { message?: string }).message ?? 'Could not save the changes'
  } finally {
    saving.value = false
  }
}

const shownTabs = computed<(typeof TABS)[number][]>(() =>
  TABS.filter((entry) =>
    entry.id === 'balances' ? canSeeBalances.value : canSeeRequests.value,
  ),
)

/** Active tab from `?tab=`, falling back to the first visible tab. */
const tab = computed<TabId>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return shownTabs.value.some((entry: (typeof TABS)[number]) => entry.id === value)
    ? (value as TabId)
    : (shownTabs.value[0]?.id ?? 'balances')
})

function goTab(next: TabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

onMounted(() => {
  void loadBalances()
  void loadRequests()
  void loadApprovals()
})

watch(yearFilter, () => {
  void loadBalances()
})

watch([requestsQuery, canSeeRequests], () => {
  void loadRequests()
})

watch([approvalsQuery, canApprove], () => {
  void loadApprovals()
})
</script>

<template>
  <div>
    <PageHeader
      title="Time Off"
      description="Annual leave in one place — balances, requests and approvals. Allowances count in working days (Mon–Fri)."
    />
    <!-- Tabs (AFC-896): one section, `?tab=` deep-links (events detail precedent). -->
    <nav aria-label="Time off sections" class="mt-4">
      <div
        class="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          v-for="entry in shownTabs"
          :key="entry.id"
          type="button"
          :aria-current="tab === entry.id ? 'page' : undefined"
          :class="[
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm',
            tab === entry.id
              ? 'bg-primary-950 font-medium text-white'
              : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
          ]"
          @click="goTab(entry.id)"
        >
          <UIcon :name="entry.icon" class="size-4" />{{ entry.label }}
        </button>
      </div>
    </nav>

    <!-- BALANCES (AFC-854): allowances + calculator + preview math -->
    <section v-if="tab === 'balances'" aria-label="Leave balances" class="mt-4">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Year" class="w-40">
          <USelect v-model="yearFilter" :items="yearItems" class="w-full" />
        </UFormField>
      </div>
      <p v-if="balancesPending" class="mt-3 text-sm text-gray-500">Loading allowances…</p>
      <p v-else-if="balancesError !== ''" class="mt-3 text-sm text-red-600">
        {{ balancesError }}
      </p>
      <div v-else-if="balances.length === 0" class="mt-3">
        <UCard>
          <EmptyState
            title="No allowances yet"
            description="Set the first annual allowance below."
          />
        </UCard>
      </div>
      <ul v-else class="mt-3 space-y-2">
        <li
          v-for="row in balances"
          :key="row.id"
          class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
        >
          <span class="min-w-0 flex-1 truncate font-medium">{{
            row.name ?? 'Unknown'
          }}</span>
          <UBadge color="neutral" variant="subtle">{{ row.year }}</UBadge>
          <span class="text-gray-600 dark:text-gray-400"
            >{{ row.allowance_days }} allowed</span
          >
          <span v-if="row.used_days !== null" class="text-gray-600 dark:text-gray-400"
            >{{ row.used_days }} used &middot; {{ row.remaining_days }} left</span
          >
          <span v-else class="text-xs text-gray-400">used n/a</span>
          <UButton
            v-if="canManage"
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            :aria-label="`Remove allowance for ${row.name}`"
            @click="removeBalance(row.id)"
          />
        </li>
      </ul>
      <div class="mt-4 grid gap-3 lg:grid-cols-2">
        <UCard v-if="canManage">
          <template #header>
            <h3 class="font-semibold">Set allowance</h3>
          </template>
          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField label="Person" class="sm:col-span-2">
              <EntitySelect
                v-model="newBalance.person"
                :items="personOptions"
                placeholder="Type a name to search…"
                :loading="personPending"
                server-search
                class="w-full"
                @update:search-term="onPersonSearch"
              />
            </UFormField>
            <UFormField label="Year">
              <USelect v-model="newBalance.year" :items="yearItems" class="w-full" />
            </UFormField>
            <UFormField label="Days">
              <UInput
                v-model="newBalance.allowance"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
          </div>
          <UButton
            class="mt-3"
            label="Set allowance"
            icon="i-lucide-plus"
            :loading="balanceSaving"
            @click="setAllowance"
          />
          <p v-if="balanceError !== ''" class="mt-2 text-sm text-red-600">
            {{ balanceError }}
          </p>
        </UCard>
        <UCard>
          <template #header>
            <h3 class="font-semibold">Working-day calculator</h3>
            <p class="mt-1 text-xs text-gray-500">
              Weekends skipped. Public holidays not subtracted yet.
            </p>
          </template>
          <div class="grid gap-2 sm:grid-cols-2">
            <UFormField label="Start">
              <UInput v-model="calcStart" type="date" class="w-full" />
            </UFormField>
            <UFormField label="End">
              <UInput v-model="calcEnd" type="date" class="w-full" />
            </UFormField>
          </div>
          <p class="mt-3 text-sm">
            <span v-if="calcDays === null" class="text-gray-500">Pick both dates.</span>
            <span v-else class="font-semibold">{{ calcDays }} working days</span>
          </p>
        </UCard>
      </div>
    </section>

    <!-- REQUESTS: Mine-default, avatars + names, pending-row edit -->
    <section v-else-if="tab === 'requests'" aria-label="Leave requests" class="mt-4">
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
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>

        <EmptyState
          v-else-if="requests.length === 0"
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
                v-for="row in requests"
                :key="row.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3">
                  <span class="flex items-center gap-2">
                    <PersonAvatar
                      :name="row.requester_name"
                      :photo="row.requester_photo"
                    />
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
                  <span v-if="rowDays(row) !== null" class="text-gray-400"
                    >({{ rowDays(row) }}d)</span
                  >
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
        <p v-if="requestsError !== ''" class="mt-3 text-sm text-red-600">
          {{ requestsError }}
        </p>
      </UCard>

      <UCard v-if="canCreate" class="mt-4">
        <template #header>
          <h3 class="font-semibold">File a request</h3>
          <p class="mt-1 text-xs text-gray-500">
            Filed as you — the requester is stamped from your session. Day counts
            are computed Mon–Fri, never typed.
          </p>
        </template>
        <div class="grid gap-2 sm:grid-cols-2">
          <UFormField label="Link a person record (optional)" class="sm:col-span-2">
            <EntitySelect
              v-model="newRequest.person"
              :items="personOptions"
              placeholder="Self-filed — pick a record when filing on behalf…"
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
              :items="leaveTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Reason">
            <UInput
              v-model="newRequest.reason"
              placeholder="Required"
              class="w-full"
            />
          </UFormField>
        </div>
        <p v-if="previewPending" class="mt-3 text-sm text-gray-500">Checking balance…</p>
        <p
          v-else-if="previewBalance && previewDays !== null"
          class="mt-3 text-sm text-gray-600 dark:text-gray-400"
        >
          Balance: {{ previewBalance.allowance }} allowed<template
            v-if="previewBalance.used !== null"
          >
            · {{ previewBalance.used }} used</template
          >
          · this request {{ previewDays }} working day<template v-if="previewDays !== 1"
            >s</template
          ><template v-if="previewBalance.used !== null">
            → {{ previewBalance.allowance - previewBalance.used - previewDays }} left
            after</template
          >.
        </p>
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
    </section>

    <!-- APPROVALS: update-grant queue, restricted notice otherwise -->
    <section v-else-if="tab === 'approvals'" aria-label="Leave approvals" class="mt-4">
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
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>

        <EmptyState
          v-else-if="approvals.length === 0"
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
                <th class="px-3 py-2"><span class="sr-only">Decide</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="row in approvals"
                :key="row.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3">
                  <span class="flex items-center gap-2">
                    <PersonAvatar
                      :name="row.requester_name"
                      :photo="row.requester_photo"
                    />
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
                  <span v-if="rowDays(row) !== null" class="text-gray-400"
                    >({{ rowDays(row) }}d)</span
                  >
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
                  <span v-if="row.status === 'pending'" class="flex justify-end gap-1">
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
                      label="Reject"
                      @click="decide(row.id, 'rejected')"
                    />
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="approvalsError !== ''" class="mt-3 text-sm text-red-600">
          {{ approvalsError }}
        </p>
        <p v-if="actionError !== ''" class="mt-3 text-sm text-red-600">
          {{ actionError }}
        </p>
      </UCard>

      <UAlert
        v-else
        color="warning"
        variant="subtle"
        title="Restricted"
        description="The approvals queue is visible to deciding officers only. Your own requests are on the Requests tab."
      />
    </section>

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
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="editing = null"
          />
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
