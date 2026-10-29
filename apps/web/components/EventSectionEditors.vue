<script setup lang="ts">
import { SECTION_VISIBILITIES } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'
import type { EventDetail } from '~/types/portal'

/**
 * Staff programme-section editors (AFC-871 slice 2).
 *
 * One card: four per-section visibility marks (draft/private/public/login/
 * custom, fail-closed default private) plus the three jsonb section arrays
 * (speakers/resources/schedule). Saves through PATCH /api/events/[id],
 * which already runs the shared `eventFormSchema` — the arrays travel only
 * when this editor sends them, so older staff forms cannot wipe them.
 *
 * `custom` has no audience model: the public detail route never serves it.
 * Staff can store the mark; the signed-out surface fails closed.
 */
const props = defineProps<{ event: EventDetail }>()

const emit = defineEmits<{ refreshed: [] }>()

const api = useApi()

const visibilityOptions = SECTION_VISIBILITIES.map((value) => ({
  label: value,
  value,
}))

const registrationVisibility = ref<string>(
  props.event.registration_visibility ?? 'private',
)
const speakersVisibility = ref<string>(props.event.speakers_visibility ?? 'private')
const resourcesVisibility = ref<string>(props.event.resources_visibility ?? 'private')
const scheduleVisibility = ref<string>(props.event.schedule_visibility ?? 'private')

const speakersText = ref(JSON.stringify(props.event.speakers ?? [], null, 2))
const resourcesText = ref(JSON.stringify(props.event.resources ?? [], null, 2))
const scheduleText = ref(JSON.stringify(props.event.schedule ?? [], null, 2))

watch(
  () => props.event.id,
  () => {
    registrationVisibility.value = props.event.registration_visibility ?? 'private'
    speakersVisibility.value = props.event.speakers_visibility ?? 'private'
    resourcesVisibility.value = props.event.resources_visibility ?? 'private'
    scheduleVisibility.value = props.event.schedule_visibility ?? 'private'
    speakersText.value = JSON.stringify(props.event.speakers ?? [], null, 2)
    resourcesText.value = JSON.stringify(props.event.resources ?? [], null, 2)
    scheduleText.value = JSON.stringify(props.event.schedule ?? [], null, 2)
  },
)

const saving = ref(false)
const saveError = ref('')
const savedAt = ref('')

function parseSectionArray(raw: string, label: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array`)
  return parsed as Array<Record<string, unknown>>
}

async function save(): Promise<void> {
  saving.value = true
  saveError.value = ''
  savedAt.value = ''
  try {
    let speakers: Array<Record<string, unknown>>
    let resources: Array<Record<string, unknown>>
    let schedule: Array<Record<string, unknown>>
    try {
      speakers = parseSectionArray(speakersText.value, 'Speakers')
      resources = parseSectionArray(resourcesText.value, 'Resources')
      schedule = parseSectionArray(scheduleText.value, 'Schedule')
    } catch (cause) {
      saveError.value =
        cause instanceof Error ? cause.message : 'Sections must be JSON arrays'
      return
    }
    await api.patch(`/api/events/${props.event.id}`, {
      title: props.event.title,
      summary: props.event.summary,
      description: (props.event as { description?: string | null }).description ?? null,
      event_type: props.event.event_type,
      branch: props.event.branch,
      start_at: props.event.start_at,
      end_at: props.event.end_at,
      location: props.event.location,
      address: props.event.address,
      capacity: props.event.capacity,
      waitlist_enabled: props.event.waitlist_enabled,
      registration_opens_at: props.event.registration_opens_at,
      registration_closes_at: props.event.registration_closes_at,
      fee_amount: props.event.fee_amount,
      currency: props.event.currency,
      requires_guardian_consent: props.event.requires_guardian_consent,
      collect_medical: props.event.collect_medical,
      age_min: props.event.age_min,
      age_max: props.event.age_max,
      visibility: props.event.visibility,
      status: props.event.status,
      registration_visibility: registrationVisibility.value,
      speakers_visibility: speakersVisibility.value,
      resources_visibility: resourcesVisibility.value,
      schedule_visibility: scheduleVisibility.value,
      speakers,
      resources,
      schedule,
    })
    savedAt.value = new Date().toLocaleTimeString()
    emit('refreshed')
  } catch (cause) {
    saveError.value =
      cause instanceof ApiRequestError ? cause.message : 'Could not save sections.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-sm font-semibold">Public sections</h2>
      <p class="text-xs text-gray-500">
        Each section serves publicly only at <code>public</code>. Login and custom stay
        hidden from signed-out visitors; custom has no audience model yet.
      </p>
    </template>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Registration access" name="registration_visibility">
        <USelect
          v-model="registrationVisibility"
          :items="visibilityOptions"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Speakers access" name="speakers_visibility">
        <USelect v-model="speakersVisibility" :items="visibilityOptions" class="w-full" />
      </UFormField>
      <UFormField label="Resources access" name="resources_visibility">
        <USelect
          v-model="resourcesVisibility"
          :items="visibilityOptions"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Schedule access" name="schedule_visibility">
        <USelect v-model="scheduleVisibility" :items="visibilityOptions" class="w-full" />
      </UFormField>
    </div>

    <div class="mt-4 grid gap-4">
      <UFormField
        label="Speakers (JSON array)"
        name="speakers"
        hint='e.g. [{"name":"...","role":"..."}]'
      >
        <UTextarea v-model="speakersText" :rows="4" class="w-full font-mono text-xs" />
      </UFormField>
      <UFormField
        label="Resources (JSON array)"
        name="resources"
        hint='e.g. [{"title":"...","url":"..."}]'
      >
        <UTextarea v-model="resourcesText" :rows="4" class="w-full font-mono text-xs" />
      </UFormField>
      <UFormField
        label="Schedule (JSON array)"
        name="schedule"
        hint='e.g. [{"day":"Fri","time":"18:00","title":"..."}]'
      >
        <UTextarea v-model="scheduleText" :rows="4" class="w-full font-mono text-xs" />
      </UFormField>
    </div>

    <UAlert
      v-if="saveError"
      class="mt-3"
      color="error"
      variant="subtle"
      :description="saveError"
      role="alert"
    />
    <p v-if="savedAt" class="mt-2 text-xs text-green-700">Saved at {{ savedAt }}.</p>

    <template #footer>
      <UButton
        size="sm"
        label="Save sections"
        icon="i-lucide-save"
        :loading="saving"
        @click="save"
      />
    </template>
  </UCard>
</template>
