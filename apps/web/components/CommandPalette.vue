<script setup lang="ts">
/**
 * Command palette (AFC-717). Frappe-style awesome-bar over scoped search.
 *
 * Upgrades AFC-585 HeaderSearch (which keeps `/` + the `/search` page); this
 * overlay adds Ctrl/Cmd+K plus the mobile search-button entry point.
 *
 * Scope rule: NO new backend surface. Each Records group queries its own
 * EXISTING scoped list endpoint with the caller token (`/api/people`,
 * `/api/events`, `/api/households`, `/api/services` with `?search=`); the
 * server scope-filters fail-closed and aggregation here is display-only.
 * A per-group 403 collapses to an empty group, never a leak. Out-of-scope
 * records NEVER appear because the palette only renders rows the caller's
 * own scoped endpoints returned.
 *
 * Groups: Go to (permission-filtered pages index) / Records (people, events,
 * households, services) / New... (create actions, gated on write grants).
 * Recent items persist in localStorage under a CALLER-SCOPED key only
 * (`afc:palette:recent:<userId>`); no bare shared key is ever read/written.
 */

import { NAVIGATION, type NavigationItem } from '~/utils/navigation'
import type { Paginated } from '~/types/portal'

const PALETTE_OPEN_EVENT = 'afc:open-palette'
const PALETTE_DEBOUNCE_MS = 250
const PALETTE_RECENT_LIMIT = 5

interface PaletteItem {
  id: string
  kind: 'page' | 'person' | 'event' | 'household' | 'service' | 'create' | 'recent'
  label: string
  hint: string
  to: string
}

interface RecentEntry {
  label: string
  hint: string
  to: string
}

const api = useApi()
const permissions = usePermissions()
const { user } = useAuth()
const route = useRoute()

const open = ref(false)
const query = ref('')
const debounced = ref('')
const pending = ref(false)
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const peopleRows = ref<Array<{ id: string; label: string }>>([])
const eventRows = ref<Array<{ id: string; label: string }>>([])
const householdRows = ref<Array<{ id: string; label: string }>>([])
const serviceRows = ref<Array<{ id: string; label: string }>>([])

/** Caller-scoped recent key — never a bare shared key. */
const recentKey = computed(() =>
  user.value?.id ? `afc:palette:recent:${user.value.id}` : null,
)

function readRecent(): RecentEntry[] {
  if (!import.meta.client || !recentKey.value) return []
  try {
    const raw = window.localStorage.getItem(recentKey.value)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (entry): entry is RecentEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as RecentEntry).label === 'string' &&
          typeof (entry as RecentEntry).to === 'string',
      )
      .slice(0, PALETTE_RECENT_LIMIT)
  } catch {
    return []
  }
}

const recent = ref<RecentEntry[]>([])

function persistRecent(entry: RecentEntry): void {
  if (!import.meta.client || !recentKey.value) return
  try {
    const next = [entry, ...readRecent().filter((item) => item.to !== entry.to)].slice(
      0,
      PALETTE_RECENT_LIMIT,
    )
    window.localStorage.setItem(recentKey.value, JSON.stringify(next))
    recent.value = next
  } catch {
    // Storage unavailable (private mode): palette still works for the session.
  }
}

function openPalette(): void {
  open.value = true
  activeIndex.value = 0
  recent.value = readRecent()
  nextTick(() => inputEl.value?.focus())
}

function closePalette(): void {
  open.value = false
  query.value = ''
  debounced.value = ''
  activeIndex.value = 0
  peopleRows.value = []
  eventRows.value = []
  householdRows.value = []
  serviceRows.value = []
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (open.value) closePalette()
    else openPalette()
    return
  }
  if (open.value && event.key === 'Escape') {
    event.preventDefault()
    closePalette()
  }
}

function onOpenEvent(): void {
  openPalette()
}

/** Debounced query — 250ms, matching the EntitySelect precedent (AFC-631). */
let timer: ReturnType<typeof setTimeout> | null = null
watch(query, (value: string) => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    debounced.value = value.trim()
    activeIndex.value = 0
  }, PALETTE_DEBOUNCE_MS)
})

interface PersonRow {
  id: string
  preferred_name?: string | null
  first_name?: string | null
  last_name?: string | null
}
interface TitledRow {
  id: string | number
  title?: string | null
  name?: string | null
  theme?: string | null
}

function personLabel(row: PersonRow): string {
  return (
    [row.preferred_name || row.first_name, row.last_name].filter(Boolean).join(' ') ||
    'Unnamed person'
  )
}

function titledLabel(row: TitledRow, fallback: string): string {
  return String(row.title ?? row.name ?? row.theme ?? fallback)
}

