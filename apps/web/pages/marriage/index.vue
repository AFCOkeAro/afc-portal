<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Single Marriage section (AFC-898): matters, the pipeline and the conducted
 * report are one subject, so they share this page as tabs. The tab is
 * `?tab=` so each surface deep-links (events-detail precedent). The old
 * /marriage-cases and /marriage-cases/report routes stay as deep-link
 * redirects into their tab. No new registers; pipeline stages and report
 * queries are unchanged — the three surfaces below moved here verbatim.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()
const permissions = usePermissions()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

type MarriageTab = 'matters' | 'pipeline' | 'report'

const MARRIAGE_TABS: readonly { id: MarriageTab; label: string; icon: string }[] = [
  { id: 'matters', label: 'Matters', icon: 'i-lucide-heart' },
  { id: 'pipeline', label: 'Pipeline', icon: 'i-lucide-heart-handshake' },
  { id: 'report', label: 'Report', icon: 'i-lucide-scroll-text' },
]

const canMatters = computed(() => permissions.can(COLLECTIONS.marriageMatters, 'read'))
const canCases = computed(() => permissions.can(COLLECTIONS.marriageCases, 'read'))

const shownTabs = computed(() =>
  MARRIAGE_TABS.filter((entry: (typeof MARRIAGE_TABS)[number]) =>
    entry.id === 'matters' ? canMatters.value : canCases.value,
  ),
)

const tab = computed<MarriageTab>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  if (shownTabs.value.some((entry: (typeof MARRIAGE_TABS)[number]) => entry.id === value))
    return value as MarriageTab
  return shownTabs.value[0]?.id ?? 'matters'
})

function goTab(next: MarriageTab): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

/* Matters surface (moved verbatim from the standalone matters page). */
const matterShowForm = ref(false)
/** AFC-897: the Forms hub links here with ?new=1 to open the create form directly. */
onMounted(() => {
  if (route.query.new !== undefined) matterShowForm.value = true
})
const matterForm = ref({
  person: '',
  branch: '',
  matter_type: 'wedding',
  wedding_date: '',
  notes: '',
})
const matterError = ref('')

const {
  data: matterData,
  pending: matterPending,
  refresh: matterRefresh,
} = await useAsyncData('marriage-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/marriage'),
)

async function createMatter() {
  matterError.value = ''
  try {
    await api.post('/api/marriage', {
      person: matterForm.value.person,
      ...(matterForm.value.branch ? { branch: matterForm.value.branch } : {}),
      matter_type: matterForm.value.matter_type,
      ...(matterForm.value.wedding_date
        ? { wedding_date: matterForm.value.wedding_date }
        : {}),
      ...(matterForm.value.notes ? { notes: matterForm.value.notes } : {}),
    })
    matterShowForm.value = false
    matterForm.value = {
      person: '',
      branch: '',
      matter_type: 'wedding',
      wedding_date: '',
      notes: '',
    }
    await matterRefresh()
  } catch (cause) {
    matterError.value =
      (cause as { message?: string }).message ?? 'Could not record the matter'
  }
}

const matterTypeOptions = [
  { label: 'Banns', value: 'banns' },
  { label: 'Wedding', value: 'wedding' },
  { label: 'Counselling', value: 'counselling' },
  { label: 'Other', value: 'other' },
]

const matterRows = computed(() => matterData.value?.data ?? [])

/** Dashboard strip (AFC-588): no server filters — display-only total, no new backend. */
const matterStripItems = computed(() => [
  { label: 'Matters', value: matterRows.value.length, to: null, hint: 'Total in view' },
])

/* Pipeline surface (moved verbatim from the standalone pipeline page). */
const caseShowForm = ref(false)
const caseForm = ref({
  brother_person: '',
  sister_person: '',
  branch: '',
  wedding_date: '',
  notes: '',
})
const caseError = ref('')

const {
  data: caseData,
  pending: casePending,
  refresh: caseRefresh,
} = await useAsyncData('marriage-cases-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/marriage-cases'),
)

