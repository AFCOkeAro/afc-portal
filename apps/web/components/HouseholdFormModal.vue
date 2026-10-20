<script setup lang="ts">
import { householdFormSchema, type HouseholdFormInput } from '@afc/shared'
import type { BranchSummary, HouseholdDetail } from '~/types/portal'

const props = defineProps<{
  open: boolean
  household?: HouseholdDetail | null
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

const empty = (): HouseholdFormInput => ({
  name: '',
  branch: props.branches[0]?.id ?? '',
  address: '',
  phone: '',
  wedding_date: '',
  household_head: '',
})

const form = reactive<HouseholdFormInput>(empty())

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
    const household = props.household
    if (household) {
      Object.assign(form, {
        name: household.name ?? '',
        branch: household.branch ?? props.branches[0]?.id ?? '',
        address: household.address ?? '',
        phone: household.phone ?? '',
        wedding_date: household.wedding_date ?? '',
        household_head: household.household_head ?? '',
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
  const parsed = householdFormSchema.safeParse(form)
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
    if (props.household) {
      await api.patch(`/api/households/${props.household.id}`, parsed.data)
    } else {
      await api.post('/api/households', parsed.data)
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not save that household'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="household ? 'Edit household' : 'Add household'"
    description="The branch controls who can see this record. Address only — no map pin yet."
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

        <UFormField label="Household name" required :error="fieldErrors.name">
          <UInput v-model="form.name" class="w-full" placeholder="e.g. Adeyemi family" />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Branch" :error="fieldErrors.branch">
            <USelect v-model="form.branch" :items="branchOptions" class="w-full" />
          </UFormField>
          <UFormField label="Phone" :error="fieldErrors.phone">
            <UInput
              v-model="form.phone"
              type="tel"
              class="w-full"
              placeholder="08012345678"
            />
          </UFormField>
        </div>

        <UFormField label="Wedding date" :error="fieldErrors.wedding_date">
          <UInput v-model="form.wedding_date" type="date" class="w-full" />
        </UFormField>

        <UFormField label="Address" :error="fieldErrors.address">
          <UTextarea v-model="form.address" :rows="2" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton
          :label="household ? 'Save changes' : 'Add household'"
          :loading="saving"
          @click="submit"
        />
      </div>
    </template>
  </UModal>
</template>
