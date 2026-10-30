<script setup lang="ts">
import {
  CUSTOM_FORM_FIELD_TYPES,
  CUSTOM_FORM_MODULES,
  type CustomFormFieldType,
} from '@afc/shared'

/**
 * Custom form builder (AFC-897, phase 1): name the form, link it to a v1
 * module, and tick the database columns it collects. The column list comes
 * from `/api/custom-forms/fields` (live Directus introspection), never from
 * a checked-in copy; columns the database refuses to leave empty arrive
 * pre-ticked as required. The create route re-checks everything against
 * the same live list, so this UI is convenience, not control.
 */
const emit = defineEmits<{
  created: []
  cancel: []
}>()

const api = useApi()

const MODULE_LABELS: Record<(typeof CUSTOM_FORM_MODULES)[number], string> = {
  visitors: 'Visitors',
  people: 'People',
  households: 'Households',
  welfare_cases: 'Welfare cases',
  blessings: 'Blessings',
  announcements: 'Announcements',
  tasks: 'Tasks',
}

interface ColumnDraft {
  name: string
  kind: CustomFormFieldType
  requiredByDb: boolean
  included: boolean
  required: boolean
  label: string
  type: CustomFormFieldType
  optionsText: string
}

type ModuleValue = (typeof CUSTOM_FORM_MODULES)[number] | ''

const name = ref('')
const module = ref<ModuleValue>('')
const columns = ref<ColumnDraft[]>([])
const loadingFields = ref(false)
const fieldsError = ref('')
const saving = ref(false)
const saveError = ref('')

function prettyLabel(key: string): string {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function loadFields(next: string): Promise<void> {
  columns.value = []
  fieldsError.value = ''
  if (next === '') return
  loadingFields.value = true
  try {
    const res = await api.get<{
      data: {
        module: string
        fields: Array<{
          name: string
          kind: CustomFormFieldType
          nullable: boolean
          hasDefault: boolean
        }>
      }
    }>('/api/custom-forms/fields', { query: { module: next } })
    columns.value = (res.data?.fields ?? []).map((column) => {
      const requiredByDb = !column.nullable && !column.hasDefault
      return {
        name: column.name,
        kind: column.kind,
        requiredByDb,
        included: false,
        required: requiredByDb,
        label: prettyLabel(column.name),
        type: column.kind,
        optionsText: '',
      }
    })
  } catch (cause) {
    fieldsError.value =
      (cause as { message?: string }).message ?? 'Could not load the module fields'
  } finally {
    loadingFields.value = false
  }
}

const moduleOptions: Array<{
  label: string
  value: (typeof CUSTOM_FORM_MODULES)[number]
}> = CUSTOM_FORM_MODULES.map((value: (typeof CUSTOM_FORM_MODULES)[number]) => ({
  label: MODULE_LABELS[value],
  value,
}))

const typeOptions: Array<{ label: string; value: CustomFormFieldType }> =
  CUSTOM_FORM_FIELD_TYPES.map((value: CustomFormFieldType) => ({
    label: value,
    value,
  }))

watch(module, (next: ModuleValue) => {
  void loadFields(next)
})

const includedCount = computed(
  () => columns.value.filter((c: ColumnDraft) => c.included).length,
)

const canSave = computed(
  () =>
    name.value.trim().length > 0 &&
    module.value !== '' &&
    includedCount.value > 0 &&
    !saving.value,
)

async function save(): Promise<void> {
  if (!canSave.value || module.value === '') return
  saving.value = true
  saveError.value = ''
  try {
    await api.post('/api/custom-forms', {
      name: name.value.trim(),
      module: module.value,
      fields: columns.value
        .filter((column: ColumnDraft) => column.included)
        .map((column: ColumnDraft) => ({
          key: column.name,
          label: column.label.trim(),
          type: column.type,
          required: column.required,
          ...(column.type === 'select'
            ? {
                options: column.optionsText
                  .split(',')
                  .map((option: string) => option.trim())
                  .filter((option: string) => option.length > 0),
              }
            : {}),
        })),
    })
    emit('created')
  } catch (cause) {
    saveError.value = (cause as { message?: string }).message ?? 'Could not save the form'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <span class="font-semibold">New custom form</span>
    </template>
    <div class="grid gap-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField label="Form name" required>
          <UInput v-model="name" placeholder="e.g. Intake short" class="w-full" />
        </UFormField>
        <UFormField label="Linked module" required>
          <USelect
            v-model="module"
            :items="moduleOptions"
            placeholder="Choose a module"
            class="w-full"
          />
        </UFormField>
      </div>

      <UAlert
        v-if="fieldsError"
        color="error"
        variant="subtle"
        title="Could not load the module fields"
        :description="fieldsError"
      />

      <div v-if="loadingFields" class="flex justify-center py-6">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <div v-else-if="module !== '' && columns.length > 0" class="grid gap-2">
        <p class="text-sm text-gray-500">
          Tick the database columns this form collects. Columns the database refuses to
          leave empty arrive required.
        </p>
        <div
          v-for="column in columns"
          :key="column.name"
          class="grid gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800 sm:grid-cols-[auto_1fr]"
        >
          <UCheckbox v-model="column.included" :label="column.name" />
          <div class="grid gap-2 sm:grid-cols-2">
            <UInput
              v-model="column.label"
              placeholder="Field label"
              :disabled="!column.included"
            />
            <USelect
              v-model="column.type"
              :items="typeOptions"
              :disabled="!column.included"
            />
            <UCheckbox
              v-model="column.required"
              label="Required"
              :disabled="!column.included || column.requiredByDb"
            />
            <UBadge v-if="column.requiredByDb" color="info" variant="subtle">
              Required by the database
            </UBadge>
            <UInput
              v-if="column.type === 'select'"
              v-model="column.optionsText"
              placeholder="Choices, comma separated"
              :disabled="!column.included"
              class="sm:col-span-2"
            />
          </div>
        </div>
      </div>

      <UAlert
        v-if="saveError"
        color="error"
        variant="subtle"
        title="Could not save the form"
        :description="saveError"
      />

      <div class="flex gap-2">
        <UButton label="Save form" :loading="saving" :disabled="!canSave" @click="save" />
        <UButton
          label="Cancel"
          color="neutral"
          variant="outline"
          @click="emit('cancel')"
        />
      </div>
    </div>
  </UCard>
</template>
