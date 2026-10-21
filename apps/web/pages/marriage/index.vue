<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()
const showForm = ref(false)
const form = ref({
  person: '',
  branch: '',
  matter_type: 'wedding',
  wedding_date: '',
  notes: '',
})
const error = ref('')

const { data, pending, refresh } = await useAsyncData('marriage-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/marriage'),
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/marriage', {
      person: form.value.person,
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      matter_type: form.value.matter_type,
      ...(form.value.wedding_date ? { wedding_date: form.value.wedding_date } : {}),
      ...(form.value.notes ? { notes: form.value.notes } : {}),
    })
    showForm.value = false
    form.value = {
      person: '',
      branch: '',
      matter_type: 'wedding',
      wedding_date: '',
      notes: '',
    }
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not record the matter'
  }
}

const matterTypeOptions = [
  { label: 'Banns', value: 'banns' },
  { label: 'Wedding', value: 'wedding' },
  { label: 'Counselling', value: 'counselling' },
  { label: 'Other', value: 'other' },
]

const rows = computed(() => data.value?.data ?? [])

/** Dashboard strip (AFC-588): no server filters — display-only total, no new backend. */
const stripItems = computed(() => [
  { label: 'Matters', value: rows.value.length, to: null, hint: 'Total in view' },
])
</script>

<template>
  <div>
    <PageHeader
      title="Marriage matters"
      description="Banns, weddings and counselling with an audit trail."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.marriageMatters" action="create">
          <UButton
            label="Record matter"
            icon="i-lucide-plus"
            @click="showForm = !showForm"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard v-if="showForm" class="mb-4">
      <template #header>
        <h2 class="font-semibold">New matter</h2>
      </template>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Person">
          <EntitySelect
            v-model="form.person"
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
            v-model="form.branch"
            :items="branchOptions"
            placeholder="Select branch…"
            :loading="branchesPending"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Matter type">
          <USelect v-model="form.matter_type" :items="matterTypeOptions" class="w-full" />
        </UFormField>
        <UFormField label="Wedding date">
          <UInput v-model="form.wedding_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Notes" class="sm:col-span-2">
          <UTextarea v-model="form.notes" class="w-full" placeholder="Notes" />
        </UFormField>
      </div>
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not record the matter"
        :description="error"
      />
      <div class="mt-4">
        <UButton label="Save" icon="i-lucide-check" @click="create" />
      </div>
    </UCard>

    <UCard>
      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No marriage matters yet"
        description="Record the first banns, wedding or counselling matter."
      >
        <PermissionGate :collection="COLLECTIONS.marriageMatters" action="create">
          <UButton class="mt-4" label="Record matter" @click="showForm = true" />
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
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">{{ row.person }}</td>
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
  </div>
</template>
