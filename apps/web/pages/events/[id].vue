<script setup lang="ts">
import { COLLECTIONS, EXPENSE_CATEGORIES, expenseFormSchema } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type {
  BranchSummary,
  BudgetRow,
  EventDetail,
  ExpenseRow,
  RegistrationRow,
} from '~/types/portal'

/**
 * Programme detail (AFC-649 §A–D, F; AFC-666 Tasks tab): hero with public
 * link + 7 tabs (Overview, Registrations, Check-in, Reports, Schedule,
 * Materials, Tasks) matching the reference screenshots.
 *
 * Data paths unchanged (GET /api/events/[id], rollups, check-in,
 * registrations, invites, visitors — all scope-filtered server-side).
 * Overview analytics are folded client-side from the already-loaded
 * scoped rows (rollups precedent: no summary tables, no new endpoint).
 * Tab is `?tab=` so each tab deep-links.
 */
definePageMeta({ middleware: 'staff' })

interface RegistrationRollups {
  registered: number
  confirmed: number
  attended: number
  expected: number
  collected: number
  outstanding: number
  byStatus: Record<string, number>
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'i-lucide-layout-grid' },
  { id: 'registrations', label: 'Registrations', icon: 'i-lucide-users' },
  { id: 'checkin', label: 'Check-in', icon: 'i-lucide-scan-line' },
  { id: 'attendance', label: 'Attendance', icon: 'i-lucide-clipboard-list' },
  { id: 'reports', label: 'Reports', icon: 'i-lucide-chart-column' },
  { id: 'schedule', label: 'Schedule', icon: 'i-lucide-calendar-days' },
  { id: 'materials', label: 'Resources', icon: 'i-lucide-folder-open' },
  { id: 'tasks', label: 'Tasks', icon: 'i-lucide-square-kanban' },
  { id: 'expenses', label: 'Expenses', icon: 'i-lucide-receipt' },
  { id: 'speakers', label: 'Speakers', icon: 'i-lucide-mic' },
] as const

type TabId = (typeof TABS)[number]['id']
const REPORT_SUBTABS = ['Unit reports', 'Feedback', 'Blessings', 'Testimonies'] as const

const route = useRoute()
const router = useRouter()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const showBlessingForm = ref(false)
const showWalkinForm = ref(false)
const showGroupForm = ref(false)
const showComms = ref(false)
const managingRegistration = ref<RegistrationRow | null>(null)
const showManageOpen = computed({
  get: () => managingRegistration.value !== null,
  set: (open: boolean) => {
    if (!open) managingRegistration.value = null
  },
})
const savingStatus = ref(false)
const actionError = ref('')
const checkinTicket = ref('')
const checkinName = ref('')
const checkinMode = ref<'scan' | 'type'>('scan')
const checkinSession = ref('arrival')
const checkingIn = ref(false)
const checkinMessage = ref('')
const checkinIsError = ref(false)
/** People checked in on this device, this session (client-side only). */
const deviceCheckins = ref<Array<{ name: string; at: string }>>([])
const rollups = ref<RegistrationRollups | null>(null)
const reportSubtab = ref<(typeof REPORT_SUBTABS)[number]>('Unit reports')

/* Registrations tab state (AFC-649 §C): filter bar + bulk select. */
const regSearch = ref('')
const regStatus = ref('all')
const regCheckin = ref('all')
const regSort = ref('newest')
const selectedRegs = ref<Set<string>>(new Set())

const tab = computed<TabId>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return shownTabs.value.some((entry: (typeof TABS)[number]) => entry.id === value)
    ? (value as TabId)
    : 'overview'
})

function goTab(next: TabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

const {
  data: event,
  pending,
  error,
  refresh,
} = await useAsyncData(`event-${id}`, () => api.get<EventDetail>(`/api/events/${id}`))

const branches = await useAsyncData('events-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchNameOf = computed(() => {
  const map = new Map(
    (branches.data.value ?? []).map((row) => [String(row.id), row.name]),
  )
  return (branch: unknown): string | null => {
    if (branch === null || branch === undefined || branch === '') return null
    return map.get(String(branch)) ?? null
  }
})

const canEdit = computed(() => permissions.can(COLLECTIONS.events, 'update'))
const { user: authUser } = useAuth()
const canManageCategories = computed(
  () =>
    authUser.value?.staffRole === 'area_admin' ||
    authUser.value?.staffRole === 'super_admin',
)
const canBlessings = computed(() => permissions.can(COLLECTIONS.blessings, 'read'))
const canRecordBlessings = computed(() =>
  permissions.can(COLLECTIONS.blessings, 'create'),
)
const canReadRegistrations = computed(() =>
  permissions.can(COLLECTIONS.eventRegistrations, 'read'),
)
const canUpdateRegistrations = computed(() =>
  permissions.can(COLLECTIONS.eventRegistrations, 'update'),
)
const canCreateRegistrations = computed(() =>
  permissions.can(COLLECTIONS.eventRegistrations, 'create'),
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

/* Expenses tab (AFC-801): the 8th tab, hidden without the grant. */
const canExpenses = computed(() => permissions.can(COLLECTIONS.eventExpenses, 'read'))
/* Speakers tab (AFC-843): bookings, hidden without the grant. */
const canSpeakers = computed(() => permissions.can(COLLECTIONS.eventSpeakers, 'read'))
const canManageSpeakers = computed(
  () =>
    canSpeakers.value &&
    (permissions.can(COLLECTIONS.eventSpeakers, 'create') ||
      permissions.can(COLLECTIONS.events, 'update')),
)
/* Resources tab (AFC-844): approved library for readers; the pending
 * queue and share form need the manage grant. */
const canResources = computed(() => permissions.can(COLLECTIONS.eventResources, 'read'))
const canManageResources = computed(
  () =>
    canResources.value &&
    (permissions.can(COLLECTIONS.eventResources, 'create') ||
      permissions.can(COLLECTIONS.events, 'update')),
)
const canRecordExpenses = computed(
  () =>
    canExpenses.value &&
    (permissions.can(COLLECTIONS.eventExpenses, 'create') ||
      permissions.can(COLLECTIONS.events, 'update')),
)
const expenseAmountVisible = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.eventExpenses, 'amount'),
)
const shownTabs = computed<(typeof TABS)[number][]>(() =>
  TABS.filter(
    (entry) =>
      (entry.id !== 'expenses' || canExpenses.value) &&
      (entry.id !== 'speakers' || canSpeakers.value),
  ),
)

const restrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.eventRegistrations)
  if (hidden.length === 0) return ''
  return `Registration fields not shown on this account: ${hidden.join(', ')}.`
})

const isUpcoming = computed(() => {
  if (!event.value) return true
  const start = new Date(event.value.start_at).getTime()
  return Number.isNaN(start) || start >= Date.now()
})

/** Scope pill wording matches the programmes list (review item 10). */
const scopePill = computed(() =>
  event.value?.branch_name
    ? `Showing ${event.value.branch_name}`
    : 'Showing all in your scope',
)

const publicLink = computed(() => `/register?event=${id}`)

function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
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

/* ---------- Overview analytics: scoped rows only (AFC-649 §B) ---------- */

const activeRegs = computed(() =>
  (event.value?.registrations ?? []).filter(
    (row) => row.registration_status !== 'cancelled',
  ),
)

