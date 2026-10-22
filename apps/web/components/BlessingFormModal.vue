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

export interface ProgramOption {
  label: string
  value: string
}

const props = defineProps<{
  open: boolean
  branches: BranchSummary[]
  preset?: BlessingPreset
  services?: ProgramOption[]
  eventsList?: ProgramOption[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const rowErrors = ref<Array<{ blessing_type: string; error: string }>>([])
const resultSummary = ref('')

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function defaults() {
  return {
    branch: props.preset?.branch ?? props.branches[0]?.id ?? '',
    service_date: props.preset?.service_date ?? today(),
    service: '',
    eventSel: '',
    notes: '',
    other_label: '',
    counts: Object.fromEntries(BLESSING_TYPES.map((type) => [type, 0])) as Record<
      string,
      number
    >,
  }
}

const form = reactive(defaults())

const branchOptions = computed(() =>
  props.branches.map((row) => ({ label: row.name, value: row.id })),
)

const serviceOptions = computed(() => props.services ?? [])
const eventOptions = computed(() => props.eventsList ?? [])

const typeOptions = BLESSING_TYPES.map((value) => ({
  label: value.replace(/_/g, ' '),
  value,
}))

const grandTotal = computed(() =>
  Object.values(form.counts).reduce(
    (sum: number, value: number | unknown) => sum + Number(value || 0),
    0,
  ),
)

function clampCount(type: string): void {
  const value = Number(form.counts[type] ?? 0)
  if (Number.isNaN(value) || value < 0) form.counts[type] = 0
  else form.counts[type] = Math.floor(value)
}

const linkedProgram = computed(() => {
  const preset = props.preset
  if (!preset) return ''
  if (preset.sunday_service) return 'Linked to this service.'
  if (preset.event) return 'Linked to this event.'
  if (preset.session) return 'Linked to this session.'
  return ''
})

const showPickers = computed(() => !linkedProgram.value)

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    rowErrors.value = []
    resultSummary.value = ''
    Object.assign(form, defaults(), {
      counts: Object.fromEntries(BLESSING_TYPES.map((type) => [type, 0])),
    })
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  rowErrors.value = []
  resultSummary.value = ''

  type BulkRow = { blessing_type: string; other_label?: string; count: number }
  const rows: BulkRow[] = BLESSING_TYPES.flatMap((blessing_type): BulkRow[] => {
    const count = Number(form.counts[blessing_type] ?? 0)
    if (blessing_type === 'other') {
      const label = form.other_label.trim()
      if (!label && count <= 0) return []
      return [{ blessing_type, other_label: label || undefined, count }]
    }
    if (count <= 0) return []
    return [{ blessing_type, count }]
  })

  if (rows.length === 0) {
    formError.value = 'Enter at least one blessing count'
    fieldErrors.value = { rows: 'Enter at least one blessing count' }
    return
  }

  saving.value = true
  try {
    const response = await api.post<{
      data: Array<{
        blessing_type: string
        other_label: string | null
        count: number
        status: 'created' | 'updated' | 'skipped'
        id: string | null
        error?: string
      }>
      meta: { created: number; updated: number; skipped: number }
    }>('/api/blessings/batch', {
      branch: form.branch || undefined,
      session: props.preset?.session ?? undefined,
      event: props.preset?.event || form.eventSel || undefined,
      sunday_service: props.preset?.sunday_service || form.service || undefined,
      service_date: form.service_date,
      notes: form.notes.trim() || undefined,
      rows,
    })
    const failed = response.data.filter((row) => row.error)
    resultSummary.value = `${response.meta.created} recorded · ${response.meta.updated} updated · ${response.meta.skipped} skipped`
    if (failed.length > 0) {
      rowErrors.value = failed.map((row) => ({
        blessing_type: row.blessing_type,
        error: row.error ?? 'Could not save this row',
      }))
      return
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save those blessing records'
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
    description="All six blessing types on one screen, one count each. Save writes every entered type at once."
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
          v-if="resultSummary"
          color="success"
          variant="subtle"
          :description="resultSummary"
        />
        <UAlert
          v-if="linkedProgram"
          color="neutral"
          variant="subtle"
          :description="linkedProgram"
        />
        <UAlert
          v-for="row in rowErrors"
          :key="row.blessing_type"
          color="warning"
          variant="subtle"
          :title="row.blessing_type.replace(/_/g, ' ')"
          :description="row.error"
        />

        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Context</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <EntitySelect
              v-model="form.branch"
              :items="branchOptions"
              placeholder="Select branch…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Service date" required :error="fieldErrors.service_date">
            <UInput v-model="form.service_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <div v-if="showPickers">
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              v-if="serviceOptions.length > 0"
              label="Sunday service (optional)"
            >
              <EntitySelect
                v-model="form.service"
                :items="serviceOptions"
                placeholder="No service link…"
                class="w-full"
              />
            </UFormField>
            <UFormField v-if="eventOptions.length > 0" label="Event (optional)">
              <EntitySelect
                v-model="form.eventSel"
                :items="eventOptions"
                placeholder="No event link…"
                class="w-full"
              />
            </UFormField>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Link these blessings to the service or event they belong to; leave both empty
            only for branch-level records.
          </p>
        </div>

        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Counts</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField
            v-for="type in typeOptions"
            :key="type.value"
            :label="type.label"
            :error="fieldErrors[`rows.${type.value}`]"
          >
            <UInput
              v-model="form.counts[type.value]"
              type="number"
              inputmode="numeric"
              min="0"
              step="1"
              class="w-full"
              :aria-label="`${type.label} count`"
              @change="clampCount(type.value)"
              @blur="clampCount(type.value)"
            />
          </UFormField>
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          Leave 0 to skip — only types above 0 are saved.
        </p>

        <UFormField
          v-if="Number(form.counts.other ?? 0) > 0 || form.other_label"
          label="Name the other blessing"
          required
          :error="fieldErrors['rows.other_label']"
        >
          <UInput
            v-model="form.other_label"
            class="w-full"
            placeholder="For example: Delivered from addiction"
          />
        </UFormField>

        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">Notes</h3>
        <UFormField label="Notes" :error="fieldErrors.notes">
          <UTextarea
            v-model="form.notes"
            class="w-full"
            placeholder="Optional record notes"
          />
        </UFormField>

        <p class="text-sm text-gray-500 dark:text-gray-400">
          {{
            resultSummary ||
            (grandTotal > 0
              ? `${grandTotal} blessings in total`
              : 'Leave 0 to skip — only types above 0 are saved.')
          }}
        </p>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save all" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
