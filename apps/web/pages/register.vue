<script setup lang="ts">
import type { RegistrationForm, RegistrationFormInput } from '@afc/shared'
import { registrationFormSchema, toRegistrationPayload } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

/**
 * Public event registration.
 *
 * The one page that is genuinely wired end to end: the form validates against
 * `registrationFormSchema` in the browser, and `/api/register` validates it again
 * on the server, projects it onto the public allowlist and writes it with a
 * public-scoped token. The double validation is not redundancy for its own sake —
 * the server is the one that can be attacked directly, and the browser copy exists
 * so a registrant is told what is wrong before they submit.
 *
 * Medical and emergency fields are hidden until the registrant states an age
 * group. That mirrors the server rule and it avoids asking a parent to type a
 * child's allergies before we know the form is for a child.
 *
 * AFC-871 slice 2: 7-step stepper parity with the YDD register screenshots.
 * Steps — 1 Event, 2 Name, 3 Contact, 4 Age, 5 Guardian, 6 Health & emergency,
 * 7 Review & submit. The stepper is presentation-only: the schema validates
 * the whole form on submit, and the server re-validates. Step order is a
 * stated choice (spec is silent on field-to-step mapping); guardian consent
 * stays mandatory for minors at submit regardless of which step it was shown
 * on. Progress survives per-field edits because all steps share one `form`.
 */
definePageMeta({ layout: 'public' })

/**
 * The form's own shape is the schema's *input* shape: every field is a string or
 * a checkbox, because that is what the DOM produces. `registrationFormSchema`
 * turns it into `RegistrationForm`, which is what the server accepts.
 */
const blankForm = (): RegistrationFormInput => ({
  event: '',
  registrant_first_name: '',
  registrant_last_name: '',
  email: '',
  phone: '',
  date_of_birth: '',
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
})

const form = reactive<RegistrationFormInput>(blankForm())

// AFC-649 review fix 2: programme heroes link here with ?event=<id> so the
// registrant lands on the right event instead of re-finding it. An unknown
// id (or a non-public event, which the public feed never lists) falls back
// to the picker — never a stuck invalid selection.
const route = useRoute()
const preselectedEvent =
  typeof route.query.event === 'string' && route.query.event.length > 0
    ? route.query.event
    : ''

// Public event picker (AFC-631): same session-free /api/calendar/public feed
// the public calendar page renders. Options are the public rows only.
const { data: publicEvents, pending: eventsPending } = await useAsyncData(
  'register-public-events',
  () =>
    $fetch<{ data: Array<{ id: string; title: string; date: string }> }>(
      '/api/calendar/public',
    ),
)
const eventOptions = computed(() => [
  { label: 'Choose an event', value: '' },
  ...(publicEvents.value?.data ?? []).map((row) => ({
    label: `${row.title} · ${row.date}`,
    value: row.id,
  })),
])

watch(
  publicEvents,
  (
    feed: { data: Array<{ id: string; title: string; date: string }> } | null | undefined,
  ) => {
    if (!preselectedEvent || form.event) return
    if (
      (feed?.data ?? []).some(
        (row: { id: string; title: string; date: string }) => row.id === preselectedEvent,
      )
    ) {
      form.event = preselectedEvent
    }
  },
  { immediate: true },
)

const submitting = ref(false)
const submitted = ref<{ ticket_code: string | null; registration_status: string } | null>(
  null,
)
const errorMessage = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})

const ageGroup = computed({
  get: () => form.age_group,
  set: (value: RegistrationFormInput['age_group']) => {
    form.age_group = value
  },
})

const isMinor = computed(() => ageGroup.value === 'child' || ageGroup.value === 'teen')
const showChildFields = computed(() => ageGroup.value !== 'unknown')

/* AFC-871 slice 2 stepper: 1 Event · 2 Name · 3 Contact · 4 Age · 5 Guardian · 6 Health · 7 Review. */
const STEPS = [
  { id: 1, label: 'Event' },
  { id: 2, label: 'Name' },
  { id: 3, label: 'Contact' },
  { id: 4, label: 'Age' },
  { id: 5, label: 'Guardian' },
  { id: 6, label: 'Health' },
  { id: 7, label: 'Review' },
] as const
const step = ref(1)
const stepError = ref('')

function stepValid(next: number): boolean {
  if (next === 2 && !form.event) {
    stepError.value = 'Choose an event to continue.'
    return false
  }
  if (
    next === 3 &&
    (!form.registrant_first_name.trim() || !form.registrant_last_name.trim())
  ) {
    stepError.value = 'Enter the first and last name to continue.'
    return false
  }
  if (next === 4 && !form.email.trim()) {
    stepError.value = 'Enter an email address to continue.'
    return false
  }
  if (
    next === 5 &&
    form.age_group === 'unknown' &&
    !String(form.date_of_birth ?? '').trim()
  ) {
    stepError.value = 'State the age group or date of birth to continue.'
    return false
  }
  stepError.value = ''
  return true
}

