<script setup lang="ts">
import { visitorFormSchema } from '@afc/shared'
import type { BranchSummary, VisitorRow } from '~/types/portal'

const props = defineProps<{
  open: boolean
  visitor?: VisitorRow | null
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

function empty() {
  return {
    branch: props.branches[0]?.id ?? '',
    visitor_first_name: '',
    visitor_last_name: '',
    email: '',
    phone: '',
    visit_date: today(),
    event: '',
    age_group: 'unknown',
    invited_by: '',
    follow_up_owner: '',
    next_follow_up_date: '',
    notes: '',
    status: 'new',
  }
}

const form = reactive(empty())

const ageOptions = [
  { label: 'Adult', value: 'adult' },
  { label: 'Youth', value: 'youth' },
  { label: 'Teen', value: 'teen' },
  { label: 'Child', value: 'child' },
  { label: 'Unknown', value: 'unknown' },
]

const statusOptions = [
  { label: 'New', value: 'new' },
  { label: 'Follow up', value: 'follow_up' },
  { label: 'Converted', value: 'converted' },
  { label: 'Closed', value: 'closed' },
  { label: 'Declined', value: 'declined' },
]

const branchOptions = computed(() =>
  props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
)

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
    const row = props.visitor
    if (row) {
      Object.assign(form, {
        branch: row.branch ?? props.branches[0]?.id ?? '',
        visitor_first_name: row.visitor_first_name,
        visitor_last_name: row.visitor_last_name,
        email: row.email ?? '',
        phone: row.phone ?? '',
        visit_date: row.visit_date,
        event: row.event ?? '',
        age_group: row.age_group,
        invited_by: row.invited_by ?? '',
        follow_up_owner: row.follow_up_owner ?? '',
        next_follow_up_date: row.next_follow_up_date ?? '',
        notes: row.notes ?? '',
        status: row.status,
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
    email: form.email || undefined,
    phone: form.phone || undefined,
    event: form.event || undefined,
    invited_by: form.invited_by || undefined,
    follow_up_owner: form.follow_up_owner || undefined,
    next_follow_up_date: form.next_follow_up_date || undefined,
    notes: form.notes || undefined,
  }
  const parsed = visitorFormSchema.safeParse(candidate)
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
    if (props.visitor) {
      await api.patch(`/api/visitors/${props.visitor.id}`, parsed.data)
    } else {
      await api.post('/api/visitors', parsed.data)
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that visitor'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="visitor ? 'Edit visitor' : 'Record visitor intake'"
    description="Intake is available to volunteers; the follow-up queue needs a read grant."
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
          <UFormField label="First name" required :error="fieldErrors.visitor_first_name">
            <UInput v-model="form.visitor_first_name" class="w-full" />
          </UFormField>
          <UFormField label="Last name" required :error="fieldErrors.visitor_last_name">
            <UInput v-model="form.visitor_last_name" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Phone" :error="fieldErrors.phone">
            <UInput
              v-model="form.phone"
              type="tel"
              class="w-full"
              placeholder="08012345678"
            />
          </UFormField>
          <UFormField label="Email" :error="fieldErrors.email">
            <UInput v-model="form.email" type="email" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Visit date" required :error="fieldErrors.visit_date">
            <UInput v-model="form.visit_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Age group" :error="fieldErrors.age_group">
            <USelect v-model="form.age_group" :items="ageOptions" class="w-full" />
          </UFormField>
          <UFormField label="Status" :error="fieldErrors.status">
            <USelect v-model="form.status" :items="statusOptions" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Invited by" :error="fieldErrors.invited_by">
            <UInput v-model="form.invited_by" class="w-full" placeholder="Optional" />
          </UFormField>
          <UFormField label="Follow-up owner" :error="fieldErrors.follow_up_owner">
            <UInput
              v-model="form.follow_up_owner"
              class="w-full"
              placeholder="Optional"
            />
          </UFormField>
        </div>

        <UFormField label="Next follow-up" :error="fieldErrors.next_follow_up_date">
          <UInput v-model="form.next_follow_up_date" type="date" class="w-full" />
        </UFormField>

        <UFormField label="Notes" :error="fieldErrors.notes">
          <UTextarea v-model="form.notes" :rows="3" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="visitor ? 'Save changes' : 'Record intake'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
