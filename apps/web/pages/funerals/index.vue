<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Funerals under Family (AFC-884): the household's farewell register.
 * Lists cases with stage + funeral date; opening one records the paper
 * trail, the music-director programme approval, both days and attendance.
 *
 * Tabbed sub-menu (AFC-899, AFC-1024): one Family sidebar entry, four
 * tabs on this page — Cases (the list + new-case modal below, default),
 * Paper trail, Programme, Dates & attendance. The per-case detail page
 * keeps its own tabs (overview/papers/programme/dates); the tabs here
 * reuse the same list rows and link into the case tabs, so no new
 * registers or endpoints.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()

const TABS = [
  { id: 'cases', label: 'Cases' },
  { id: 'papers', label: 'Paper trail' },
  { id: 'programme', label: 'Programme' },
  { id: 'dates', label: 'Dates & attendance' },
] as const

type IndexTabId = (typeof TABS)[number]['id']

const tab = computed<IndexTabId>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return (TABS as readonly { id: string }[]).some((entry) => entry.id === value)
    ? (value as IndexTabId)
    : 'cases'
})

function goTab(next: IndexTabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

interface FuneralRow {
  id: string
  deceased_display: string
  stage: string
  funeral_date: string | null
  service_of_songs_date: string | null
}

const rows = ref<FuneralRow[]>([])
const pending = ref(false)
const error = ref('')
const showNew = ref(false)
const saving = ref(false)
const formError = ref('')

const form = ref({
  deceased_name: '',
  person: '',
  branch: '',
  funeral_date: '',
  service_of_songs_date: '',
})
const branches = ref<Array<{ id: string; name: string }>>([])
const personSearch = ref('')
const personResults = ref<Array<{ id: string; label: string }>>([])
const personPending = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

function stageLabel(stage: string): string {
  return stage.replace(/_/g, ' ')
}

async function loadFunerals(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: FuneralRow[] }>('/api/funerals')
    rows.value = res.data ?? []
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not load funerals'
  } finally {
    pending.value = false
  }
}

async function loadBranches(): Promise<void> {
  try {
    const res = await api.get<{ data: Array<{ id: string; name: string }> }>(
      '/api/branches',
    )
    branches.value = (res.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }))
  } catch {
    branches.value = []
  }
}

watch(personSearch, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void searchPeople(value.trim()), 300)
})

const branchOptions = computed(() => [
  { label: 'My branch', value: '' },
  ...branches.value.map((row: { id: string; name: string }) => ({
    label: row.name,
    value: row.id,
  })),
])

async function searchPeople(term: string): Promise<void> {
  personResults.value = []
  if (term.length < 2) return
  personPending.value = true
  try {
    const res = await api.get<{ data: Array<Record<string, unknown>> }>('/api/people', {
      query: { search: term, limit: 8, status: 'active' },
    })
    personResults.value = (res.data ?? []).map((row) => ({
      id: String(row.id),
      label: String(
        row.preferred_name ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          'Someone',
      ),
    }))
  } catch {
    personResults.value = []
  } finally {
    personPending.value = false
  }
}

function pickPerson(id: string, label: string): void {
  form.value.person = id
  form.value.deceased_name = label
  personResults.value = []
  personSearch.value = ''
}

async function createFuneral(): Promise<void> {
  saving.value = true
  formError.value = ''
  try {
    await api.post('/api/funerals', {
      ...(form.value.branch === '' ? {} : { branch: form.value.branch }),
      ...(form.value.person === '' ? {} : { deceased_person: form.value.person }),
      ...(form.value.person === '' && form.value.deceased_name.trim() !== ''
        ? { deceased_name: form.value.deceased_name.trim() }
        : {}),
      ...(form.value.service_of_songs_date === ''
        ? {}
        : { service_of_songs_date: form.value.service_of_songs_date }),
      ...(form.value.funeral_date === ''
        ? {}
        : { funeral_date: form.value.funeral_date }),
    })
    showNew.value = false
    form.value = {
      deceased_name: '',
      person: '',
      branch: '',
      funeral_date: '',
      service_of_songs_date: '',
    }
    await loadFunerals()
  } catch (cause) {
    formError.value =
      (cause as { message?: string }).message ?? 'Could not open the funeral case'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadFunerals()
  void loadBranches()
})
</script>

