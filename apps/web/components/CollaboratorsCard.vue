<script setup lang="ts">
/**
 * Collaborators manager (AFC-880): per-event delegation with per-area
 * grants. Lists current collaborators (person + area badges), adds one by
 * searching staff with area checkboxes, removes with confirm. Gated on
 * events update — only someone who can edit the whole programme may
 * delegate parts of it. Enforcement lives server-side on every write
 * route; this card is the assignment surface only.
 */
interface Props {
  eventId: string
  canManage: boolean
}

const props = defineProps<Props>()

const api = useApi()

interface CollaboratorRow {
  id: string
  person: string
  person_name: string | null
  areas: string[]
}

const AREAS = [
  { value: 'details', label: 'Details' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'speakers', label: 'Speakers' },
  { value: 'resources', label: 'Resources' },
  { value: 'budget', label: 'Budget' },
  { value: 'registration', label: 'Registration' },
] as const

const rows = ref<CollaboratorRow[]>([])
const pending = ref(false)
const error = ref('')
const search = ref('')
const searchResults = ref<Array<{ id: string; label: string }>>([])
const searchPending = ref(false)
const picked = ref<{ id: string; label: string } | null>(null)
const pickedAreas = ref<string[]>(['details'])
const saving = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

async function loadCollaborators(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: CollaboratorRow[] }>(
      `/api/events/${props.eventId}/collaborators`,
    )
    rows.value = res.data ?? []
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not load collaborators'
  } finally {
    pending.value = false
  }
}

watch(search, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(value.trim()), 300)
})

async function runSearch(term: string): Promise<void> {
  searchResults.value = []
  picked.value = null
  if (term.length < 2) return
  searchPending.value = true
  try {
    const res = await api.get<{ data: Array<Record<string, unknown>> }>('/api/people', {
      query: { search: term, limit: 8, status: 'active' },
    })
    searchResults.value = (res.data ?? []).map((row) => ({
      id: String(row.id),
      label: String(
        row.preferred_name ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Someone',
      ),
    }))
  } catch {
    searchResults.value = []
  } finally {
    searchPending.value = false
  }
}

function toggleArea(area: string): void {
  pickedAreas.value = pickedAreas.value.includes(area)
    ? pickedAreas.value.filter((entry: string) => entry !== area)
    : [...pickedAreas.value, area]
}

async function addCollaborator(): Promise<void> {
  if (!picked.value || pickedAreas.value.length === 0) return
  saving.value = true
  error.value = ''
  try {
    await api.post(`/api/events/${props.eventId}/collaborators`, {
      person: picked.value.id,
      areas: pickedAreas.value,
    })
    search.value = ''
    searchResults.value = []
    picked.value = null
    pickedAreas.value = ['details']
    await loadCollaborators()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not add collaborator'
  } finally {
    saving.value = false
  }
}

async function removeCollaborator(id: string): Promise<void> {
  saving.value = true
  error.value = ''
  try {
    await api.remove(`/api/events/${props.eventId}/collaborators/${id}`)
    await loadCollaborators()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not remove collaborator'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadCollaborators()
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold">Collaborators</h2>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {{ rows.length }} {{ rows.length === 1 ? 'person' : 'people' }}
        </span>
      </div>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        People who can change parts of this programme without full edit rights. Tick only
        the areas each person may change.
      </p>
    </template>

    <p v-if="pending" class="py-4 text-center text-sm text-gray-500">
      Loading collaborators…
    </p>
    <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
    <div v-else-if="rows.length === 0">
      <EmptyState
        title="No collaborators yet"
        description="Add branch staff here to let them edit scheduled parts of this programme."
      />
    </div>
    <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex flex-wrap items-center gap-2 py-2"
      >
        <span class="text-sm font-medium">{{ row.person_name ?? 'Someone' }}</span>
        <span class="flex flex-wrap gap-1">
          <UBadge
            v-for="area in row.areas"
            :key="area"
            color="neutral"
            variant="subtle"
            class="capitalize"
          >
            {{ area }}
          </UBadge>
        </span>
        <UButton
          v-if="canManage"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-unlink"
          aria-label="Remove collaborator"
          :loading="saving"
          @click="removeCollaborator(row.id)"
        />
      </li>
    </ul>

    <div v-if="canManage" class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Type at least two letters of a name"
        aria-label="Search staff to add"
      />
      <ul
        v-if="searchResults.length > 0"
        class="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800"
      >
        <li v-for="person in searchResults" :key="person.id">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            class="w-full justify-start"
            :label="person.label"
            @click="picked = person"
          />
        </li>
      </ul>
      <div
        v-if="picked"
        class="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
      >
        <p class="text-sm">
          Adding <strong>{{ picked.label }}</strong> — tick what they may change:
        </p>
        <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <label
            v-for="area in AREAS"
            :key="area.value"
            class="inline-flex cursor-pointer items-center gap-1.5 text-sm"
          >
            <input
              type="checkbox"
              :checked="pickedAreas.includes(area.value)"
              class="size-3.5 accent-primary-600"
              @change="toggleArea(area.value)"
            />
            {{ area.label }}
          </label>
        </div>
        <UButton
          class="mt-3"
          size="sm"
          label="Add collaborator"
          icon="i-lucide-plus"
          :loading="saving"
          :disabled="pickedAreas.length === 0"
          @click="addCollaborator"
        />
      </div>
    </div>
  </UCard>
</template>
