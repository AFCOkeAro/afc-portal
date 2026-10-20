<script setup lang="ts">
/**
 * Staff group registration modal (AFC-470 §4): one `group_code` plus N
 * members in a single submission.
 *
 * Client validation is deliberately thin (names present, code present) —
 * the route validates every member against `registrationFormSchema` and
 * answers per-member errors, which are shown against the row index.
 * Retries are safe: the route's idempotency split skips already-written
 * members instead of duplicating them.
 */
const props = defineProps<{
  open: boolean
  eventId: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
}>()

const api = useApi()
const saving = ref(false)
const formError = ref('')
const fieldErrors = ref<Record<string, string>>({})
const groupCode = ref('')

interface GroupMember {
  registrant_first_name: string
  registrant_last_name: string
  phone: string
  email: string
}

function blankMember(): GroupMember {
  return { registrant_first_name: '', registrant_last_name: '', phone: '', email: '' }
}

const members = reactive<GroupMember[]>([blankMember(), blankMember()])

function addMember(): void {
  if (members.length < 50) members.push(blankMember())
}

function removeMember(index: number): void {
  if (members.length > 1) members.splice(index, 1)
}

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    groupCode.value = ''
    members.splice(0, members.length, blankMember(), blankMember())
  },
  { immediate: true },
)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  const errors: Record<string, string> = {}
  if (!groupCode.value.trim()) errors.group_code = 'Give this group submission a code'
  members.forEach((member, index) => {
    if (!member.registrant_first_name.trim()) {
      errors[`members.${index}.registrant_first_name`] = 'First name is required'
    }
    if (!member.registrant_last_name.trim()) {
      errors[`members.${index}.registrant_last_name`] = 'Last name is required'
    }
  })
  if (Object.keys(errors).length > 0) {
    fieldErrors.value = errors
    return
  }

  saving.value = true
  try {
    const result = await api.post<{
      data: unknown[]
      meta: { created: number; skipped: number; total: number }
    }>(`/api/events/${props.eventId}/group-registrations`, {
      group_code: groupCode.value.trim(),
      members: members.map((member) => ({
        registrant_first_name: member.registrant_first_name.trim(),
        registrant_last_name: member.registrant_last_name.trim(),
        phone: member.phone.trim() || undefined,
        email: member.email.trim() || undefined,
      })),
    })
    formError.value = ''
    fieldErrors.value = {}
    if (result.meta.skipped > 0 && result.meta.created === 0) {
      formError.value =
        'All members were already registered under this code — nothing new was added.'
      return
    }
    emit('saved')
    close()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    formError.value = error.message ?? 'Could not register that group'
    fieldErrors.value = error.fields ?? {}
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Register group"
    description="One code for the whole submission. Retrying the same code never duplicates members."
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

        <UFormField label="Group code" required :error="fieldErrors.group_code">
          <UInput
            v-model="groupCode"
            class="w-full"
            placeholder="e.g. YOUTH-CAMP-BUS-3"
          />
        </UFormField>

        <div
          v-for="(member, index) in members"
          :key="index"
          class="space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <div class="flex items-center justify-between">
            <p class="text-sm font-medium">Member {{ index + 1 }}</p>
            <UButton
              v-if="members.length > 1"
              size="xs"
              color="neutral"
              variant="ghost"
              label="Remove"
              @click="removeMember(index)"
            />
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField
              label="First name"
              required
              :error="fieldErrors[`members.${index}.registrant_first_name`]"
            >
              <UInput v-model="member.registrant_first_name" class="w-full" />
            </UFormField>
            <UFormField
              label="Last name"
              required
              :error="fieldErrors[`members.${index}.registrant_last_name`]"
            >
              <UInput v-model="member.registrant_last_name" class="w-full" />
            </UFormField>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Phone" :error="fieldErrors[`members.${index}.phone`]">
              <UInput v-model="member.phone" type="tel" class="w-full" />
            </UFormField>
            <UFormField label="Email" :error="fieldErrors[`members.${index}.email`]">
              <UInput v-model="member.email" type="email" class="w-full" />
            </UFormField>
          </div>
        </div>

        <UButton
          color="neutral"
          variant="outline"
          label="Add member"
          icon="i-lucide-plus"
          :disabled="members.length >= 50"
          @click="addMember()"
        />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Cancel" @click="close" />
        <UButton label="Register group" :loading="saving" @click="submit" />
      </div>
    </template>
  </UModal>
</template>