const overTime = computed<Array<[string, number]>>(() => {
  const buckets = new Map<string, number>()
  for (const row of activeRegs.value) {
    const created = (row as { created_at?: string }).created_at
    if (!created) continue
    const day = created.slice(0, 10)
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .sort(([a]: [string, number], [b]: [string, number]) => (a < b ? -1 : 1))
    .slice(-14)
})
const overTimePeak = computed(() =>
  overTime.value.reduce(
    (peak: number, [, count]: [string, number]) => Math.max(peak, count),
    0,
  ),
)
/** Busiest registration day (script-side so the template stays typeless). */
const busiestDay = computed(() => {
  if (overTime.value.length === 0) return null
  return overTime.value.reduce<[string, number]>(
    (a: [string, number], b: [string, number]) => (b[1] > a[1] ? b : a),
  )
})
const overTimeLast7 = computed(() =>
  overTime.value.slice(-7).reduce((sum: number, [, c]: [string, number]) => sum + c, 0),
)

function breakdown(get: (row: RegistrationRow) => string): Array<[string, number]> {
  const buckets = new Map<string, number>()
  for (const row of activeRegs.value) {
    const key = get(row) || 'Not given'
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  return [...buckets.entries()].sort(([, a], [, b]) => b - a)
}

const byStatus = computed(() =>
  breakdown((row) => row.registration_status.replace(/_/g, ' ')),
)
const byAgeGroup = computed(() =>
  breakdown((row) => String(row.age_group || 'Not given')),
)
const byPayment = computed(() =>
  breakdown((row) => String(row.payment_status || 'Not given')),
)
const bySource = computed(() => breakdown((row) => String(row.source || 'Not given')))
const byBranch = computed(() =>
  breakdown((row) => branchNameOf.value(row.branch) ?? 'Area-wide'),
)

const byBranchCheckin = computed(() => {
  const checked = new Map<string, number>()
  for (const row of activeRegs.value) {
    if (row.registration_status !== 'attended') continue
    const key = branchNameOf.value(row.branch) ?? 'Area-wide'
    checked.set(key, (checked.get(key) ?? 0) + 1)
  }
  return checked
})

const totalActive = computed(() => activeRegs.value.length)
function share(count: number): string {
  if (totalActive.value === 0) return '0%'
  return `${Math.round((count / totalActive.value) * 100)}%`
}

/* ---------- Registrations tab rows ---------- */

const filteredRegs = computed<RegistrationRow[]>(() => {
  const needle = regSearch.value.trim().toLowerCase()
  const rows = (event.value?.registrations ?? []).filter((row: RegistrationRow) => {
    if (regStatus.value !== 'all' && row.registration_status !== regStatus.value)
      return false
    if (regCheckin.value === 'in' && row.registration_status !== 'attended') return false
    if (regCheckin.value === 'not' && row.registration_status === 'attended') return false
    if (!needle) return true
    const haystack = [
      row.ticket_code,
      row.person_name,
      row.email,
      row.phone,
      branchNameOf.value(row.branch),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(needle)
  })
  /* Review item 8: Newest-first is the reference order. */
  return [...rows].sort((a: RegistrationRow, b: RegistrationRow) => {
    if (regSort.value === 'name') {
      return (a.person_name ?? '').localeCompare(b.person_name ?? '')
    }
    const at = a.created_at ?? ''
    const bt = b.created_at ?? ''
    if (at === bt) return 0
    return regSort.value === 'oldest' ? (at < bt ? -1 : 1) : at < bt ? 1 : -1
  })
})

const allSelected = computed(
  () =>
    filteredRegs.value.length > 0 &&
    filteredRegs.value.every((row: RegistrationRow) => selectedRegs.value.has(row.id)),
)
function toggleAll(): void {
  if (allSelected.value) selectedRegs.value = new Set()
  else
    selectedRegs.value = new Set(filteredRegs.value.map((row: RegistrationRow) => row.id))
}
function toggleOne(rowId: string): void {
  const next = new Set(selectedRegs.value)
  if (next.has(rowId)) next.delete(rowId)
  else next.add(rowId)
  selectedRegs.value = next
}

/** Rows currently selected for comms (script-side so the template stays typeless). */
const selectedRegistrations = computed<RegistrationRow[]>(() =>
  (event.value?.registrations ?? []).filter((row: RegistrationRow) =>
    selectedRegs.value.has(row.id),
  ),
)

const regStatusOptions = [
  { label: 'Status: all', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Attended', value: 'attended' },
  { label: 'Waitlisted', value: 'waitlisted' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'No show', value: 'no_show' },
]

/* Review item 8: checked-in filter + sort stay to 2–3 options. */
const regCheckinOptions = [
  { label: 'Check-in: all', value: 'all' },
  { label: 'Checked in', value: 'in' },
  { label: 'Not yet', value: 'not' },
]

const regSortOptions = [
  { label: 'Newest first', value: 'newest' },
  { label: 'Oldest first', value: 'oldest' },
  { label: 'Name A–Z', value: 'name' },
]

/* ---------- Actions (unchanged paths) ---------- */

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

async function copyPublicLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      new URL(publicLink.value, window.location.origin).toString(),
    )
  } catch {
    /* Clipboard unavailable — the visible link text is still copyable. */
  }
}

async function loadRollups(): Promise<void> {
  if (!canReadRegistrations.value) {
    rollups.value = null
    return
  }
  try {
    const result = await api.get<{ data: RegistrationRollups }>(
      `/api/events/${id}/rollups`,
    )
    rollups.value = result.data
  } catch {
    rollups.value = null
  }
}

async function checkIn(): Promise<void> {
  const ticket = checkinTicket.value.trim()
  const name = checkinName.value.trim()
  checkinMessage.value = ''
  if ((ticket === '') === (name === '')) {
    checkinIsError.value = true
    checkinMessage.value = 'Enter either a ticket code or a name — not both.'
    return
  }
  checkingIn.value = true
  try {
    const result = await api.post<{
      data: Record<string, unknown>
      meta: { already: boolean }
    }>(`/api/events/${id}/check-in`, ticket !== '' ? { ticket_code: ticket } : { name })
    checkinIsError.value = false
    const display =
      ((result.data.person_name as string | undefined) ??
        (result.data.registrant_first_name as string | undefined) ??
        ticket) ||
      name
    if (!result.meta.already) {
      deviceCheckins.value = [
        { name: String(display), at: new Date().toLocaleTimeString() },
        ...deviceCheckins.value,
      ].slice(0, 50)
    }
    checkinMessage.value = result.meta.already
      ? 'Already checked in — no change made.'
      : 'Checked in and marked attended.'
    checkinTicket.value = ''
    checkinName.value = ''
    await Promise.all([refresh(), loadRollups()])
  } catch (cause) {
    checkinIsError.value = true
    checkinMessage.value =
      cause instanceof ApiRequestError ? cause.message : 'Check-in failed.'
  } finally {
    checkingIn.value = false
  }
}

/* Unit reports headcount capture (AFC-757): aggregate session headcounts
   recorded through the existing capture endpoint — no new backend. Totals
   below are display totals (AFC-859): the split-aggregate SUM where at
   least one attendance_counts row exists, else the stored headcount_total.
   attendance-flows.md S2 owns the canonical rule; the Flow attendance.total
   owns the derived total_headcount. */
interface UnitSessionRow {
  id: string
  session_date: string
  session_type: string
  session_name: string
  headcount_total: number | null
  split_total: number | null
}
interface UnitServiceType {
  key: string
  label: string
  categories: string[] | string
  supports_sex_split?: boolean
}
const unitSessions = ref<UnitSessionRow[]>([])
const unitTypes = ref<UnitServiceType[]>([])
const unitLoading = ref(false)
const unitLoaded = ref(false)
const unitDate = ref('')
const unitType = ref('')
const unitName = ref('')
/**
 * Picked session (AFC-827). Empty means a brand-new session typed below;
 * otherwise the date/type/name auto-fill from the programme's session list
 * and the save targets that session (no twin is created).
 */
const unitSessionId = ref('')
const unitCats = ref<string[]>([])
const unitSplit = ref(true)
const unitCounts = ref<Record<string, { male: number | null; female: number | null }>>({})
const unitOtherLabel = ref('')
const unitSaving = ref(false)
const unitMessage = ref('')
const unitIsError = ref(false)
/**
 * Display total (AFC-859): split-aggregate SUM where at least one split
 * row exists, else the legacy stored headcount_total. Null when both are
 * absent — the table renders an em dash and the grand total treats it as 0.
 */
function unitDisplayTotal(row: UnitSessionRow): number | null {
  if (typeof row.split_total === 'number') return row.split_total
  return row.headcount_total
}
const unitTotal = computed(() =>
  unitSessions.value.reduce(
    (sum: number, row: UnitSessionRow) => sum + (unitDisplayTotal(row) ?? 0),
    0,
  ),
)
const unitTypeItems = computed(() =>
  unitTypes.value.map((row: UnitServiceType) => ({ label: row.label, value: row.key })),
)

const unitSessionItems = computed(() => [
  { label: 'New session — enter details below', value: '' },
  ...unitSessions.value.map((row: UnitSessionRow) => ({
    label: `${row.session_date} · ${row.session_name}`,
    value: String(row.id),
  })),
])

/** Display label for a category key (AFC-835). */
function unitCatLabel(key: string): string {
  if (key === 'avs') return 'AVS'
  if (key === 'other') return 'Other (describe below)'
  return key
    .split('_')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/** Default rows (AFC-835): Adult, Youth, Children, Visitors where offered. */
const UNIT_DEFAULT_CATS = ['adults', 'youth', 'children', 'visitors']

function unitPickSession(id: string): void {
  unitSessionId.value = id
  if (id === '') return
  const picked = unitSessions.value.find((row: UnitSessionRow) => String(row.id) === id)
  if (!picked) return
  unitDate.value = picked.session_date
  unitName.value = picked.session_name
  if (unitTypes.value.some((row: UnitServiceType) => row.key === picked.session_type)) {
    unitPickType(picked.session_type)
  } else {
    unitType.value = picked.session_type
    unitCats.value = []
    unitSplit.value = true
  }
}
function unitCategoriesOf(entry: UnitServiceType): string[] {
  if (Array.isArray(entry.categories)) return entry.categories.map(String)
  try {
    const parsed: unknown = JSON.parse(entry.categories)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
async function loadUnitData(): Promise<void> {
  if (unitLoading.value) return
  unitLoading.value = true
  try {
    const [sessions, types] = await Promise.all([
      api.get<{ data: UnitSessionRow[] }>('/api/attendance', {
        query: { event: id, limit: -1 },
      }),
      api.get<{ data: UnitServiceType[] }>('/api/attendance/service-types'),
    ])
    unitSessions.value = sessions.data ?? []
    unitTypes.value = types.data ?? []
    unitLoaded.value = true
  } catch (cause) {
    unitMessage.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not load sessions.'
    unitIsError.value = true
  } finally {
    unitLoading.value = false
  }
}
function unitPickType(key: string): void {
  unitType.value = key
  const entry = unitTypes.value.find((row: UnitServiceType) => row.key === key)
  const cats = entry ? unitCategoriesOf(entry) : []
  // AFC-806 staging feedback: the event Attendance tab must offer the
  // children category even if a stale service-type definition omits it.
  const offered =
    key === 'event' && !cats.includes('children') ? ['children', ...cats] : cats
  // AFC-835: default rows are Adult/Youth/Children/Visitors where offered;
  // the rest wait in the add-row picker. Fall back to the full offered set
  // when none of the defaults is present.
  const defaults = UNIT_DEFAULT_CATS.filter((cat) => offered.includes(cat))
  unitCats.value = defaults.length > 0 ? defaults : [...offered]
  unitSplit.value = entry?.supports_sex_split !== false
  unitCounts.value = {}
}

const unitAddableCats = computed(() => {
  const entry = unitTypes.value.find((row: UnitServiceType) => row.key === unitType.value)
  const cats = entry ? unitCategoriesOf(entry) : []
  return cats.filter((cat: string) => !unitCats.value.includes(cat))
})

const unitAddableItems = computed(() =>
  unitAddableCats.value.map((cat: string) => ({ label: unitCatLabel(cat), value: cat })),
)

function unitAddCategory(key: string): void {
  if (key !== '' && !unitCats.value.includes(key))
    unitCats.value = [...unitCats.value, key]
}

function unitRemoveCategory(key: string): void {
  unitCats.value = unitCats.value.filter((cat: string) => cat !== key)
  const counts = { ...unitCounts.value }
  Reflect.deleteProperty(counts, key)
  unitCounts.value = counts
}
async function submitUnitCapture(): Promise<void> {
  unitMessage.value = ''
  if (unitDate.value === '' || unitType.value === '' || unitName.value.trim() === '') {
    unitIsError.value = true
    unitMessage.value = 'Fill in the session date, service type and session name.'
    return
  }
  if (unitCats.value.includes('other') && unitOtherLabel.value.trim() === '') {
    unitIsError.value = true
    unitMessage.value = 'Name the Other category before saving.'
    return
  }
  const rows: Array<{
    category: string
    sex: string
    count: number
    category_other_label?: string
  }> = []
  for (const category of unitCats.value) {
    const entry = unitCounts.value[category] ?? { male: null, female: null }
    const label = category === 'other' ? unitOtherLabel.value.trim() : undefined
    if (unitSplit.value) {
      if (typeof entry.male === 'number' && entry.male > 0)
        rows.push({
          category,
          sex: 'male',
          count: entry.male,
          ...(label ? { category_other_label: label } : {}),
        })
      if (typeof entry.female === 'number' && entry.female > 0)
        rows.push({
          category,
          sex: 'female',
          count: entry.female,
          ...(label ? { category_other_label: label } : {}),
        })
    } else if (typeof entry.male === 'number' && entry.male > 0) {
      rows.push({
        category,
        sex: 'unspecified',
        count: entry.male,
        ...(label ? { category_other_label: label } : {}),
      })
    }
  }
  if (rows.length === 0) {
    unitIsError.value = true
    unitMessage.value = 'Enter at least one headcount above zero.'
    return
  }
  unitSaving.value = true
  try {
    await api.post('/api/attendance/capture', {
      event: id,
      branch: event.value?.branch ?? null,
      session_date: unitDate.value,
      session_type: unitType.value,
      session_name: unitName.value.trim(),
      ...(unitSessionId.value !== '' ? { session_id: unitSessionId.value } : {}),
      idempotency_key: crypto.randomUUID(),
      rows,
    })
    unitIsError.value = false
    unitMessage.value = 'Headcount recorded.'
    unitCounts.value = {}
    await loadUnitData()
  } catch (cause) {
    unitIsError.value = true
    unitMessage.value =
      cause instanceof ApiRequestError && cause.status === 409
        ? 'Already recorded — no change made.'
        : cause instanceof ApiRequestError
          ? cause.message
          : 'Could not record the headcount.'
  } finally {
    unitSaving.value = false
  }
}
watch(
  [tab, reportSubtab],
  ([nextTab, nextSub]: [TabId, (typeof REPORT_SUBTABS)[number]]) => {
    if (nextTab === 'attendance' && !unitLoaded.value) void loadUnitData()
    if (nextTab === 'reports' && nextSub === 'Unit reports' && !unitLoaded.value)
      void loadUnitData()
  },
)

onMounted(() => {
  void loadRollups()
})

async function afterRegistrationSaved(): Promise<void> {
  selectedRegs.value = new Set()
  await Promise.all([refresh(), loadRollups()])
}

/* ---------- Expenses tab (AFC-801): scoped list + client-side total ---------- */

const expenses = ref<ExpenseRow[]>([])
const expensesPending = ref(false)
const expensesError = ref('')
const showExpenseForm = ref(false)
const savingExpense = ref(false)
const expenseError = ref('')
const expenseFieldErrors = ref<Record<string, string>>({})
const expenseForm = ref({
  category: 'venue',
  category_other_label: '',
  amount: '',
  currency: 'NGN',
  spent_on: new Date().toISOString().slice(0, 10),
  notes: '',
})

const expenseReceiptFile = ref<File | null>(null)
const expenseReceiptName = ref('')

function pickExpenseReceipt(target: EventTarget | null): void {
  const files = (target as HTMLInputElement | null)?.files
  const first = files && files.length > 0 ? files[0] : null
  expenseReceiptFile.value = first
  expenseReceiptName.value = first?.name ?? ''
}

const expenseCats = ref<Array<{ key: string; label: string }>>([])

async function loadExpenseCategories(): Promise<void> {
  try {
    const result = await api.get<{ data: Array<{ key: string; label: string }> }>(
      '/api/expense-categories',
    )
    if (result.data.length > 0) expenseCats.value = result.data
  } catch {
    expenseCats.value = []
  }
}

const expenseCategoryOptions = computed(() =>
  (expenseCats.value.length > 0
    ? expenseCats.value
    : EXPENSE_CATEGORIES.map((value) => ({
        key: value,
        label: value.charAt(0).toUpperCase() + value.slice(1),
      }))
  ).map((row: { key: string; label: string }) => ({ label: row.label, value: row.key })),
)

/**
 * Displayed total. It IS the sum of the listed rows (AFC-801 totals parity:
 * no separate endpoint, the contract pins sum(amounts) === total).
 */
const expenseTotal = computed(() =>
  expenses.value.reduce(
    (sum: number, row: ExpenseRow) => sum + Number(row.amount ?? 0),
    0,
  ),
)

/* Budgets vs actual (AFC-825): latest planned line per category against
 * summed spend. Revision = new row; the route resolves latest-wins. */
const budgets = ref<BudgetRow[]>([])
const budgetsPending = ref(false)
const budgetError = ref('')
const budgetFieldErrors = ref<Record<string, string>>({})
const budgetSaving = ref(false)
const budgetForm = ref({ category_key: 'venue', amount: '', notes: '' })
const newCategory = ref({ key: '', label: '' })
const categorySaving = ref(false)
const categoryError = ref('')

async function loadBudgets(): Promise<void> {
  if (!canExpenses.value) {
    budgets.value = []
    return
  }
  budgetsPending.value = true
  try {
    const result = await api.get<{ data: BudgetRow[] }>(`/api/events/${id}/budgets`)
    budgets.value = result.data.map((row: BudgetRow) => ({ ...row, id: String(row.id) }))
  } catch (cause) {
    budgets.value = []
    budgetError.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not load budgets.'
  } finally {
    budgetsPending.value = false
  }
}

const budgetVariance = computed(() => {
  const actualByCat = new Map<string, number>()
  for (const row of expenses.value as ExpenseRow[]) {
    const key = String(row.category ?? '')
    actualByCat.set(key, (actualByCat.get(key) ?? 0) + Number(row.amount ?? 0))
  }
  const cats =
    expenseCats.value.length > 0
      ? expenseCats.value
      : EXPENSE_CATEGORIES.map((value) => ({
          key: value,
          label: value.charAt(0).toUpperCase() + value.slice(1),
        }))
  return cats.map((cat: { key: string; label: string }) => {
    const planned = budgets.value.find(
      (row: BudgetRow) => String(row.category_key) === cat.key,
    )
    const budget = planned ? Number(planned.amount ?? 0) : null
    const actual = actualByCat.get(cat.key) ?? 0
    return {
      key: cat.key,
      label: cat.label,
      budget,
      actual,
      left: budget === null ? null : budget - actual,
      pct:
        budget === null || budget <= 0
          ? actual > 0
            ? 100
            : 0
          : Math.min(100, Math.round((actual / budget) * 100)),
    }
  })
})

async function submitBudget(): Promise<void> {
  budgetError.value = ''
  budgetFieldErrors.value = {}
  if (budgetForm.value.category_key.trim() === '' || budgetForm.value.amount === '') {
    budgetError.value = 'Pick a category and enter a planned amount'
    return
  }
  budgetSaving.value = true
  try {
    await api.post(`/api/events/${id}/budgets`, {
      category_key: budgetForm.value.category_key,
      amount: budgetForm.value.amount,
      ...(budgetForm.value.notes ? { notes: budgetForm.value.notes } : {}),
    })
    budgetForm.value = {
      category_key: budgetForm.value.category_key,
      amount: '',
      notes: '',
    }
    await loadBudgets()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    budgetError.value = error.message ?? 'Could not record that budget'
    budgetFieldErrors.value = error.fields ?? {}
  } finally {
    budgetSaving.value = false
  }
}

async function submitCategory(): Promise<void> {
  categoryError.value = ''
  if (newCategory.value.key.trim() === '' || newCategory.value.label.trim() === '') {
    categoryError.value = 'Give the category a key and a label'
    return
  }
  categorySaving.value = true
  try {
    await api.post('/api/expense-categories', {
      key: newCategory.value.key.trim().toLowerCase(),
      label: newCategory.value.label.trim(),
    })
    newCategory.value = { key: '', label: '' }
    await loadExpenseCategories()
    await loadBudgets()
  } catch (cause) {
    categoryError.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not add that category'
  } finally {
    categorySaving.value = false
  }
}

const expenseRestrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.eventExpenses)
  if (hidden.length === 0) return ''
  return `Expense fields not shown on this account: ${hidden.join(', ')}.`
})

function formatExpenseAmount(row: ExpenseRow): string {
  if (!expenseAmountVisible.value) return '—'
  const numeric = Number(row.amount ?? 0)
  const formatted = Number.isNaN(numeric) ? String(row.amount ?? 0) : numeric.toFixed(2)
  return `${formatted} ${row.currency ?? ''}`.trim()
}

function expenseCategoryLabel(row: ExpenseRow): string {
  if (row.category === 'other' && row.category_other_label)
    return row.category_other_label
  return row.category.replace(/_/g, ' ')
}

async function loadExpenses(): Promise<void> {
  if (!canExpenses.value) {
    expenses.value = []
    return
  }
  expensesPending.value = true
  expensesError.value = ''
  try {
    const result = await api.get<{ data: ExpenseRow[] }>(`/api/events/${id}/expenses`)
    expenses.value = result.data.map((row) => ({
      ...row,
      id: String(row.id),
    }))
  } catch (cause) {
    expenses.value = []
    expensesError.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not load expenses.'
  } finally {
    expensesPending.value = false
  }
}

async function submitExpense(): Promise<void> {
  const parsed = expenseFormSchema.safeParse({
    category: expenseForm.value.category,
    category_other_label: expenseForm.value.category_other_label || undefined,
    amount: expenseForm.value.amount,
    currency: expenseForm.value.currency,
    spent_on: expenseForm.value.spent_on,
    notes: expenseForm.value.notes || undefined,
  })
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.')
      if (key && !errors[key]) errors[key] = issue.message
    }
    expenseFieldErrors.value = errors
    expenseError.value = 'Some fields need attention'
    return
  }

  savingExpense.value = true
  expenseError.value = ''
  expenseFieldErrors.value = {}
  try {
    let receipt: string | undefined
    if (expenseReceiptFile.value) {
      const uploadBody = new FormData()
      uploadBody.append('file', expenseReceiptFile.value)
      try {
        const uploaded = await api.post<{ data: { id: string } }>(
          `/api/events/${id}/expenses/upload`,
          uploadBody,
        )
        receipt = uploaded.data.id
      } catch {
        expenseError.value =
          'Could not upload that receipt — check the file and try again'
        expenseFieldErrors.value = { file: 'Could not upload that receipt' }
        return
      }
    }
    await api.post(`/api/events/${id}/expenses`, {
      category: parsed.data.category,
      ...(parsed.data.category_other_label
        ? { category_other_label: parsed.data.category_other_label }
        : {}),
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      spent_on: parsed.data.spent_on,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      ...(receipt ? { receipt } : {}),
    })
    showExpenseForm.value = false
    expenseForm.value = {
      category: 'venue',
      category_other_label: '',
      amount: '',
      currency: 'NGN',
      spent_on: new Date().toISOString().slice(0, 10),
      notes: '',
    }
    expenseReceiptFile.value = null
    expenseReceiptName.value = ''
    await loadExpenses()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    expenseError.value = error.message ?? 'Could not record that expense'
    expenseFieldErrors.value = error.fields ?? {}
  } finally {
    savingExpense.value = false
  }
}

