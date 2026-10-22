<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, BscSummary, ZoneSummary } from '~/types/portal'

/**
 * Merged Churches surface (AFC-672).
 *
 * One menu for zones + branches + Bible Study Centres with a kind filter
 * (All/Zones/Branches/BSC), text search, a list/map toggle, and per-pin
 * tooltips with contact details.
 *
 * Scope: each kind fetches its own list endpoint under its own read grant
 * (branches/zones/bible_study_centres + scopeFilter, fail-closed). A 403 on
 * one kind degrades that kind with a named warning; sibling kinds still
 * render (dashboard AFC-564 precedent). No new collections.
 *
 * HQ rule (user-confirmed): Area HQ = the Oke-Aro branch (code OKE-ARO).
 * Zonal HQ has no designated-flag column in the schema, so zones plot at
 * their own geo when present and otherwise sit in the data-quality strip
 * with "No HQ designated" — coordinates are never invented, and rows
 * without coordinates are never plotted at 0,0.
 *
 * Map: an offline-safe SVG schematic (normalised geo bounds), not a tile
 * layer — no new dependency, no external request, no children's data leaving
 * the portal. Native <title> tooltips + a click-to-open detail card keep
 * pins reachable by keyboard and screen reader.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const router = useRouter()

type Kind = 'all' | 'zones' | 'branches' | 'bscs'
const KIND_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Zones', value: 'zones' },
  { label: 'Branches', value: 'branches' },
  { label: 'BSC', value: 'bscs' },
] as const

const kind = ref<Kind>(
  route.query.kind === 'zones' ||
    route.query.kind === 'branches' ||
    route.query.kind === 'bscs'
    ? (route.query.kind as Kind)
    : 'all',
)
const search = ref(typeof route.query.search === 'string' ? route.query.search : '')
const zoneFilter = ref(typeof route.query.zone === 'string' ? route.query.zone : '')
const view = ref<'list' | 'map'>(route.query.view === 'map' ? 'map' : 'list')
const selectedId = ref<string | null>(null)

watch([kind, search, zoneFilter, view], () => {
  router.replace({
    query: {
      ...(kind.value !== 'all' ? { kind: kind.value } : {}),
      ...(search.value ? { search: search.value } : {}),
      ...(zoneFilter.value ? { zone: zoneFilter.value } : {}),
      ...(view.value === 'map' ? { view: 'map' } : {}),
    },
  })
})

const canBranches = computed(() => permissions.can(COLLECTIONS.branches, 'read'))
const canZones = computed(() => permissions.can(COLLECTIONS.zones, 'read'))
const canBscs = computed(() => permissions.can(COLLECTIONS.bibleStudyCentres, 'read'))

const {
  data: branchRows,
  error: branchError,
  pending: branchPending,
} = await useAsyncData('churches-branches', () =>
  canBranches.value
    ? api.get<BranchSummary[]>('/api/branches')
    : Promise.resolve([] as BranchSummary[]),
)
const {
  data: zoneRows,
  error: zoneError,
  pending: zonePending,
} = await useAsyncData('churches-zones', () =>
  canZones.value
    ? api.get<ZoneSummary[]>('/api/zones')
    : Promise.resolve([] as ZoneSummary[]),
)
const {
  data: bscRows,
  error: bscError,
  pending: bscPending,
} = await useAsyncData('churches-bscs', () =>
  canBscs.value
    ? api.get<BscSummary[]>('/api/bscs')
    : Promise.resolve([] as BscSummary[]),
)

const pending = computed(
  () => branchPending.value || zonePending.value || bscPending.value,
)

interface ChurchPin {
  id: string
  kind: Exclude<Kind, 'all'>
  kindLabel: string
  name: string
  code: string
  address: string | null
  contact: string | null
  leader: string | null
  lat: number | null
  lng: number | null
  href: string
  isAreaHq: boolean
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value) : (value as number)
  return Number.isFinite(n) ? n : null
}

function contactOf(phone?: string | null, email?: string | null): string | null {
  const parts = [phone, email].filter(Boolean) as string[]
  return parts.length > 0 ? parts.join(' · ') : null
}

const pins = computed<ChurchPin[]>(() => {
  const list: ChurchPin[] = []
  for (const b of branchRows.value ?? []) {
    const isAreaHq = b.code?.toUpperCase() === 'OKE-ARO'
    list.push({
      id: `branch:${b.id}`,
      kind: 'branches',
      kindLabel: isAreaHq ? 'Area HQ' : 'Branch',
      name: b.name,
      code: b.code,
      address: b.address ?? ([b.city, b.state].filter(Boolean).join(', ') || null),
      contact: contactOf(b.phone, b.email),
      leader: b.pastor ?? null,
      lat: toNum(b.geo_lat),
      lng: toNum(b.geo_lng),
      href: `/branches/${b.id}`,
      isAreaHq,
    })
  }
  for (const z of zoneRows.value ?? []) {
    list.push({
      id: `zone:${z.id}`,
      kind: 'zones',
      // No HQ-flag column exists: a zone with its own geo plots as the
      // zonal marker; without geo it is data-quality, never invented.
      kindLabel: z.geo_lat != null && z.geo_lng != null ? 'Zonal HQ' : 'Zone',
      name: z.name,
      code: z.code,
      address: z.address ?? null,
      contact: null,
      leader: z.leader ?? null,
      lat: toNum(z.geo_lat),
      lng: toNum(z.geo_lng),
      href: `/zones/${z.id}`,
      isAreaHq: false,
    })
  }
  for (const c of bscRows.value ?? []) {
    list.push({
      id: `bsc:${c.id}`,
      kind: 'bscs',
      kindLabel: 'BSC',
      name: c.name,
      code: c.code,
      address: c.address ?? c.location ?? null,
      contact: null,
      leader: c.leader ?? null,
      lat: toNum(c.geo_lat),
      lng: toNum(c.geo_lng),
      href: `/bscs/${c.id}`,
      isAreaHq: false,
    })
  }
  return list
})

const zoneOptions = computed(() =>
  (zoneRows.value ?? []).map((z) => ({ label: `${z.name} (${z.code})`, value: z.id })),
)
const zoneNameById = computed(
  () => new Map((zoneRows.value ?? []).map((z) => [z.id, z.name])),
)

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return pins.value.filter((pin: ChurchPin) => {
    if (kind.value !== 'all' && pin.kind !== kind.value) return false
    if (zoneFilter.value) {
      const zoneName = zoneNameById.value.get(zoneFilter.value)
      const inZone =
        (pin.kind === 'branches' &&
          (branchRows.value ?? []).find((b: BranchSummary) => `branch:${b.id}` === pin.id)
            ?.zone === zoneFilter.value) ||
        (pin.kind === 'bscs' &&
          (bscRows.value ?? []).find((c: BscSummary) => `bsc:${c.id}` === pin.id)
            ?.zone === zoneFilter.value) ||
        (pin.kind === 'zones' && pin.id === `zone:${zoneFilter.value}`)
      if (!inZone && !(pin.kind === 'zones' && zoneName && pin.name === zoneName))
        return false
    }
    if (!term) return true
    return [pin.name, pin.code, pin.address, pin.kindLabel]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(term))
  })
})

const plottable = computed(() =>
  filtered.value.filter((p: ChurchPin) => p.lat !== null && p.lng !== null),
)
const missingGeo = computed(() =>
  filtered.value.filter((p: ChurchPin) => p.lat === null || p.lng === null),
)

const bounds = computed(() => {
  const pts = plottable.value
  if (pts.length === 0) return null
  const lats = pts.map((p: ChurchPin) => p.lat as number)
  const lngs = pts.map((p: ChurchPin) => p.lng as number)
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  }
})

function pinXY(pin: ChurchPin): { x: number; y: number } {
  const b = bounds.value
  if (!b || pin.lat === null || pin.lng === null) return { x: 50, y: 50 }
  const spanLat = Math.max(b.maxLat - b.minLat, 1e-6)
  const spanLng = Math.max(b.maxLng - b.minLng, 1e-6)
  // 8..92 inset keeps pins inside the frame; y flips (north up).
  return {
    x: 8 + ((pin.lng - b.minLng) / spanLng) * 84,
    y: 8 + ((b.maxLat - pin.lat) / spanLat) * 84,
  }
}

function pinColor(pin: ChurchPin): string {
  if (pin.isAreaHq) return '#b45309'
  if (pin.kind === 'zones') return '#1d4ed8'
  if (pin.kind === 'branches') return '#15803d'
  return '#7e22ce'
}

const selected = computed(
  () => filtered.value.find((p: ChurchPin) => p.id === selectedId.value) ?? null,
)

const kindWarnings = computed(() => {
  const warnings: Array<{ kind: string; message: string }> = []
  if (!canZones.value)
    warnings.push({ kind: 'Zones', message: 'No zones read grant for this account.' })
  else if (zoneError.value)
    warnings.push({ kind: 'Zones', message: zoneError.value.message })
  if (!canBranches.value)
    warnings.push({
      kind: 'Branches',
      message: 'No branches read grant for this account.',
    })
  else if (branchError.value)
    warnings.push({ kind: 'Branches', message: branchError.value.message })
  if (!canBscs.value)
    warnings.push({ kind: 'BSC', message: 'No BSC read grant for this account.' })
  else if (bscError.value) warnings.push({ kind: 'BSC', message: bscError.value.message })
  return warnings
})

const stripItems = computed(() => [
  {
    label: 'Shown',
    value: filtered.value.length,
    to: null,
    hint: 'Matches kind + search',
  },
  {
    label: 'On map',
    value: plottable.value.length,
    to: null,
    hint: 'Rows with coordinates',
  },
  {
    label: 'Missing geo',
    value: missingGeo.value.length,
    to: null,
    hint: 'In the data-quality strip below',
  },
])

function tooltip(pin: ChurchPin): string {
  return [pin.name, pin.kindLabel, pin.address, pin.contact].filter(Boolean).join(' · ')
}

function clearFilters(): void {
  kind.value = 'all'
  search.value = ''
  zoneFilter.value = ''
  selectedId.value = null
}
</script>

<template>
  <div>
    <PageHeader
      title="Churches"
      description="Zones, branches and Bible Study Centres in one place. Area HQ is Oke-Aro; zonal markers plot where the zone holds coordinates and are otherwise listed below — never invented."
    />

    <DashboardStrip :items="stripItems" />

    <UAlert
      v-for="warning in kindWarnings"
      :key="warning.kind"
      class="mt-3"
      color="warning"
      variant="subtle"
      :title="`${warning.kind} unavailable`"
      :description="warning.message"
    />

    <UCard class="mt-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-end">
        <div class="w-full md:w-56">
          <label for="churches-kind" class="mb-1 block text-sm font-medium">Kind</label>
          <USelectMenu
            id="churches-kind"
            v-model="kind"
            :items="[...KIND_OPTIONS]"
            value-key="value"
            label-key="label"
            aria-label="Filter by kind"
            class="w-full"
          />
        </div>
        <div class="w-full md:w-72">
          <label for="churches-zone" class="mb-1 block text-sm font-medium">Zone</label>
          <EntitySelect
            v-model="zoneFilter"
            :items="[{ label: 'All zones', value: '' }, ...zoneOptions]"
            placeholder="All zones"
            aria-label="Filter by zone"
          />
        </div>
        <div class="w-full md:flex-1">
          <label for="churches-search" class="mb-1 block text-sm font-medium"
            >Search</label
          >
          <UInput
            id="churches-search"
            v-model="search"
            icon="i-lucide-search"
            placeholder="Search name, code or address"
            aria-label="Search churches"
          />
        </div>
        <div>
          <span class="mb-1 block text-sm font-medium">View</span>
          <div class="flex gap-1" role="tablist" aria-label="List or map view">
            <UButton
              size="sm"
              :color="view === 'list' ? 'primary' : 'neutral'"
              :variant="view === 'list' ? 'solid' : 'ghost'"
              icon="i-lucide-list"
              label="List"
              role="tab"
              :aria-selected="view === 'list'"
              @click="view = 'list'"
            />
            <UButton
              size="sm"
              :color="view === 'map' ? 'primary' : 'neutral'"
              :variant="view === 'map' ? 'solid' : 'ghost'"
              icon="i-lucide-map-pin"
              label="Map"
              role="tab"
              :aria-selected="view === 'map'"
              @click="view = 'map'"
            />
          </div>
        </div>
      </div>

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="filtered.length === 0"
        title="No churches match this filter"
        description="Try another kind, zone or search term."
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            label="Clear filters"
            @click="clearFilters"
          />
        </template>
      </EmptyState>

      <template v-else>
        <!-- List view -->
        <div v-if="view === 'list'" class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <NuxtLink
            v-for="pin in filtered"
            :key="pin.id"
            :to="pin.href"
            class="rounded-lg border border-gray-200 p-4 transition hover:border-primary-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-gray-900/60"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-medium text-gray-900 dark:text-white">{{ pin.name }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ pin.code }} · {{ pin.kindLabel }}
                </p>
              </div>
              <span
                class="inline-block size-3 rounded-full"
                :style="{ backgroundColor: pinColor(pin) }"
                :aria-label="`${pin.kindLabel} marker`"
              />
            </div>
            <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">
              {{ pin.address ?? 'No address on file' }}
            </p>
            <p v-if="pin.contact" class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ pin.contact }}
            </p>
            <p v-else class="mt-1 text-xs italic text-gray-400">No contact on file</p>
          </NuxtLink>
        </div>

        <!-- Map view: schematic SVG, keyboard-reachable pins -->
        <div v-else class="mt-4">
          <div
            class="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-300"
            aria-label="Map legend"
          >
            <span class="inline-flex items-center gap-1"
              ><span
                class="inline-block size-3 rounded-full"
                style="background-color: #b45309"
              />
              Area HQ (Oke-Aro)</span
            >
            <span class="inline-flex items-center gap-1"
              ><span
                class="inline-block size-3 rounded-full"
                style="background-color: #1d4ed8"
              />
              Zonal HQ</span
            >
            <span class="inline-flex items-center gap-1"
              ><span
                class="inline-block size-3 rounded-full"
                style="background-color: #15803d"
              />
              Branch</span
            >
            <span class="inline-flex items-center gap-1"
              ><span
                class="inline-block size-3 rounded-full"
                style="background-color: #7e22ce"
              />
              BSC</span
            >
          </div>
          <svg
            viewBox="0 0 100 62"
            role="img"
            aria-label="Schematic map of churches with coordinates"
            class="mt-3 w-full rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/40"
            style="height: 320px"
          >
            <rect x="0" y="0" width="100" height="62" fill="none" />
            <g v-for="pin in plottable" :key="pin.id">
              <title>{{ tooltip(pin) }}</title>
              <circle
                :cx="pinXY(pin).x"
                :cy="(pinXY(pin).y / 100) * 62"
                r="2.2"
                :fill="pinColor(pin)"
                stroke="white"
                stroke-width="0.5"
                tabindex="0"
                role="button"
                :aria-label="`${pin.name}, ${pin.kindLabel}. ${pin.address ?? 'No address on file'}. ${pin.contact ?? 'No contact on file'}.`"
                class="cursor-pointer"
                @click="selectedId = selectedId === pin.id ? null : pin.id"
                @keydown.enter="selectedId = selectedId === pin.id ? null : pin.id"
                @keydown.space.prevent="
                  selectedId = selectedId === pin.id ? null : pin.id
                "
              />
            </g>
          </svg>
          <UCard v-if="selected" class="mt-3">
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-base font-semibold">
                  {{ selected.name }} · {{ selected.kindLabel }}
                </h2>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-x"
                  label="Close"
                  @click="selectedId = null"
                />
              </div>
            </template>
            <dl class="grid gap-1 text-sm">
              <div class="flex gap-2">
                <dt class="text-gray-500">Code</dt>
                <dd>{{ selected.code }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="text-gray-500">Address</dt>
                <dd>{{ selected.address ?? 'No address on file' }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="text-gray-500">Contact</dt>
                <dd>{{ selected.contact ?? 'No contact on file' }}</dd>
              </div>
            </dl>
            <NuxtLink
              :to="selected.href"
              class="mt-3 inline-block text-sm text-primary-600 underline hover:text-primary-700"
            >
              Open {{ selected.kindLabel.toLowerCase() }} record
            </NuxtLink>
          </UCard>
        </div>

        <!-- Data-quality strip: never plotted at 0,0, always listed -->
        <div
          v-if="missingGeo.length > 0"
          class="mt-6 rounded-lg border border-dashed border-gray-300 p-4 dark:border-gray-700"
        >
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
            {{ missingGeo.length }} {{ missingGeo.length === 1 ? 'row' : 'rows' }} without
            coordinates
          </h2>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            These rows are listed, never plotted at 0,0. Zones without coordinates have no
            HQ designated — coordinates are not invented. An admin can add geo data on the
            record.
          </p>
          <ul class="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            <li
              v-for="pin in missingGeo"
              :key="pin.id"
              class="flex items-center justify-between gap-2"
            >
              <span
                >{{ pin.name }}
                <span class="text-xs text-gray-500"
                  >({{ pin.code }} · {{ pin.kindLabel }})</span
                ></span
              >
              <NuxtLink
                :to="pin.href"
                class="text-xs text-primary-600 underline hover:text-primary-700"
                >Open</NuxtLink
              >
            </li>
          </ul>
        </div>
      </template>
    </UCard>
  </div>
</template>