async function createCase() {
  caseError.value = ''
  try {
    await api.post('/api/marriage-cases', {
      brother_person: caseForm.value.brother_person,
      ...(caseForm.value.sister_person
        ? { sister_person: caseForm.value.sister_person }
        : {}),
      ...(caseForm.value.branch ? { branch: caseForm.value.branch } : {}),
      ...(caseForm.value.wedding_date
        ? { wedding_date: caseForm.value.wedding_date }
        : {}),
      ...(caseForm.value.notes ? { notes: caseForm.value.notes } : {}),
    })
    caseShowForm.value = false
    caseForm.value = {
      brother_person: '',
      sister_person: '',
      branch: '',
      wedding_date: '',
      notes: '',
    }
    await caseRefresh()
  } catch (cause) {
    caseError.value = (cause as { message?: string }).message ?? 'Could not open the case'
  }
}

const caseRows = computed(() => caseData.value?.data ?? [])

/* Report surface (moved verbatim from the standalone report page). */
const {
  data: reportData,
  pending: reportPending,
  error: reportError,
  refresh: reportRefresh,
} = await useAsyncData('marriage-cases-report', () =>
  api.get<{
    data: Record<string, unknown>[]
    meta: { total: number; page: number; limit: number }
  }>('/api/marriage-cases/report', { query: { limit: 100 } }),
)

const reportRows = computed(() => reportData.value?.data ?? [])
const reportTotal = computed(
  () => reportData.value?.meta.total ?? reportRows.value.length,
)
</script>

