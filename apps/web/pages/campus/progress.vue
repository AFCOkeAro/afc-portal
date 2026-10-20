<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()

interface ProgressRow {
  id: string
  campus_student?: string | null
  person?: string | null
  programme: string
  assessment?: string | null
  score?: number | null
  max_score?: number | null
  progress_date?: string | null
  remarks?: string | null
}

const programme = ref('')
const student = ref('')
const saving = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
  assessment: '',
  score: '',
  max_score: '',
  progress_date: new Date().toISOString().slice(0, 10),
  remarks: '',
})

const query = computed(() => ({
  ...(programme.value ? { programme: programme.value } : {}),
  ...(student.value ? { campus_student: student.value } : {}),
  limit: 100,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'campus-progress',
  () => api.get<{ data: ProgressRow[]; meta: { total: number } }>('/api/campus/progress', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])

const csvHref = computed(() => {
  const params = new URLSearchParams()
  if (programme.value) params.set('programme', programme.value)
  if (student.value) params.set('campus_student', student.value)
  const suffix = params.toString()
  return `/api/campus/progress/report.csv${suffix ? `?${suffix}` : ''}`
})

async function saveProgress() {
  saving.value = true
  formError.value = null
  try {
    await api.post('/api/campus/progress', {
      campus_student: student.value || null,
      programme: programme.value || null,
      assessment: form.assessment || null,
      score: form.score === '' ? null : Number(form.score),
      max_score: form.max_score === '' ? null : Number(form.max_score),
      progress_date: form.progress_date || null,
      remarks: form.remarks || null,
    })
    form.assessment = ''
    form.score = ''
    form.max_score = ''
    form.remarks = ''
    await refresh()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Could not record progress'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Progress & reports"
      description="Assessments per student. The coordinator export streams the same scoped query as this list (US-C2)."
    >
      <template #actions>
        <UButton
          :to="csvHref"
          external
          color="neutral"
          variant="outline"
          icon="i-lucide-download"
          label="Export CSV"
        />
      </template>
    </PageHeader>

    <UCard class="mt-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Programme id">
          <UInput
            v-model="programme"
            placeholder="Programme UUID"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Campus student id (optional)">
          <UInput
            v-model="student"
            placeholder="Student UUID"
            class="w-full"
          />
        </UFormField>
      </div>
    </UCard>

    <PermissionGate :collection="COLLECTIONS.coachingProgress" action="create">
      <UCard class="mt-4">
        <form class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" @submit.prevent="saveProgress">
          <UFormField label="Assessment">
            <UInput v-model="form.assessment" placeholder="Mock UTME 1" class="w-full" />
          </UFormField>
          <UFormField label="Score">
            <UInput v-model="form.score" type="number" min="0" step="any" class="w-full" />
          </UFormField>
          <UFormField label="Max score">
            <UInput v-model="form.max_score" type="number" min="0" step="any" class="w-full" />
          </UFormField>
          <UFormField label="Date">
            <UInput v-model="form.progress_date" type="date" class="w-full" />
          </UFormField>
          <UFormField label="Remarks" class="sm:col-span-2">
            <UInput v-model="form.remarks" class="w-full" />
          </UFormField>
          <div class="flex items-end">
            <UButton type="submit" label="Record" :loading="saving" :disabled="!programme || !student" />
          </div>
          <UAlert
            v-if="formError"
            class="sm:col-span-2 xl:col-span-3"
            color="error"
            variant="subtle"
            title="Could not record progress"
            :description="formError"
          />
        </form>
      </UCard>
    </PermissionGate>

    <UCard class="mt-4">
      <UAlert
        v-if="error"
        color="error"
        variant="subtle"
        title="Could not load progress"
        :description="error.message"
      />

      <div v-else-if="pending" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No progress records for this filter"
        description="Record the first assessment above."
      />

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">Date</th>
              <th class="px-3 py-2 font-medium">Assessment</th>
              <th class="px-3 py-2 font-medium">Score</th>
              <th class="px-3 py-2 font-medium">Remarks</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">{{ row.progress_date ?? '—' }}</td>
              <td class="px-3 py-3">{{ row.assessment ?? '—' }}</td>
              <td class="px-3 py-3">
                {{ row.score ?? '—' }}{{ row.max_score != null ? ` / ${row.max_score}` : '' }}
              </td>
              <td class="px-3 py-3">{{ row.remarks ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
