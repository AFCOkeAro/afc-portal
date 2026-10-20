<script setup lang="ts">
import { registrationFormSchema } from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

/**
 * Staff walk-in / phone registration modal (AFC-470 §1).
 *
 * Client-side validation reuses `registrationFormSchema` for field errors,
 * but the POST route re-validates and stamps the server-owned columns
 * (`source: 'staff'`, status `pending`) — the browser never sends
 * `ticket_code` or `registration_status`. The public allowlist module is
 * imported, never edited.
 */
const props = defineProps<{
  open: boolean
  eventId: string
  branches: BranchSummary[]
  eventBranch?: string | null
  medicalVisible: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

const ageOptions = [
  { label: 'Adult', value: 'adult' },
  { label: 'Youth', value: 'youth' },
  { label: 'Teen', value: 'teen' },
  { label: 'Child', value: 'child' },
  { label: 'Unknown', value: 'unknown' },
]

const branchOptions = computed(() => [
  { label: 'Use event branch', value: '' },
  ...props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
])

function empty() {
  return {
    registrant_first_name: '',
    registrant_last_name: '',
    email: '',
    phone: '',
    age_group: 'unknown',
    branch: '',
    guardian_name: '',
    guardian_phone: '',
    guardian_email: '',
    guardian_consent: false,
    medical_notes: '',
    allergies: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
  }
}

const form = reactive(empty())

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  const candidate = {
    event: props.eventId,
    registrant_first_name: form.registrant_first_name.trim(),
    registrant_last_name: form.registrant_last_name.trim(),
    email: form.email.trim() || undefined,
    phone: form.phone.trim() || undefined,
    age_group: form.age_group,
    branch: form.branch || undefined,
    guardian_name: form.guardian_name.trim() || undefined,
    guardian_phone: form.guardian_phone.trim() || undefined,
    guardian_email: form.guardian_email.trim() || undefined,
    guardian_consent: form.guardian_consent,
    medical_notes: form.medical_notes.trim() || undefined,
    allergies: form.allergies.trim() || undefined,
    emergency_contact_name: form.emergency_contact_name.trim() || undefined,
    emergency_contact_phone: form.emergency_contact_phone.trim() || undefined,
  }
  const parsed = registrationFormSchema.safeParse(candidate)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.')
      if (key && !errors[key]) errors[key] = issue.message
    }
    fieldErrors.value = errors
    return
  }

  saving.value = true
  try {
    await api.post(`/api/events/${props.eventId}/registrations`, parsed.data)
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not register that person'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Register walk-in"
    description="Phone and walk-in registrations are recorded by staff here; the ticket is assigned automatically."
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

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="First name"
            required
            :error="fieldErrors.registrant_first_name"
          >
            <UInput v-model="form.registrant_first_name" class="w-full" />
          </UFormField>
          <UFormField
            label="Last name"
            required
            :error="fieldErrors.registrant_last_name"
          >
            <UInput v-model="form.registrant_last_name" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Phone" :error="fieldErrors.phone">
            <UInput
              v-model="form.phone"
              type="tel"
              class="w-full"
              placeholder="08012345678"
            />
          </UFormField>
          <UFormField label="Email" :error="fieldErrors.email">
            <UInput v-model="form.email" type="email" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Age group" :error="fieldErrors.age_group">
            <USelect v-model="form.age_group" :items="ageOptions" class="w-full" />
          </UFormField>
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Guardian name" :error="fieldErrors.guardian_name">
            <UInput v-model="form.guardian_name" class="w-full" />
          </UFormField>
          <UFormField label="Guardian phone" :error="fieldErrors.guardian_phone">
            <UInput v-model="form.guardian_phone" type="tel" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Guardian email" :error="fieldErrors.guardian_email">
            <UInput v-model="form.guardian_email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Guardian consent" :error="fieldErrors.guardian_consent">
            <UCheckbox v-model="form.guardian_consent" label="Guardian consents" />
          </UFormField>
        </div>

        <template v-if="medicalVisible">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Allergies" :error="fieldErrors.allergies">
              <UInput v-model="form.allergies" class="w-full" />
            </UFormField>
            <UFormField label="Medical notes" :error="fieldErrors.medical_notes">
              <UInput v-model="form.medical_notes" class="w-full" />
            </UFormField>
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Emergency contact"
              :error="fieldErrors.emergency_contact_name"
            >
              <UInput v-model="form.emergency_contact_name" class="w-full" />
            </UFormField>
            <UFormField
              label="Emergency phone"
              :error="fieldErrors.emergency_contact_phone"
            >
              <UInput v-model="form.emergency_contact_phone" type="tel" class="w-full" />
            </UFormField>
          </div>
        </template>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Register" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
