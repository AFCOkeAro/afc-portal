<script setup lang="ts">
import { COLLECTIONS, isTaskOverdue } from '@afc/shared'

/**
 * Notion-style multi-view task board (AFC-666): one scoped task list rendered
 * as six interchangeable views — board (kanban grouped by status), table,
 * list, calendar (by due date), timeline (by due week) and gallery (cards).
 * Views shape the same rows; sorts and filters stay client-side while the
 * scope (branch) is enforced server-side. Task detail stays at /tasks/:id.
 *
 * Used by the event detail Tasks tab (scoped to the event branch) with a
 * link out to the full /tasks board.
 */
interface TaskItem {
  id: unknown
  title: unknown
  status: unknown
  priority: unknown
  due_date: unknown
}

const props = defineProps<{
  /** Narrow to one branch (event Tasks tab). Omit for the whole scope. */
  branchId?: string | null
  /** Small caption shown under the view switcher. */
  description?: string
  /** Checklist template to offer (e.g. event_programme on the event tab). */
  templateId?: string | null
  /** tasks.related_id stamped on generated rows. */
  relatedId?: string | null
  /** Base date (YYYY-MM-DD) offsets count from. */
  baseDate?: string | null
}>()

const api = useApi()

type ViewId = 'board' | 'table' | 'list' | 'calendar' | 'timeline' | 'gallery'
const VIEWS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'board', label: 'Board', icon: 'i-lucide-square-kanban' },
  { id: 'table', label: 'Table', icon: 'i-lucide-table' },
  { id: 'list', label: 'List', icon: 'i-lucide-list' },
  { id: 'calendar', label: 'Calendar', icon: 'i-lucide-calendar-days' },
  { id: 'timeline', label: 'Timeline', icon: 'i-lucide-chart-gantt' },
  { id: 'gallery', label: 'Gallery', icon: 'i-lucide-images' },
]
const view = ref<ViewId>('board')

const STATUS_META: Record<string, { label: string; badge: string; dot: string; strip: string }> = {
  todo: { label: 'To do', badge: 'neutral', dot: 'bg-gray-400', strip: 'bg-gray-300' },
  in_progress: { label: 'In progress', badge: 'warning', dot: 'bg-amber-500', strip: 'bg-amber-400' },
  blocked: { label: 'Blocked', badge: 'error', dot: 'bg-red-500', strip: 'bg-red-400' },
  done: { label: 'Done', badge: 'success', dot: 'bg-green-500', strip: 'bg-green-400' },
}
const STATUS_IDS = ['todo', 'in_progress', 'blocked', 'done']
const statusOptions = [
  { label: 'All statuses', value: 'all' },
  ...STATUS_IDS.map((id) => ({ label: STATUS_META[id].label, value: id })),
]
const statusFilter = ref('all')

const query = computed<Record<string, string | number>>(() => ({
  limit: 100,
  ...(props.branchId ? { branch: props.branchId } : {}),
}))

const {
  data,
  pending,
  error,
  refresh,
} = await useAsyncData(`task-views-${props.branchId ?? 'all'}`, () =>
  api.get<{ data: TaskItem[]; meta: { total: number } }>('/api/tasks', {
    query: query.value,
  }),
  { watch: [query] },
)

const rows = computed<TaskItem[]>(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? rows.value.length)

/** One-click recurring checklist (AFC-668): applies the configured template
 *  for this scope (branch + related record + base date). */
const applying = ref(false)
const appliedCount = ref<number | null>(null)
const applyError = ref('')
async function applyChecklist() {
  if (!props.templateId) return
  applying.value = true
  applyError.value = ''
  appliedCount.value = null
  try {
    const res = await api.post<{ data: { created: number; ids: string[] } }>(
      '/api/tasks/from-template',
      {
        template: props.templateId,
        ...(props.branchId ? { branch: props.branchId } : {}),
        base_date: props.baseDate ?? null,
        related_id: props.relatedId ?? null,
      },
    )
    appliedCount.value = res.data.created
    await refresh()
  } catch (cause) {
    applyError.value =
      (cause as { message?: string }).message ?? 'Could not apply the checklist'
  } finally {
    applying.value = false
  }
}
const filtered = computed(() =>
  statusFilter.value === 'all'
    ? rows.value
    : rows.value.filter((row) => String(row.status ?? '') === statusFilter.value),
)