function goStep(next: number): void {
  const clamped = Math.min(7, Math.max(1, next))
  if (clamped > step.value && !stepValid(clamped)) return
  stepError.value = ''
  step.value = clamped
}

async function submit() {
  submitting.value = true
  errorMessage.value = null
  fieldErrors.value = {}

  const parsed = registrationFormSchema.safeParse(form)
  if (!parsed.success) {
    fieldErrors.value = collectFieldErrors(parsed.error)
    errorMessage.value = 'Check the highlighted fields and submit again.'
    submitting.value = false
    return
  }

  try {
    // `toRegistrationPayload` is what the server route applies to its own copy.
    // Running it here means the payload shape a registrant produces is visible in
    // the browser for anyone auditing the allowlist.
    const payload = toRegistrationPayload(parsed.data as RegistrationForm)
    const result = await $fetch<{
      id: string
      ticket_code: string | null
      registration_status: string
    }>('/api/register', { method: 'POST', body: payload })
    submitted.value = result
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      errorMessage.value = cause.message
      fieldErrors.value = cause.fields
    } else {
      errorMessage.value = 'The registration could not be submitted.'
    }
  } finally {
    submitting.value = false
  }
}

function collectFieldErrors(error: {
  issues: Array<{ path: PropertyKey[]; message: string }>
}) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    if (key && !fields[key]) fields[key] = issue.message
  }
  return fields
}
</script>

