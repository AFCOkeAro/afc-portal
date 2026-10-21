<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()

interface Programme {
  id: string
  name: string
  exam: string
  year?: number | null
}

interface Slot {
  id: string
  programme: string
  subject: string
  facilitator?: string | null
  day_of_week?: string | null
  start_time?: string | null
  end_time?: string | null
  location?: string | null
  status: string
}

const programmes = await useAsyncData('campus-programmes', () =>
  api.get<{ data: Programme[] }>('/api/campus/programmes', { query: { limit: 100 } }),
)

const programmeId = ref('')
const day = ref('all')
const showForm = ref(false)
const saving = ref(false)
const formError = ref<string | null>(null)
const clashWarning = ref<string | null>(null)

const form = reactive({
  subject: '',
  day_of_week: 'saturday',
  start_time: '',
  end_time: '',
  location: '',
})

const programmeOptions = computed(() => [
  { label: 'Choose a programme', value: '' },
  ...(programmes.data.value?.data ?? []).map((row) => ({
    label: `${row.name} (${row.exam.toUpperCase()}${row.year ? ` ${row.year}` : ''})`,
    value: row.id,
  })),
])

const dayOptions = [
  { label: 'Any day', value: 'all' },
  ...['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(
    (value) => ({ label: value.charAt(0).toUpperCase() + value.slice(1), value }),
  ),
]

const formDayOptions = dayOptions.filter((option) => option.value !== 'all')

const query = computed(() => ({
  ...(programmeId.value ? { programme: programmeId.value } : {}),
  ...(day.value !== 'all' ? { day_of_week: day.value } : {}),
  limit: 100,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'campus-timetable',
  () => api.get<{ data: Slot[] }>('/api/campus/timetable', { query: query.value }),
  { watch: [query] },
)

watch(programmeId, () => {
  clashWarning.value = null
})

const slots = computed(() => data.value?.data ?? [])

async function saveSlot() {
  if (!programmeId.value) return
  saving.value = true
  formError.value = null
  clashWarning.value = null
  try {
    const response = await api.post<{
      data: Slot
      meta: { clashes: string[]; clash_count: number }
    }>('/api/campus/timetable', {
      programme: programmeId.value,
      subject: form.subject,
      day_of_week: form.day_of_week,
      start_time: form.start_time || null,
      end_time: form.end_time || null,
      location: form.location || null,
    })
    if (response.meta.clash_count > 0) {
      clashWarning.value = `Saved with ${response.meta.clash_count} clash${response.meta.clash_count === 1 ? '' : 'es'} flagged — same facilitator or location, overlapping times. The coordinator decides.`
    }
    form.subject = ''
    form.start_time = ''
    form.end_time = ''
    form.location = ''
    showForm.value = false
    await refresh()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Could not save the slot'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Coaching timetable"
      description="Weekly slots per programme. Clashes (same facilitator or location, overlapping times) are flagged on save — the coordinator decides."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.coachingTimetable" action="create">
          <UButton
            label="Add slot"
            icon="i-lucide-plus"
            :disabled="!programmeId"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UAlert
      v-if="clashWarning"
      class="mt-4"
      color="warning"
      variant="subtle"
      title="Timetable clash flagged"
      :description="clashWarning"
    />

    <UCard v-if="showForm" class="mt-4">
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveSlot">
        <UFormField label="Subject" required>
          <UInput
            v-model="form.subject"
            placeholder="Mathematics"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Day">
          <USelect v-model="form.day_of_week" :items="formDayOptions" class="w-full" />
        </UFormField>
        <UFormField label="Start (HH:MM)">
          <UInput v-model="form.start_time" placeholder="09:00" class="w-full" />
        </UFormField>
        <UFormField label="End (HH:MM)">
          <UInput v-model="form.end_time" placeholder="12:00" class="w-full" />
        </UFormField>
        <UFormField label="Location" class="sm:col-span-2">
          <UInput v-model="form.location" placeholder="Oke-Aro hall" class="w-full" />
        </UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" label="Save slot" :loading="saving" />
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            @click="showForm = false"
          />
        </div>
        <UAlert
          v-if="formError"
          class="sm:col-span-2"
          color="error"
          variant="subtle"
          title="Could not save the slot"
          :description="formError"
        />
      </form>
    </UCard>

    <UCard class="mt-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <EntitySelect
          v-model="programmeId"
          :items="programmeOptions"
          placeholder="Select programme…"
          class="w-full"
          aria-label="Filter by programme"
        />
        <USelect
          v-model="day"
          :items="dayOptions"
          class="w-full"
          aria-label="Filter by day"
        />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load the timetable"
        :description="error.message"
      />

      <p v-else-if="!programmeId" class="mt-6 text-sm text-gray-500">
        Choose a programme to see its weekly slots.
      </p>

      <div v-else-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="slots.length === 0"
        title="No slots for this programme yet"
        description="Add the first weekly slot — subject, day, time, location and facilitator."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Subject</th>
              <th class="px-3 py-2 font-medium">Day</th>
              <th class="px-3 py-2 font-medium">Time</th>
              <th class="px-3 py-2 font-medium">Location</th>
              <th class="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="slot in slots"
              :key="slot.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">{{ slot.subject }}</td>
              <td class="px-3 py-3 capitalize">{{ slot.day_of_week ?? '—' }}</td>
              <td class="px-3 py-3">
                {{ slot.start_time ?? '—' }} – {{ slot.end_time ?? '—' }}
              </td>
              <td class="px-3 py-3">{{ slot.location ?? '—' }}</td>
              <td class="px-3 py-3">{{ slot.status }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
