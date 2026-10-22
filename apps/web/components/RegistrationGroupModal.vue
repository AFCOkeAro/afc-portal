<script setup lang="ts">
/**
 * Branch-scoped group mass registration (AFC-470 §4, AFC-649 §G): one
 * `group_code` plus N members in a single submission.
 *
 * Client validation is deliberately thin (names present, code present) —
 * the route validates every member against `registrationFormSchema` and
 * answers per-member errors, which are shown against the row index AND in
 * the row-level error report below the form. Retries are safe: the route's
 * idempotency split skips already-written members instead of duplicating
 * them. Branch is picked with the searchable EntitySelect (AFC-631, no
 * manual IDs); empty means the event's own branch.
 *
 * Stated limit: Directus REST has no multi-row transaction, so a
 * mid-batch failure returns the ids already written and the same payload
 * retried skips them instead of duplicating (group_partial_failure 502).
 * A single-transaction batch needs a DB function outside this route —
 * not claimed here.
 */
import type { BranchSummary } from '~/types/portal'

const props = defineProps<{
  open: boolean
  eventId: string
  branches: BranchSummary[]
  eventBranch: string | null
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
const branch = ref('')

/** Row-level report of the last submit (AFC-649 §G). */
const lastReport = ref<{
  created: Array<{ index: number; ticket: string | null }>
  skipped: number[]
  errors: Array<{ index: number; message: string }>
} | null>(null)

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

const branchOptions = computed(() => [
  { label: 'Event branch', value: '' },
  ...props.branches.map((row) => ({ label: row.name, value: row.id })),
])

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    formError.value = ''
    fieldErrors.value = {}
    groupCode.value = ''
    branch.value = ''
    lastReport.value = null
    members.splice(0, members.length, blankMember(), blankMember())
  },
  { immediate: true },
)

/** Row-level report rows with a real error (script-side so the template stays typeless). */
const reportErrorRows = computed<Array<{ index: number; message: string }>>(() =>
  (lastReport.value?.errors ?? []).filter(
    (entry: { index: number; message: string }) =>
      entry.message !== 'No error reported for this row.',
  ),
)
const hasReportErrors = computed(() => reportErrorRows.value.length > 0)

function close(): void {
  emit('update:open', false)
}

async function submit(): Promise<void> {
  formError.value = ''
  fieldErrors.value = {}
  const errors: Record<string, string> = {}
  if (!groupCode.value.trim()) errors.group_code = 'Give this group submission a code'
  members.forEach((member: GroupMember, index: number) => {
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
      data: Array<{ id: string; ticket_code?: string | null }>
      meta: { created: number; skipped: number; total: number }
    }>(`/api/events/${props.eventId}/group-registrations`, {
      group_code: groupCode.value.trim(),
      members: members.map((member: GroupMember) => ({
        registrant_first_name: member.registrant_first_name.trim(),
        registrant_last_name: member.registrant_last_name.trim(),
        phone: member.phone.trim() || undefined,
        email: member.email.trim() || undefined,
        // Branch-scoped mass registration: one branch for the whole batch
        // (server resolves + scope-checks per member; empty → event branch).
        branch: branch.value || undefined,
      })),
    })
    formError.value = ''
    fieldErrors.value = {}
    lastReport.value = {
      created: result.data.map((row, index) => ({
        index,
        ticket: row.ticket_code ?? null,
      })),
      skipped: [],
      errors: [],
    }
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
    lastReport.value = {
      created: [],
      skipped: [],
      errors: members.map((member: GroupMember, index: number) => {
        const messages = Object.entries(error.fields ?? {})
          .filter(
            ([key]) => key === `members.${index}` || key.startsWith(`members.${index}.`),
          )
          .map(([, message]) => message)
        return {
          index,
          message:
            messages.length > 0 ? messages.join('; ') : 'No error reported for this row.',
        }
      }),
    }
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

        <UFormField
          label="Branch for this batch"
          help="Every member registers under this branch. Empty means the event's own branch."
        >
          <EntitySelect
            v-model="branch"
            :items="branchOptions"
            placeholder="Event branch"
            class="w-full"
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

        <div v-if="hasReportErrors" aria-live="polite">
          <h3 class="text-sm font-semibold">
            Row-level error report — nothing was registered
          </h3>
          <ul class="mt-1 space-y-1 text-sm">
            <li
              v-for="entry in reportErrorRows"
              :key="entry.index"
              class="rounded border border-red-200 bg-red-50 px-2 py-1 dark:border-red-900 dark:bg-red-950"
            >
              Row {{ entry.index + 1 }}: {{ entry.message }}
            </li>
          </ul>
        </div>
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
