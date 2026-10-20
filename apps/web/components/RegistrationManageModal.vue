<script setup lang="ts">
import type { RegistrationRow } from '~/types/portal'

/**
 * Staff registration manage modal (AFC-470 §2–§3): status moves plus
 * payment reconciliation with an audit note.
 *
 * The legal edges below mirror STATUS_TRANSITIONS in
 * server/utils/event-registration-completion.ts, which remains the
 * authority — the PATCH route re-checks every move with a 409, so a stale
 * client map can only hide a button, never force a transition. The
 * contract suite pins the two maps together.
 */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  waitlisted: 'Waitlisted',
  cancelled: 'Cancelled',
  attended: 'Attended',
  no_show: 'No show',
}

const NEXT_STATUS: Record<string, string[]> = {
  pending: ['pending', 'confirmed', 'waitlisted', 'cancelled'],
  waitlisted: ['waitlisted', 'confirmed', 'pending', 'cancelled'],
  confirmed: ['confirmed', 'attended', 'cancelled', 'no_show'],
  attended: ['attended'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
}

const PAYMENT_OPTIONS = [
  { label: 'Not required', value: 'not_required' },
  { label: 'Pending', value: 'pending' },
  { label: 'Paid', value: 'paid' },
  { label: 'Refunded', value: 'refunded' },
]

const props = defineProps<{
  open: boolean
  registration: RegistrationRow | null
  currency?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

const form = reactive({
  registration_status: 'pending',
  amount_expected: '',
  amount_paid: '',
  payment_status: '',
  payment_reference: '',
  audit_note: '',
})

const statusOptions = computed(() =>
  (NEXT_STATUS[props.registration?.registration_status ?? 'pending'] ?? ['pending']).map(
    (value) => ({ label: STATUS_LABELS[value] ?? value, value }),
  ),
)

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    const row = props.registration
    Object.assign(form, {
      registration_status: row?.registration_status ?? 'pending',
      amount_expected: row?.amount_expected ?? '',
      amount_paid: row?.amount_paid ?? '',
      payment_status: '',
      payment_reference: row?.payment_reference ?? '',
      audit_note: '',
    })
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  if (!props.registration) return
  formError.value = ''
  fieldErrors.value = {}
  const body: Record<string, unknown> = {
    registration_status: form.registration_status,
  }
  if (form.amount_expected !== '') body.amount_expected = form.amount_expected
  if (form.amount_paid !== '') body.amount_paid = form.amount_paid
  if (form.payment_status !== '') body.payment_status = form.payment_status
  if (form.payment_reference.trim() !== '') {
    body.payment_reference = form.payment_reference.trim()
  }
  if (form.audit_note.trim() !== '') body.audit_note = form.audit_note.trim()

  saving.value = true
  try {
    await api.patch(`/api/events/registrations/${props.registration.id}`, body)
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not update that registration'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="`Manage ${registration?.person_name ?? 'registration'}`"
    description="Status moves follow the allowed edges; money is reconciled here, never online."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <UAlert
          v-if="formError"
          color="error"
          variant="subtle"
          :description="formError"
        />

        <UFormField label="Status" :error="fieldErrors.registration_status">
          <USelect
            v-model="form.registration_status"
            :items="statusOptions"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            :label="`Amount expected${currency ? ` (${currency})` : ''}`"
            :error="fieldErrors.amount_expected"
          >
            <UInput v-model="form.amount_expected" inputmode="decimal" class="w-full" />
          </UFormField>
          <UFormField
            :label="`Amount paid${currency ? ` (${currency})` : ''}`"
            :error="fieldErrors.amount_paid"
          >
            <UInput v-model="form.amount_paid" inputmode="decimal" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Payment status" :error="fieldErrors.payment_status">
            <USelect
              v-model="form.payment_status"
              :items="[{ label: 'Leave unchanged', value: '' }, ...PAYMENT_OPTIONS]"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Payment reference" :error="fieldErrors.payment_reference">
            <UInput
              v-model="form.payment_reference"
              class="w-full"
              placeholder="Bank transfer reference"
            />
          </UFormField>
        </div>

        <UFormField label="Audit note" :error="fieldErrors.audit_note">
          <UTextarea
            v-model="form.audit_note"
            :rows="2"
            class="w-full"
            placeholder="Why is this change being made?"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save changes" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
