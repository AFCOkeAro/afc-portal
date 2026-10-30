<script setup lang="ts">
import type { CollectionName, CustomFormFieldDef } from '@afc/shared'
import type { CustomFormRow } from '~/types/portal'

/**
 * Custom form renderer (AFC-897, phase 1): on a linked module page, lists
 * the custom forms built for that module and fills one. The fill writes
 * through `POST /api/custom-forms/:id/submissions`, which holds create on
 * the linked module and re-checks every value -- this component draws
 * inputs, it grants nothing.
 */
const props = defineProps<{
  module: string
}>()

const api = useApi()
const permissions = usePermissions()

interface DraftValue {
  text: string
  checked: boolean
}

const forms = ref<CustomFormRow[]>([])
const pending = ref(true)
const error = ref('')
const active = ref<CustomFormRow | null>(null)
const draft = ref<Record<string, DraftValue>>({})
const submitting = ref(false)
const submitError = ref('')
const doneMessage = ref('')

const canFill = computed(() => permissions.can(props.module as CollectionName, 'create'))

function blankDraft(form: CustomFormRow): Record<string, DraftValue> {
  const next: Record<string, DraftValue> = {}
  for (const field of form.schema.fields ?? []) {
    next[field.key] = { text: '', checked: false }
  }
  return next
}

function openFill(form: CustomFormRow): void {
  active.value = form
  draft.value = blankDraft(form)
  submitError.value = ''
  doneMessage.value = ''
}

function closeFill(): void {
  active.value = null
}

async function loadForms(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: CustomFormRow[] }>('/api/custom-forms', {
      query: { module: props.module },
    })
    forms.value = res.data ?? []
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not load custom forms'
  } finally {
    pending.value = false
  }
}

function selectOptions(
  field: CustomFormFieldDef,
): Array<{ label: string; value: string }> {
  return (field.options ?? []).map((option: string) => ({
    label: option,
    value: option,
  }))
}

function coerce(field: CustomFormFieldDef, raw: DraftValue): unknown {
  if (field.type === 'boolean') return raw.checked
  const text = raw.text.trim()
  if (text === '') return undefined
  if (field.type === 'integer' || field.type === 'number') {
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : text
  }
  return raw.text
}

async function submitFill(): Promise<void> {
  if (!active.value) return
  submitting.value = true
  submitError.value = ''
  try {
    const values: Record<string, unknown> = {}
    for (const field of active.value.schema.fields ?? []) {
      const coerced = coerce(
        field,
        draft.value[field.key] ?? { text: '', checked: false },
      )
      if (coerced !== undefined) values[field.key] = coerced
    }
    await api.post(`/api/custom-forms/${active.value.id}/submissions`, { values })
    doneMessage.value = `"${active.value.name}" submitted.`
    draft.value = blankDraft(active.value)
  } catch (cause) {
    submitError.value =
      (cause as { message?: string }).message ?? 'Could not submit this form'
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  void loadForms()
})
</script>

<template>
  <div v-if="!pending && (forms.length > 0 || error)">
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load custom forms"
      :description="error"
    />
    <div v-else class="grid gap-3 sm:grid-cols-2">
      <UCard v-for="form in forms" :key="form.id">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-semibold">{{ form.name }}</span>
            <UBadge color="neutral" variant="subtle">Custom form</UBadge>
          </div>
        </template>
        <p class="text-sm text-gray-500">
          {{ (form.schema.fields ?? []).length }} fields
        </p>
        <UButton
          v-if="canFill"
          class="mt-3"
          label="Fill form"
          color="neutral"
          variant="outline"
          size="sm"
          @click="openFill(form)"
        />
      </UCard>
    </div>

    <UModal
      :open="active !== null"
      title="Fill form"
      @update:open="
        (open: boolean) => {
          if (!open) closeFill()
        }
      "
    >
      <template #body>
        <div v-if="active" class="grid gap-3">
          <p class="font-semibold">{{ active.name }}</p>
          <UFormField
            v-for="field in active.schema.fields ?? []"
            :key="field.key"
            :label="field.label"
            :required="field.required"
          >
            <UInput
              v-if="field.type === 'string'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).text"
              class="w-full"
            />
            <UTextarea
              v-else-if="field.type === 'text'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).text"
              class="w-full"
            />
            <UInput
              v-else-if="field.type === 'number' || field.type === 'integer'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).text"
              type="number"
              class="w-full"
            />
            <UInput
              v-else-if="field.type === 'date'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).text"
              type="date"
              class="w-full"
            />
            <UCheckbox
              v-else-if="field.type === 'boolean'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).checked"
              :label="field.label"
            />
            <USelect
              v-else-if="field.type === 'select'"
              v-model="(draft[field.key] ??= { text: '', checked: false }).text"
              :items="selectOptions(field)"
              placeholder="Choose"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="submitError"
            color="error"
            variant="subtle"
            title="Could not submit this form"
            :description="submitError"
          />
          <UAlert
            v-if="doneMessage"
            color="success"
            variant="subtle"
            :title="doneMessage"
          />
          <div class="flex gap-2">
            <UButton label="Submit" :loading="submitting" @click="submitFill" />
            <UButton label="Close" color="neutral" variant="outline" @click="closeFill" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