/** Fan-out to EXISTING scoped list endpoints only — no new backend surface. */
watch(debounced, async (term: string) => {
  if (!open.value || term.length < 2) {
    peopleRows.value = []
    eventRows.value = []
    householdRows.value = []
    serviceRows.value = []
    pending.value = false
    return
  }
  pending.value = true
  const limit = 5
  const [people, events, households, services] = await Promise.all([
    api
      .get<Paginated<PersonRow>>('/api/people', { query: { search: term, limit } })
      .catch(() => ({ data: [] })),
    api
      .get<Paginated<TitledRow>>('/api/events', {
        query: { search: term, limit, when: 'all' },
      })
      .catch(() => ({ data: [] })),
    api
      .get<Paginated<TitledRow>>('/api/households', { query: { search: term, limit } })
      .catch(() => ({ data: [] })),
    api
      .get<Paginated<TitledRow>>('/api/services', { query: { search: term, limit } })
      .catch(() => ({ data: [] })),
  ])
  // Render ONLY rows the caller's own scoped endpoints returned. An
  // out-of-scope record can never appear here because the server never
  // sends it; a per-group denial arrives as a caught error above and
  // collapses to an empty group.
  peopleRows.value = (people.data ?? []).map((row) => ({
    id: String(row.id),
    label: personLabel(row),
  }))
  eventRows.value = (events.data ?? []).map((row) => ({
    id: String(row.id),
    label: titledLabel(row, 'Untitled event'),
  }))
  householdRows.value = (households.data ?? []).map((row) => ({
    id: String(row.id),
    label: titledLabel(row, 'Unnamed household'),
  }))
  serviceRows.value = (services.data ?? []).map((row) => ({
    id: String(row.id),
    label: titledLabel(row, 'Untitled service'),
  }))
  pending.value = false
  activeIndex.value = 0
})

const pageItems = computed<PaletteItem[]>(() => {
  const term = debounced.value.trim().toLowerCase()
  return NAVIGATION.filter(
    (item: NavigationItem) =>
      permissions.can(...item.requires) && item.inSidebar !== false,
  )
    .filter((item: NavigationItem) => !term || item.label.toLowerCase().includes(term))
    .slice(0, 7)
    .map((item: NavigationItem) => ({
      id: `page:${item.to}`,
      kind: 'page' as const,
      label: item.label,
      hint: 'Go to',
      to: item.to,
    }))
})

/** Create actions — each gated on its own write grant, never shown otherwise. */
const createItems = computed<PaletteItem[]>(() => {
  const term = debounced.value.trim().toLowerCase()
  const candidates: PaletteItem[] = []
  if (permissions.can('people', 'create'))
    candidates.push({
      id: 'new:person',
      kind: 'create',
      label: 'New person…',
      hint: 'New',
      to: '/people',
    })
  if (permissions.can('events', 'create'))
    candidates.push({
      id: 'new:event',
      kind: 'create',
      label: 'New event…',
      hint: 'New',
      to: '/events',
    })
  if (permissions.can('households', 'create'))
    candidates.push({
      id: 'new:household',
      kind: 'create',
      label: 'New household…',
      hint: 'New',
      to: '/households/new',
    })
  if (permissions.can('sunday_services', 'create'))
    candidates.push({
      id: 'new:service',
      kind: 'create',
      label: 'New service…',
      hint: 'New',
      to: '/services',
    })
  if (!term) return candidates
  return candidates.filter(
    (item) =>
      'new'.includes(term) ||
      item.label.toLowerCase().includes(term) ||
      term
        .split(/\s+/)
        .some(
          (word: string) => word.length > 1 && item.label.toLowerCase().includes(word),
        ),
  )
})

interface RowLabel {
  id: string
  label: string
}

const recordItems = computed<PaletteItem[]>(() => [
  ...peopleRows.value.map((row: RowLabel): PaletteItem => ({
    id: `person:${row.id}`,
    kind: 'person',
    label: row.label,
    hint: 'Person',
    to: `/people/${row.id}`,
  })),
  ...eventRows.value.map((row: RowLabel): PaletteItem => ({
    id: `event:${row.id}`,
    kind: 'event',
    label: row.label,
    hint: 'Event',
    to: `/events/${row.id}`,
  })),
  ...householdRows.value.map((row: RowLabel): PaletteItem => ({
    id: `household:${row.id}`,
    kind: 'household',
    label: row.label,
    hint: 'Household',
    to: `/households/${row.id}`,
  })),
  ...serviceRows.value.map((row: RowLabel): PaletteItem => ({
    id: `service:${row.id}`,
    kind: 'service',
    label: row.label,
    hint: 'Service',
    to: `/services/${row.id}`,
  })),
])

const recentItems = computed<PaletteItem[]>(() =>
  debounced.value.trim()
    ? []
    : recent.value.map((entry: RecentEntry, index: number): PaletteItem => ({
        id: `recent:${index}:${entry.to}`,
        kind: 'recent',
        label: entry.label,
        hint: entry.hint || 'Recent',
        to: entry.to,
      })),
)

