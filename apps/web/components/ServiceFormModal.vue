<script setup lang="ts">
import type { BranchSummary } from '~/types/portal'

const props = defineProps<{
  open: boolean
  branches: BranchSummary[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaults() {
  return {
    branch: props.branches[0]?.id ?? '',
    service_date: today(),
    service_time: '09:00',
    service_type: 'sunday',
    theme: '',
    expected_attendance: 0,
    status: 'planned',
    notes: '',
  }
}

const form = reactive(defaults())

const branchOptions = computed(() =>
  props.branches.map((row) => ({ label: row.name, value: row.id })),
)

const typeOptions = [
  { label: 'Sunday', value: 'sunday' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Special', value: 'special' },
  { label: 'Camp', value: 'camp' },
]

const statusOptions = [
  { label: 'Planned', value: 'planned' },
  { label: 'Completed', value: 'completed' },
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
    await api.post('/api/services', {
      branch: form.branch || undefined,
      service_date: form.service_date,
      service_time: form.service_time || undefined,
      service_type: form.service_type,
      theme: form.theme.trim() || undefined,
      expected_attendance: Number(form.expected_attendance || 0),
      status: form.status,
      notes: form.notes.trim() || undefined,
    })
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that service'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Plan a service"
    description="Sunday, midweek, special or camp. The roster is assigned after the service is planned."
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
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Date" required :error="fieldErrors.service_date">
            <UInput v-model="form.service_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Time" :error="fieldErrors.service_time">
            <UInput v-model="form.service_time" type="time" class="w-full" />
          </UFormField>
          <UFormField label="Service type" :error="fieldErrors.service_type">
            <USelect v-model="form.service_type" :items="typeOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Theme" :error="fieldErrors.theme">
          <UInput
            v-model="form.theme"
            class="w-full"
            placeholder="For example: Grace for the journey"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Expected attendance"
            :error="fieldErrors.expected_attendance"
          >
            <UInput
              v-model="form.expected_attendance"
              type="number"
              min="0"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Status" :error="fieldErrors.status">
            <USelect v-model="form.status" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Notes" :error="fieldErrors.notes">
          <UTextarea
            v-model="form.notes"
            class="w-full"
            placeholder="Optional planning notes"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save service" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
