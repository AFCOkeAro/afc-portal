<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()

const id = computed(() => String(route.params.id ?? ''))

interface StudentDetail {
  id: string
  course?: string | null
  level?: string | null
  afcf_handshake_status?: string | null
  afcmf_linked?: boolean | null
  nysc_status?: string | null
  nysc_deployment?: string | null
  next_checkup_date?: string | null
  status: string
  notes?: string | null
  support_total?: number | null
}

interface SupportRow {
  id: string
  amount?: number | null
  term?: string | null
  source?: string | null
  status: string
  support_date?: string | null
}

const { data, pending, error, refresh } = await useAsyncData(
  'campus-student-detail',
  () => api.get<{ data: StudentDetail }>(`/api/campus/students/${id.value}`),
)

const support = await useAsyncData('campus-student-support', () =>
  api.get<{ data: SupportRow[] }>(`/api/campus/support`, {
    query: { student: id.value, limit: 100 },
  }),
)

const row = computed(() => data.value?.data ?? null)
const supportRows = computed(() => support.data.value?.data ?? [])

const saving = ref(false)
const formError = ref<string | null>(null)
const savedNote = ref<string | null>(null)

const form = reactive({
  level: '',
  graduation_year: '',
  afcf_handshake_status: '',
  afcmf_linked: false,
  nysc_status: '',
  nysc_deployment: '',
  next_checkup_date: '',
  status: '',
  notes: '',
})

watch(
  row,
  (current: StudentDetail | null) => {
    if (!current) return
    form.level = current.level ?? ''
    form.afcf_handshake_status = current.afcf_handshake_status ?? ''
    form.afcmf_linked = current.afcmf_linked ?? false
    form.nysc_status = current.nysc_status ?? ''
    form.nysc_deployment = current.nysc_deployment ?? ''
    form.next_checkup_date = current.next_checkup_date ?? ''
    form.status = current.status ?? ''
    form.notes = current.notes ?? ''
  },
  { immediate: true },
)

const optionItems = (values: string[]) => [
  { label: 'No change', value: '' },
  ...values.map((value) => ({ label: value.replace(/_/g, ' '), value })),
]

async function saveChanges() {
  saving.value = true
  formError.value = null
  savedNote.value = null
  try {
    const body: Record<string, unknown> = {}
    if (form.level) body.level = form.level
    if (form.graduation_year !== '') body.graduation_year = Number(form.graduation_year)
    if (form.afcf_handshake_status)
      body.afcf_handshake_status = form.afcf_handshake_status
    body.afcmf_linked = form.afcmf_linked
    if (form.nysc_status) body.nysc_status = form.nysc_status
    if (form.nysc_deployment !== '') body.nysc_deployment = form.nysc_deployment || null
    if (form.next_checkup_date !== '')
      body.next_checkup_date = form.next_checkup_date || null
    if (form.status) body.status = form.status
    if (form.notes !== '') body.notes = form.notes || null
    await api.patch(`/api/campus/students/${id.value}`, body)
    savedNote.value = 'Campus-care record updated.'
    await refresh()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : 'Could not update the record'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Student campus-care record"
      description="AFCF handshake, AFCMF link, support total, level progression, check-ups and NYSC deployment (US-C4, US-C5)."
    >
      <template #actions>
        <UButton
          to="/campus/students"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          label="Back to students"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      class="mt-4"
      color="error"
      variant="subtle"
      title="Could not load the student"
      :description="error.message"
    />

    <div v-else-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else-if="row">
      <UCard class="mt-4">
        <dl class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Course</dt>
            <dd class="mt-1 text-sm">{{ row.course ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Level</dt>
            <dd class="mt-1 text-sm">{{ (row.level ?? '—').replace(/_/g, ' ') }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">AFCF handshake</dt>
            <dd class="mt-1 text-sm">
              {{ (row.afcf_handshake_status ?? '—').replace(/_/g, ' ') }}
              {{ row.afcmf_linked ? '· AFCMF linked' : '' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">
              Support total (disbursed)
            </dt>
            <dd class="mt-1 text-sm">
              {{ row.support_total == null ? 'Hidden for your role' : row.support_total }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">NYSC</dt>
            <dd class="mt-1 text-sm">
              {{ (row.nysc_status ?? '—').replace(/_/g, ' ') }}
              {{ row.nysc_deployment ? `· ${row.nysc_deployment}` : '' }}
            </dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-gray-500">Next check-up</dt>
            <dd class="mt-1 text-sm">{{ row.next_checkup_date ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <PermissionGate :collection="COLLECTIONS.campusStudents" action="update">
        <UCard class="mt-4">
          <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="saveChanges">
            <UFormField label="Level (never regresses)">
              <USelect
                v-model="form.level"
                :items="
                  optionItems([
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
              />
            </UFormField>
            <UFormField label="Graduation year">
              <UInput
                v-model="form.graduation_year"
                inputmode="numeric"
                placeholder="e.g. 2027"
                class="w-full"
              />
            </UFormField>
            <UFormField label="AFCF handshake">
              <USelect
                v-model="form.afcf_handshake_status"
                :items="
                  optionItems([
                    'not_contacted',
                    'contacted',
                    'connected',
                    'active',
                    'declined',
                  ])
                "
                class="w-full"
              />
            </UFormField>
            <UFormField label="NYSC status (graph-validated)">
              <USelect
                v-model="form.nysc_status"
                :items="
                  optionItems([
                    'not_deployed',
                    'waiting_callup',
                    'deployed',
                    'serving',
                    'completed',
                    'exempt',
                  ])
                "
                class="w-full"
              />
            </UFormField>
            <UFormField label="NYSC deployment">
              <UInput
                v-model="form.nysc_deployment"
                placeholder="State / camp / PPA"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Next check-up date">
              <UInput v-model="form.next_checkup_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Status">
              <USelect
                v-model="form.status"
                :items="optionItems(['active', 'inactive', 'graduated'])"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Check-up notes" class="sm:col-span-2">
              <UInput v-model="form.notes" class="w-full" />
            </UFormField>
            <div class="flex items-center gap-2 sm:col-span-2">
              <UButton type="submit" label="Save changes" :loading="saving" />
              <UAlert
                v-if="savedNote"
                color="success"
                variant="subtle"
                :title="savedNote"
              />
            </div>
            <UAlert
              v-if="formError"
              class="sm:col-span-2"
              color="error"
              variant="subtle"
              title="Could not update the record"
              :description="formError"
            />
          </form>
        </UCard>
      </PermissionGate>

      <UCard class="mt-4">
        <h2 class="font-semibold">Financial support</h2>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">
          proposed → approved → disbursed. Amounts stay hidden outside the coordinator
          read set.
        </p>
        <div v-if="supportRows.length === 0" class="mt-3 text-sm text-gray-500">
          No support records for this student yet.
        </div>
        <div v-else class="mt-3 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Amount</th>
                <th class="px-3 py-2 font-medium">Term</th>
                <th class="px-3 py-2 font-medium">Source</th>
                <th class="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="item in supportRows" :key="item.id">
                <td class="px-3 py-3">{{ item.support_date ?? '—' }}</td>
                <td class="px-3 py-3">{{ item.amount ?? 'Hidden' }}</td>
                <td class="px-3 py-3">{{ item.term ?? '—' }}</td>
                <td class="px-3 py-3">{{ item.source ?? '—' }}</td>
                <td class="px-3 py-3">{{ item.status }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </template>
  </div>
</template>
