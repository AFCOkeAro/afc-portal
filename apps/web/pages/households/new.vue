<script setup lang="ts">
import { householdWizardSchema, type HouseholdWizardInput } from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const router = useRouter()

const { data: branchRows } = await useAsyncData('wizard-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'Use my branch', value: '' },
  ...(branchRows.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const roleOptions = [
  { label: 'Head of household', value: 'head_of_household' },
  { label: 'Spouse', value: 'spouse' },
  { label: 'Child', value: 'child' },
  { label: 'Relative', value: 'relative' },
]

const genderOptions = [
  { label: 'Male', value: 'male' },
  { label: 'Female', value: 'female' },
]

interface WizardMember {
  role: string
  first_name: string
  last_name: string
  gender: string
  date_of_birth: string
  phone: string
  email: string
  consent_sms: boolean
  consent_whatsapp: boolean
}

const blankMember = (role = ''): WizardMember => ({
  role,
  first_name: '',
  last_name: '',
  gender: '',
  date_of_birth: '',
  phone: '',
  email: '',
  consent_sms: false,
  consent_whatsapp: false,
})

const householdName = ref('')
const branch = ref('')
const address = ref('')
const members = ref<WizardMember[]>([blankMember('head_of_household')])

const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

function memberError(index: number, field: string): string | undefined {
  return fieldErrors.value[`members.${index}.${field}`]
}

function addPerson(): void {
  if (members.value.length >= 20) return
  members.value.push(blankMember())
}

function removePerson(index: number): void {
  if (members.value.length <= 1) return
  members.value.splice(index, 1)
}

function payload(): HouseholdWizardInput {
  return {
    branch: branch.value || undefined,
    name: householdName.value.trim() || undefined,
    address: address.value.trim() || undefined,
    members: members.value.map((member: WizardMember) => ({
      role: member.role as HouseholdWizardInput['members'][number]['role'],
      first_name: member.first_name,
      last_name: member.last_name,
      gender: member.gender as 'male' | 'female',
      date_of_birth: member.date_of_birth || undefined,
      phone: member.phone.trim() || undefined,
      email: member.email.trim() || undefined,
      consent_sms: member.consent_sms,
      consent_whatsapp: member.consent_whatsapp,
    })),
  }
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}

  // Client-side pass with the same schema the server enforces, so a staff
  // member sees named field errors before the round trip.
  const parsed = householdWizardSchema.safeParse(payload())
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.')
      if (key && !errors[key]) errors[key] = issue.message
    }
    fieldErrors.value = errors
    if (errors.members && Object.keys(errors).length === 1) {
      formError.value = errors.members
    }
    return
  }

  saving.value = true
  try {
    const result = await api.post<{ data: { household_id: string } }>(
      '/api/households/wizard',
      parsed.data,
    )
    await router.push(`/households/${result.data.household_id}`)
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that family'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/households"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to households"
      />
    </div>

    <PageHeader
      title="New family"
      description="Add a household with its members and messaging consent in one guided submit. A checked box writes one consent record; an unchecked box stores nothing."
    />

    <form novalidate @submit.prevent="submit">
      <UAlert
        v-if="formError"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="formError"
      />

      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Household</h2>
        </template>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Household name (optional)" :error="fieldErrors.name">
            <UInput
              v-model="householdName"
              class="w-full"
              placeholder="Defaults to “<Head surname> family”"
            />
          </UFormField>
          <UFormField label="Branch" :error="fieldErrors.branch">
            <EntitySelect
              v-model="branch"
              :items="branchOptions"
              placeholder="Select branch…"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="Address" class="mt-4" :error="fieldErrors.address">
          <UTextarea v-model="address" :rows="2" class="w-full" />
        </UFormField>
      </UCard>

      <UCard class="mt-6">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold" tabindex="-1">Members</h2>
            <UButton
              size="sm"
              icon="i-lucide-user-plus"
              label="Add person"
              :disabled="members.length >= 20"
              @click="addPerson"
            />
          </div>
        </template>

        <UAlert
          v-if="fieldErrors.members"
          class="mb-4"
          color="error"
          variant="subtle"
          :description="fieldErrors.members"
        />

        <div
          v-for="(member, index) in members"
          :key="index"
          class="mb-6 rounded-lg border border-gray-200 p-4 last:mb-0 dark:border-gray-800"
        >
          <div class="mb-3 flex items-center justify-between">
            <p class="text-sm font-medium">Person {{ index + 1 }}</p>
            <UButton
              v-if="members.length > 1"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              aria-label="Remove person"
              @click="removePerson(index)"
            />
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Role" required :error="memberError(index, 'role')">
              <USelect v-model="member.role" :items="roleOptions" class="w-full" />
            </UFormField>
            <UFormField label="Gender" required :error="memberError(index, 'gender')">
              <USelect v-model="member.gender" :items="genderOptions" class="w-full" />
            </UFormField>
          </div>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <UFormField
              label="First name"
              required
              :error="memberError(index, 'first_name')"
            >
              <UInput v-model="member.first_name" class="w-full" />
            </UFormField>
            <UFormField
              label="Last name"
              required
              :error="memberError(index, 'last_name')"
            >
              <UInput v-model="member.last_name" class="w-full" />
            </UFormField>
          </div>

          <div class="mt-4 grid gap-4 sm:grid-cols-3">
            <UFormField label="Birth date" :error="memberError(index, 'date_of_birth')">
              <UInput v-model="member.date_of_birth" type="date" class="w-full" />
            </UFormField>
            <UFormField label="Phone" :error="memberError(index, 'phone')">
              <UInput
                v-model="member.phone"
                type="tel"
                class="w-full"
                placeholder="08012345678"
              />
            </UFormField>
            <UFormField label="Email" :error="memberError(index, 'email')">
              <UInput
                v-model="member.email"
                type="email"
                class="w-full"
                placeholder="name@example.com"
              />
            </UFormField>
          </div>

          <div class="mt-4 flex flex-wrap gap-x-8 gap-y-2">
            <UCheckbox
              v-model="member.consent_sms"
              label="SMS consent — writes one SMS record"
            />
            <UCheckbox
              v-model="member.consent_whatsapp"
              label="WhatsApp consent — writes one WhatsApp record"
            />
          </div>
        </div>
      </UCard>

      <div class="mt-6 flex justify-end gap-2">
        <UButton to="/households" color="neutral" variant="ghost" label="Cancel" />
        <UButton type="submit" label="Save family" :loading="saving" />
      </div>
    </form>
  </div>
</template>
