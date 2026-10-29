<script setup lang="ts">
import { householdWizardSchema, type HouseholdWizardInput } from '@afc/shared'
import type { BscSummary, BranchSummary } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const router = useRouter()

const { data: branchRows } = await useAsyncData('wizard-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const { data: bscRows } = await useAsyncData('wizard-bscs', () =>
  api.get<BscSummary[]>('/api/bscs'),
)

const branchOptions = computed(() => [
  ...(branchRows.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const memberBranchOptions = computed(() => [
  ...(branchRows.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const bscOptions = computed(() => [
  ...(bscRows.value ?? []).map((row) => ({ label: row.name, value: row.id })),
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

const statusOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Regular attendee', value: 'regular_attendee' },
  { label: 'Visitor', value: 'visitor' },
  { label: 'Youth', value: 'youth' },
  { label: 'Child', value: 'child' },
  { label: 'Staff', value: 'staff' },
  { label: 'Inactive', value: 'inactive' },
]

const roleLabels: Record<string, string> = {
  head_of_household: 'Head',
  spouse: 'Spouse',
  child: 'Child',
  relative: 'Relative',
}

const statusLabels: Record<string, string> = {
  member: 'Member',
  regular_attendee: 'Regular',
  visitor: 'Visitor',
  youth: 'Youth',
  child: 'Child',
  staff: 'Staff',
  inactive: 'Inactive',
}

interface WizardMember {
  role: string
  first_name: string
  middle_name: string
  last_name: string
  suffix: string
  gender: string
  birthY: string
  birthM: string
  birthD: string
  phone: string
  email: string
  branch: string | undefined
  membership_status: string | undefined
  bsc: string | undefined
  consent_sms: boolean
  consent_whatsapp: boolean
  expanded: boolean
}

const blankMember = (role = '', expanded = true): WizardMember => ({
  role,
  first_name: '',
  middle_name: '',
  last_name: '',
  suffix: '',
  gender: '',
  birthY: '',
  birthM: '',
  birthD: '',
  phone: '',
  email: '',
  branch: undefined,
  membership_status: undefined,
  bsc: undefined,
  consent_sms: false,
  consent_whatsapp: false,
  expanded,
})

const householdName = ref('')
const branch = ref<string | undefined>(undefined)
const weddingDate = ref('')
const address = ref('')
const address1 = ref('')
const address2 = ref('')
const city = ref('')
const state = ref('')
const zip = ref('')
const country = ref('')
const latitude = ref('')
const longitude = ref('')
const members = ref<WizardMember[]>([blankMember('head_of_household')])

const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

function memberError(index: number, field: string): string | undefined {
  return fieldErrors.value[`members.${index}.${field}`]
}

function displayName(member: WizardMember): string {
  const bits = [member.first_name.trim(), member.last_name.trim()].filter(Boolean)
  if (member.suffix.trim()) bits.push(member.suffix.trim())
  return bits.join(' ') || 'Unnamed person'
}

/** Month/day/year inputs map to one YYYY-MM-DD date (or undefined). */
function birthIso(member: WizardMember): string | undefined {
  const { birthY: y, birthM: m, birthD: d } = member
  if (!y && !m && !d) return undefined
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (!year || !month || !day) return 'incomplete'
  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return 'invalid'
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function displayBirth(member: WizardMember): string {
  const iso = birthIso(member)
  if (iso === undefined) return ''
  if (iso === 'incomplete' || iso === 'invalid') return 'Check date'
  return iso
}

function toggleMember(index: number): void {
  members.value[index].expanded = !members.value[index].expanded
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
  const numOrUndefined = (raw: string): number | undefined => {
    const trimmed = raw.trim()
    if (!trimmed) return undefined
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : Number.NaN
  }
  return {
    branch: branch.value || undefined,
    name: householdName.value.trim() || undefined,
    wedding_date: weddingDate.value || undefined,
    address: address.value.trim() || undefined,
    address_1: address1.value.trim() || undefined,
    address_2: address2.value.trim() || undefined,
    city: city.value.trim() || undefined,
    state: state.value.trim() || undefined,
    zip: zip.value.trim() || undefined,
    country: country.value.trim() || undefined,
    latitude: numOrUndefined(latitude.value),
    longitude: numOrUndefined(longitude.value),
    members: members.value.map((member: WizardMember) => ({
      role: member.role as HouseholdWizardInput['members'][number]['role'],
      first_name: member.first_name,
      middle_name: member.middle_name.trim() || undefined,
      last_name: member.last_name,
      suffix: member.suffix.trim() || undefined,
      gender: member.gender as 'male' | 'female',
      date_of_birth: birthIso(member),
      phone: member.phone.trim() || undefined,
      email: member.email.trim() || undefined,
      branch: member.branch || undefined,
      membership_status: (member.membership_status ||
        undefined) as HouseholdWizardInput['members'][number]['membership_status'],
      bsc: member.bsc || undefined,
      consent_sms: member.consent_sms,
      consent_whatsapp: member.consent_whatsapp,
    })),
  }
}

function resetWizard(): void {
  householdName.value = ''
  branch.value = undefined
  weddingDate.value = ''
  address.value = ''
  address1.value = ''
  address2.value = ''
  city.value = ''
  state.value = ''
  zip.value = ''
  country.value = ''
  latitude.value = ''
  longitude.value = ''
  members.value = [blankMember('head_of_household')]
}

async function submit(saveAndNew = false): Promise<void> {
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
    // Open every row that carries an error so nothing hides.
    members.value.forEach((member: WizardMember, index: number) => {
      if (Object.keys(errors).some((key) => key.startsWith(`members.${index}.`))) {
        member.expanded = true
      }
    })
    return
  }

  saving.value = true
  try {
    const result = await api.post<{ data: { household_id: string } }>(
      '/api/households/wizard',
      parsed.data,
    )
    if (saveAndNew) {
      resetWizard()
      formError.value = ''
      return
    }
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

    <form novalidate @submit.prevent="submit(false)">
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
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <UFormField label="Wedding date (optional)" :error="fieldErrors.wedding_date">
            <UInput v-model="weddingDate" type="date" class="w-full" />
          </UFormField>
          <UFormField
            label="Old address line (kept readable)"
            :error="fieldErrors.address"
          >
            <UInput
              v-model="address"
              class="w-full"
              placeholder="Legacy single-line address"
            />
          </UFormField>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <UFormField label="Address line 1" :error="fieldErrors.address_1">
            <UInput v-model="address1" class="w-full" placeholder="14 Church St" />
          </UFormField>
          <UFormField label="Address line 2 (optional)" :error="fieldErrors.address_2">
            <UInput
              v-model="address2"
              class="w-full"
              placeholder="Flat, block, landmark"
            />
          </UFormField>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <UFormField label="City" :error="fieldErrors.city">
            <UInput v-model="city" class="w-full" />
          </UFormField>
          <UFormField label="State" :error="fieldErrors.state">
            <UInput v-model="state" class="w-full" />
          </UFormField>
          <UFormField label="ZIP (optional)" :error="fieldErrors.zip">
            <UInput v-model="zip" class="w-full" />
          </UFormField>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-3">
          <UFormField label="Country" :error="fieldErrors.country">
            <UInput v-model="country" class="w-full" placeholder="Nigeria" />
          </UFormField>
          <UFormField label="Latitude (optional)" :error="fieldErrors.latitude">
            <UInput
              v-model="latitude"
              inputmode="decimal"
              class="w-full"
              placeholder="6.5244"
            />
          </UFormField>
          <UFormField label="Longitude (optional)" :error="fieldErrors.longitude">
            <UInput
              v-model="longitude"
              inputmode="decimal"
              class="w-full"
              placeholder="3.3792"
            />
          </UFormField>
        </div>
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
          class="mb-3 rounded-lg border border-gray-200 last:mb-0 dark:border-gray-800"
          :class="member.expanded ? 'p-4' : ''"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-left"
            :class="
              member.expanded
                ? 'mb-3 border-b border-gray-100 pb-3 dark:border-gray-800'
                : ''
            "
            :aria-expanded="member.expanded"
            @click="toggleMember(index)"
          >
            <UIcon
              :name="member.expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              class="size-4 shrink-0 text-gray-400"
            />
            <span class="min-w-0 flex-1 truncate text-sm">
              <span class="font-medium">{{ displayName(member) }}</span>
              <span class="text-gray-500 dark:text-gray-400">
                · {{ roleLabels[member.role] || 'Pick role' }} ·
                {{ displayBirth(member) || 'No birth date' }} ·
                {{
                  member.membership_status
                    ? statusLabels[member.membership_status]
                    : 'Auto'
                }}
              </span>
            </span>
            <span
              v-if="
                memberError(index, 'role') ||
                memberError(index, 'first_name') ||
                memberError(index, 'last_name') ||
                memberError(index, 'gender') ||
                memberError(index, 'date_of_birth')
              "
              class="size-2 shrink-0 rounded-full bg-red-500"
              aria-label="This row has errors"
            />
            <UButton
              v-if="members.length > 1"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-x"
              aria-label="Remove person"
              @click.stop="removePerson(index)"
            />
          </button>

          <div v-if="member.expanded" class="px-1 pb-1">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="First name"
                required
                :error="memberError(index, 'first_name')"
              >
                <UInput v-model="member.first_name" class="w-full" />
              </UFormField>
              <UFormField
                label="Middle name (optional)"
                :error="memberError(index, 'middle_name')"
              >
                <UInput v-model="member.middle_name" class="w-full" />
              </UFormField>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Last name"
                required
                :error="memberError(index, 'last_name')"
              >
                <UInput v-model="member.last_name" class="w-full" />
              </UFormField>
              <UFormField label="Suffix (optional)" :error="memberError(index, 'suffix')">
                <UInput
                  v-model="member.suffix"
                  class="w-full"
                  placeholder="Jr, Sr, III"
                />
              </UFormField>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-3">
              <UFormField
                label="Birth month"
                :error="memberError(index, 'date_of_birth')"
              >
                <UInput
                  v-model="member.birthM"
                  inputmode="numeric"
                  class="w-full"
                  placeholder="MM"
                  maxlength="2"
                  aria-label="Birth month"
                />
              </UFormField>
              <UFormField label="Birth day" :error="memberError(index, 'date_of_birth')">
                <UInput
                  v-model="member.birthD"
                  inputmode="numeric"
                  class="w-full"
                  placeholder="DD"
                  maxlength="2"
                  aria-label="Birth day"
                />
              </UFormField>
              <UFormField label="Birth year" :error="memberError(index, 'date_of_birth')">
                <UInput
                  v-model="member.birthY"
                  inputmode="numeric"
                  class="w-full"
                  placeholder="YYYY"
                  maxlength="4"
                  aria-label="Birth year"
                />
              </UFormField>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <UFormField label="Role" required :error="memberError(index, 'role')">
                <USelect
                  v-model="member.role"
                  :items="roleOptions"
                  placeholder="Select role…"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Gender" required :error="memberError(index, 'gender')">
                <USelect
                  v-model="member.gender"
                  :items="genderOptions"
                  placeholder="Select gender…"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
              <UFormField label="Member branch" :error="memberError(index, 'branch')">
                <EntitySelect
                  v-model="member.branch"
                  :items="memberBranchOptions"
                  placeholder="Select branch…"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Status" :error="memberError(index, 'membership_status')">
                <USelect
                  v-model="member.membership_status"
                  :items="statusOptions"
                  placeholder="Auto by age"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="mt-4">
              <UFormField label="Bible Study Centre" :error="memberError(index, 'bsc')">
                <EntitySelect
                  v-model="member.bsc"
                  :items="bscOptions"
                  placeholder="Select centre…"
                  class="w-full"
                />
              </UFormField>
            </div>

            <div class="mt-4 grid gap-4 sm:grid-cols-2">
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
        </div>
      </UCard>

      <div class="mt-6 flex flex-wrap justify-end gap-2">
        <UButton to="/households" color="neutral" variant="ghost" label="Cancel" />
        <UButton
          type="button"
          label="Save and add new"
          color="neutral"
          variant="outline"
          :loading="saving"
          @click="submit(true)"
        />
        <UButton type="submit" label="Save family" :loading="saving" />
      </div>
    </form>
  </div>
</template>
