<script setup lang="ts">
import { COLLECTIONS, eventFormSchema } from '@afc/shared'
import type { BranchSummary, EventRow } from '~/types/portal'

const props = defineProps<{
  open: boolean
  event?: EventRow | null
  branches: BranchSummary[]
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

const canCreateAreaWide = computed(
  () => permissions.scopeFor(COLLECTIONS.events, 'create') === 'all',
)

function empty() {
  return {
    title: '',
    summary: '',
    event_type: 'other',
    branch: canCreateAreaWide.value ? 'area' : (props.branches[0]?.id ?? ''),
    start_at: '',
    end_at: '',
    location: '',
    address: '',
    capacity: '' as string | number,
    waitlist_enabled: false,
    registration_opens_at: '',
    registration_closes_at: '',
    fee_amount: '',
    currency: 'NGN',
    requires_guardian_consent: false,
    collect_medical: false,
    age_min: '' as string | number,
    age_max: '' as string | number,
    visibility: 'branch',
    status: 'draft',
    description: '',
  }
}

const form = reactive(empty())

const typeOptions = [
  { label: 'Service', value: 'service' },
  { label: 'Summit', value: 'summit' },
  { label: 'Camp', value: 'camp' },
  { label: 'Training', value: 'training' },
  { label: 'Outreach', value: 'outreach' },
  { label: 'Social', value: 'social' },
  { label: 'Other', value: 'other' },
]

const currencyOptions = [
  { label: 'NGN', value: 'NGN' },
  { label: 'USD', value: 'USD' },
  { label: 'GBP', value: 'GBP' },
]

const visibilityOptions = [
  { label: 'Branch', value: 'branch' },
  { label: 'Public', value: 'public' },
  { label: 'Internal', value: 'internal' },
]

const statusOptions = [
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Closed', value: 'closed' },
  { label: 'Cancelled', value: 'cancelled' },
]

const branchOptions = computed(() => [
  ...(canCreateAreaWide.value
    ? [{ label: 'Area-wide (all branches)', value: 'area' }]
    : []),
  ...props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
])

function toLocal(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function toIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function numberOrUndefined(value: string | number): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
    const row = props.event
    if (row) {
      Object.assign(form, {
        title: row.title,
        summary: row.summary ?? '',
        event_type: row.event_type,
        branch:
          row.branch ??
          (canCreateAreaWide.value ? 'area' : (props.branches[0]?.id ?? '')),
        start_at: toLocal(row.start_at),
        end_at: toLocal(row.end_at),
        location: row.location ?? '',
        address: row.address ?? '',
        capacity: row.capacity ?? '',
        waitlist_enabled: row.waitlist_enabled,
        registration_opens_at: toLocal(row.registration_opens_at),
        registration_closes_at: toLocal(row.registration_closes_at),
        fee_amount: row.fee_amount ?? '',
        currency: row.currency ?? 'NGN',
        requires_guardian_consent: row.requires_guardian_consent,
        collect_medical: row.collect_medical,
        age_min: row.age_min ?? '',
        age_max: row.age_max ?? '',
        visibility: row.visibility,
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
    branch: form.branch === 'area' ? undefined : form.branch || undefined,
    start_at: toIso(form.start_at) ?? form.start_at,
    end_at: toIso(form.end_at) ?? form.end_at,
    registration_opens_at: toIso(form.registration_opens_at),
    registration_closes_at: toIso(form.registration_closes_at),
    capacity: numberOrUndefined(form.capacity),
    age_min: numberOrUndefined(form.age_min),
    age_max: numberOrUndefined(form.age_max),
    fee_amount: form.fee_amount || '',
  }

  const parsed = eventFormSchema.safeParse(candidate)
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
    if (props.event) {
      await api.patch(`/api/events/${props.event.id}`, parsed.data)
    } else {
      await api.post('/api/events', parsed.data)
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that event'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="event ? 'Edit event' : 'Create event'"
    description="Area-wide events have no branch and are visible to every branch account."
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

        <UFormField label="Title" required :error="fieldErrors.title">
          <UInput v-model="form.title" class="w-full" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Type" :error="fieldErrors.event_type">
            <USelect v-model="form.event_type" :items="typeOptions" class="w-full" />
          </UFormField>
          <UFormField label="Branch" :error="fieldErrors.branch">
            <EntitySelect v-model="form.branch" :items="branchOptions" placeholder="Select branch…" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Starts" required :error="fieldErrors.start_at">
            <UInput v-model="form.start_at" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="Ends" required :error="fieldErrors.end_at">
            <UInput v-model="form.end_at" type="datetime-local" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Summary" :error="fieldErrors.summary">
          <UInput v-model="form.summary" class="w-full" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Location" :error="fieldErrors.location">
            <UInput v-model="form.location" class="w-full" />
          </UFormField>
          <UFormField
            label="Capacity"
            hint="Blank means unlimited"
            :error="fieldErrors.capacity"
          >
            <UInput v-model="form.capacity" type="number" min="0" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Address" :error="fieldErrors.address">
          <UTextarea v-model="form.address" :rows="2" class="w-full" />
        </UFormField>

        <details class="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <summary class="cursor-pointer text-sm font-medium">
            Registration and eligibility
          </summary>
          <div class="mt-4 space-y-4">
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Registration opens"
                :error="fieldErrors.registration_opens_at"
              >
                <UInput
                  v-model="form.registration_opens_at"
                  type="datetime-local"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                label="Registration closes"
                :error="fieldErrors.registration_closes_at"
              >
                <UInput
                  v-model="form.registration_closes_at"
                  type="datetime-local"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="grid gap-4 sm:grid-cols-3">
              <UFormField label="Fee" :error="fieldErrors.fee_amount">
                <UInput
                  v-model="form.fee_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Currency" :error="fieldErrors.currency">
                <USelect
                  v-model="form.currency"
                  :items="currencyOptions"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Visibility" :error="fieldErrors.visibility">
                <USelect
                  v-model="form.visibility"
                  :items="visibilityOptions"
                  class="w-full"
                />
              </UFormField>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Minimum age" :error="fieldErrors.age_min">
                <UInput v-model="form.age_min" type="number" min="0" class="w-full" />
              </UFormField>
              <UFormField label="Maximum age" :error="fieldErrors.age_max">
                <UInput v-model="form.age_max" type="number" min="0" class="w-full" />
              </UFormField>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <UCheckbox
                v-model="form.waitlist_enabled"
                label="Enable a waitlist when full"
              />
              <UCheckbox
                v-model="form.requires_guardian_consent"
                label="Requires guardian consent"
              />
              <UCheckbox v-model="form.collect_medical" label="Collect medical notes" />
            </div>
          </div>
        </details>

        <UFormField label="Status" :error="fieldErrors.status">
          <USelect v-model="form.status" :items="statusOptions" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="event ? 'Save changes' : 'Create event'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
