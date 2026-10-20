<script setup lang="ts">
import { BLESSING_TYPES } from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

export interface BlessingPreset {
  branch?: string | null
  session?: string | null
  event?: string | null
  sunday_service?: string | null
  service_date?: string | null
}

const props = defineProps<{
  open: boolean
  branches: BranchSummary[]
  preset?: BlessingPreset
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
    blessing_type: 'salvation',
    other_label: '',
    male_count: 0,
    female_count: 0,
    branch: props.preset?.branch ?? props.branches[0]?.id ?? '',
    service_date: props.preset?.service_date ?? today(),
    notes: '',
  }
}

const form = reactive(defaults())

const branchOptions = computed(() =>
  props.branches.map((row) => ({ label: row.name, value: row.id })),
)

const typeOptions = BLESSING_TYPES.map((value) => ({
  label: value.replace(/_/g, ' '),
  value,
}))

const total = computed(
  () => Number(form.male_count || 0) + Number(form.female_count || 0),
)

const linkedProgram = computed(() => {
  const preset = props.preset
  if (!preset) return ''
  if (preset.sunday_service) return 'Linked to this service.'
  if (preset.event) return 'Linked to this event.'
  if (preset.session) return 'Linked to this session.'
  return ''
})

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
    await api.post('/api/blessings', {
      blessing_type: form.blessing_type,
      other_label: form.other_label.trim() || undefined,
      male_count: Number(form.male_count || 0),
      female_count: Number(form.female_count || 0),
      branch: form.branch || undefined,
      session: props.preset?.session ?? undefined,
      event: props.preset?.event ?? undefined,
      sunday_service: props.preset?.sunday_service ?? undefined,
      service_date: form.service_date,
      notes: form.notes.trim() || undefined,
    })
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that blessing record'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Record blessings"
    description="One blessing type per record. A program records several types, one record each."
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
        <UAlert
          v-if="linkedProgram"
          color="neutral"
          variant="subtle"
          :description="linkedProgram"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Service date" required :error="fieldErrors.service_date">
            <UInput v-model="form.service_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Blessing type" :error="fieldErrors.blessing_type">
          <USelect v-model="form.blessing_type" :items="typeOptions" class="w-full" />
        </UFormField>

        <UFormField
          v-if="form.blessing_type === 'other'"
          label="Name the other blessing"
          required
          :error="fieldErrors.other_label"
        >
          <UInput
            v-model="form.other_label"
            class="w-full"
            placeholder="For example: Delivered from addiction"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Male" :error="fieldErrors.male_count">
            <UInput v-model="form.male_count" type="number" min="0" class="w-full" />
          </UFormField>
          <UFormField label="Female" :error="fieldErrors.female_count">
            <UInput v-model="form.female_count" type="number" min="0" class="w-full" />
          </UFormField>
          <UFormField label="Total">
            <UInput :model-value="total" type="number" disabled class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Notes" :error="fieldErrors.notes">
          <UTextarea
            v-model="form.notes"
            class="w-full"
            placeholder="Optional record notes"
          />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save record" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
