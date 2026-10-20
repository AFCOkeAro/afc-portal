<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type { BranchSummary } from '~/types/portal'

definePageMeta({ middleware: ['staff', 'finance'] })

const api = useApi()

const branches = await useAsyncData('finance-new-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'Choose a branch', value: '' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const form = reactive({
  branch: '',
  month: '',
  income: '',
  intervention: '',
  faith_city: '',
  notes: '',
})

const fieldErrors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const saving = ref(false)

function firstDayOfMonth(value: string): string {
  return value.length === 7 ? `${value}-01` : value
}

async function submit() {
  fieldErrors.value = {}
  formError.value = null
  saving.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/finance/records', {
      branch: form.branch,
      month: firstDayOfMonth(form.month),
      income: form.income,
      intervention: form.intervention,
      faith_city: form.faith_city,
      notes: form.notes || undefined,
    })
    await navigateTo(`/finance/records/${created.data.id}`)
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      fieldErrors.value = cause.fields ?? {}
      formError.value = cause.message
    } else {
      formError.value = 'Could not save the record. Try again.'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="New financial record"
      description="Capture what the treasurer counted: income, intervention and Faith City. MF and the 5% lines compute from the board formula afterwards."
    />

    <PermissionGate :collection="COLLECTIONS.branchFinancialRecords" action="create">
      <UCard class="max-w-2xl">
        <form class="grid gap-4" @submit.prevent="submit">
          <UFormField label="Branch" name="branch" :error="fieldErrors.branch" required>
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>

          <UFormField
            label="Month"
            name="month"
            hint="First day of the month is stored; pick the month."
            :error="fieldErrors.month"
            required
          >
            <UInput v-model="form.month" type="month" class="w-full" />
          </UFormField>

          <UFormField
            label="Tithe and offering income (₦)"
            name="income"
            :error="fieldErrors.income"
            required
          >
            <UInput v-model="form.income" inputmode="decimal" placeholder="0.00" class="w-full" />
          </UFormField>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Intervention (₦)" name="intervention" :error="fieldErrors.intervention">
              <UInput
                v-model="form.intervention"
                inputmode="decimal"
                placeholder="0.00"
                class="w-full"
              />
              <template #hint>Manual input, never derived from income (ADR-0008 R3).</template>
            </UFormField>
            <UFormField label="Faith City (₦)" name="faith_city" :error="fieldErrors.faith_city">
              <UInput
                v-model="form.faith_city"
                inputmode="decimal"
                placeholder="0.00"
                class="w-full"
              />
              <template #hint>Manual input, never derived from income (ADR-0008 R3).</template>
            </UFormField>
          </div>

          <UFormField label="Notes" name="notes" :error="fieldErrors.notes">
            <UTextarea v-model="form.notes" class="w-full" placeholder="Anything the reviewer should know" />
          </UFormField>

          <UAlert
            v-if="formError"
            color="error"
            variant="subtle"
            title="Could not save the record"
            :description="formError"
          />

          <div class="flex gap-2">
            <UButton type="submit" label="Save draft" icon="i-lucide-save" :loading="saving" />
            <UButton label="Back to records" color="neutral" variant="outline" to="/finance/records" />
          </div>
        </form>
      </UCard>
    </PermissionGate>
  </div>
</template>
