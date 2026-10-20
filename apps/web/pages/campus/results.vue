<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()

interface ResultRow {
  id: string
  campus_student?: string | null
  person?: string | null
  exam: string
  exam_year?: number | null
  scores?: Record<string, unknown> | null
  aggregate?: string | null
  status: string
  institution?: string | null
}

const exam = ref('all')
const examYear = ref('')
const saving = ref(false)
const formError = ref<string | null>(null)

const form = reactive({
  campus_student: '',
  exam: 'waec',
  exam_year: String(new Date().getFullYear()),
  aggregate: '',
  status: 'pending',
  institution: '',
})

const examOptions = [
  { label: 'Any exam', value: 'all' },
  { label: 'WAEC', value: 'waec' },
  { label: 'UTME', value: 'utme' },
  { label: 'Admission', value: 'admission' },
]

const formExamOptions = examOptions.filter((option) => option.value !== 'all')

const statusOptions = ['pending', 'passed', 'failed', 'admitted', 'not_admitted'].map(
  (value) => ({ label: value.replace(/_/g, ' '), value }),
)

const query = computed(() => ({
  ...(exam.value !== 'all' ? { exam: exam.value } : {}),
  ...(examYear.value ? { exam_year: examYear.value } : {}),
  limit: 100,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'campus-results',
  () => api.get<{ data: ResultRow[]; meta: { total: number } }>('/api/campus/results', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])

function scoreSummary(row: ResultRow): string {
  if (row.aggregate) return row.aggregate
  const scores = row.scores
  if (!scores || typeof scores !== 'object') return '—'
  const entries = Object.entries(scores)
  if (entries.length === 0) return '—'
  return entries.map(([subject, grade]) => `${subject}: ${String(grade)}`).join(', ')
}

async function saveResult() {
  saving.value = true
  formError.value = null
  try {
    await api.post('/api/campus/results', {
      campus_student: form.campus_student || null,
      exam: form.exam,
      exam_year: form.exam_year === '' ? null : Number(form.exam_year),
      scores: {},
      aggregate: form.aggregate || null,
      status: form.status,
      institution: form.institution || null,
    })
    form.campus_student = ''
    form.aggregate = ''
    form.institution = ''
    await refresh()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Could not record the result'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="WAEC / UTME / admission results"
      description="One result per student, exam and year. Admission results name the institution (US-C3)."
    />

    <UCard class="mt-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <USelect
          v-model="exam"
          :items="examOptions"
          class="w-full"
          aria-label="Filter by exam"
        />
        <UFormField label="Year">
          <UInput
            v-model="examYear"
            placeholder="2026"
            inputmode="numeric"
            class="w-full"
          />
        </UFormField>
      </div>
    </UCard>

    <PermissionGate :collection="COLLECTIONS.examResults" action="create">
      <UCard class="mt-4">
        <form class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" @submit.prevent="saveResult">
          <UFormField label="Campus student id" required>
            <UInput
              v-model="form.campus_student"
              placeholder="Student UUID"
              required
              class="w-full"
            />
          </UFormField>
          <UFormField label="Exam">
            <USelect v-model="form.exam" :items="formExamOptions" class="w-full" />
          </UFormField>
          <UFormField label="Year">
            <UInput v-model="form.exam_year" inputmode="numeric" class="w-full" />
          </UFormField>
          <UFormField label="Aggregate">
            <UInput v-model="form.aggregate" placeholder="e.g. 287, 5 distinctions" class="w-full" />
          </UFormField>
          <UFormField label="Status">
            <USelect v-model="form.status" :items="statusOptions" class="w-full" />
          </UFormField>
          <UFormField label="Institution (admission)">
            <UInput
              v-model="form.institution"
              placeholder="Required for admission results"
              class="w-full"
            />
          </UFormField>
          <div class="flex items-end">
            <UButton type="submit" label="Record result" :loading="saving" />
          </div>
          <UAlert
            v-if="formError"
            class="sm:col-span-2 xl:col-span-3"
            color="error"
            variant="subtle"
            title="Could not record the result"
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
        title="Could not load results"
        :description="error.message"
      />

      <div v-else-if="pending" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No results for this filter"
        description="Record the first result above."
      />

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">Exam</th>
              <th class="px-3 py-2 font-medium">Year</th>
              <th class="px-3 py-2 font-medium">Scores / aggregate</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Institution</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 uppercase">{{ row.exam }}</td>
              <td class="px-3 py-3">{{ row.exam_year ?? '—' }}</td>
              <td class="px-3 py-3">{{ scoreSummary(row) }}</td>
              <td class="px-3 py-3">{{ row.status.replace(/_/g, ' ') }}</td>
              <td class="px-3 py-3">{{ row.institution ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
