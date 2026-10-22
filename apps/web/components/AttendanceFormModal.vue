<script setup lang="ts">
import { ATTENDANCE_CATEGORIES, batchTotal, type AttendanceCategory } from '@afc/shared'
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

interface ServiceTypeDefinition {
  id: string
  key: string
  label: string
  categories: string[]
  supports_sex_split: boolean
  requires_bsc: boolean
  status: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

/** category -> { male, female } counts, rebuilt when the service type changes. */
function emptyCounts(
  categories: string[],
): Record<string, { male: number; female: number }> {
  return Object.fromEntries(
    categories.map((category) => [category, { male: 0, female: 0 }]),
  )
}

const branch = ref('')
const sessionDate = ref(today())
const sessionType = ref('sunday_service')
const sessionName = ref('Sunday service')
const idempotencyKey = ref(newKey())
const counts = ref<Record<string, { male: number; female: number }>>({})
const otherLabels = ref<Record<string, string>>({})

const { data: serviceTypes } = await useAsyncData('attendance-service-types', () =>
  api.get<{ data: ServiceTypeDefinition[] }>('/api/attendance/service-types'),
)

const definitions = computed<ServiceTypeDefinition[]>(
  () => serviceTypes.value?.data ?? [],
)
const activeDefinition = computed<ServiceTypeDefinition | null>(
  () =>
    definitions.value.find(
      (row: ServiceTypeDefinition) => row.key === sessionType.value,
    ) ?? null,
)
const categories = computed<string[]>(
  () =>
    activeDefinition.value?.categories.filter((category: string) =>
      (ATTENDANCE_CATEGORIES as readonly string[]).includes(category),
    ) ?? [],
)

const typeOptions = computed(() =>
  definitions.value.length > 0
    ? definitions.value.map((row: ServiceTypeDefinition) => ({
        label: row.label,
        value: row.key,
      }))
    : [{ label: 'Sunday service', value: 'sunday_service' }],
)

const branchOptions = computed(() =>
  props.branches.map((row: BranchSummary) => ({ label: row.name, value: row.id })),
)

const total = computed(() => {
  const entries = Object.values(counts.value) as Array<{
    male: number | string
    female: number | string
  }>
  return batchTotal({
    rows: entries.flatMap((entry) => [
      { count: Number(entry.male || 0) },
      { count: Number(entry.female || 0) },
    ]),
  })
})

function categoryLabel(category: string): string {
  return category
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    branch.value = props.branches[0]?.id ?? ''
    sessionDate.value = today()
    sessionType.value = 'sunday_service'
    sessionName.value = 'Sunday service'
    idempotencyKey.value = newKey()
    otherLabels.value = {}
  },
  { immediate: true },
)

watch(
  [sessionType, activeDefinition],
  () => {
    counts.value = emptyCounts(categories.value)
    otherLabels.value = {}
    if (sessionType.value === 'sunday_service') sessionName.value = 'Sunday service'
    else if (sessionType.value === 'midweek') sessionName.value = 'Midweek service'
    else if (sessionType.value === 'department') sessionName.value = 'Department meeting'
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}

  const rows: Array<{
    category: AttendanceCategory
    category_other_label?: string
    sex: 'male' | 'female'
    count: number
  }> = []
  for (const category of categories.value) {
    const entry = counts.value[category] ?? { male: 0, female: 0 }
    const male = Math.max(0, Math.floor(Number(entry.male || 0)))
    const female = Math.max(0, Math.floor(Number(entry.female || 0)))
    const label = (otherLabels.value[category] ?? '').trim()
    if (category === 'other' && (male > 0 || female > 0) && !label) {
      fieldErrors.value[`other-${category}`] = 'Name the other category'
      return
    }
    rows.push(
      {
        category: category as AttendanceCategory,
        ...(label ? { category_other_label: label } : {}),
        sex: 'male',
        count: male,
      },
      {
        category: category as AttendanceCategory,
        ...(label ? { category_other_label: label } : {}),
        sex: 'female',
        count: female,
      },
    )
  }
  if (rows.length === 0) {
    formError.value = 'That service type offers no categories to capture'
    return
  }

  saving.value = true
  try {
    await api.post('/api/attendance/capture', {
      branch: branch.value || undefined,
      session_date: sessionDate.value,
      session_type: sessionType.value,
      session_name: sessionName.value,
      idempotency_key: idempotencyKey.value,
      rows,
    })
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    // A failed submit keeps its idempotency key, so a retry replays the same
    // batch instead of filing a twin. A fresh key is minted on reopen only.
    formError.value = error.message ?? 'Could not save that capture'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Capture attendance"
    description="Male and female counts per category. The total is calculated for you."
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
            <EntitySelect
              v-model="branch"
              :items="branchOptions"
              placeholder="Select branch…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Date" required :error="fieldErrors.session_date">
            <UInput v-model="sessionDate" type="date" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Session type" :error="fieldErrors.session_type">
            <USelect v-model="sessionType" :items="typeOptions" class="w-full" />
          </UFormField>
          <UFormField label="Session name" required :error="fieldErrors.session_name">
            <UInput v-model="sessionName" class="w-full" />
          </UFormField>
        </div>

        <div
          v-for="category in categories"
          :key="category"
          class="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <p class="text-sm font-medium">{{ categoryLabel(category) }}</p>
          <div class="mt-2 grid grid-cols-2 gap-3">
            <UFormField label="Male">
              <UInput
                v-model="counts[category].male"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Female">
              <UInput
                v-model="counts[category].female"
                type="number"
                min="0"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField
            v-if="category === 'other'"
            class="mt-2"
            label="Name the other category"
            required
            :error="fieldErrors[`other-${category}`]"
          >
            <UInput
              v-model="otherLabels[category]"
              class="w-full"
              placeholder="For example: Deaf fellowship"
            />
          </UFormField>
        </div>

        <EmptyState
          v-if="categories.length === 0"
          title="No categories for this service type"
          description="Choose another service type, or ask an area admin to configure its categories."
        />

        <div class="rounded-lg bg-gray-50 p-4 text-center dark:bg-gray-900">
          <p class="text-sm text-gray-500 dark:text-gray-400">Total attendance</p>
          <p class="text-3xl font-semibold tabular-nums">{{ total }}</p>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save capture" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