const groups = computed<Array<{ name: string; items: PaletteItem[] }>>(() => {
  const out: Array<{ name: string; items: PaletteItem[] }> = []
  if (pageItems.value.length > 0) out.push({ name: 'Go to', items: pageItems.value })
  if (recordItems.value.length > 0)
    out.push({ name: 'Records', items: recordItems.value })
  if (createItems.value.length > 0) out.push({ name: 'New…', items: createItems.value })
  if (recentItems.value.length > 0)
    out.unshift({ name: 'Recent', items: recentItems.value })
  return out
})

const flatItems = computed<PaletteItem[]>(() =>
  groups.value.flatMap((group: { name: string; items: PaletteItem[] }) => group.items),
)

const hasQuery = computed(() => debounced.value.trim().length >= 2)
const isEmpty = computed(
  () =>
    !pending.value &&
    flatItems.value.length === 0 &&
    (hasQuery.value || recent.value.length === 0),
)

function moveActive(delta: number): void {
  if (flatItems.value.length === 0) return
  const next = activeIndex.value + delta
  const total = flatItems.value.length
  activeIndex.value = ((next % total) + total) % total
  nextTick(() => {
    document
      .getElementById(`palette-option-${activeIndex.value}`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

async function choose(item: PaletteItem | undefined): Promise<void> {
  if (!item) return
  persistRecent({ label: item.label, hint: item.hint, to: item.to })
  closePalette()
  await navigateTo(item.to)
}

function onInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    void choose(flatItems.value[activeIndex.value])
  }
}

/** Full-page fallback stays available: mobile has no keyboard shortcut. */
function seeAllResults(): void {
  const q = debounced.value.trim() || query.value.trim()
  closePalette()
  void navigateTo({ path: '/search', query: q ? { q } : {} })
}

watch(
  () => route.path,
  () => {
    if (open.value) closePalette()
  },
)

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener(PALETTE_OPEN_EVENT, onOpenEvent)
  recent.value = readRecent()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener(PALETTE_OPEN_EVENT, onOpenEvent)
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div v-if="open">
    <div
      class="fixed inset-0 z-[70] bg-gray-950/50"
      aria-hidden="true"
      @click="closePalette"
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      class="fixed inset-x-0 top-[10vh] z-[71] mx-auto w-full max-w-lg px-4"
    >
      <div
        class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900"
      >
        <div
          class="flex items-center gap-2 border-b border-gray-100 px-3 dark:border-gray-800"
        >
          <UIcon name="i-lucide-search" class="size-4 shrink-0 text-gray-400" />
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            role="combobox"
            aria-label="Search pages, records and actions"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-autocomplete="list"
            placeholder="Type to search pages, people, events…"
            class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-gray-400"
            @keydown="onInputKeydown"
          />
          <kbd
            class="hidden shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 sm:block dark:border-gray-700"
            >esc</kbd
          >
        </div>

        <div class="max-h-[50vh] overflow-y-auto p-2">
          <div
            v-if="pending"
            class="flex items-center justify-center gap-2 py-8 text-sm text-gray-500"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            Searching…
          </div>

          <div
            v-else-if="isEmpty"
            class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
          >
            <p class="font-medium">No matches</p>
            <p class="mt-1">Try a different spelling, or see the full results page.</p>
          </div>

          <div v-else id="palette-listbox" role="listbox" aria-label="Suggestions">
            <div v-for="group in groups" :key="group.name" class="mb-1 last:mb-0">
              <p
                class="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400"
              >
                {{ group.name }}
              </p>
              <ul>
                <li
                  v-for="item in group.items"
                  :id="`palette-option-${flatItems.indexOf(item)}`"
                  :key="item.id"
                  role="option"
                  :aria-selected="
                    flatItems.indexOf(item) === activeIndex ? 'true' : 'false'
                  "
                  class="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm"
                  :class="
                    flatItems.indexOf(item) === activeIndex
                      ? 'bg-primary-50 text-gray-900 dark:bg-primary-950 dark:text-white'
                      : 'text-gray-700 dark:text-gray-200'
                  "
                  @click="choose(item)"
                  @mousemove="activeIndex = flatItems.indexOf(item)"
                >
                  <span
                    class="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                    >{{ item.hint }}</span
                  >
                  <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div
          class="flex items-center justify-between border-t border-gray-100 px-3 py-2 text-xs text-gray-400 dark:border-gray-800"
        >
          <span class="hidden sm:block">↑↓ navigate · Enter open · esc close</span>
          <span class="sm:hidden">Tap a result to open it</span>
          <button
            type="button"
            class="rounded text-primary-600 hover:underline dark:text-primary-400"
            @click="seeAllResults"
          >
            See all results
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
