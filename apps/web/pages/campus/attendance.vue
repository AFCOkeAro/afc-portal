<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()

interface Mark {
  id: string
  timetable?: string | null
  programme?: string | null
  class_date: string
  campus_student?: string | null
  person?: string | null
  present: boolean
}

interface Slot {
  id: string
  programme: string
  subject: string
  day_of_week?: string | null
  start_time?: string | null
  end_time?: string | null
  status: string
}

interface StudentOption {
  id: string
  course?: string | null
  level?: string | null
}

const programme = ref('')
const classDate = ref(new Date().toISOString().slice(0, 10))
const timetable = ref('')
const campusStudent = ref('')
const present = ref(true)
const saving = ref(false)
const formError = ref<string | null>(null)
const savedNote = ref<string | null>(null)

const query = computed(() => ({
  ...(programme.value ? { programme: programme.value } : {}),
  ...(classDate.value ? { class_date: classDate.value } : {}),
  limit: 100,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'campus-attendance',
  () =>
    api.get<{ data: Mark[]; meta: { total: number } }>('/api/campus/attendance', {
      query: query.value,
    }),
  { watch: [query] },
)

// Preloaded caller-scoped option lists for the searchable pickers below.
// No new endpoints: same list routes the timetable/students pages use.
const programmesQuery = await useAsyncData('campus-attendance-programmes', () =>
  api.get<{
    data: Array<{ id: string; name: string; exam: string; year?: number | null }>
  }>('/api/campus/programmes', { query: { limit: 100 } }),
)
const slotsQuery = await useAsyncData('campus-attendance-slots', () =>
  api.get<{ data: Slot[] }>('/api/campus/timetable', { query: { limit: 100 } }),
)
const studentsQuery = await useAsyncData('campus-attendance-students', () =>
  api.get<{ data: StudentOption[]; meta: { total: number } }>('/api/campus/students', {
    query: { limit: 100 },
  }),
)

const programmeOptions = computed(() => [
  { label: 'All programmes', value: '' },
  ...(programmesQuery.data.value?.data ?? []).map((row) => ({
    label: `${row.name} (${row.exam.toUpperCase()}${row.year ? ` ${row.year}` : ''})`,
    value: row.id,
  })),
])
const slotOptions = computed(() => [
  { label: 'No slot', value: '' },
  ...(slotsQuery.data.value?.data ?? []).map((row) => ({
    label: `${row.subject} · ${(row.day_of_week ?? '?').replace(/_/g, ' ')} ${row.start_time ?? ''}–${row.end_time ?? ''}`,
    value: row.id,
  })),
])
const studentOptions = computed(() => [
  { label: 'All students', value: '' },
  ...(studentsQuery.data.value?.data ?? []).map((row) => ({
    label: `${row.course ?? 'Student record'} · ${(row.level ?? '').replace(/_/g, ' ')} · ${row.id.slice(0, 8)}`,
    value: row.id,
  })),
])

const marks = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const presentCount = computed(
  () => marks.value.filter((mark: Mark) => mark.present).length,
)

async function saveMark() {
  saving.value = true
  formError.value = null
  savedNote.value = null
  if (!campusStudent.value) {
    formError.value = 'Choose a student first.'
    saving.value = false
    return
  }
  try {
    const response = await api.post<{ data: Mark; meta: { idempotent: boolean } }>(
      '/api/campus/attendance',
      {
        timetable: timetable.value || null,
        programme: programme.value || null,
        class_date: classDate.value,
        campus_student: campusStudent.value || null,
        present: present.value,
      },
    )
    savedNote.value = response.meta.idempotent
      ? 'Attendance updated — the same row was re-marked, no duplicate created.'
      : 'Attendance marked.'
    campusStudent.value = ''
    await refresh()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Could not mark attendance'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Class attendance"
      description="Mark attendance per class occurrence. Re-marking the same student for the same session and date updates the row — never a duplicate (US-C2)."
    />

    <PermissionGate :collection="COLLECTIONS.coachingClassAttendance" action="create">
      <UCard class="mt-4">
        <form class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" @submit.prevent="saveMark">
          <UFormField label="Programme">
            <EntitySelect
              v-model="programme"
              :items="programmeOptions"
              placeholder="Select programme…"
              :loading="programmesQuery.pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Timetable slot (optional)">
            <EntitySelect
              v-model="timetable"
              :items="slotOptions"
              placeholder="Select slot…"
              :loading="slotsQuery.pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Class date" required>
            <UInput v-model="classDate" type="date" required class="w-full" />
          </UFormField>
          <UFormField label="Campus student" required>
            <EntitySelect
              v-model="campusStudent"
              :items="studentOptions"
              placeholder="Select student…"
              :loading="studentsQuery.pending"
              class="w-full"
            />
          </UFormField>
          <div class="flex items-end gap-2">
            <USelect
              v-model="present"
              :items="[
                { label: 'Present', value: true },
                { label: 'Absent', value: false },
              ]"
              class="w-full"
              aria-label="Present or absent"
            />
            <UButton type="submit" label="Mark" :loading="saving" />
          </div>
          <UAlert
            v-if="formError"
            class="sm:col-span-2 xl:col-span-5"
            color="error"
            variant="subtle"
            title="Could not mark attendance"
            :description="formError"
          />
          <UAlert
            v-if="savedNote"
            class="sm:col-span-2 xl:col-span-5"
            color="success"
            variant="subtle"
            title="Saved"
            :description="savedNote"
          />
        </form>
      </UCard>
    </PermissionGate>

    <UCard class="mt-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ total }} mark{{ total === 1 ? '' : 's' }} · {{ presentCount }} present
        {{ classDate ? `on ${classDate}` : '' }}
      </p>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load attendance"
        :description="error.message"
      />

      <div v-else-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="marks.length === 0"
        title="No marks for this filter"
        description="Mark the first student above, or widen the filter."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Student</th>
              <th class="px-3 py-2 font-medium">Present</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="mark in marks"
              :key="mark.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">{{ mark.class_date }}</td>
              <td class="px-3 py-3 font-mono text-xs">
                {{ mark.campus_student ?? mark.person ?? '—' }}
              </td>
              <td class="px-3 py-3">{{ mark.present ? 'Yes' : 'No' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
