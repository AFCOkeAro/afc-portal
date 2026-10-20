<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()

interface StudentRow {
  id: string
  course?: string | null
  level?: string | null
  afcf_handshake_status?: string | null
  afcmf_linked?: boolean | null
  nysc_status?: string | null
  next_checkup_date?: string | null
  status: string
}

const level = ref('all')
const nysc = ref('all')
const status = ref('all')

const selectOptions = (values: string[]) => [
  { label: 'Any', value: 'all' },
  ...values.map((value) => ({ label: value.replace(/_/g, ' '), value })),
]

const query = computed(() => ({
  ...(level.value !== 'all' ? { level: level.value } : {}),
  ...(nysc.value !== 'all' ? { nysc_status: nysc.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
  limit: 50,
}))

const { data, pending, error } = await useAsyncData(
  'campus-students',
  () =>
    api.get<{ data: StudentRow[]; meta: { total: number } }>('/api/campus/students', {
      query: query.value,
    }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
</script>

<template>
  <div>
    <PageHeader
      title="Campus students"
      description="Campus-care records: AFCF handshake, AFCMF link, level progression, check-ups and NYSC deployment (US-C4, US-C5). Scores and support amounts stay hidden outside the coordinator read set."
    />

    <UCard class="mt-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <USelect
          v-model="level"
          :items="
            selectOptions([
              'freshman',
              'sophomore',
              'junior',
              'senior',
              'final_year',
              'graduated',
              'other',
            ])
          "
          class="w-full"
          aria-label="Filter by level"
        />
        <USelect
          v-model="nysc"
          :items="
            selectOptions([
              'not_deployed',
              'waiting_callup',
              'deployed',
              'serving',
              'completed',
              'exempt',
            ])
          "
          class="w-full"
          aria-label="Filter by NYSC status"
        />
        <USelect
          v-model="status"
          :items="selectOptions(['active', 'inactive', 'graduated'])"
          class="w-full"
          aria-label="Filter by status"
        />
      </div>

      <p class="mt-3 text-sm text-gray-600 dark:text-gray-400">
        {{ total }} student{{ total === 1 ? '' : 's' }} in scope.
      </p>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load students"
        :description="error.message"
      />

      <div v-else-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No students match these filters"
        description="Enrol the first campus student from the coordinator workflow."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Course</th>
              <th class="px-3 py-2 font-medium">Level</th>
              <th class="px-3 py-2 font-medium">AFCF</th>
              <th class="px-3 py-2 font-medium">NYSC</th>
              <th class="px-3 py-2 font-medium">Next check-up</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="row.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">{{ row.course ?? '—' }}</td>
              <td class="px-3 py-3">{{ (row.level ?? '—').replace(/_/g, ' ') }}</td>
              <td class="px-3 py-3">
                {{ (row.afcf_handshake_status ?? '—').replace(/_/g, ' ') }}
              </td>
              <td class="px-3 py-3">{{ (row.nysc_status ?? '—').replace(/_/g, ' ') }}</td>
              <td class="px-3 py-3">{{ row.next_checkup_date ?? '—' }}</td>
              <td class="px-3 py-3 text-right">
                <PermissionGate :collection="COLLECTIONS.campusStudents" action="read">
                  <UButton
                    variant="ghost"
                    color="neutral"
                    icon="i-lucide-arrow-right"
                    :to="`/campus/students/${row.id}`"
                    aria-label="Open student record"
                  />
                </PermissionGate>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