<template>
  <div>
    <PageHeader
      title="Event registration"
      description="No account needed. A guardian must consent to the registration of anyone under 18."
    />

    <UCard v-if="submitted">
      <div class="text-center">
        <UIcon name="i-lucide-circle-check" class="mx-auto size-10 text-green-600" />
        <h2 class="mt-3 text-lg font-semibold">Registration received</h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Status: <strong>{{ submitted.registration_status }}</strong>
        </p>
        <p v-if="submitted.ticket_code" class="mt-3">
          <span class="text-sm text-gray-500 dark:text-gray-400">Ticket code</span>
          <span class="ml-2 font-mono text-lg">{{ submitted.ticket_code }}</span>
        </p>
        <TicketQr
          v-if="submitted.ticket_code"
          :value="submitted.ticket_code"
          class="mt-3"
        />
        <p v-else class="mt-3 text-sm text-gray-500 dark:text-gray-400">
          The ticket code is generated by a server Flow that is not deployed yet.
        </p>
      </div>
    </UCard>

    <UCard v-else>
      <!-- AFC-871 slice 2 stepper -->
      <ol aria-label="Registration steps" class="mb-5 flex flex-wrap gap-1.5">
        <li v-for="entry in STEPS" :key="entry.id">
          <button
            type="button"
            :aria-current="step === entry.id ? 'step' : undefined"
            :class="[
              'rounded-full px-3 py-1 text-xs font-medium',
              step === entry.id
                ? 'bg-primary-950 text-white'
                : entry.id < step
                  ? 'bg-green-100 text-green-900 dark:bg-green-900 dark:text-green-100'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
            ]"
            @click="goStep(entry.id)"
          >
            {{ entry.id }} · {{ entry.label }}
          </button>
        </li>
      </ol>

      <form class="space-y-5" novalidate @submit.prevent="submit">
        <!-- Step 1: event -->
        <div v-if="step === 1">
          <UFormField label="Event" name="event" required :error="fieldErrors.event">
            <EntitySelect
              v-model="form.event"
              name="event"
              :items="eventOptions"
              placeholder="Type to find your event…"
              :loading="eventsPending"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Step 2: name -->
        <div v-if="step === 2" class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="First name"
            name="registrant_first_name"
            required
            :error="fieldErrors.registrant_first_name"
          >
            <UInput v-model="form.registrant_first_name" class="w-full" />
          </UFormField>
          <UFormField
            label="Last name"
            name="registrant_last_name"
            required
            :error="fieldErrors.registrant_last_name"
          >
            <UInput v-model="form.registrant_last_name" class="w-full" />
          </UFormField>
        </div>

        <!-- Step 3: contact -->
        <div v-if="step === 3" class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Email" name="email" required :error="fieldErrors.email">
            <UInput v-model="form.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Phone" name="phone" :error="fieldErrors.phone">
            <UInput
              v-model="form.phone"
              type="tel"
              class="w-full"
              placeholder="08012345678"
            />
          </UFormField>
        </div>

        <!-- Step 4: age -->
        <div v-if="step === 4" class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Age group"
            name="age_group"
            required
            :error="fieldErrors.age_group"
          >
            <USelect
              v-model="ageGroup"
              :items="[
                { label: 'Adult', value: 'adult' },
                { label: 'Youth', value: 'youth' },
                { label: 'Teen', value: 'teen' },
                { label: 'Child', value: 'child' },
                { label: 'Prefer not to say', value: 'unknown' },
              ]"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Date of birth"
            name="date_of_birth"
            hint="Used only to check the age group and to ask for guardian consent."
            :error="fieldErrors.date_of_birth"
          >
            <UInput v-model="form.date_of_birth" type="date" class="w-full" />
          </UFormField>
        </div>

        <!-- Step 5: guardian -->
        <div v-if="step === 5">
          <template v-if="isMinor || ageGroup === 'unknown'">
            <USeparator label="Guardian consent" />
            <p class="text-sm text-gray-500 dark:text-gray-400">
              The registrant is under 18 (or the age is unstated), so a guardian has to
              consent and be reachable.
            </p>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Guardian name"
                name="guardian_name"
                required
                :error="fieldErrors.guardian_name"
              >
                <UInput v-model="form.guardian_name" class="w-full" />
              </UFormField>
              <UFormField
                label="Guardian phone"
                name="guardian_phone"
                :error="fieldErrors.guardian_phone"
              >
                <UInput v-model="form.guardian_phone" type="tel" class="w-full" />
              </UFormField>
            </div>

            <UFormField
              label="Guardian email"
              name="guardian_email"
              :error="fieldErrors.guardian_email"
            >
              <UInput v-model="form.guardian_email" type="email" class="w-full" />
            </UFormField>

            <UCheckbox
              v-model="form.guardian_consent"
              name="guardian_consent"
              :error="fieldErrors.guardian_consent"
              label="I am the parent or guardian and I consent to this registration and to the church storing these details."
            />
          </template>
          <UAlert
            v-else
            color="success"
            variant="subtle"
            title="No guardian needed"
            description="The registrant is an adult, so this step is informational. Continue to health details."
          />
        </div>

        <!-- Step 6: health & emergency -->
        <div v-if="step === 6">
          <template v-if="showChildFields">
            <USeparator label="Optional" />

            <UFormField label="Allergies" name="allergies" :error="fieldErrors.allergies">
              <UTextarea v-model="form.allergies" :rows="2" class="w-full" />
            </UFormField>

            <UFormField
              label="Medical notes"
              name="medical_notes"
              hint="Only church staff permitted to see this field will read it."
              :error="fieldErrors.medical_notes"
            >
              <UTextarea v-model="form.medical_notes" :rows="3" class="w-full" />
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Emergency contact"
                name="emergency_contact_name"
                :error="fieldErrors.emergency_contact_name"
              >
                <UInput v-model="form.emergency_contact_name" class="w-full" />
              </UFormField>
              <UFormField
                label="Emergency phone"
                name="emergency_contact_phone"
                :error="fieldErrors.emergency_contact_phone"
              >
                <UInput
                  v-model="form.emergency_contact_phone"
                  type="tel"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>
          <UAlert
            v-else
            color="neutral"
            variant="subtle"
            title="Nothing to add here"
            description="State the age group on step 4 before giving medical or emergency details."
          />
        </div>

        <!-- Step 7: review -->
        <div v-if="step === 7">
          <USeparator label="Review" />
          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-gray-500">Event</dt>
              <dd>{{ form.event || '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Name</dt>
              <dd>{{ form.registrant_first_name }} {{ form.registrant_last_name }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Email</dt>
              <dd>{{ form.email || '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Phone</dt>
              <dd>{{ form.phone || '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Age group</dt>
              <dd>{{ form.age_group }}</dd>
            </div>
            <div>
              <dt class="text-gray-500">Guardian consent</dt>
              <dd>{{ form.guardian_consent ? 'Yes' : 'No' }}</dd>
            </div>
          </dl>
        </div>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="errorMessage"
          role="alert"
        />
        <UAlert
          v-if="stepError"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="stepError"
          role="alert"
        />

        <div class="flex gap-2">
          <UButton
            v-if="step > 1"
            color="neutral"
            variant="outline"
            label="Back"
            icon="i-lucide-arrow-left"
            @click="goStep(step - 1)"
          />
          <UButton
            v-if="step < 7"
            block
            label="Continue"
            trailing-icon="i-lucide-arrow-right"
            @click="goStep(step + 1)"
          />
          <UButton
            v-else
            type="submit"
            block
            :loading="submitting"
            label="Submit registration"
            trailing-icon="i-lucide-arrow-right"
          />
        </div>
      </form>
    </UCard>
  </div>
</template>
