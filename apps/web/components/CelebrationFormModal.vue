<script setup lang="ts">
import { CELEBRATION_TYPES, CELEBRATION_VISIBILITIES } from '@afc/shared'
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
    person: '',
    type: 'birthday',
    event_date: today(),
    is_recurring: true,
    title: '',
    message: '',
    visibility: 'internal',
    branch: props.branches[0]?.id ?? '',
    guardian_consent: false,
  }
}

const form = reactive(defaults())

const branchOptions = computed(() =>
  props.branches.map((row) => ({ label: row.name, value: row.id })),
)

const typeOptions = CELEBRATION_TYPES.map((value) => ({
  label: value.replace(/_/g, ' '),
  value,
}))

const visibilityOptions = CELEBRATION_VISIBILITIES.map((value) => ({
  label: value,
  value,
}))

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
    await api.post('/api/celebrations', {
      person: form.person.trim() || undefined,
      type: form.type,
      event_date: form.event_date,
      is_recurring: form.is_recurring,
      title: form.title.trim() || undefined,
      message: form.message.trim() || undefined,
      visibility: form.visibility,
      branch: form.branch || undefined,
      guardian_consent: form.guardian_consent,
    })
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that celebration'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Record celebration"
    description="Birthdays and anniversaries recur yearly; shout-outs are one-off. New rows land as draft."
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
          label="Person"
          required
          :error="fieldErrors.person"
          hint="Paste the person's id from the People directory."
        >
          <UInput v-model="form.person" class="w-full" placeholder="Person id (uuid)" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Type" :error="fieldErrors.type">
            <USelect v-model="form.type" :items="typeOptions" class="w-full" />
          </UFormField>
          <UFormField label="Date" required :error="fieldErrors.event_date">
            <UInput v-model="form.event_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Title" :error="fieldErrors.title">
          <UInput
            v-model="form.title"
            class="w-full"
            placeholder="For example: Happy birthday Ada"
          />
        </UFormField>

        <UFormField label="Message" :error="fieldErrors.message">
          <UTextarea
            v-model="form.message"
            class="w-full"
            placeholder="Greeting or shout-out text"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Visibility" :error="fieldErrors.visibility">
            <USelect
              v-model="form.visibility"
              :items="visibilityOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Recurring yearly">
            <USwitch v-model="form.is_recurring" />
          </UFormField>
          <UFormField
            label="Guardian consent confirmed"
            :error="fieldErrors.guardian_consent"
            hint="Required when the person is a minor."
          >
            <USwitch v-model="form.guardian_consent" />
          </UFormField>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save draft" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
