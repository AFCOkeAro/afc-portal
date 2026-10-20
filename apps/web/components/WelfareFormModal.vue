<script setup lang="ts">
import { COLLECTIONS, welfareCaseFormSchema } from '@afc/shared'
import type { BranchSummary, PersonRow, WelfareCaseRow } from '~/types/portal'

const props = defineProps<{
  open: boolean
  welfareCase?: WelfareCaseRow | null
  branches: BranchSummary[]
  people: PersonRow[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const permissions = usePermissions()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})

const showRestricted = computed(
  () => permissions.isFieldVisible(COLLECTIONS.welfareCases, 'description'),
)

function defaultRef(): string {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `WF-${stamp}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
}

function empty() {
  return {
    case_ref: defaultRef(),
    branch: props.branches[0]?.id ?? '',
    person: '',
    category: 'other',
    priority: 'normal',
    status: 'open',
    amount_requested: '',
    amount_assisted: '',
    assigned_to: '',
    description: '',
    outcome_notes: '',
  }
}

const form = reactive(empty())

const categoryOptions = [
  { label: 'Medical', value: 'medical' },
  { label: 'Financial', value: 'financial' },
  { label: 'Bereavement', value: 'bereavement' },
  { label: 'Education', value: 'education' },
  { label: 'Other', value: 'other' },
]

const priorityOptions = [
  { label: 'Low', value: 'low' },
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Urgent', value: 'urgent' },
]

const statusOptions = [
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Closed', value: 'closed' },
]

const branchOptions = computed(() =>
  props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
)

const personOptions = computed(() => [
  { label: 'No linked person', value: '' },
  ...props.people.map((person) => ({
    label:
      person.preferred_name ||
      [person.first_name, person.last_name].filter(Boolean).join(' '),
    value: person.id,
  })),
])

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
    const row = props.welfareCase
    if (row) {
      Object.assign(form, {
        case_ref: row.case_ref,
        branch: row.branch ?? props.branches[0]?.id ?? '',
        person: row.person ?? '',
        category: row.category,
        priority: row.priority ?? 'normal',
        status: row.status ?? 'open',
        amount_requested: row.amount_requested ?? '',
        amount_assisted: row.amount_assisted ?? '',
        assigned_to: row.assigned_to ?? '',
        description: row.description ?? '',
        outcome_notes: row.outcome_notes ?? '',
      })
    }
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  const candidate = {
    ...form,
    person: form.person || undefined,
    assigned_to: form.assigned_to || undefined,
    description: form.description || undefined,
    outcome_notes: form.outcome_notes || undefined,
    amount_requested: form.amount_requested || '',
    amount_assisted: form.amount_assisted || '',
  }
  const parsed = welfareCaseFormSchema.safeParse(candidate)
  if (!parsed.success) {
    const errors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.')
      if (key && !errors[key]) errors[key] = issue.message
    }
    fieldErrors.value = errors
    return
  }

  saving.value = true
  try {
    if (props.welfareCase) {
      await api.patch(`/api/welfare/${props.welfareCase.id}`, parsed.data)
    } else {
      await api.post('/api/welfare', parsed.data)
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that case'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="welfareCase ? 'Edit case' : 'Open welfare case'"
    description="Welfare is restricted to branch administrators, area administrators and the assigned owner."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <UAlert v-if="formError" color="error" variant="subtle" :description="formError" />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Case reference" required :error="fieldErrors.case_ref">
            <UInput v-model="form.case_ref" class="w-full" />
          </UFormField>
          <UFormField label="Status" :error="fieldErrors.status">
            <USelect v-model="form.status" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Linked person" :error="fieldErrors.person">
            <USelect v-model="form.person" :items="personOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Category" :error="fieldErrors.category">
            <USelect v-model="form.category" :items="categoryOptions" class="w-full" />
          </UFormField>
          <UFormField label="Priority" :error="fieldErrors.priority">
            <USelect v-model="form.priority" :items="priorityOptions" class="w-full" />
          </UFormField>
          <UFormField label="Assigned to" :error="fieldErrors.assigned_to">
            <UInput v-model="form.assigned_to" class="w-full" placeholder="Optional" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Amount requested" :error="fieldErrors.amount_requested">
            <UInput v-model="form.amount_requested" type="number" min="0" step="0.01" class="w-full" />
          </UFormField>
          <UFormField label="Amount assisted" :error="fieldErrors.amount_assisted">
            <UInput v-model="form.amount_assisted" type="number" min="0" step="0.01" class="w-full" />
          </UFormField>
        </div>

        <template v-if="showRestricted">
          <UFormField label="Case description" :error="fieldErrors.description">
            <UTextarea v-model="form.description" :rows="3" class="w-full" />
          </UFormField>
          <UFormField label="Outcome notes" :error="fieldErrors.outcome_notes">
            <UTextarea v-model="form.outcome_notes" :rows="2" class="w-full" />
          </UFormField>
        </template>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="welfareCase ? 'Save changes' : 'Open case'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
