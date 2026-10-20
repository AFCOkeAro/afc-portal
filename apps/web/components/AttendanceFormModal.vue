<script setup lang="ts">
import { attendanceSessionFormSchema } from '@afc/shared'
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

function empty() {
  return {
    branch: props.branches[0]?.id ?? '',
    session_date: today(),
    session_type: 'sunday_service',
    session_name: 'Sunday service',
    service: '',
    event: '',
    headcount_men: 0 as number | string,
    headcount_women: 0 as number | string,
    headcount_children: 0 as number | string,
  }
}

const form = reactive(empty())

const typeOptions = [
  { label: 'Sunday service', value: 'sunday_service' },
  { label: 'Midweek', value: 'midweek' },
  { label: 'Event', value: 'event' },
  { label: 'Camp', value: 'camp' },
  { label: 'Department', value: 'department' },
]

const branchOptions = computed(() =>
  props.branches.map((branch) => ({ label: branch.name, value: branch.id })),
)

const total = computed(
  () =>
    Number(form.headcount_men || 0) +
    Number(form.headcount_women || 0) +
    Number(form.headcount_children || 0),
)

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    Object.assign(form, empty())
  },
  { immediate: true },
)

watch(
  () => form.session_type,
  (type: string) => {
    if (type === 'sunday_service') form.session_name = 'Sunday service'
    else if (type === 'midweek') form.session_name = 'Midweek service'
    else if (type === 'department') form.session_name = 'Department meeting'
  },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  const candidate = {
    ...form,
    headcount_men: Number(form.headcount_men || 0),
    headcount_women: Number(form.headcount_women || 0),
    headcount_children: Number(form.headcount_children || 0),
    service: form.service || undefined,
    event: form.event || undefined,
  }
  const parsed = attendanceSessionFormSchema.safeParse(candidate)
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
    await api.post('/api/attendance', parsed.data)
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that session'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Capture headcount"
    description="The total is calculated from the three category counts."
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form class="space-y-4" novalidate @submit.prevent="submit">
        <UAlert v-if="formError" color="error" variant="subtle" :description="formError" />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Date" required :error="fieldErrors.session_date">
            <UInput v-model="form.session_date" type="date" class="w-full" />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Session type" :error="fieldErrors.session_type">
            <USelect v-model="form.session_type" :items="typeOptions" class="w-full" />
          </UFormField>
          <UFormField label="Session name" required :error="fieldErrors.session_name">
            <UInput v-model="form.session_name" class="w-full" />
          </UFormField>
        </div>

        <UFormField label="Service or event reference" :error="fieldErrors.service">
          <UInput v-model="form.service" class="w-full" placeholder="Optional" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Men" :error="fieldErrors.headcount_men">
            <UInput v-model="form.headcount_men" type="number" min="0" class="w-full" />
          </UFormField>
          <UFormField label="Women" :error="fieldErrors.headcount_women">
            <UInput v-model="form.headcount_women" type="number" min="0" class="w-full" />
          </UFormField>
          <UFormField label="Children" :error="fieldErrors.headcount_children">
            <UInput v-model="form.headcount_children" type="number" min="0" class="w-full" />
          </UFormField>
        </div>

        <div class="rounded-lg bg-gray-50 p-4 text-center dark:bg-gray-900">
          <p class="text-sm text-gray-500 dark:text-gray-400">Total headcount</p>
          <p class="text-3xl font-semibold tabular-nums">{{ total }}</p>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Save session" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
