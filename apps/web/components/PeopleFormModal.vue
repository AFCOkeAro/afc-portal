<script setup lang="ts">
import { personFormSchema, type PersonFormInput } from '@afc/shared'
import type { BranchSummary, PersonRow } from '~/types/portal'

const props = defineProps<{
  open: boolean
  person?: PersonRow | null
  branches: BranchSummary[]
  showDob?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

const empty = (): PersonFormInput => ({
  first_name: '',
  last_name: '',
  preferred_name: '',
  other_names: '',
  gender: 'unspecified',
  date_of_birth: '',
  phone: '',
  email: '',
  address: '',
  branch: props.branches[0]?.id ?? '',
  membership_status: 'member',
  member_since: '',
  guardian: '',
  consent_data: false,
  consent_media: false,
})

const form = reactive<PersonFormInput>(empty())

const genderOptions = [
  { label: 'Unspecified', value: 'unspecified' },
  { label: 'Female', value: 'female' },
  { label: 'Male', value: 'male' },
]

const membershipOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Regular attendee', value: 'regular_attendee' },
  { label: 'Visitor', value: 'visitor' },
  { label: 'Youth', value: 'youth' },
  { label: 'Child', value: 'child' },
  { label: 'Staff', value: 'staff' },
  { label: 'Inactive', value: 'inactive' },
]

const branchOptions = computed(() =>
  props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
)

const isMinor = computed(() => {
  if (!form.date_of_birth) return false
  const born = new Date(`${form.date_of_birth}T00:00:00Z`)
  if (Number.isNaN(born.getTime())) return false
  const now = new Date()
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear() - 18, now.getUTCMonth(), now.getUTCDate()),
  )
  return born > cutoff
})

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
    const person = props.person
    if (person) {
      Object.assign(form, {
        first_name: person.first_name,
        last_name: person.last_name,
        preferred_name: person.preferred_name ?? '',
        other_names: person.other_names ?? '',
        gender: person.gender,
        date_of_birth: person.date_of_birth ?? '',
        phone: person.phone ?? '',
        email: person.email ?? '',
        address: person.address ?? '',
        branch: person.branch ?? props.branches[0]?.id ?? '',
        membership_status: person.membership_status,
        member_since: person.member_since ?? '',
        guardian: person.guardian ?? '',
        consent_data: person.consent_data,
        consent_media: person.consent_media,
      })
    }
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  if (!props.showDob) form.date_of_birth = ''
  const parsed = personFormSchema.safeParse(form)
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
    if (props.person) {
      await api.patch(`/api/people/${props.person.id}`, parsed.data)
    } else {
      await api.post('/api/people', parsed.data)
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that person'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="person ? 'Edit person' : 'Add person'"
    description="The branch controls who can see this record."
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
          <UFormField label="First name" required :error="fieldErrors.first_name">
            <UInput v-model="form.first_name" class="w-full" />
          </UFormField>
          <UFormField label="Last name" required :error="fieldErrors.last_name">
            <UInput v-model="form.last_name" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Preferred name" :error="fieldErrors.preferred_name">
            <UInput v-model="form.preferred_name" class="w-full" />
          </UFormField>
          <UFormField label="Other names" :error="fieldErrors.other_names">
            <UInput v-model="form.other_names" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Gender" :error="fieldErrors.gender">
            <USelect v-model="form.gender" :items="genderOptions" class="w-full" />
          </UFormField>
          <UFormField label="Membership" :error="fieldErrors.membership_status">
            <USelect
              v-model="form.membership_status"
              :items="membershipOptions"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Member since" :error="fieldErrors.member_since">
            <UInput v-model="form.member_since" type="date" class="w-full" />
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

        <UFormField
          v-if="showDob"
          label="Date of birth"
          hint="Restricted field. Used to derive the minor flag and guardian requirement."
          :error="fieldErrors.date_of_birth"
        >
          <UInput v-model="form.date_of_birth" type="date" class="w-full" />
        </UFormField>

        <UFormField
          v-if="isMinor || form.guardian"
          label="Guardian"
          hint="Required for a person under 18."
          :error="fieldErrors.guardian"
        >
          <UInput
            v-model="form.guardian"
            class="w-full"
            placeholder="Guardian name and phone"
          />
        </UFormField>

        <UFormField label="Address" :error="fieldErrors.address">
          <UTextarea v-model="form.address" :rows="2" class="w-full" />
        </UFormField>

        <div class="grid gap-3 sm:grid-cols-2">
          <UCheckbox v-model="form.consent_data" label="Data consent given" />
          <UCheckbox v-model="form.consent_media" label="Media consent given" />
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="person ? 'Save changes' : 'Add person'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