watch(
  () => [tab.value, canExpenses.value] as const,
  ([next, allowed]: readonly [TabId, boolean]) => {
    if (next === 'expenses' && allowed) {
      void loadExpenses()
      void loadBudgets()
      void loadExpenseCategories()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div>
    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this programme"
      :description="error.message"
    />

    <template v-else-if="event">
      <!-- Hero (reference: back link, status pill, title, dates, public link) -->
      <div
        class="rounded-2xl bg-gradient-to-br from-primary-950 via-primary-900 to-primary-950 p-6 text-white"
      >
        <NuxtLink to="/events" class="text-xs text-primary-200 hover:text-white">
          ← All programmes
        </NuxtLink>
        <div class="mt-2">
          <UBadge color="neutral" variant="solid" size="xs">
            {{ isUpcoming ? 'Upcoming' : 'Past' }}
          </UBadge>
        </div>
        <h1 class="mt-2 text-2xl font-bold">{{ event.title }}</h1>
        <p class="mt-1 text-sm text-primary-200">
          {{
            event.event_type
              ? event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1)
              : 'Event'
          }}{{ event.summary ? ` · ${event.summary}` : '' }}
        </p>
        <div
          class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-primary-100"
        >
          <span>
            <UIcon name="i-lucide-calendar" class="mr-1 inline size-3" />
            {{ formatDay(event.start_at)
            }}{{ event.end_at ? ` – ${formatDay(event.end_at)}` : '' }}
          </span>
          <span>
            <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />
            {{ event.branch_name || 'Area-wide' }}
          </span>
          <span
            class="ml-auto inline-flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-mono text-[11px] text-gray-700"
          >
            <UIcon name="i-lucide-globe" class="size-3" />{{ publicLink }}
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-copy"
              aria-label="Copy public registration link"
              @click="copyPublicLink()"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-external-link"
              aria-label="Open public registration form"
              :to="publicLink"
            />
          </span>
        </div>
        <div
          v-if="canEdit"
          class="mt-4 flex flex-wrap gap-2 border-t border-white/15 pt-3"
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
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            label="Edit programme"
            icon="i-lucide-pencil"
            @click="showEdit = true"
          />
        </div>
      </div>

      <UAlert
        v-if="actionError"
        class="mt-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />
      <UAlert
        v-if="restrictedMessage"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Restricted on this account"
        :description="restrictedMessage"
      />
      <UAlert
        v-if="event.visibility === 'public' && event.status !== 'published'"
        class="mt-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-eye-off"
        title="Not on the public page yet"
        description="This programme is marked public but not published — it will not appear on the public page, calendar or registration picker until published. Change the status above."
      />

      <!-- 7 tabs -->
      <nav aria-label="Programme sections" class="mt-4">
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

      <!-- OVERVIEW -->
      <section v-if="tab === 'overview'" aria-label="Programme overview" class="mt-4">
        <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
          At a glance
          <span class="float-right">
            <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />{{ scopePill }}
          </span>
        </p>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <StatCard label="Registered" :value="event.registered_count" hint="All time" />
          <StatCard
            label="Checked in"
            :value="event.attended_count"
            :hint="`${share(event.attended_count)} of registered`"
          />
          <StatCard
            label="Confirmed"
            :value="event.confirmed_count"
            hint="Confirmed registrations"
          />
          <StatCard
            label="Blessings linked"
            :value="`${event.blessings.length}`"
            hint="Blessing records on this event"
          />
          <template v-if="canReadRegistrations && rollups">
            <StatCard
              label="Expected revenue"
              :value="`${rollups.expected} ${event.currency ?? ''}`.trim()"
              hint="Excluding cancelled"
            />
            <StatCard
              label="Collected"
              :value="`${rollups.collected} ${event.currency ?? ''}`.trim()"
              hint="Excluding cancelled"
            />
            <StatCard
              label="Outstanding"
              :value="`${rollups.outstanding} ${event.currency ?? ''}`.trim()"
              hint="Expected minus collected"
            />
          </template>
        </div>

        <div class="mt-4 grid gap-4 xl:grid-cols-2">
          <UCard>
            <template #header
              ><h2 class="text-sm font-semibold">Registrations over time</h2>
              <p class="text-xs text-gray-500">New registrations per day</p></template
            >
            <EmptyState
              v-if="overTime.length === 0"
              title="No registrations yet"
              description="Share the public registration link to start collecting sign-ups."
            />
            <template v-else>
              <div
                class="flex h-28 items-end gap-1"
                role="img"
                aria-label="Registrations per day"
              >
                <div
                  v-for="[day, count] in overTime"
                  :key="day"
                  class="flex-1 rounded-t bg-primary-900"
                  :style="{
                    height: `${Math.max(4, (count / Math.max(1, overTimePeak)) * 100)}%`,
                  }"
                  :title="`${day}: ${count}`"
                />
              </div>
              <!-- Review item 5: axis endpoints readable without hover/touch. -->
              <div
                class="mt-1 flex justify-between text-xs text-gray-500"
                aria-hidden="true"
              >
                <span>{{ overTime[0][0] }}</span>
                <span>{{ overTime[overTime.length - 1][0] }}</span>
              </div>
              <table class="sr-only">
                <caption>
                  Registrations per day
                </caption>
                <tbody>
                  <tr v-for="[day, count] in overTime" :key="day">
                    <th scope="row">{{ day }}</th>
                    <td>{{ count }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="mt-2 flex justify-between text-xs text-gray-500">
                <span
                  >Last 7 days:
                  <strong class="tabular-nums">{{ overTimeLast7 }}</strong></span
                >
                <span v-if="busiestDay"
                  >Busiest day:
                  <strong>{{ busiestDay[0] }}</strong>
                  ·
                  <strong class="tabular-nums">{{ overTimePeak }}</strong></span
                >
              </div>
            </template>
          </UCard>

          <UCard>
            <template #header
              ><h2 class="text-sm font-semibold">Who's coming</h2></template
            >
            <EmptyState
              v-if="totalActive === 0"
              title="Nobody registered yet"
              description="Age-group and status breakdowns appear here."
            />
            <div v-else class="space-y-4">
              <div>
                <p class="mb-1 text-xs uppercase tracking-wide text-gray-500">
                  Age group
                </p>
                <div v-for="[label, count] in byAgeGroup" :key="label" class="mb-1.5">
                  <div class="flex justify-between text-xs">
                    <span>{{ label }}</span>
                    <span class="tabular-nums">{{ count }} · {{ share(count) }}</span>
                  </div>
                  <div class="h-1.5 rounded bg-gray-100 dark:bg-gray-800">
                    <div
                      class="h-1.5 rounded bg-primary-900"
                      :style="{ width: share(count) }"
                    />
                  </div>
                </div>
              </div>
              <div>
                <p class="mb-1 text-xs uppercase tracking-wide text-gray-500">Status</p>
                <div v-for="[label, count] in byStatus" :key="label" class="mb-1.5">
                  <div class="flex justify-between text-xs">
                    <span class="capitalize">{{ label }}</span>
                    <span class="tabular-nums">{{ count }} · {{ share(count) }}</span>
                  </div>
                  <div class="h-1.5 rounded bg-gray-100 dark:bg-gray-800">
                    <div
                      class="h-1.5 rounded bg-primary-900"
                      :style="{ width: share(count) }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </UCard>
        </div>

        <UCard class="mt-4">
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-sm font-semibold">By branch</h2>
                <p class="text-xs text-gray-500">
                  Select scope on the list to narrow this table
                </p>
              </div>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                label="All"
                to="/events"
              />
            </div>
          </template>
          <EmptyState
            v-if="byBranch.length === 0"
            title="No data yet"
            description="Branch breakdowns appear once registrations arrive."
          />
          <div v-else class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="px-3 py-2 font-medium">Branch</th>
                  <th class="px-3 py-2 font-medium">Registered</th>
                  <th class="px-3 py-2 font-medium">Checked in</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="[label, count] in byBranch" :key="label">
                  <td class="px-3 py-2 font-medium">{{ label }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ count }}</td>
                  <td class="px-3 py-2 tabular-nums">
                    {{ byBranchCheckin.get(label) ?? 0 }}
                  </td>
                </tr>
                <tr class="font-medium">
                  <td class="px-3 py-2">Total</td>
                  <td class="px-3 py-2 tabular-nums">{{ totalActive }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ event.attended_count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>

        <div class="mt-4 grid gap-4 xl:grid-cols-2">
          <UCard v-if="event.payments_enabled">
            <template #header
              ><h2 class="text-sm font-semibold">Payment status</h2></template
            >
            <EmptyState
              v-if="byPayment.length === 0"
              title="No data yet"
              description="Payment breakdowns appear once registrations arrive."
            />
            <ul v-else class="space-y-1.5 text-sm">
              <li
                v-for="[label, count] in byPayment"
                :key="label"
                class="flex justify-between"
              >
                <span class="capitalize">{{ label }}</span>
                <span class="tabular-nums">{{ count }} · {{ share(count) }}</span>
              </li>
            </ul>
          </UCard>
          <UCard>
            <template #header
              ><h2 class="text-sm font-semibold">Registration source</h2></template
            >
            <EmptyState
              v-if="bySource.length === 0"
              title="No data yet"
              description="Source breakdowns appear once registrations arrive."
            />
            <ul v-else class="space-y-1.5 text-sm">
              <li
                v-for="[label, count] in bySource"
                :key="label"
                class="flex justify-between"
              >
                <span class="capitalize">{{ label }}</span>
                <span class="tabular-nums">{{ count }} · {{ share(count) }}</span>
              </li>
            </ul>
          </UCard>
        </div>

        <!-- Review item 4: reference panels we cannot fold — named, not silent. -->
        <UCard class="mt-4">
          <template #header
            ><h2 class="text-sm font-semibold">Breakdowns not shown</h2></template
          >
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Gender, marital status, membership status, mode of attendance,
            education/career, class, role and position splits from the reference need
            fields registrations do not collect — they are omitted rather than guessed.
            The area drill-down and unit-report coverage need a follow-up aggregate with
            its own scoping decision.
          </p>
        </UCard>
      </section>

      <!-- REGISTRATIONS -->
      <section v-if="tab === 'registrations'" aria-label="Registrations" class="mt-4">
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <p>
            <strong class="tabular-nums">{{ filteredRegs.length }}</strong> registrations
          </p>
          <span class="text-xs text-gray-500">
            <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />{{ scopePill }}
          </span>
          <span class="ml-auto flex gap-2">
            <UButton
              v-if="canExport"
              :to="`/api/events/${event.id}/registrations.csv`"
              external
              color="neutral"
              variant="outline"
              size="sm"
              icon="i-lucide-download"
              label="Export CSV"
            />
            <UButton
              v-if="canCreateRegistrations"
              size="sm"
              icon="i-lucide-user-plus"
              label="Add registrant"
              @click="showWalkinForm = true"
            />
          </span>
        </div>

        <UCard>
          <div class="flex flex-col gap-2 lg:flex-row">
            <UInput
              v-model="regSearch"
              icon="i-lucide-search"
              placeholder="Search name, reg no, phone or email"
              aria-label="Search registrations"
              class="flex-1"
            />
            <USelect
              v-model="regStatus"
              :items="regStatusOptions"
              aria-label="Filter by status"
            />
            <USelect
              v-model="regCheckin"
              :items="regCheckinOptions"
              aria-label="Filter by check-in"
            />
            <USelect
              v-model="regSort"
              :items="regSortOptions"
              aria-label="Sort registrations"
            />
          </div>

          <UAlert
            v-if="!canReadRegistrations"
            class="mt-3"
            color="warning"
            variant="subtle"
            title="Registration list not available"
            description="Your role can see the event but does not hold a read grant on registrations."
          />
          <EmptyState
            v-else-if="filteredRegs.length === 0"
            class="mt-3"
            title="No registrations match"
            description="Try a different search or add the first registrant."
          />
          <div v-else class="mt-3 overflow-x-auto">
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="px-2 py-2">
                    <UCheckbox
                      :model-value="allSelected"
                      aria-label="Select all registrations"
                      @update:model-value="toggleAll()"
                    />
                  </th>
                  <th class="px-3 py-2 font-medium">Reg no</th>
                  <th class="px-3 py-2 font-medium">Name</th>
                  <th class="px-3 py-2 font-medium">Phone</th>
                  <th class="px-3 py-2 font-medium">Branch</th>
                  <th class="px-3 py-2 font-medium">Registered</th>
                  <th class="px-3 py-2 font-medium">Check-in</th>
                  <th v-if="canUpdateRegistrations" class="px-3 py-2">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="registration in filteredRegs" :key="registration.id">
                  <td class="px-2 py-3">
                    <UCheckbox
                      :model-value="selectedRegs.has(registration.id)"
                      :aria-label="`Select ${registration.person_name}`"
                      @update:model-value="toggleOne(registration.id)"
                    />
                  </td>
                  <td class="px-3 py-3 font-mono text-xs">
                    {{ registration.ticket_code || '—' }}
                  </td>
                  <td class="px-3 py-3">
                    <p class="font-medium">{{ registration.person_name }}</p>
                    <p class="text-xs text-gray-500">{{ registration.email || '' }}</p>
                  </td>
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ registration.phone || '—' }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ branchNameOf(registration.branch) ?? '—' }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ formatDay(registration.created_at) }}
                  </td>
                  <td class="px-3 py-3">
                    <UBadge
                      :color="
                        registrationColor[registration.registration_status] ?? 'neutral'
                      "
                      variant="subtle"
                    >
                      {{
                        registration.registration_status === 'attended'
                          ? 'Checked in'
                          : 'Not yet'
                      }}
                    </UBadge>
                  </td>
                  <td v-if="canUpdateRegistrations" class="px-3 py-3 text-right">
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      label="Manage"
                      @click="managingRegistration = registration"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            class="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-sm dark:border-gray-800"
          >
            <p class="text-xs text-gray-500">
              {{ selectedRegs.size }} of {{ filteredRegs.length }} selected
            </p>
            <span class="ml-auto flex gap-2">
              <UButton
                v-if="canCreateRegistrations"
                size="sm"
                color="neutral"
                variant="outline"
                label="Register group"
                icon="i-lucide-users"
                @click="showGroupForm = true"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                label="Message selected"
                icon="i-lucide-mail"
                :disabled="selectedRegs.size === 0"
                @click="showComms = true"
              />
            </span>
          </div>
        </UCard>
      </section>

      <!-- CHECK-IN -->
      <section v-if="tab === 'checkin'" aria-label="Check-in" class="mt-4">
        <div class="grid gap-4 xl:grid-cols-2">
          <div class="space-y-4">
            <UCard>
              <div class="flex items-end justify-between gap-3">
                <UFormField label="Checking in to" class="flex-1">
                  <USelect
                    v-model="checkinSession"
                    :items="[
                      { label: 'Arrival (accreditation)', value: 'arrival' },
                      { label: 'General session', value: 'general' },
                    ]"
                    class="w-full"
                  />
                </UFormField>
                <div class="pb-0.5 text-right">
                  <p class="text-2xl font-bold tabular-nums">
                    {{ event.attended_count }}
                  </p>
                  <p class="text-xs text-gray-500">
                    checked in · you: {{ deviceCheckins.length }}
                  </p>
                </div>
              </div>
            </UCard>

            <div
              v-if="canUpdateRegistrations"
              class="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
              role="tablist"
              aria-label="Check-in mode"
            >
              <button
                type="button"
                role="tab"
                :aria-selected="checkinMode === 'scan'"
                :class="[
                  'rounded-lg px-3 py-2.5 text-sm',
                  checkinMode === 'scan'
                    ? 'bg-gray-100 font-medium dark:bg-gray-800'
                    : 'text-gray-500',
                ]"
                @click="checkinMode = 'scan'"
              >
                <UIcon name="i-lucide-scan-line" class="mr-1 inline size-4" />Scan QR
              </button>
              <button
                type="button"
                role="tab"
                :aria-selected="checkinMode === 'type'"
                :class="[
                  'rounded-lg px-3 py-2.5 text-sm',
                  checkinMode === 'type'
                    ? 'bg-gray-100 font-medium dark:bg-gray-800'
                    : 'text-gray-500',
                ]"
                @click="checkinMode = 'type'"
              >
                <UIcon name="i-lucide-keyboard" class="mr-1 inline size-4" />Type or
                search
              </button>
            </div>

            <UCard v-if="canUpdateRegistrations">
              <div v-if="checkinMode === 'scan'">
                <div
                  class="flex aspect-square items-center justify-center rounded-xl bg-black text-white"
                  aria-label="QR scanner placeholder"
                >
                  <div class="text-center">
                    <UIcon name="i-lucide-scan-line" class="size-16 opacity-80" />
                    <p class="mt-2 text-xs opacity-70">
                      Camera scanning is not on this device — type the ticket code below.
                    </p>
                  </div>
                </div>
                <UInput
                  v-model="checkinTicket"
                  placeholder="Ticket code from the QR"
                  class="mt-3 font-mono"
                  :disabled="checkingIn"
                  @keyup.enter="checkIn()"
                />
              </div>
              <div v-else>
                <p class="mb-3 text-sm text-gray-500">
                  Find one registration by ticket code or by name and mark it attended. A
                  name must match exactly one registration — otherwise you are asked to
                  refine it.
                </p>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <UInput
                    v-model="checkinTicket"
                    placeholder="Ticket code"
                    class="font-mono"
                    :disabled="checkingIn"
                    @keyup.enter="checkIn()"
                  />
                  <UInput
                    v-model="checkinName"
                    placeholder="Registrant name"
                    :disabled="checkingIn"
                    @keyup.enter="checkIn()"
                  />
                </div>
              </div>
              <UButton
                class="mt-3 w-full"
                label="Check in"
                icon="i-lucide-check"
                :loading="checkingIn"
                @click="checkIn()"
              />
              <UAlert
                v-if="checkinMessage"
                class="mt-3"
                :color="checkinIsError ? 'error' : 'success'"
                variant="subtle"
                :description="checkinMessage"
              />
            </UCard>
            <UAlert
              v-else
              color="warning"
              variant="subtle"
              title="Check-in not available"
              description="Your role does not hold the registration update grant."
            />
          </div>

          <UCard>
            <template #header
              ><h2 class="text-sm font-semibold">Checked in on this device</h2>
              <p class="text-xs text-gray-500">
                People you check in appear here.
              </p></template
            >
            <EmptyState
              v-if="deviceCheckins.length === 0"
              title="Nobody checked in yet"
              description="Successful check-ins on this device are listed here for the session."
            />
            <ul v-else class="divide-y divide-gray-100 text-sm dark:divide-gray-800">
              <li
                v-for="(entry, index) in deviceCheckins"
                :key="`${entry.name}-${index}`"
                class="flex justify-between py-2"
              >
                <span class="font-medium">{{ entry.name }}</span>
                <span class="text-xs text-gray-500">{{ entry.at }}</span>
              </li>
            </ul>
          </UCard>
        </div>
      </section>

      <!-- ATTENDANCE (AFC-806): own event tab for session headcount capture.
        Staging feedback: capture was buried in Reports > Unit reports and the
        event flow missed the children category. This tab reuses the unit
        capture state (same endpoint, same 409 semantics) and defaults the
        service type to `event`; unitPickType guarantees `children` is offered
        for events even against a stale definition. Reports > Unit reports is
        kept for back-compat. -->
      <section v-if="tab === 'attendance'" aria-label="Attendance" class="mt-4">
        <div v-if="unitLoading" class="py-6 text-center text-sm text-gray-500">
          Loading sessions…
        </div>
        <div v-else>
          <table v-if="unitSessions.length > 0" class="w-full text-left text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-800">
                <th class="py-2 pr-2 font-medium">Date</th>
                <th class="py-2 pr-2 font-medium">Session</th>
                <th class="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="session in unitSessions"
                :key="session.id"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td class="py-2 pr-2">{{ session.session_date }}</td>
                <td class="py-2 pr-2">{{ session.session_name }}</td>
                <td class="py-2 text-right tabular-nums">
                  {{ unitDisplayTotal(session) ?? '—' }}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td class="py-2 pr-2 font-semibold" colspan="2">Total</td>
                <td class="py-2 text-right font-semibold tabular-nums">
                  {{ unitTotal }}
                </td>
              </tr>
            </tfoot>
          </table>
          <p v-else class="text-sm text-gray-500">
            No sessions recorded for this programme yet.
          </p>
          <div
            v-if="canEdit"
            class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800"
          >
            <h3 class="text-sm font-semibold">Record headcount</h3>
            <UFormField
              v-if="unitSessions.length > 0"
              label="Session (optional — pick from this programme's list)"
            >
              <USelect
                :model-value="unitSessionId"
                :items="unitSessionItems"
                class="w-full"
                @update:model-value="unitPickSession(String($event))"
              />
            </UFormField>
            <div class="mt-2 grid gap-2 sm:grid-cols-3">
              <UFormField label="Session date">
                <UInput
                  v-model="unitDate"
                  type="date"
                  class="w-full"
                  :disabled="unitSessionId !== ''"
                />
              </UFormField>
              <UFormField label="Service type">
                <USelect
                  :model-value="unitType === '' ? 'event' : unitType"
                  :items="unitTypeItems"
                  class="w-full"
                  :disabled="unitSessionId !== ''"
                  @update:model-value="unitPickType(String($event))"
                />
              </UFormField>
              <UFormField label="Session name">
                <UInput
                  v-model="unitName"
                  type="text"
                  class="w-full"
                  :disabled="unitSessionId !== ''"
                />
              </UFormField>
            </div>
            <div v-if="unitCats.length > 0" class="mt-2 grid gap-2 sm:grid-cols-2">
              <div v-for="category in unitCats" :key="category">
                <UFormField>
                  <template #label>
                    <span class="mr-auto">{{ unitCatLabel(category) }}</span>
                    <UButton
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-x"
                      :aria-label="`Remove ${unitCatLabel(category)} row`"
                      @click="unitRemoveCategory(category)"
                    />
                  </template>
                  <div class="flex gap-2">
                    <UInput
                      :model-value="unitCounts[category]?.male ?? null"
                      type="number"
                      min="0"
                      :placeholder="unitSplit ? 'Male' : 'Count'"
                      class="w-full"
                      @update:model-value="
                        unitCounts[category] = {
                          male: $event === null ? null : Number($event),
                          female: unitCounts[category]?.female ?? null,
                        }
                      "
                    />
                    <UInput
                      v-if="unitSplit"
                      :model-value="unitCounts[category]?.female ?? null"
                      type="number"
                      min="0"
                      placeholder="Female"
                      class="w-full"
                      @update:model-value="
                        unitCounts[category] = {
                          male: unitCounts[category]?.male ?? null,
                          female: $event === null ? null : Number($event),
                        }
                      "
                    />
                  </div>
                </UFormField>
              </div>
            </div>
            <p
              v-if="unitMessage !== ''"
              class="mt-2 text-sm"
              :class="unitIsError ? 'text-red-600' : 'text-green-700'"
            >
              {{ unitMessage }}
            </p>
            <div
              v-if="unitAddableCats.length > 0"
              class="mt-2 flex flex-wrap items-end gap-2"
            >
              <UFormField label="Add a row" class="min-w-48 flex-1">
                <USelect
                  :model-value="''"
                  :items="unitAddableItems"
                  placeholder="Choose a category…"
                  class="w-full"
                  @update:model-value="unitAddCategory(String($event))"
                />
              </UFormField>
              <UFormField
                v-if="unitCats.includes('other')"
                label="Describe Other"
                class="min-w-48 flex-1"
              >
                <UInput
                  v-model="unitOtherLabel"
                  placeholder="e.g. Ushers"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div
              v-else-if="unitCats.includes('other')"
              class="mt-2 grid gap-2 sm:grid-cols-2"
            >
              <UFormField label="Describe Other">
                <UInput
                  v-model="unitOtherLabel"
                  placeholder="e.g. Ushers"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UButton
              class="mt-2"
              label="Save headcount"
              icon="i-lucide-save"
              :loading="unitSaving"
              @click="submitUnitCapture"
            />
          </div>
        </div>
      </section>

      <!-- REPORTS -->
      <section v-if="tab === 'reports'" aria-label="Reports" class="mt-4">
        <div class="flex flex-wrap items-center gap-1">
          <div
            class="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
            role="tablist"
            aria-label="Report types"
          >
            <button
              v-for="sub in REPORT_SUBTABS"
              :key="sub"
              type="button"
              role="tab"
              :aria-selected="reportSubtab === sub"
              :class="[
                'shrink-0 rounded-lg px-3 py-2.5 text-sm',
                reportSubtab === sub
                  ? 'bg-primary-950 font-medium text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
              ]"
              @click="reportSubtab = sub"
            >
              {{ sub }}
            </button>
          </div>
          <span class="ml-auto text-xs text-gray-500">
            <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />{{ scopePill }}
          </span>
        </div>

        <UCard class="mt-3">
          <template v-if="reportSubtab === 'Blessings'">
            <div class="mb-3 flex items-center justify-between">
              <p class="text-sm text-gray-500">
                {{ event.blessings_total }} total · {{ event.blessings.length }} records
              </p>
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
            <EmptyState
              v-if="!canBlessings"
              title="Blessings not available"
              description="Your role does not hold the blessings read grant."
            />
            <EmptyState
              v-else-if="event.blessings.length === 0"
              title="No blessings recorded"
              description="Blessings recorded against this event will appear here."
            />
            <div v-else class="overflow-x-auto">
              <table
                class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
              >
                <thead>
                  <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th class="px-3 py-2 font-medium">Blessing</th>
                    <th class="px-3 py-2 font-medium">Date</th>
                    <th class="px-3 py-2 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr v-for="blessing in event.blessings" :key="blessing.id">
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
                    <td class="px-3 py-3 text-gray-600">{{ blessing.service_date }}</td>
                    <td class="px-3 py-3 font-medium tabular-nums">
                      {{ blessing.count ?? blessing.total_count }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>

          <template v-else-if="reportSubtab === 'Unit reports'">
            <div v-if="unitLoading" class="py-6 text-center text-sm text-gray-500">
              Loading sessions…
            </div>
            <div v-else>
              <table v-if="unitSessions.length > 0" class="w-full text-left text-sm">
                <thead>
                  <tr class="border-b border-gray-200 dark:border-gray-800">
                    <th class="py-2 pr-2 font-medium">Date</th>
                    <th class="py-2 pr-2 font-medium">Session</th>
                    <th class="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="session in unitSessions"
                    :key="session.id"
                    class="border-b border-gray-100 dark:border-gray-800"
                  >
                    <td class="py-2 pr-2">{{ session.session_date }}</td>
                    <td class="py-2 pr-2">{{ session.session_name }}</td>
                    <td class="py-2 text-right tabular-nums">
                      {{ unitDisplayTotal(session) ?? '—' }}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td class="py-2 pr-2 font-semibold" colspan="2">Total</td>
                    <td class="py-2 text-right font-semibold tabular-nums">
                      {{ unitTotal }}
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div v-else>
                <p class="text-sm text-gray-500">
                  No sessions recorded for this programme yet.
                </p>
                <UButton
                  v-if="canEdit"
                  class="mt-2"
                  size="sm"
                  color="neutral"
                  variant="outline"
                  label="Open programme settings"
                  icon="i-lucide-settings"
                  @click="showEdit = true"
                />
              </div>
              <div
                v-if="canEdit"
                class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800"
              >
                <h3 class="text-sm font-semibold">Record headcount</h3>
                <UFormField
                  v-if="unitSessions.length > 0"
                  label="Session (optional — pick from this programme's list)"
                >
                  <USelect
                    :model-value="unitSessionId"
                    :items="unitSessionItems"
                    class="w-full"
                    @update:model-value="unitPickSession(String($event))"
                  />
                </UFormField>
                <div class="mt-2 grid gap-2 sm:grid-cols-3">
                  <UFormField label="Session date">
                    <UInput
                      v-model="unitDate"
                      type="date"
                      class="w-full"
                      :disabled="unitSessionId !== ''"
                    />
                  </UFormField>
                  <UFormField label="Service type">
                    <USelect
                      :model-value="unitType"
                      :items="unitTypeItems"
                      class="w-full"
                      :disabled="unitSessionId !== ''"
                      @update:model-value="unitPickType(String($event))"
                    />
                  </UFormField>
                  <UFormField label="Session name">
                    <UInput
                      v-model="unitName"
                      type="text"
                      class="w-full"
                      :disabled="unitSessionId !== ''"
                    />
                  </UFormField>
                </div>
                <div v-if="unitCats.length > 0" class="mt-2 grid gap-2 sm:grid-cols-2">
                  <div v-for="category in unitCats" :key="category">
                    <UFormField>
                      <template #label>
                        <span class="mr-auto">{{ unitCatLabel(category) }}</span>
                        <UButton
                          size="xs"
                          color="neutral"
                          variant="ghost"
                          icon="i-lucide-x"
                          :aria-label="`Remove ${unitCatLabel(category)} row`"
                          @click="unitRemoveCategory(category)"
                        />
                      </template>
                      <div class="flex gap-2">
                        <UInput
                          :model-value="unitCounts[category]?.male ?? null"
                          type="number"
                          min="0"
                          :placeholder="unitSplit ? 'Male' : 'Count'"
                          class="w-full"
                          @update:model-value="
                            unitCounts[category] = {
                              male: $event === null ? null : Number($event),
                              female: unitCounts[category]?.female ?? null,
                            }
                          "
                        />
                        <UInput
                          v-if="unitSplit"
                          :model-value="unitCounts[category]?.female ?? null"
                          type="number"
                          min="0"
                          placeholder="Female"
                          class="w-full"
                          @update:model-value="
                            unitCounts[category] = {
                              male: unitCounts[category]?.male ?? null,
                              female: $event === null ? null : Number($event),
                            }
                          "
                        />
                      </div>
                    </UFormField>
                  </div>
                </div>
                <p
                  v-if="unitMessage !== ''"
                  class="mt-2 text-sm"
                  :class="unitIsError ? 'text-red-600' : 'text-green-700'"
                >
                  {{ unitMessage }}
                </p>
                <div
                  v-if="unitAddableCats.length > 0"
                  class="mt-2 flex flex-wrap items-end gap-2"
                >
                  <UFormField label="Add a row" class="min-w-48 flex-1">
                    <USelect
                      :model-value="''"
                      :items="unitAddableItems"
                      placeholder="Choose a category…"
                      class="w-full"
                      @update:model-value="unitAddCategory(String($event))"
                    />
                  </UFormField>
                  <UFormField
                    v-if="unitCats.includes('other')"
                    label="Describe Other"
                    class="min-w-48 flex-1"
                  >
                    <UInput
                      v-model="unitOtherLabel"
                      placeholder="e.g. Ushers"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <div
                  v-else-if="unitCats.includes('other')"
                  class="mt-2 grid gap-2 sm:grid-cols-2"
                >
                  <UFormField label="Describe Other">
                    <UInput
                      v-model="unitOtherLabel"
                      placeholder="e.g. Ushers"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <UButton
                  class="mt-2"
                  label="Save headcount"
                  icon="i-lucide-save"
                  :loading="unitSaving"
                  @click="submitUnitCapture"
                />
              </div>
            </div>
          </template>

          <template v-else-if="reportSubtab === 'Feedback'">
            <FeedbackList :event-id="id" />
          </template>
          <template v-else>
            <TestimonyList :event-id="id" />
          </template>
        </UCard>

        <!-- Visitor invitation + management (AFC-649 §F) -->
        <UCard class="mt-4">
          <template #header
            ><h2 class="text-sm font-semibold">Visitors and invitations</h2>
            <p class="text-xs text-gray-500">
              Scoped by your area, zone and branch.
            </p></template
          >
          <div class="flex flex-wrap gap-2">
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-mail-plus"
              label="Invite someone"
              :to="`/events/${event.id}/invite`"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-users"
              label="Manage visitors"
              :to="`/visitors?event=${event.id}`"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              icon="i-lucide-send"
              label="Sent invitations"
              :to="`/invites?event=${event.id}`"
            />
          </div>
        </UCard>
      </section>

      <!-- SCHEDULE -->
      <!-- AFC-826: sessions ARE attendance_sessions (one model); the builder
        below lists the event's sessions and manages each session's
        programme items (session_activities). -->
      <section v-if="tab === 'schedule'" aria-label="Schedule" class="mt-4">
        <ScheduleBuilder :event-id="id" :can-edit="canEdit" />
      </section>

      <!-- MATERIALS -->
      <!-- AFC-844: approved library + approval queue + share form. Only
        approved rows render as the library; pending items wait for a
        manager. Scope is enforced server-side. -->
      <section v-if="tab === 'materials'" aria-label="Resources" class="mt-4">
        <ResourceLibrary
          v-if="canResources"
          :event-id="id"
          :can-manage="canManageResources"
        />
        <UCard v-else>
          <EmptyState
            title="No resources yet"
            description="Guidelines, handbooks and the order of programme will appear here once they're shared."
          >
            <UButton
              v-if="canEdit"
              class="mt-4"
              size="sm"
              color="neutral"
              variant="outline"
              label="Open programme settings"
              icon="i-lucide-settings"
              @click="showEdit = true"
            />
          </EmptyState>
        </UCard>
      </section>

      <!-- TASKS (AFC-666 board; AFC-668 recurring checklist) -->
      <section v-if="tab === 'tasks'" aria-label="Programme tasks" class="mt-4">
        <TaskViews
          :branch-id="event.branch"
          description="Tasks filed under this programme's branch — one list, six views."
          template-id="event_programme"
          :related-id="String(event.id)"
          :base-date="event.start_at.slice(0, 10)"
        />
      </section>

      <!-- EXPENSES (AFC-801): scoped spend list + client-side total -->
      <section v-if="tab === 'expenses'" aria-label="Programme expenses" class="mt-4">
        <div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <p>
            <strong class="tabular-nums">{{ expenses.length }}</strong> expense
            {{ expenses.length === 1 ? 'record' : 'records' }}
          </p>
          <span class="text-xs text-gray-500">
            <UIcon name="i-lucide-map-pin" class="mr-1 inline size-3" />{{ scopePill }}
          </span>
          <span class="ml-auto flex gap-2">
            <UButton
              v-if="canRecordExpenses"
              size="sm"
              icon="i-lucide-plus"
              label="New expense"
              @click="showExpenseForm = true"
            />
          </span>
        </div>

        <UAlert
          v-if="expenseRestrictedMessage"
          class="mb-3"
          color="warning"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="Restricted on this account"
          :description="expenseRestrictedMessage"
        />

        <!-- Budget vs actual (AFC-825): per-category plan against summed
          spend. Bars read actual/budget; revision = record again. -->
        <UCard class="mb-3">
          <h3 class="text-sm font-semibold">Budget vs actual</h3>
          <p v-if="budgetError" class="mt-1 text-xs text-red-600 dark:text-red-400">
            {{ budgetError }}
          </p>
          <div v-else-if="budgetsPending" class="flex justify-center py-4">
            <UIcon
              name="i-lucide-loader-circle"
              class="size-5 animate-spin text-gray-400"
            />
          </div>
          <table v-else class="mt-2 w-full text-left text-sm">
            <thead>
              <tr
                class="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800"
              >
                <th class="py-2 pr-2 font-medium">Category</th>
                <th class="py-2 pr-2 text-right font-medium">Budget</th>
                <th class="py-2 pr-2 text-right font-medium">Actual</th>
                <th class="py-2 pr-2 text-right font-medium">Left</th>
                <th class="py-2 font-medium">Spend</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="line in budgetVariance"
                :key="line.key"
                class="border-b border-gray-100 dark:border-gray-800"
              >
                <td class="py-2 pr-2 font-medium capitalize">{{ line.label }}</td>
                <td class="py-2 pr-2 text-right tabular-nums">
                  {{ line.budget === null ? '—' : line.budget.toFixed(2) }}
                </td>
                <td class="py-2 pr-2 text-right tabular-nums">
                  {{ line.actual.toFixed(2) }}
                </td>
                <td
                  class="py-2 pr-2 text-right tabular-nums"
                  :class="
                    line.left !== null && line.left < 0
                      ? 'text-red-600 dark:text-red-400'
                      : ''
                  "
                >
                  {{ line.left === null ? '—' : line.left.toFixed(2) }}
                </td>
                <td class="py-2">
                  <div
                    class="h-2 min-w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  >
                    <div
                      class="h-full rounded-full"
                      :class="
                        line.left !== null && line.left < 0
                          ? 'bg-red-500'
                          : 'bg-primary-500'
                      "
                      :style="{ width: `${line.pct}%` }"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
          <div
            v-if="canRecordExpenses"
            class="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800"
          >
            <h4 class="text-sm font-semibold">Record a budget line</h4>
            <div class="mt-2 grid gap-2 sm:grid-cols-3">
              <UFormField label="Category" :error="budgetFieldErrors.category_key">
                <USelect
                  v-model="budgetForm.category_key"
                  :items="expenseCategoryOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Planned amount" :error="budgetFieldErrors.amount">
                <UInput
                  v-model="budgetForm.amount"
                  inputmode="decimal"
                  placeholder="0.00"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Notes" :error="budgetFieldErrors.notes">
                <UInput v-model="budgetForm.notes" class="w-full" />
              </UFormField>
            </div>
            <div class="mt-2 flex justify-end">
              <UButton
                size="sm"
                label="Record budget"
                :loading="budgetSaving"
                @click="submitBudget()"
              />
            </div>
            <div
              v-if="canManageCategories"
              class="mt-3 border-t border-gray-200 pt-3 dark:border-gray-800"
            >
              <h4 class="text-sm font-semibold">Add a spend category</h4>
              <p v-if="categoryError" class="mt-1 text-xs text-red-600 dark:text-red-400">
                {{ categoryError }}
              </p>
              <div class="mt-2 grid gap-2 sm:grid-cols-3">
                <UFormField label="Key (lowercase, no spaces)">
                  <UInput
                    v-model="newCategory.key"
                    placeholder="e.g. sound"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Label">
                  <UInput
                    v-model="newCategory.label"
                    placeholder="e.g. Sound"
                    class="w-full"
                  />
                </UFormField>
                <div class="flex items-end justify-end">
                  <UButton
                    size="sm"
                    variant="outline"
                    label="Add category"
                    :loading="categorySaving"
                    @click="submitCategory()"
                  />
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <div v-if="expensesPending" class="flex justify-center py-10">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>
        <UAlert
          v-else-if="expensesError"
          color="error"
          variant="subtle"
          title="Could not load expenses"
          :description="expensesError"
        />
        <EmptyState
          v-else-if="expenses.length === 0"
          title="No expenses recorded"
          description="Spend recorded against this programme will appear here."
        />
        <UCard v-else>
          <div class="overflow-x-auto">
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="px-3 py-2 font-medium">Date</th>
                  <th class="px-3 py-2 font-medium">Category</th>
                  <th class="px-3 py-2 font-medium">Amount</th>
                  <th class="px-3 py-2 font-medium">Notes</th>
                  <th class="px-3 py-2 font-medium">Receipt</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="row in expenses" :key="row.id">
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ formatDay(row.spent_on) }}
                  </td>
                  <td class="px-3 py-3 font-medium capitalize">
                    {{ expenseCategoryLabel(row) }}
                  </td>
                  <td class="px-3 py-3 tabular-nums">
                    {{ formatExpenseAmount(row) }}
                  </td>
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ row.notes || '—' }}
                  </td>
                  <td class="px-3 py-3">
                    <UButton
                      v-if="row.receipt"
                      size="xs"
                      color="neutral"
                      variant="ghost"
                      icon="i-lucide-receipt"
                      label="View"
                      :to="`/api/events/${id}/expenses/receipt?file=${row.receipt}`"
                      target="_blank"
                    />
                    <span v-else class="text-gray-400">—</span>
                  </td>
                </tr>
                <tr class="font-medium">
                  <td class="px-3 py-2">Total</td>
                  <td class="px-3 py-2" />
                  <td class="px-3 py-2 tabular-nums">
                    {{
                      expenseAmountVisible
                        ? `${expenseTotal.toFixed(2)} ${event.currency ?? ''}`.trim()
                        : '—'
                    }}
                  </td>
                  <td class="px-3 py-2" />
                  <td class="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </section>

      <!-- SPEAKERS -->
      <!-- AFC-843: booked vs pending at a glance. SpeakerManager owns the
        list/book/move/withdraw cycle; scope is enforced server-side. -->
      <section v-if="tab === 'speakers'" aria-label="Programme speakers" class="mt-4">
        <SpeakerManager :event-id="id" :can-manage="canManageSpeakers" />
      </section>

      <!-- Modals (unchanged) -->
      <RegistrationManageModal
        v-model:open="showManageOpen"
        :registration="managingRegistration"
        :currency="event.currency"
        :payments-enabled="event.payments_enabled"
        @saved="afterRegistrationSaved()"
      />
      <RegistrationCreateModal
        v-model:open="showWalkinForm"
        :event-id="event.id"
        :branches="branches.data.value ?? []"
        :event-branch="event.branch"
        :medical-visible="medicalVisible"
        @saved="afterRegistrationSaved()"
      />
      <RegistrationGroupModal
        v-model:open="showGroupForm"
        :event-id="event.id"
        :branches="branches.data.value ?? []"
        :event-branch="event.branch"
        @saved="afterRegistrationSaved()"
      />
      <EventCommsModal
        v-model:open="showComms"
        :event-id="event.id"
        :event-title="event.title"
        :registrations="selectedRegistrations"
        @sent="afterRegistrationSaved()"
      />
      <EventFormModal
        v-model:open="showEdit"
        :event="event"
        :branches="branches.data.value ?? []"
        @saved="refresh()"
      />
      <UModal
        v-model:open="showExpenseForm"
        title="Record expense"
        description="Spend against this programme. The branch and zone are copied from the programme — never typed here."
      >
        <template #body>
          <form class="space-y-4" novalidate @submit.prevent="submitExpense()">
            <UAlert
              v-if="expenseError"
              color="error"
              variant="subtle"
              :description="expenseError"
            />
            <UFormField label="Category" required :error="expenseFieldErrors.category">
              <USelect
                v-model="expenseForm.category"
                :items="expenseCategoryOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="expenseForm.category === 'other'"
              label="Describe the expense"
              required
              :error="expenseFieldErrors.category_other_label"
            >
              <UInput v-model="expenseForm.category_other_label" class="w-full" />
            </UFormField>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Amount" required :error="expenseFieldErrors.amount">
                <UInput
                  v-model="expenseForm.amount"
                  inputmode="decimal"
                  placeholder="0.00"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Date spent"
                required
                :error="expenseFieldErrors.spent_on"
              >
                <UInput v-model="expenseForm.spent_on" type="date" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Notes" :error="expenseFieldErrors.notes">
              <UTextarea v-model="expenseForm.notes" class="w-full" :rows="3" />
            </UFormField>
            <UFormField label="Receipt (optional)" :error="expenseFieldErrors.file">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                class="w-full text-sm text-gray-500 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 dark:file:bg-gray-800 dark:file:text-gray-200"
                @change="pickExpenseReceipt($event.target)"
              />
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                PDF, JPG, PNG or WebP, up to 10 MB. Sent when you record the expense.
              </p>
              <p
                v-if="expenseReceiptName"
                class="mt-1 text-xs text-gray-500 dark:text-gray-400"
              >
                Attached: {{ expenseReceiptName }}
              </p>
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                label="Cancel"
                @click="showExpenseForm = false"
              />
              <UButton type="submit" label="Record expense" :loading="savingExpense" />
            </div>
          </form>
        </template>
      </UModal>
      <BlessingFormModal
        v-model:open="showBlessingForm"
        :branches="branches.data.value ?? []"
        :preset="{
          event: event.id,
          branch: event.branch,
          service_date: event.start_at.slice(0, 10),
        }"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