<template>
  <div>
    <PageHeader
      title="Marriage"
      description="Matters, the pipeline and conducted marriages in one place."
    >
      <template #actions>
        <PermissionGate
          v-if="tab === 'matters'"
          :collection="COLLECTIONS.marriageMatters"
          action="create"
        >
          <UButton
            label="Record matter"
            icon="i-lucide-plus"
            @click="matterShowForm = !matterShowForm"
          />
        </PermissionGate>
        <PermissionGate
          v-if="tab === 'pipeline'"
          :collection="COLLECTIONS.marriageCases"
          action="create"
        >
          <UButton
            label="Open case"
            icon="i-lucide-plus"
            @click="caseShowForm = !caseShowForm"
          />
        </PermissionGate>
        <UButton
          v-if="tab === 'report'"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Refresh"
          @click="reportRefresh()"
        />
      </template>
    </PageHeader>

    <nav aria-label="Marriage sections" class="mt-4">
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

    <!-- MATTERS -->
    <section v-if="tab === 'matters'" aria-label="Marriage matters" class="mt-4">
      <DashboardStrip :items="matterStripItems" />

      <UCard v-if="matterShowForm" class="mb-4">
        <template #header>
          <h2 class="font-semibold">New matter</h2>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Person">
            <EntitySelect
              v-model="matterForm.person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
          <UFormField label="Branch">
            <EntitySelect
              v-model="matterForm.branch"
              :items="branchOptions"
              placeholder="Select branch…"
              :loading="branchesPending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Matter type">
            <USelect
              v-model="matterForm.matter_type"
              :items="matterTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Wedding date">
            <UInput v-model="matterForm.wedding_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Notes" class="sm:col-span-2">
            <UTextarea v-model="matterForm.notes" class="w-full" placeholder="Notes" />
          </UFormField>
        </div>
        <UAlert
          v-if="matterError"
          class="mt-4"
          color="error"
          variant="subtle"
          title="Could not record the matter"
          :description="matterError"
        />
        <div class="mt-4">
          <UButton label="Save" icon="i-lucide-check" @click="createMatter" />
        </div>
      </UCard>

      <UCard>
        <div v-if="matterPending" class="mt-8 flex justify-center py-10">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>

        <EmptyState
          v-else-if="matterRows.length === 0"
          title="No marriage matters yet"
          description="Record the first banns, wedding or counselling matter."
        >
          <PermissionGate :collection="COLLECTIONS.marriageMatters" action="create">
            <UButton class="mt-4" label="Record matter" @click="matterShowForm = true" />
          </PermissionGate>
        </EmptyState>

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Person</th>
                <th class="px-3 py-2 font-medium">Type</th>
                <th class="px-3 py-2 font-medium">Wedding</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2"><span class="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="row in matterRows"
                :key="String(row.id)"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.person }}
                </td>
                <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                  {{ String(row.matter_type).replace(/_/g, ' ') }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.wedding_date ?? '—' }}
                </td>
                <td class="px-3 py-3">
                  <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
                </td>
                <td class="px-3 py-3 text-right">
                  <UButton
                    :to="`/marriage/${String(row.id)}`"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-arrow-right"
                    aria-label="Open marriage matter"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </section>

    <!-- PIPELINE -->
    <section v-if="tab === 'pipeline'" aria-label="Marriage pipeline" class="mt-4">
      <UCard v-if="caseShowForm" class="mb-4">
        <template #header>
          <h2 class="font-semibold">New couple</h2>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Brother">
            <EntitySelect
              v-model="caseForm.brother_person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
          <UFormField label="Sister (leave empty to link later)">
            <EntitySelect
              v-model="caseForm.sister_person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
          <UFormField label="Branch">
            <EntitySelect
              v-model="caseForm.branch"
              :items="branchOptions"
              placeholder="Select branch…"
              :loading="branchesPending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Wedding date">
            <UInput v-model="caseForm.wedding_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Notes" class="sm:col-span-2">
            <UTextarea v-model="caseForm.notes" class="w-full" placeholder="Notes" />
          </UFormField>
        </div>
        <UAlert
          v-if="caseError"
          class="mt-4"
          color="error"
          variant="subtle"
          :title="caseError"
        />
        <div class="mt-4 flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="caseShowForm = false"
          />
          <UButton label="Open case" icon="i-lucide-plus" @click="createCase" />
        </div>
      </UCard>

      <UCard>
        <UTable :data="caseRows" :loading="casePending" />
      </UCard>
    </section>

    <!-- REPORT -->
    <section v-if="tab === 'report'" aria-label="Conducted marriages" class="mt-4">
      <UAlert
        v-if="reportError"
        color="error"
        variant="subtle"
        title="Could not load the report"
        :description="reportError.message"
      />

      <div v-if="reportPending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <UCard v-else>
        <template #header>
          <h2 class="font-semibold">Marriages conducted · {{ reportTotal }}</h2>
        </template>

        <EmptyState
          v-if="reportRows.length === 0"
          title="No conducted marriages yet"
          description="Couples appear here once their file reaches the reported stage."
        />

        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Brother</th>
                <th class="px-3 py-2 font-medium">Sister</th>
                <th class="px-3 py-2 font-medium">Church (branch)</th>
                <th class="px-3 py-2 font-medium">Wedding date</th>
                <th class="px-3 py-2 font-medium">Officiating minister</th>
                <th class="px-3 py-2 font-medium">Bible passage</th>
                <th class="px-3 py-2 font-medium">Certificate</th>
                <th class="px-3 py-2 font-medium">Scanned certificate</th>
                <th class="px-3 py-2 font-medium">Couple photo</th>
                <th class="px-3 py-2 font-medium">Presentation photo</th>
                <th class="px-3 py-2"><span class="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="row in reportRows"
                :key="String(row.id)"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3 font-medium">
                  {{ row.brother_name ?? row.brother_person ?? '—' }}
                </td>
                <td class="px-3 py-3 font-medium">
                  {{ row.sister_name ?? row.sister_person ?? '—' }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.branch_name ?? row.branch ?? '—' }}
                </td>
                <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                  {{ row.wedding_date ?? '—' }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.officiating_minister_name ?? row.officiating_minister ?? '—' }}
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.bible_passage ?? '—' }}
                </td>
                <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                  {{ row.certificate_type ?? '—' }}
                </td>
                <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                  {{ row.marriage_certificate_file ?? '—' }}
                </td>
                <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                  {{ row.couple_photo_file ?? '—' }}
                </td>
                <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                  {{ row.presentation_photo_file ?? '—' }}
                </td>
                <td class="px-3 py-3 text-right">
                  <UButton
                    :to="`/marriage-cases/${String(row.id)}`"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-arrow-right"
                    aria-label="Open marriage case"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </section>
  </div>
</template>
