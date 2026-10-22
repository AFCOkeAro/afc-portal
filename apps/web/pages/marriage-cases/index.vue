<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()
const showForm = ref(false)
const form = ref({
  brother_person: '',
  sister_person: '',
  branch: '',
  wedding_date: '',
  notes: '',
})
const error = ref('')

const { data, pending, refresh } = await useAsyncData('marriage-cases-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/marriage-cases'),
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/marriage-cases', {
      brother_person: form.value.brother_person,
      ...(form.value.sister_person ? { sister_person: form.value.sister_person } : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      ...(form.value.wedding_date ? { wedding_date: form.value.wedding_date } : {}),
      ...(form.value.notes ? { notes: form.value.notes } : {}),
    })
    showForm.value = false
    form.value = {
      brother_person: '',
      sister_person: '',
      branch: '',
      wedding_date: '',
      notes: '',
    }
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not open the case'
  }
}

const rows = computed(() => data.value?.data ?? [])
</script>

<template>
  <div>
    <PageHeader
      title="Marriage pipeline"
      description="Brother/sister couples through the pipeline stages."
    >
      <template #actions>
        <UButton
          label="Conducted marriages"
          icon="i-lucide-book-heart"
          color="neutral"
          variant="outline"
          to="/marriage-cases/report"
        />
        <PermissionGate :collection="COLLECTIONS.marriageCases" action="create">
          <UButton label="Open case" icon="i-lucide-plus" @click="showForm = !showForm" />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard v-if="showForm" class="mb-4">
      <template #header>
        <h2 class="font-semibold">New couple</h2>
      </template>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Brother">
          <EntitySelect
            v-model="form.brother_person"
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
            v-model="form.sister_person"
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
        <UFormField label="Wedding date">
          <UInput v-model="form.wedding_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Notes" class="sm:col-span-2">
          <UTextarea v-model="form.notes" class="w-full" placeholder="Notes" />
        </UFormField>
      </div>
      <UAlert v-if="error" class="mt-4" color="error" variant="subtle" :title="error" />
      <div class="mt-4 flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="showForm = false"
        />
        <UButton label="Open case" icon="i-lucide-plus" @click="create" />
      </div>
    </UCard>

    <UCard>
      <UTable :data="rows" :loading="pending" />
    </UCard>
  </div>
</template>
