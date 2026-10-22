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

const route = useRoute()
const preselectedEvent =
  typeof route.query.event === 'string' && route.query.event.length > 0
    ? route.query.event
    : ''

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
        <p v-else class="mt-3 text-sm text-gray-500 dark:text-gray-400">
          The ticket code is generated by a server Flow that is not deployed yet.
        </p>
      </div>
    </UCard>

    <UCard v-else>
      <form class="space-y-5" novalidate @submit.prevent="submit">
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

        <div class="grid gap-4 sm:grid-cols-2">
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

        <div class="grid gap-4 sm:grid-cols-2">
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

        <div class="grid gap-4 sm:grid-cols-2">
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

        <template v-if="isMinor">
          <USeparator label="Guardian consent" />
          <p class="text-sm text-gray-500 dark:text-gray-400">
            The registrant is under 18, so a guardian has to consent and be reachable.
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
              <UInput v-model="form.emergency_contact_phone" type="tel" class="w-full" />
            </UFormField>
          </div>
        </template>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :description="errorMessage"
          role="alert"
        />

        <UButton
          type="submit"
          block
          :loading="submitting"
          label="Submit registration"
          trailing-icon="i-lucide-arrow-right"
        />
      </form>
    </UCard>
  </div>
</template>