function idOf(row: TaskItem): string {
  return String(row.id)
}
function titleOf(row: TaskItem): string {
  const title = String(row.title ?? '').trim()
  return title === '' ? 'Untitled task' : title
}
function statusOf(row: TaskItem): string {
  const status = String(row.status ?? '')
  return status in STATUS_META ? status : 'todo'
}
function priorityOf(row: TaskItem): string | null {
  const priority = String(row.priority ?? '').trim()
  return priority === '' ? null : priority
}
/** Calendar day key (YYYY-MM-DD) or null when unscheduled. */
function dueKeyOf(row: TaskItem): string | null {
  if (typeof row.due_date !== 'string' || row.due_date.trim() === '') return null
  return row.due_date.slice(0, 10)
}
function displayDate(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}
function isOverdue(row: TaskItem): boolean {
  return isTaskOverdue({
    due_date: typeof row.due_date === 'string' ? row.due_date : null,
    status: String(row.status ?? ''),
  })
}

const boardColumns = computed(() =>
  STATUS_IDS.map((id) => ({
    id,
    ...STATUS_META[id],
    items: filtered.value.filter((row) => statusOf(row) === id),
  })),
)

/* ---------- Calendar state (month grid, Monday-first) ---------- */
const now = new Date()
const calYear = ref(now.getFullYear())
const calMonth = ref(now.getMonth())
const monthLabel = computed(() =>
  new Date(calYear.value, calMonth.value, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  }),
)
function stepMonth(direction: -1 | 1): void {
  const next = new Date(calYear.value, calMonth.value + direction, 1)
  calYear.value = next.getFullYear()
  calMonth.value = next.getMonth()
}
function goThisMonth(): void {
  const today = new Date()
  calYear.value = today.getFullYear()
  calMonth.value = today.getMonth()
}
interface CalCell {
  key: string
  day: number
  isToday: boolean
  items: TaskItem[]
}
const calCells = computed<(CalCell | null)[]>(() => {
  const year = calYear.value
  const month = calMonth.value
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const days = new Date(year, month + 1, 0).getDate()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const byDate = new Map<string, TaskItem[]>()
  for (const row of filtered.value) {
    const key = dueKeyOf(row)
    if (!key) continue
    const list = byDate.get(key) ?? []
    list.push(row)
    byDate.set(key, list)
  }
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const cells: (CalCell | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let day = 1; day <= days; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`
    cells.push({ key, day, isToday: key === todayKey, items: byDate.get(key) ?? [] })
  }
  return cells
})
const unscheduled = computed(() =>
  filtered.value.filter((row) => dueKeyOf(row) === null),
)

/* ---------- Timeline state (groups by due week) ---------- */
function weekStartKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
const timelineGroups = computed(() => {
  const groups = new Map<string, TaskItem[]>()
  for (const row of filtered.value) {
    const key = dueKeyOf(row)
    if (!key) continue
    const week = weekStartKey(key)
    const list = groups.get(week) ?? []
    list.push(row)
    groups.set(week, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([week, items]) => ({
      week,
      label: `Week of ${displayDate(week)}`,
      items: [...items].sort((a, b) =>
        (dueKeyOf(a) ?? '') < (dueKeyOf(b) ?? '') ? -1 : 1,
      ),
    }))
})
</script>

<template>
  <div>
    <div class="flex flex-wrap items-center gap-2">
      <div
        class="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-950"
        role="tablist"
        aria-label="Task views"
      >
        <UButton
          v-for="entry in VIEWS"
          :key="entry.id"
          :icon="entry.icon"
          :label="entry.label"
          size="xs"
          :color="view === entry.id ? 'primary' : 'neutral'"
          :variant="view === entry.id ? 'solid' : 'ghost'"
          role="tab"
          :aria-selected="view === entry.id"
          @click="view = entry.id"
        />
      </div>
      <USelect
        v-model="statusFilter"
        :items="statusOptions"
        class="w-40"
        aria-label="Filter tasks by status"
      />
      <span class="text-xs text-gray-500 tabular-nums dark:text-gray-400">
        {{ filtered.length }} of {{ total }}
      </span>
      <PermissionGate
        v-if="props.templateId"
        :collection="COLLECTIONS.tasks"
        action="create"
      >
        <UButton
          label="Apply checklist"
          icon="i-lucide-clipboard-list"
          size="xs"
          color="neutral"
          variant="outline"
          :loading="applying"
          @click="applyChecklist()"
        />
      </PermissionGate>
      <NuxtLink
        v-if="props.branchId"
        :to="`/tasks?branch=${props.branchId}`"
        class="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
      >
        Open full board
        <UIcon name="i-lucide-arrow-right" class="size-3" />
      </NuxtLink>
    </div>
    <p v-if="appliedCount !== null" class="mt-2 text-xs font-medium text-green-700 dark:text-green-400">
      Checklist applied — {{ appliedCount }} tasks created.
    </p>
    <p v-if="applyError !== ''" class="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
      {{ applyError }}
    </p>
    <p v-if="props.description" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
      {{ props.description }}
    </p>

    <div v-if="pending" class="mt-6 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      class="mt-4"
      color="error"
      variant="subtle"
      title="Could not load tasks"
      description="The task list is unavailable for this account."
    />

    <EmptyState
      v-else-if="filtered.length === 0"
      title="No tasks in this view"
      description="Tasks filed for this scope will appear here in every view."
    >
      <UButton class="mt-4" label="Refresh" size="sm" color="neutral" variant="outline" @click="refresh()" />
    </EmptyState>

    <!-- Board (kanban, grouped by status — Notion board semantics) -->
    <div v-else-if="view === 'board'" class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <section
        v-for="column in boardColumns"
        :key="column.id"
        :aria-label="`${column.label} column`"
        class="rounded-xl border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-900/40"
      >
        <header class="flex items-center gap-2 px-2 py-1">
          <span :class="`size-2 rounded-full ${column.dot}`" />
          <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
            {{ column.label }}
          </h3>
          <span class="ml-auto text-xs text-gray-400 tabular-nums">{{ column.items.length }}</span>
        </header>
        <ul class="mt-1 space-y-2">
          <li
            v-for="row in column.items"
            :key="idOf(row)"
            class="rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-950"
          >
            <NuxtLink
              :to="`/tasks/${idOf(row)}`"
              class="block text-sm font-medium text-gray-900 hover:text-primary-600 dark:text-white"
            >
              {{ titleOf(row) }}
            </NuxtLink>
            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
              <span v-if="priorityOf(row)" class="uppercase tracking-wide">{{ priorityOf(row) }}</span>
              <span v-if="dueKeyOf(row)" :class="isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''">
                {{ displayDate(dueKeyOf(row) as string) }}
              </span>
            </div>
          </li>
        </ul>
        <p v-if="column.items.length === 0" class="px-2 py-4 text-center text-xs text-gray-400">
          Empty
        </p>
      </section>
    </div>

    <!-- Table -->
    <div v-else-if="view === 'table'" class="mt-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
      <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
        <thead>
          <tr class="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
            <th class="px-3 py-2 font-medium">Title</th>
            <th class="px-3 py-2 font-medium">Status</th>
            <th class="px-3 py-2 font-medium">Priority</th>
            <th class="px-3 py-2 font-medium">Due</th>
            <th class="px-3 py-2"><span class="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
          <tr v-for="row in filtered" :key="idOf(row)" class="hover:bg-gray-50 dark:hover:bg-gray-900/60">
            <td class="px-3 py-2.5">
              <NuxtLink :to="`/tasks/${idOf(row)}`" class="font-medium text-gray-900 hover:text-primary-600 dark:text-white">
                {{ titleOf(row) }}
              </NuxtLink>
            </td>
            <td class="px-3 py-2.5">
              <UBadge :color="STATUS_META[statusOf(row)].badge" variant="subtle">
                {{ STATUS_META[statusOf(row)].label }}
              </UBadge>
            </td>
            <td class="px-3 py-2.5 text-gray-600 dark:text-gray-300">{{ priorityOf(row) ?? '—' }}</td>
            <td class="px-3 py-2.5 text-gray-600 dark:text-gray-300" :class="isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''">
              {{ dueKeyOf(row) ? displayDate(dueKeyOf(row) as string) : '—' }}
            </td>
            <td class="px-3 py-2.5 text-right">
              <UButton :to="`/tasks/${idOf(row)}`" color="neutral" variant="ghost" size="xs" icon="i-lucide-arrow-right" aria-label="Open task" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- List -->
    <ul v-else-if="view === 'list'" class="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-950">
      <li v-for="row in filtered" :key="idOf(row)">
        <NuxtLink :to="`/tasks/${idOf(row)}`" class="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-900/60">
          <span :class="`size-2 shrink-0 rounded-full ${STATUS_META[statusOf(row)].dot}`" />
          <span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{{ titleOf(row) }}</span>
          <span v-if="dueKeyOf(row)" class="shrink-0 text-xs text-gray-500 tabular-nums dark:text-gray-400" :class="isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''">
            {{ displayDate(dueKeyOf(row) as string) }}
          </span>
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-300 dark:text-gray-600" />
        </NuxtLink>
      </li>
    </ul>

    <!-- Calendar -->
    <div v-else-if="view === 'calendar'" class="mt-4">
      <div class="mb-2 flex items-center gap-2">
        <UButton icon="i-lucide-chevron-left" color="neutral" variant="ghost" size="xs" aria-label="Previous month" @click="stepMonth(-1)" />
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">{{ monthLabel }}</h3>
        <UButton icon="i-lucide-chevron-right" color="neutral" variant="ghost" size="xs" aria-label="Next month" @click="stepMonth(1)" />
        <UButton label="Today" color="neutral" variant="ghost" size="xs" @click="goThisMonth()" />
      </div>
      <div class="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 text-xs dark:border-gray-800 dark:bg-gray-800">
        <div v-for="day in ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']" :key="day" class="bg-gray-50 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          {{ day }}
        </div>
        <template v-for="(cell, index) in calCells" :key="index">
          <div v-if="cell === null" class="min-h-20 bg-gray-50/60 dark:bg-gray-900/40" />
          <div v-else class="min-h-20 bg-white p-1 dark:bg-gray-950" :class="cell.isToday ? 'ring-1 ring-inset ring-primary-500' : ''">
            <p class="px-1 font-semibold tabular-nums" :class="cell.isToday ? 'text-primary-600 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'">
              {{ cell.day }}
            </p>
            <NuxtLink
              v-for="row in cell.items.slice(0, 3)"
              :key="idOf(row)"
              :to="`/tasks/${idOf(row)}`"
              :title="titleOf(row)"
              class="mt-0.5 block truncate rounded px-1 py-0.5 text-[11px] font-medium"
              :class="statusOf(row) === 'done' ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'"
            >
              {{ titleOf(row) }}
            </NuxtLink>
            <p v-if="cell.items.length > 3" class="px-1 text-[11px] text-gray-400">+{{ cell.items.length - 3 }} more</p>
          </div>
        </template>
      </div>
      <div v-if="unscheduled.length > 0" class="mt-3 rounded-xl border border-dashed border-gray-300 p-3 dark:border-gray-700">
        <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Unscheduled ({{ unscheduled.length }})
        </p>
        <ul class="mt-1 flex flex-wrap gap-1.5">
          <li v-for="row in unscheduled" :key="idOf(row)">
            <NuxtLink :to="`/tasks/${idOf(row)}`" class="inline-block rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200">
              {{ titleOf(row) }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>

    <!-- Timeline -->
    <div v-else-if="view === 'timeline'" class="mt-4">
      <ol v-if="timelineGroups.length > 0" class="relative space-y-4 border-l-2 border-gray-200 pl-5 dark:border-gray-800">
        <li v-for="group in timelineGroups" :key="group.week" class="relative">
          <span class="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-white bg-primary-500 dark:border-gray-950" />
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{{ group.label }}</p>
          <ul class="mt-1.5 space-y-1.5">
            <li v-for="row in group.items" :key="idOf(row)">
              <NuxtLink :to="`/tasks/${idOf(row)}`" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm hover:border-primary-300 dark:border-gray-700 dark:bg-gray-950">
                <span class="font-medium text-gray-900 dark:text-white">{{ titleOf(row) }}</span>
                <UBadge :color="STATUS_META[statusOf(row)].badge" variant="subtle" size="xs">
                  {{ STATUS_META[statusOf(row)].label }}
                </UBadge>
                <span v-if="dueKeyOf(row)" class="ml-auto text-xs text-gray-500 tabular-nums dark:text-gray-400" :class="isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''">
                  due {{ displayDate(dueKeyOf(row) as string) }}
                </span>
              </NuxtLink>
            </li>
          </ul>
        </li>
      </ol>
      <p v-if="timelineGroups.length === 0" class="text-sm text-gray-500 dark:text-gray-400">
        No dated tasks yet — set a due date and it will plot here.
      </p>
      <p v-if="unscheduled.length > 0" class="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {{ unscheduled.length }} unscheduled task{{ unscheduled.length === 1 ? '' : 's' }} not shown.
      </p>
    </div>

    <!-- Gallery -->
    <div v-else-if="view === 'gallery'" class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <NuxtLink
        v-for="row in filtered"
        :key="idOf(row)"
        :to="`/tasks/${idOf(row)}`"
        class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:border-primary-300 hover:shadow dark:border-gray-800 dark:bg-gray-950"
      >
        <div :class="`h-1.5 ${STATUS_META[statusOf(row)].strip}`" />
        <div class="p-4">
          <p class="font-semibold text-gray-900 dark:text-white">{{ titleOf(row) }}</p>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <UBadge :color="STATUS_META[statusOf(row)].badge" variant="subtle">
              {{ STATUS_META[statusOf(row)].label }}
            </UBadge>
            <span v-if="priorityOf(row)" class="uppercase tracking-wide text-gray-400">{{ priorityOf(row) }}</span>
            <span v-if="dueKeyOf(row)" class="ml-auto text-gray-500 tabular-nums dark:text-gray-400" :class="isOverdue(row) ? 'font-semibold text-red-600 dark:text-red-400' : ''">
              {{ displayDate(dueKeyOf(row) as string) }}
            </span>
          </div>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
