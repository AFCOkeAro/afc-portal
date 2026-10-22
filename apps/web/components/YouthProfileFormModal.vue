<script setup lang="ts">
import {
  YOUTH_EDUCATION_LEVELS,
  YOUTH_EMPLOYMENT_STATUSES,
  YOUTH_STUDY_LEVELS,
} from '@afc/shared'
import type { BranchSummary, YouthDetail } from '~/types/portal'

const props = defineProps<{
  open: boolean
  branches: BranchSummary[]
  /** Set for edit (PATCH); omitted for create (POST). */
  profile?: YouthDetail | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

function defaults() {
  const existing = props.profile
  return {
    person: (existing?.person as string | undefined) ?? '',
    education_level: existing?.education_level ?? '',
    institution: existing?.institution ?? '',
    course: existing?.course ?? '',
    study_level: existing?.study_level ?? '',
    employment_status: existing?.employment_status ?? '',
    professional_status: existing?.professional_status ?? '',
    is_entrepreneur: existing?.is_entrepreneur ?? false,
    youth_leadership_role: existing?.youth_leadership_role ?? '',
    branch: (existing?.branch as string | undefined) ?? props.branches[0]?.id ?? '',
    status: existing?.status ?? 'active',
  }
}

const form = reactive(defaults())

const branchOptions = computed(() =>
  props.branches.map((row) => ({ label: row.name, value: row.id })),
)

const educationOptions = [
  { label: 'Not set', value: '' },
  ...YOUTH_EDUCATION_LEVELS.map((value) => ({ label: value, value })),
]

const employmentOptions = [
  { label: 'Not set', value: '' },
  ...YOUTH_EMPLOYMENT_STATUSES.map((value) => ({
    label: value.replace(/_/g, ' '),
    value,
  })),
]

const studyOptions = [
  { label: 'Not set', value: '' },
  ...YOUTH_STUDY_LEVELS.map((value) => ({ label: value.replace(/_/g, ' '), value })),
]

const statusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
]

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, defaults())
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  saving.value = true
  try {
    const payload = {
      education_level: form.education_level || undefined,
      institution: form.institution.trim() || undefined,
      course: form.course.trim() || undefined,
      study_level: form.study_level || undefined,
      employment_status: form.employment_status || undefined,
      professional_status: form.professional_status.trim() || undefined,
      is_entrepreneur: form.is_entrepreneur,
      youth_leadership_role: form.youth_leadership_role.trim() || undefined,
      branch: form.branch || undefined,
      status: form.status,
    }
    if (props.profile) {
      await api.patch(`/api/youth/${props.profile.id}`, payload)
    } else {
      await api.post('/api/youth', {
        ...payload,
        person: form.person.trim() || undefined,
      })
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that youth profile'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="props.profile ? 'Edit youth profile' : 'Link youth profile'"
    description="Youth is a segment of the shared church database: link a person, never retype them."
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

        <UFormField
          v-if="!props.profile"
          label="Person"
          required
          :error="fieldErrors.person"
          hint="Type a name to search the People directory."
        >
          <EntitySelect
            v-model="form.person"
            :items="personOptions"
            placeholder="Type a name to search…"
            :loading="personPending"
            server-search
            class="w-full"
            @update:search-term="onPersonSearch"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <EntitySelect
              v-model="form.branch"
              :items="branchOptions"
              placeholder="Select branch…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Status" :error="fieldErrors.status">
            <USelect v-model="form.status" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Education level" :error="fieldErrors.education_level">
            <USelect
              v-model="form.education_level"
              :items="educationOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Study level" :error="fieldErrors.study_level">
            <USelect v-model="form.study_level" :items="studyOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Institution" :error="fieldErrors.institution">
            <UInput
              v-model="form.institution"
              class="w-full"
              placeholder="School or university"
            />
          </UFormField>
          <UFormField label="Course" :error="fieldErrors.course">
            <UInput v-model="form.course" class="w-full" placeholder="Course of study" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Employment" :error="fieldErrors.employment_status">
            <USelect
              v-model="form.employment_status"
              :items="employmentOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Professional status"
            :error="fieldErrors.professional_status"
          >
            <UInput
              v-model="form.professional_status"
              class="w-full"
              placeholder="Profession"
            />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Youth leadership role"
            :error="fieldErrors.youth_leadership_role"
          >
            <UInput
              v-model="form.youth_leadership_role"
              class="w-full"
              placeholder="Optional role"
            />
          </UFormField>
          <UFormField label="Entrepreneur">
            <USwitch v-model="form.is_entrepreneur" />
          </UFormField>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="props.profile ? 'Save changes' : 'Link profile'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
