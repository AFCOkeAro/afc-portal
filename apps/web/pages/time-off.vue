<script setup lang="ts">
import { COLLECTIONS, LEAVE_STATUSES, LEAVE_TYPES, workingDaysBetween } from '@afc/shared'

/**
 * Time Off (AFC-896 merged surface): Time Off and Annual Leave are the same
 * subject, so they live in one section with Balances / Requests / Approvals
 * tabs instead of separate menu entries. No new registers — the tabs only
 * move surfaces.
 *
 * Balances tab (AFC-854, moved unchanged): annual allowances per person per
 * year, plus a working-day calculator for planning leave (weekends skipped;
 * public holidays are not subtracted yet — no holiday register). Used and
 * remaining days compute server-side against approved leave_requests.
 *
 * Requests tab (AFC-842, moved unchanged): file a request (person, dates,
 * type, reason — days count start..end inclusive, stamped server-side) and
 * correct pending requests. Scoped to the caller's branch/zone server-side.
 *
 * Approvals tab (AFC-896, new focus view): the pending decision queue plus
 * the decided list, folded client-side from the already-loaded scoped rows
 * (no new endpoint, no new register). Decisions ride the same row and the
 * same transition table as the Requests tab.
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
const canDecide = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'update'))
const canSeeRequests = computed(() => permissions.can(COLLECTIONS.leaveRequests, 'read'))

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
  return [current - 1, current, current + 1].map((year) => ({
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

/* Balance preview (AFC-854 phase 2): allowance, used and the cost of the
 * draft dates, so a request is filed with eyes open. Unknown until the
 * person and both dates are chosen. */
const previewBalance = ref<{
  allowance: number
  used: number | null
} | null>(null)
const previewPending = ref(false)

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
  // The approvals queue is inherently the whole queue — landing on it resets
  // the Requests tab status filter so the pending list is complete.
  if (next === 'approvals' && statusFilter.value !== 'all') statusFilter.value = 'all'
  void router.replace({ query: { ...route.query, tab: next } })
}

/* Approvals tab (AFC-896): the pending decision queue plus the decided
 * list, folded client-side from the already-loaded scoped rows. Same rows,
 * same decide()/withdraw() flow — only the focus moves. */
const pendingRequests = computed(() =>
  requests.value.filter((row: LeaveRequest) => row.status === 'pending'),
)
const decidedRequests = computed(() =>
  requests.value.filter((row: LeaveRequest) => row.status !== 'pending'),
)

onMounted(() => {
  void loadBalances()
  void loadRequests()
})

watch(yearFilter, () => {
  void loadBalances()
})

watch(statusFilter, () => {
  void loadRequests()
})
</script>

<template>
  <div>
    <PageHeader
      title="Time Off"
      description="Annual leave in one place — balances, requests and approvals. Allowances count in working days."
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

    <!-- BALANCES (AFC-854, moved unchanged under the merged tabs) -->
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

    <!-- REQUESTS (AFC-842, moved unchanged under the merged tabs) -->
    <section v-else-if="tab === 'requests'" aria-label="Leave requests" class="mt-4">
      <div class="flex flex-wrap items-end gap-2">
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
                LEAVE_TYPES.map((type: string) => ({
                  label: typeLabel(type),
                  value: type,
                }))
              "
              class="w-full"
            />
          </UFormField>
          <UFormField label="Reason">
            <UInput v-model="newRequest.reason" placeholder="Optional" class="w-full" />
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

    <!-- APPROVALS (AFC-896): pending queue + decided list, same flow -->
    <section v-else-if="tab === 'approvals'" aria-label="Leave approvals" class="mt-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        The pending decision queue, plus the decided list. Decisions ride the same row and
        transition table as the Requests tab — this tab only focuses the queue.
      </p>
      <p v-if="requestsPending" class="mt-3 text-sm text-gray-500">Loading requests…</p>
      <p v-else-if="requestsError !== ''" class="mt-3 text-sm text-red-600">
        {{ requestsError }}
      </p>
      <template v-else>
        <h3 class="mt-4 font-semibold">
          Pending decisions ({{ pendingRequests.length }})
        </h3>
        <div v-if="pendingRequests.length === 0" class="mt-3">
          <UCard>
            <EmptyState
              title="Nothing waiting"
              description="No pending leave requests."
            />
          </UCard>
        </div>
        <div v-else class="mt-3 space-y-2">
          <UCard v-for="row in pendingRequests" :key="row.id">
            <div class="flex flex-wrap items-center gap-2 text-sm">
              <span class="font-semibold">{{ personLabel(row.person) }}</span>
              <UBadge color="neutral" variant="subtle">{{
                typeLabel(row.leave_type)
              }}</UBadge>
              <span class="text-gray-500"
                >{{ row.start_date }} → {{ row.end_date }} ({{ row.days }}d)</span
              >
              <span class="ml-auto flex gap-1">
                <UButton
                  v-if="canDecide"
                  size="xs"
                  color="success"
                  variant="soft"
                  label="Approve"
                  @click="decide(row.id, 'approved')"
                />
                <UButton
                  v-if="canDecide"
                  size="xs"
                  color="error"
                  variant="soft"
                  label="Decline"
                  @click="decide(row.id, 'declined')"
                />
                <UButton
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
        <h3 class="mt-6 font-semibold">Decided ({{ decidedRequests.length }})</h3>
        <div v-if="decidedRequests.length === 0" class="mt-3">
          <UCard>
            <EmptyState
              title="No decided requests"
              description="Approved, declined and cancelled requests land here."
            />
          </UCard>
        </div>
        <ul v-else class="mt-3 space-y-2">
          <li
            v-for="row in decidedRequests"
            :key="row.id"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
          >
            <span class="font-medium">{{ personLabel(row.person) }}</span>
            <UBadge color="neutral" variant="subtle">{{
              typeLabel(row.leave_type)
            }}</UBadge>
            <UBadge
              :color="row.status === 'approved' ? 'success' : 'error'"
              variant="subtle"
            >
              {{ row.status }}
            </UBadge>
            <span class="text-gray-500"
              >{{ row.start_date }} → {{ row.end_date }} ({{ row.days }}d)</span
            >
            <UButton
              v-if="canDecide && row.status === 'approved'"
              size="xs"
              color="neutral"
              variant="ghost"
              label="Cancel"
              class="ml-auto"
              @click="decide(row.id, 'cancelled')"
            />
          </li>
        </ul>
        <p v-if="actionError !== ''" class="mt-3 text-sm text-red-600">
          {{ actionError }}
        </p>
      </template>
    </section>
  </div>
</template>