<template>
  <div>
    <PageHeader
      title="Funerals"
      description="Farewell records for the family: paper trail, programme approval, both days."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.funeralCases" action="create">
          <UButton label="New funeral" icon="i-lucide-plus" @click="showNew = true" />
        </PermissionGate>
      </template>
    </PageHeader>

    <div class="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Funeral sections">
      <UButton
        v-for="entry in TABS"
        :key="entry.id"
        size="sm"
        :color="tab === entry.id ? 'primary' : 'neutral'"
        :variant="tab === entry.id ? 'solid' : 'ghost'"
        :label="entry.label"
        :aria-selected="tab === entry.id"
        role="tab"
        @click="goTab(entry.id)"
      />
    </div>

    <section v-if="tab === 'cases'" aria-label="Cases">
      <p v-if="pending" class="py-8 text-center text-sm text-gray-500">
        Loading funerals…
      </p>
      <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
      <EmptyState
        v-else-if="rows.length === 0"
        title="No funerals recorded"
        description="Open a case when a family reports a passing. The paper trail and programme approval live inside the case."
      />
      <ul v-else class="space-y-2">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
        >
          <NuxtLink
            :to="`/funerals/${row.id}`"
            class="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ row.deceased_display }}
          </NuxtLink>
          <UBadge color="neutral" variant="subtle" class="capitalize">{{
            stageLabel(row.stage)
          }}</UBadge>
          <span v-if="row.funeral_date" class="text-xs text-gray-500 dark:text-gray-400">
            {{ row.funeral_date }}
          </span>
        </li>
      </ul>
    </section>

    <section v-if="tab === 'papers'" aria-label="Paper trail">
      <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Checklist + uploads (death certificate, family consent letter) live inside each
        case. Approval needs both documents plus at least one song.
      </p>
      <p v-if="pending" class="py-8 text-center text-sm text-gray-500">
        Loading funerals…
      </p>
      <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
      <EmptyState
        v-else-if="rows.length === 0"
        title="No funerals recorded"
        description="Open a case when a family reports a passing, then file its paper trail inside the case."
      />
      <ul v-else class="space-y-2">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
        >
          <NuxtLink
            :to="`/funerals/${row.id}?tab=papers`"
            class="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ row.deceased_display }}
          </NuxtLink>
          <UBadge color="neutral" variant="subtle" class="capitalize">{{
            stageLabel(row.stage)
          }}</UBadge>
        </li>
      </ul>
    </section>

    <section v-if="tab === 'programme'" aria-label="Programme">
      <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Songs for the service of songs and the funeral, approved by the music director.
        Uploading a document to an approved programme sends it back for re-approval.
      </p>
      <p v-if="pending" class="py-8 text-center text-sm text-gray-500">
        Loading funerals…
      </p>
      <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
      <EmptyState
        v-else-if="rows.length === 0"
        title="No funerals recorded"
        description="Open a case when a family reports a passing, then build its programme inside the case."
      />
      <ul v-else class="space-y-2">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
        >
          <NuxtLink
            :to="`/funerals/${row.id}?tab=programme`"
            class="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ row.deceased_display }}
          </NuxtLink>
          <UBadge color="neutral" variant="subtle" class="capitalize">{{
            stageLabel(row.stage)
          }}</UBadge>
        </li>
      </ul>
    </section>

    <section v-if="tab === 'dates'" aria-label="Dates and attendance">
      <p class="mb-3 text-sm text-gray-500 dark:text-gray-400">
        Both days per case; headcounts are recorded inside the case.
      </p>
      <p v-if="pending" class="py-8 text-center text-sm text-gray-500">
        Loading funerals…
      </p>
      <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
      <EmptyState
        v-else-if="rows.length === 0"
        title="No funerals recorded"
        description="Open a case when a family reports a passing, then set both days inside the case."
      />
      <ul v-else class="space-y-2">
        <li
          v-for="row in rows"
          :key="row.id"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
        >
          <NuxtLink
            :to="`/funerals/${row.id}?tab=dates`"
            class="min-w-0 flex-1 truncate font-medium text-gray-900 hover:text-primary-600 dark:text-white"
          >
            {{ row.deceased_display }}
          </NuxtLink>
          <span
            v-if="row.service_of_songs_date"
            class="text-xs text-gray-500 dark:text-gray-400"
          >
            Songs: {{ row.service_of_songs_date }}
          </span>
          <span v-if="row.funeral_date" class="text-xs text-gray-500 dark:text-gray-400">
            Funeral: {{ row.funeral_date }}
          </span>
        </li>
      </ul>
    </section>

    <UModal v-model:open="showNew" title="Open a funeral case">
      <template #body>
        <div class="space-y-3">
          <UFormField label="Link a person (flips their status to deceased)">
            <UInput
              v-model="personSearch"
              placeholder="Type at least two letters of a name"
              aria-label="Search people to link"
            />
            <ul
              v-if="personResults.length > 0"
              class="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800"
            >
              <li v-for="person in personResults" :key="person.id">
                <UButton
                  variant="ghost"
                  color="neutral"
                  size="sm"
                  class="w-full justify-start"
                  :label="person.label"
                  @click="pickPerson(person.id, person.label)"
                />
              </li>
            </ul>
            <p v-if="form.person !== ''" class="mt-1 text-xs text-gray-500">
              Linked — the register flips to deceased on save.
            </p>
          </UFormField>
          <UFormField label="Or name the deceased (not in the register)">
            <UInput v-model="form.deceased_name" placeholder="Full name" />
          </UFormField>
          <UFormField label="Branch">
            <USelect v-model="form.branch" :items="branchOptions" />
          </UFormField>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Service of songs date">
              <UInput v-model="form.service_of_songs_date" type="date" />
            </UFormField>
            <UFormField label="Funeral date">
              <UInput v-model="form.funeral_date" type="date" />
            </UFormField>
          </div>
          <p v-if="formError !== ''" class="text-sm text-red-600">{{ formError }}</p>
        </div>
      </template>
      <template #footer>
        <UButton
          label="Open case"
          icon="i-lucide-plus"
          :loading="saving"
          @click="createFuneral"
        />
      </template>
    </UModal>
  </div>
</template>
