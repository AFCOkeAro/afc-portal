<script setup lang="ts">
import { COLLECTIONS, MINUTES_SAMPLES } from '@afc/shared'
import type { MinutesSample } from '@afc/shared'
import { ApiRequestError } from '~/composables/useApi'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

const form = ref({
  title: '',
  meeting_date: '',
  start_time: '',
  end_time: '',
  location: '',
  branch: '',
  body: '',
})
const attendeePerson = ref('')
const stagedAttendees = ref<Array<{ id: string; label: string }>>([])
const saving = ref(false)
const error = ref('')
const fieldErrors = ref<Record<string, string>>({})

function stageAttendee() {
  error.value = ''
  const id = attendeePerson.value.trim()
  if (!id) return
  if (stagedAttendees.value.some((row: { id: string }) => row.id === id)) {
    attendeePerson.value = ''
    return
  }
  const label =
    personOptions.value.find(
      (option: { value: string; label: string }) => option.value === id,
    )?.label ?? id
  stagedAttendees.value.push({ id, label })
  attendeePerson.value = ''
}

function unstageAttendee(id: string) {
  stagedAttendees.value = stagedAttendees.value.filter(
    (row: { id: string }) => row.id !== id,
  )
}

function loadSample(sampleId: string) {
  const sample = MINUTES_SAMPLES.find((row: MinutesSample) => row.id === sampleId)
  if (sample) form.value.body = sample.body
}

async function save() {
  error.value = ''
  fieldErrors.value = {}
  if (
    form.value.start_time &&
    form.value.end_time &&
    form.value.end_time <= form.value.start_time
  ) {
    fieldErrors.value = { end_time: 'The end time must be after the start time' }
    return
  }
  saving.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/minutes', {
      title: form.value.title,
      meeting_date: form.value.meeting_date,
      ...(form.value.start_time ? { start_time: form.value.start_time } : {}),
      ...(form.value.end_time ? { end_time: form.value.end_time } : {}),
      ...(form.value.location.trim() ? { location: form.value.location.trim() } : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      ...(form.value.body.trim() ? { body: form.value.body } : {}),
    })
    const id = String(created.data.id)
    const failed: string[] = []
    for (const row of stagedAttendees.value) {
      try {
        await api.post(`/api/minutes/${id}/attendees`, { person: row.id })
      } catch {
        failed.push(row.label)
      }
    }
    if (failed.length > 0) {
      error.value = `Minutes saved, but these attendees could not be added: ${failed.join(', ')}. Add them again on the detail page.`
      await navigateTo(`/minutes/${id}`)
      return
    }
    await navigateTo(`/minutes/${id}`)
  } catch (cause) {
    if (cause instanceof ApiRequestError) {
      fieldErrors.value = cause.fields
      error.value = cause.message
    } else {
      error.value = 'Could not save the minutes. Try again.'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="New minutes"
      description="Record a meeting with its time, venue, attendees and a styled Markdown body."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Minutes"
          to="/minutes"
        />
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField
          label="Title"
          required
          class="sm:col-span-2"
          :error="fieldErrors.title"
        >
          <UInput
            v-model="form.title"
            class="w-full"
            placeholder="e.g. Branch council meeting"
          />
        </UFormField>
        <UFormField label="Meeting date" required :error="fieldErrors.meeting_date">
          <UInput v-model="form.meeting_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Branch" :error="fieldErrors.branch">
          <EntitySelect
            v-model="form.branch"
            :items="branchOptions"
            placeholder="Select branch…"
            :loading="branchesPending"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Start time" :error="fieldErrors.start_time">
          <UInput v-model="form.start_time" type="time" class="w-full" />
        </UFormField>
        <UFormField label="End time" :error="fieldErrors.end_time">
          <UInput v-model="form.end_time" type="time" class="w-full" />
        </UFormField>
        <UFormField label="Location" class="sm:col-span-2" :error="fieldErrors.location">
          <UInput
            v-model="form.location"
            class="w-full"
            placeholder="e.g. Anthony Village Tabernacle, Main Hall"
          />
        </UFormField>

        <div class="sm:col-span-2">
          <MinutesBodyEditor
            v-model="form.body"
            textarea-id="minutes-body"
            :field-error="fieldErrors.body"
          />
          <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>Samples (replace the body):</span>
            <UButton
              v-for="sample in MINUTES_SAMPLES"
              :key="sample.id"
              size="xs"
              color="neutral"
              variant="outline"
              :label="sample.title"
              :title="sample.description"
              @click="loadSample(sample.id)"
            />
          </div>
        </div>

        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="update">
          <div class="sm:col-span-2">
            <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
              Attendees
            </span>
            <ul
              v-if="stagedAttendees.length > 0"
              class="mb-2 divide-y divide-gray-100 rounded-md border border-gray-200 text-sm dark:divide-gray-800 dark:border-gray-800"
            >
              <li
                v-for="row in stagedAttendees"
                :key="row.id"
                class="flex items-center justify-between gap-2 px-3 py-1.5"
              >
                <span class="text-gray-700 dark:text-gray-200">{{ row.label }}</span>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Remove ${row.label}`"
                  @click="unstageAttendee(row.id)"
                />
              </li>
            </ul>
            <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
              <EntitySelect
                v-model="attendeePerson"
                :items="personOptions"
                placeholder="Type a name to search…"
                :loading="personPending"
                server-search
                class="w-full"
                aria-label="Person to add as attendee"
                @update:search-term="onPersonSearch"
              />
              <UButton
                label="Add attendee"
                color="neutral"
                variant="outline"
                icon="i-lucide-user-plus"
                @click="stageAttendee"
              />
            </div>
            <p class="mt-1 text-xs text-gray-500">
              People are searched from the directory — no manual IDs. Staff-user attendees
              stay API-supported and are attached from the detail page once a scoped staff
              directory exists.
            </p>
          </div>
        </PermissionGate>
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not save the minutes"
        :description="error"
      />
      <div class="mt-4 flex gap-2">
        <PermissionGate :collection="COLLECTIONS.officeMinutes" action="create">
          <UButton
            label="Save minutes"
            icon="i-lucide-check"
            :loading="saving"
            :disabled="saving"
            @click="save"
          />
        </PermissionGate>
      </div>
    </UCard>
  </div>
</template>
