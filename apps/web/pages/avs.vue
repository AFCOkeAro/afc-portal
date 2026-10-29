<script setup lang="ts">
import {
  COLLECTIONS,
  OUTREACH_LOCATION_CATEGORIES,
  OUTREACH_LOCATION_OWNERSHIP,
} from '@afc/shared'

/**
 * AVS — outreach mission fields (AFC-841) with AFC-900 tabs.
 *
 * Bible Study Centres are the wrong register for this surface (and /bscs
 * has no index page), so AVS lists mission fields — schools
 * (primary/secondary, private or government), prisons, skills centres,
 * hospitals and other fields — each with its contact person and visiting
 * days. Two tabs share the one page: Outreach List (the visited-locations
 * register — not the /visitors newcomer route) and Secretaries (the AVS
 * secretary assignment surface — not the departments register). Tab is
 * `?tab=` so each tab deep-links (events detail precedent). Data paths
 * are unchanged: GET /api/outreach-locations plus the scoped secretary
 * junction endpoints.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()
const router = useRouter()
const { branchOptions } = useBranchOptions()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

const TABS = [
  { id: 'locations', label: 'Outreach List', icon: 'i-lucide-list-plus' },
  { id: 'secretaries', label: 'Secretaries', icon: 'i-lucide-clipboard-list' },
] as const

type TabId = (typeof TABS)[number]['id']

const tab = computed<TabId>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return TABS.some((entry) => entry.id === value) ? (value as TabId) : 'locations'
})

function goTab(next: TabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

interface OutreachLocation {
  id: string
  branch: string | null
  name: string
  category: string
  address: string | null
  ownership: string
  contact_name: string | null
  contact_phone: string | null
  visiting_days: string | null
  notes: string | null
}

interface SecretaryAssignment {
  id: string
  person: string | null
  name: string | null
}

const canManage = computed(() => permissions.can(COLLECTIONS.outreachLocations, 'create'))

const CATEGORY_LABELS: Record<string, string> = {
  primary_school: 'Primary school',
  secondary_school: 'Secondary school',
  prison: 'Prison',
  skills_centre: 'Skills centre',
  hospital: 'Hospital',
  other: 'Other',
}

const categoryFilter = ref('all')
const locations = ref<OutreachLocation[]>([])
const locationsPending = ref(false)
const locationsError = ref('')
const openLocation = ref<string | null>(null)
const assignments = ref<Record<string, SecretaryAssignment[]>>({})
const newLocation = ref({
  branch: '',
  name: '',
  category: 'primary_school',
  address: '',
  ownership: 'private',
  contact_name: '',
  contact_phone: '',
  visiting_days: '',
})
const locationSaving = ref(false)
const locationError = ref('')
const assignPerson = ref<Record<string, string>>({})
const assignSaving = ref(false)
const assignError = ref('')
const secretaryLocationId = ref('')

const categoryItems = computed(() => [
  { label: 'All categories', value: 'all' },
  ...OUTREACH_LOCATION_CATEGORIES.map((category: string) => ({
    label: CATEGORY_LABELS[category] ?? category,
    value: category,
  })),
])

const secretaryLocationOptions = computed(() =>
  locations.value.map((location: OutreachLocation) => ({
    label: location.name,
    value: location.id,
  })),
)

const secretaryLocation = computed(
  () =>
    locations.value.find(
      (location: OutreachLocation) => location.id === secretaryLocationId.value,
    ) ?? null,
)

const secretaryRows = computed(() => assignments.value[secretaryLocationId.value] ?? [])

async function loadLocations(): Promise<void> {
  locationsPending.value = true
  locationsError.value = ''
  try {
    const res = await api.get<{ data: OutreachLocation[] }>('/api/outreach-locations', {
      query: categoryFilter.value === 'all' ? {} : { category: categoryFilter.value },
    })
    locations.value = res.data ?? []
  } catch (cause) {
    locationsError.value =
      (cause as { message?: string }).message ?? 'Could not load locations'
  } finally {
    locationsPending.value = false
  }
}

async function toggleLocation(id: string): Promise<void> {
  openLocation.value = openLocation.value === id ? null : id
  if (openLocation.value === id && !assignments.value[id]) await loadAssignments(id)
}

async function loadAssignments(id: string): Promise<void> {
  try {
    const res = await api.get<{ data: { secretaries: SecretaryAssignment[] } }>(
      `/api/outreach-locations/${id}`,
    )
    assignments.value = { ...assignments.value, [id]: res.data.secretaries ?? [] }
  } catch (cause) {
    assignError.value =
      (cause as { message?: string }).message ?? 'Could not load secretaries'
  }
}

async function createLocation(): Promise<void> {
  if (newLocation.value.name.trim() === '') {
    locationError.value = 'Name the location.'
    return
  }
  locationSaving.value = true
  locationError.value = ''
  try {
    await api.post('/api/outreach-locations', {
      ...(newLocation.value.branch === '' ? {} : { branch: newLocation.value.branch }),
      name: newLocation.value.name.trim(),
      category: newLocation.value.category,
      ...(newLocation.value.address.trim() === ''
        ? {}
        : { address: newLocation.value.address.trim() }),
      ownership: newLocation.value.ownership,
      ...(newLocation.value.contact_name.trim() === ''
        ? {}
        : { contact_name: newLocation.value.contact_name.trim() }),
      ...(newLocation.value.contact_phone.trim() === ''
        ? {}
        : { contact_phone: newLocation.value.contact_phone.trim() }),
      ...(newLocation.value.visiting_days.trim() === ''
        ? {}
        : { visiting_days: newLocation.value.visiting_days.trim() }),
    })
    newLocation.value = {
      branch: '',
      name: '',
      category: 'primary_school',
      address: '',
      ownership: 'private',
      contact_name: '',
      contact_phone: '',
      visiting_days: '',
    }
    await loadLocations()
  } catch (cause) {
    locationError.value =
      (cause as { message?: string }).message ?? 'Could not add the location'
  } finally {
    locationSaving.value = false
  }
}

async function assignSecretary(locationId: string): Promise<void> {
  const person = assignPerson.value[locationId] ?? ''
  if (person === '') {
    assignError.value = 'Choose the secretary to assign.'
    return
  }
  assignSaving.value = true
  assignError.value = ''
  try {
    await api.post(`/api/outreach-locations/${locationId}/secretaries`, { person })
    assignPerson.value = { ...assignPerson.value, [locationId]: '' }
    await loadAssignments(locationId)
  } catch (cause) {
    assignError.value =
      (cause as { message?: string }).message ?? 'Could not assign the secretary'
  } finally {
    assignSaving.value = false
  }
}

async function unassignSecretary(
  locationId: string,
  person: string | null,
): Promise<void> {
  if (!person) return
  assignError.value = ''
  try {
    await api.remove(`/api/outreach-locations/${locationId}/secretaries`, {
      query: { person },
    })
    await loadAssignments(locationId)
  } catch (cause) {
    assignError.value =
      (cause as { message?: string }).message ?? 'Could not unassign the secretary'
  }
}

function manageSecretaries(id: string): void {
  secretaryLocationId.value = id
  goTab('secretaries')
}

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category
}

function secretaryNames(id: string): string {
  const rows = assignments.value[id] ?? []
  if (rows.length === 0) return 'No secretary assigned yet.'
  return rows.map((row: SecretaryAssignment) => row.name ?? 'Unknown').join(', ')
}

onMounted(() => {
  void loadLocations()
})

watch(categoryFilter, () => {
  void loadLocations()
})

watch(
  locations,
  (rows: OutreachLocation[]) => {
    if (secretaryLocationId.value === '' && rows.length > 0) {
      secretaryLocationId.value = rows[0]?.id ?? ''
    }
    if (
      secretaryLocationId.value !== '' &&
      !rows.some((row: OutreachLocation) => row.id === secretaryLocationId.value)
    ) {
      secretaryLocationId.value = rows[0]?.id ?? ''
    }
  },
  { immediate: true },
)

watch(secretaryLocationId, (id: string) => {
  if (id !== '' && !assignments.value[id]) void loadAssignments(id)
})
</script>

<template>
  <div>
    <PageHeader
      title="AVS"
      description="Outreach mission fields — the Outreach List of visited locations plus their assigned secretaries."
    />
    <nav aria-label="AVS sections" class="mt-4">
      <div
        class="flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
      >
        <button
          v-for="entry in TABS"
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

    <!-- OUTREACH LIST: the visited-locations register (not /visitors). -->
    <section v-if="tab === 'locations'" aria-label="Outreach List" class="mt-4">
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Category" class="w-52">
          <USelect v-model="categoryFilter" :items="categoryItems" class="w-full" />
        </UFormField>
      </div>
      <p v-if="locationsPending" class="mt-3 text-sm text-gray-500">Loading locations…</p>
      <p v-else-if="locationsError !== ''" class="mt-3 text-sm text-red-600">
        {{ locationsError }}
      </p>
      <div v-else-if="locations.length === 0" class="mt-3">
        <UCard>
          <EmptyState
            title="No outreach locations yet"
            description="Add the first mission field — a school, prison, skills centre or hospital."
          />
        </UCard>
      </div>
      <div v-else class="mt-3 space-y-3">
        <UCard v-for="location in locations" :key="location.id">
          <template #header>
            <button
              type="button"
              class="flex w-full items-center gap-2 text-left"
              @click="toggleLocation(location.id)"
            >
              <span class="font-semibold">{{ location.name }}</span>
              <UBadge color="neutral" variant="subtle">{{
                categoryLabel(location.category)
              }}</UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ location.ownership === 'public' ? 'Government' : 'Private' }}
              </UBadge>
              <UIcon
                :name="
                  openLocation === location.id
                    ? 'i-lucide-chevron-up'
                    : 'i-lucide-chevron-down'
                "
                class="ml-auto size-4 text-gray-400"
              />
            </button>
          </template>
          <div v-if="openLocation === location.id" class="text-sm">
            <p v-if="location.address" class="text-gray-600">{{ location.address }}</p>
            <p v-if="location.contact_name || location.contact_phone" class="mt-1">
              Contact: {{ location.contact_name ?? '—' }}
              <span v-if="location.contact_phone">· {{ location.contact_phone }}</span>
            </p>
            <p v-if="location.visiting_days" class="mt-1 text-gray-600">
              Visiting days: {{ location.visiting_days }}
            </p>
            <p class="mt-2 text-gray-600">
              Secretaries: {{ secretaryNames(location.id) }}
            </p>
            <UButton
              class="mt-2"
              size="sm"
              color="neutral"
              variant="outline"
              icon="i-lucide-clipboard-list"
              label="Manage secretaries"
              @click="manageSecretaries(location.id)"
            />
          </div>
        </UCard>
      </div>
      <UCard v-if="canManage" class="mt-4">
        <template #header>
          <h3 class="font-semibold">Add a location</h3>
        </template>
        <div class="grid gap-2 sm:grid-cols-2">
          <UFormField label="Name" class="sm:col-span-2">
            <UInput
              v-model="newLocation.name"
              placeholder="e.g. St Mary Primary School"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Category">
            <USelect
              v-model="newLocation.category"
              :items="
                OUTREACH_LOCATION_CATEGORIES.map((category: string) => ({
                  label: categoryLabel(category),
                  value: category,
                }))
              "
              class="w-full"
            />
          </UFormField>
          <UFormField label="Type">
            <USelect
              v-model="newLocation.ownership"
              :items="
                OUTREACH_LOCATION_OWNERSHIP.map((ownership: string) => ({
                  label: ownership === 'public' ? 'Government (public)' : 'Private',
                  value: ownership,
                }))
              "
              class="w-full"
            />
          </UFormField>
          <UFormField label="Branch">
            <USelect
              v-model="newLocation.branch"
              :items="branchOptions"
              placeholder="Area-wide"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Visiting days">
            <UInput
              v-model="newLocation.visiting_days"
              placeholder="e.g. Tuesdays and Thursdays"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Contact name">
            <UInput
              v-model="newLocation.contact_name"
              placeholder="e.g. Mrs Ade"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Contact phone">
            <UInput
              v-model="newLocation.contact_phone"
              placeholder="e.g. 0803…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Address" class="sm:col-span-2">
            <UInput
              v-model="newLocation.address"
              placeholder="Street address"
              class="w-full"
            />
          </UFormField>
        </div>
        <UButton
          class="mt-3"
          label="Add location"
          icon="i-lucide-plus"
          :loading="locationSaving"
          @click="createLocation"
        />
        <p v-if="locationError !== ''" class="mt-2 text-sm text-red-600">
          {{ locationError }}
        </p>
      </UCard>
    </section>

    <!-- SECRETARIES: AVS secretary assignment (not the departments register). -->
    <section v-else aria-label="Secretaries" class="mt-4">
      <UCard>
        <template #header>
          <h3 class="font-semibold">Secretaries</h3>
        </template>
        <p v-if="locationsPending" class="text-sm text-gray-500">Loading locations…</p>
        <p v-else-if="locations.length === 0" class="text-sm text-gray-500">
          Add a location on the Outreach List tab first, then assign its secretaries here.
        </p>
        <div v-else>
          <UFormField label="Location" class="max-w-md">
            <USelect
              v-model="secretaryLocationId"
              :items="secretaryLocationOptions"
              class="w-full"
            />
          </UFormField>
          <div v-if="secretaryLocation" class="mt-3 text-sm">
            <p v-if="secretaryLocation.contact_name || secretaryLocation.contact_phone">
              Contact: {{ secretaryLocation.contact_name ?? '—' }}
              <span v-if="secretaryLocation.contact_phone">
                · {{ secretaryLocation.contact_phone }}
              </span>
            </p>
            <p v-if="secretaryLocation.visiting_days" class="mt-1 text-gray-600">
              Visiting days: {{ secretaryLocation.visiting_days }}
            </p>
            <ul v-if="secretaryRows.length > 0" class="mt-3 space-y-1.5">
              <li
                v-for="row in secretaryRows"
                :key="row.id"
                class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-900"
              >
                <span class="min-w-0 flex-1 truncate">{{ row.name ?? 'Unknown' }}</span>
                <UButton
                  v-if="canManage"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Unassign ${row.name}`"
                  @click="unassignSecretary(secretaryLocationId, row.person)"
                />
              </li>
            </ul>
            <p v-else class="mt-3 text-gray-500">No secretary assigned yet.</p>
            <div v-if="canManage" class="mt-2 flex max-w-xl flex-wrap items-end gap-2">
              <UFormField label="Secretary" class="min-w-52 flex-1">
                <EntitySelect
                  v-model="assignPerson[secretaryLocationId]"
                  :items="personOptions"
                  placeholder="Type a name to search…"
                  :loading="personPending"
                  server-search
                  class="w-full"
                  @update:search-term="onPersonSearch"
                />
              </UFormField>
              <UButton
                label="Assign"
                icon="i-lucide-user-plus"
                :loading="assignSaving"
                @click="assignSecretary(secretaryLocationId)"
              />
            </div>
          </div>
        </div>
      </UCard>
      <p v-if="assignError !== ''" class="mt-3 text-sm text-red-600">{{ assignError }}</p>
    </section>
  </div>
</template>
