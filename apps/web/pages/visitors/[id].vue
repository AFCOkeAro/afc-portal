<script setup lang="ts">
import {
  COLLECTIONS,
  DROPOFF_OUTCOMES,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_OUTCOMES,
  JOURNEY_PACK_ITEMS,
  JOURNEY_STAGE_KEYS,
  type VisitorFollowUp,
} from '@afc/shared'
import type { BranchSummary, VisitorRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

interface VisitorDetail extends VisitorRow {
  journey_stage_key: string | null
  journey_stages: Array<{
    key: string
    name: string
    sequence: number
    requires_pack: boolean
    requires_visit_outcome: boolean
  }>
}

interface DuplicateWarning {
  id: string
  collection: 'people' | 'visitors'
  name: string | null
  branch: string | null
  matchedOn: Array<'phone' | 'email'>
}

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const savingStatus = ref(false)
const actionError = ref('')

const {
  data: visitor,
  pending,
  error,
  refresh,
} = await useAsyncData(`visitor-${id}`, () =>
  api.get<VisitorDetail>(`/api/visitors/${id}`),
)

const branches = await useAsyncData('visitors-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const canUpdate = computed(() => permissions.can(COLLECTIONS.visitors, 'update'))
const canConvert = computed(() => permissions.can(COLLECTIONS.people, 'create'))

const displayName = computed(() => {
  const row = visitor.value
  if (!row) return 'Visitor'
  return [row.visitor_first_name, row.visitor_last_name].filter(Boolean).join(' ')
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function prettyKey(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  new: 'warning',
  follow_up: 'warning',
  converted: 'success',
  closed: 'neutral',
  declined: 'error',
}

async function setStatus(status: string): Promise<void> {
  savingStatus.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/visitors/${id}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update status'
  } finally {
    savingStatus.value = false
  }
}

/* ---- Journey tracker (AFC-471) ---- */

const journeyError = ref('')
const advancing = ref(false)
const advanceNote = ref('')
const advanceChecklist = ref<string[]>([])
const advanceOutcome = ref('address_confirmed')

const stageSteps = computed(() => {
  const row = visitor.value
  const stages = row?.journey_stages?.length
    ? row.journey_stages
    : JOURNEY_STAGE_KEYS.map((key, index) => ({
        key,
        name: prettyKey(key),
        sequence: index + 1,
        requires_pack: key === 'pack',
        requires_visit_outcome: key === 'dropoff',
      }))
  const currentKey = row?.journey_stage_key ?? null
  const currentIndex = stages.findIndex((stage) => stage.key === currentKey)
  return { stages, currentKey, currentIndex }
})

const nextStage = computed(() => {
  const { stages, currentIndex } = stageSteps.value
  if (currentIndex < 0) return stages[0] ?? null
  return stages[currentIndex + 1] ?? null
})

const PACK_LABELS: Record<string, string> = {
  literature: 'Literature',
  sermon_notes: 'Sermon notes',
  gift_bag: 'Gift bag',
  malt: 'Malt',
  biscuits: 'Biscuits',
  contact_card: 'Contact card',
}

const dropoffOptions = DROPOFF_OUTCOMES.filter(
  (outcome: string) => outcome !== 'pending',
).map((outcome: string) => ({ label: prettyKey(outcome), value: outcome }))
const channelOptions = FOLLOW_UP_CHANNELS.map((channel: string) => ({
  label: prettyKey(channel),
  value: channel,
}))
const outcomeOptions = FOLLOW_UP_OUTCOMES.map((outcome: string) => ({
  label: prettyKey(outcome),
  value: outcome,
}))

async function advanceStage(): Promise<void> {
  const target = nextStage.value
  if (!target) return
  advancing.value = true
  journeyError.value = ''
  try {
    await api.post('/api/visitors/journey', {
      id,
      to_stage: target.key,
      note: advanceNote.value || undefined,
      pack_checklist: target.requires_pack ? advanceChecklist.value : undefined,
      dropoff_outcome: target.requires_visit_outcome ? advanceOutcome.value : undefined,
    })
    advanceNote.value = ''
    advanceChecklist.value = []
    await refresh()
  } catch (cause) {
    journeyError.value =
      (cause as { message?: string }).message ?? 'Could not advance the journey'
  } finally {
    advancing.value = false
  }
}

/* ---- Officer assignment (restricted to Welfare position holders) ---- */

const officerInput = ref('')
const assigning = ref(false)
const assignError = ref('')

async function assignOfficer(officer: string | null): Promise<void> {
  assigning.value = true
  assignError.value = ''
  try {
    await api.post('/api/visitors/assign', { id, officer })
    officerInput.value = ''
    await refresh()
  } catch (cause) {
    assignError.value =
      (cause as { message?: string }).message ?? 'Could not assign the officer'
  } finally {
    assigning.value = false
  }
}

/* ---- Follow-up timeline + log form ---- */

const {
  data: followUps,
  pending: followUpsPending,
  refresh: refreshFollowUps,
} = await useAsyncData(`visitor-${id}-follow-ups`, () =>
  api.get<VisitorFollowUp[]>('/api/visitors/follow-ups', { query: { visitor: id } }),
)

const logChannel = ref<string>('visit')
const logOutcome = ref<string>('reached')
const logNextStep = ref('')
const logNextDate = ref('')
const logNotes = ref('')
const logging = ref(false)
const logError = ref('')
const logHint = ref('')

async function logFollowUp(): Promise<void> {
  logging.value = true
  logError.value = ''
  logHint.value = ''
  try {
    const result = await api.post<{ id: string; needsSupport: boolean }>(
      '/api/visitors/follow-ups',
      {
        visitor: id,
        contact_channel: logChannel.value,
        outcome: logOutcome.value,
        next_step: logNextStep.value || undefined,
        next_follow_up_at: logNextDate.value || undefined,
        notes: logNotes.value || undefined,
      },
    )
    if (result.needsSupport) {
      logHint.value =
        'This newcomer needs support. Consider opening a welfare case from the Welfare page.'
    }
    logNextStep.value = ''
    logNextDate.value = ''
    logNotes.value = ''
    await Promise.all([refreshFollowUps(), refresh()])
  } catch (cause) {
    logError.value =
      (cause as { message?: string }).message ?? 'Could not log the follow-up'
  } finally {
    logging.value = false
  }
}

/* ---- Conversion + dedupe ---- */

const converting = ref(false)
const convertError = ref('')
const convertResult = ref<{
  person_id: string
  already_converted: boolean
  duplicates: DuplicateWarning[]
} | null>(null)
const linkPersonId = ref('')

async function convert(mode: 'create' | 'link'): Promise<void> {
  converting.value = true
  convertError.value = ''
  try {
    const result = await api.post<{
      visitor_id: string
      person_id: string
      already_converted: boolean
      duplicates: DuplicateWarning[]
    }>('/api/visitors/convert', {
      id,
      mode,
      person_id: mode === 'link' ? linkPersonId.value || undefined : undefined,
    })
    convertResult.value = result
    await refresh()
  } catch (cause) {
    convertError.value =
      (cause as { message?: string }).message ?? 'Could not convert this visitor'
  } finally {
    converting.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/visitors"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to visitors"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this visitor"
      :description="error.message"
    />

    <template v-else-if="visitor">
      <PageHeader
        :title="displayName"
        :description="`Visited ${formatDate(visitor.visit_date)} · ${visitor.branch_name || 'No branch'}`"
      >
        <template #actions>
          <UButton
            v-if="canConvert"
            to="/people"
            color="neutral"
            variant="ghost"
            icon="i-lucide-user-plus"
            label="Open People"
          />
          <PermissionGate :collection="COLLECTIONS.visitors" action="update">
            <UButton
              label="Edit visitor"
              icon="i-lucide-pencil"
              @click="showEdit = true"
            />
          </PermissionGate>
        </template>
      </PageHeader>

      <UAlert
        v-if="actionError"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />

      <div class="grid gap-6 xl:grid-cols-3">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Visit</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Status</dt>
              <dd>
                <UBadge
                  :color="statusColor[visitor.status] ?? 'neutral'"
                  variant="subtle"
                  >{{ visitor.status.replace(/_/g, ' ') }}</UBadge
                >
              </dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Age group</dt>
              <dd class="capitalize">{{ visitor.age_group }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
              <dd>{{ visitor.phone || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Email</dt>
              <dd class="break-all text-right">{{ visitor.email || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Invited by</dt>
              <dd>{{ visitor.invited_by || '—' }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header><h2 class="text-base font-semibold">Follow-up</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Owner</dt>
              <dd>{{ visitor.follow_up_owner || 'Unassigned' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Next date</dt>
              <dd>{{ formatDate(visitor.next_follow_up_date) }}</dd>
            </div>
          </dl>
          <div
            v-if="canUpdate"
            class="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <UButton
              size="xs"
              label="Mark follow up"
              :loading="savingStatus"
              @click="setStatus('follow_up')"
            />
            <UButton
              size="xs"
              color="success"
              variant="outline"
              label="Converted"
              :loading="savingStatus"
              @click="setStatus('converted')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              label="Close"
              :loading="savingStatus"
              @click="setStatus('closed')"
            />
            <UButton
              size="xs"
              color="error"
              variant="outline"
              label="Declined"
              :loading="savingStatus"
              @click="setStatus('declined')"
            />
          </div>
        </UCard>

        <UCard>
          <template #header><h2 class="text-base font-semibold">Notes</h2></template>
          <p
            v-if="visitor.notes"
            class="whitespace-pre-line text-sm text-gray-600 dark:text-gray-300"
          >
            {{ visitor.notes }}
          </p>
          <p v-else class="text-sm text-gray-500 dark:text-gray-400">
            No notes recorded.
          </p>
        </UCard>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Journey</h2></template>
          <ol class="space-y-2">
            <li
              v-for="(stage, index) in stageSteps.stages"
              :key="stage.key"
              class="flex items-center gap-3 text-sm"
            >
              <UBadge
                :color="
                  stageSteps.currentIndex >= 0 && index < stageSteps.currentIndex
                    ? 'success'
                    : stage.key === stageSteps.currentKey
                      ? 'warning'
                      : 'neutral'
                "
                variant="subtle"
              >
                {{ index + 1 }}
              </UBadge>
              <span class="font-medium">{{ stage.name }}</span>
              <span
                v-if="stage.key === stageSteps.currentKey"
                class="text-xs text-gray-500 dark:text-gray-400"
              >
                current
              </span>
            </li>
          </ol>

          <div
            v-if="canUpdate && nextStage"
            class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <p class="text-sm">
              Next step:
              <strong>{{ nextStage.name }}</strong>
            </p>
            <div v-if="nextStage.requires_pack" class="mt-3">
              <p class="mb-2 text-xs font-medium text-gray-500">
                Pack checklist (all six required)
              </p>
              <div class="grid grid-cols-2 gap-2">
                <label
                  v-for="item in JOURNEY_PACK_ITEMS"
                  :key="item"
                  class="flex items-center gap-2 text-sm"
                >
                  <input v-model="advanceChecklist" type="checkbox" :value="item" />
                  {{ PACK_LABELS[item] ?? item }}
                </label>
              </div>
            </div>
            <div v-if="nextStage.requires_visit_outcome" class="mt-3">
              <UFormField label="Drop-off outcome">
                <USelect
                  v-model="advanceOutcome"
                  :items="dropoffOptions"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UFormField label="Note (optional)" class="mt-3">
              <UInput
                v-model="advanceNote"
                placeholder="What happened at this step?"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="journeyError"
              class="mt-3"
              color="error"
              variant="subtle"
              :description="journeyError"
            />
            <UButton
              class="mt-3"
              :label="`Move to ${nextStage.name}`"
              icon="i-lucide-arrow-right"
              :loading="advancing"
              @click="advanceStage()"
            />
          </div>
          <p v-else-if="!nextStage" class="mt-4 text-sm text-gray-500">
            Journey complete — the final stage is reached.
          </p>
        </UCard>

        <UCard>
          <template #header><h2 class="text-base font-semibold">Officer</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Assigned to</dt>
              <dd>{{ visitor.follow_up_owner || 'Unassigned' }}</dd>
            </div>
          </dl>
          <div
            v-if="canUpdate"
            class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <UFormField label="Welfare officer (Directus user id)">
              <UInput
                v-model="officerInput"
                placeholder="User id holding the Welfare position"
                class="w-full"
              />
            </UFormField>
            <p class="mt-1 text-xs text-gray-500">
              Assignment is restricted to Welfare position holders in this branch.
            </p>
            <UAlert
              v-if="assignError"
              class="mt-3"
              color="error"
              variant="subtle"
              :description="assignError"
            />
            <div class="mt-3 flex flex-wrap gap-2">
              <UButton
                size="sm"
                label="Assign"
                :loading="assigning"
                :disabled="!officerInput"
                @click="assignOfficer(officerInput)"
              />
              <UButton
                v-if="visitor.follow_up_owner"
                size="sm"
                color="neutral"
                variant="outline"
                label="Clear"
                :loading="assigning"
                @click="assignOfficer(null)"
              />
            </div>
          </div>
        </UCard>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Follow-ups</h2></template>
          <div v-if="followUpsPending" class="flex justify-center py-6">
            <UIcon
              name="i-lucide-loader-circle"
              class="size-5 animate-spin text-gray-400"
            />
          </div>
          <ol v-else-if="(followUps ?? []).length > 0" class="space-y-3">
            <li
              v-for="entry in followUps ?? []"
              :key="entry.id"
              class="border-b border-gray-100 pb-3 text-sm last:border-0 dark:border-gray-800"
            >
              <div class="flex items-center justify-between gap-2">
                <UBadge color="neutral" variant="subtle">{{
                  prettyKey(entry.outcome)
                }}</UBadge>
                <span class="text-xs text-gray-500">{{
                  prettyKey(entry.contact_channel)
                }}</span>
              </div>
              <p v-if="entry.next_step" class="mt-1">{{ entry.next_step }}</p>
              <p
                v-if="entry.notes"
                class="mt-1 whitespace-pre-line text-gray-600 dark:text-gray-300"
              >
                {{ entry.notes }}
              </p>
              <p class="mt-1 text-xs text-gray-500">
                Next check-in: {{ formatDate(entry.next_follow_up_at) }}
              </p>
            </li>
          </ol>
          <p v-else class="text-sm text-gray-500">No follow-ups logged yet.</p>

          <div
            v-if="canUpdate"
            class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="Channel">
                <USelect v-model="logChannel" :items="channelOptions" class="w-full" />
              </UFormField>
              <UFormField label="Outcome">
                <USelect v-model="logOutcome" :items="outcomeOptions" class="w-full" />
              </UFormField>
              <UFormField label="Next step">
                <UInput
                  v-model="logNextStep"
                  placeholder="e.g. Visit on Sunday"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Next check-in">
                <UInput v-model="logNextDate" type="date" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Notes" class="mt-3">
              <UTextarea
                v-model="logNotes"
                placeholder="Restricted: branch admin, assigned officer, area"
                class="w-full"
              />
            </UFormField>
            <UAlert
              v-if="logError"
              class="mt-3"
              color="error"
              variant="subtle"
              :description="logError"
            />
            <UAlert
              v-if="logHint"
              class="mt-3"
              color="warning"
              variant="subtle"
              title="Needs support"
              :description="logHint"
            >
              <template #actions>
                <UButton to="/welfare" size="xs" variant="outline" label="Open Welfare" />
              </template>
            </UAlert>
            <UButton
              class="mt-3"
              size="sm"
              label="Log follow-up"
              icon="i-lucide-phone"
              :loading="logging"
              @click="logFollowUp()"
            />
          </div>
        </UCard>

        <UCard>
          <template #header><h2 class="text-base font-semibold">Conversion</h2></template>
          <div v-if="visitor.person" class="text-sm">
            <p>
              Linked to person <strong>{{ visitor.person }}</strong
              >. The visitor trail is preserved.
            </p>
            <UButton
              to="/people"
              size="sm"
              variant="outline"
              label="Open People"
              class="mt-3"
            />
          </div>
          <div v-else-if="canConvert">
            <p class="text-sm text-gray-600 dark:text-gray-300">
              Creates (or links) a person record, sets this visitor to converted, and
              keeps the journey trail. Duplicates warn — they never merge silently.
            </p>
            <UAlert
              v-if="convertResult && convertResult.duplicates.length > 0"
              class="mt-3"
              color="warning"
              variant="subtle"
              title="Possible duplicates"
            >
              <template #description>
                <ul class="mt-1 list-disc space-y-1 pl-5">
                  <li
                    v-for="dup in convertResult.duplicates"
                    :key="`${dup.collection}:${dup.id}`"
                  >
                    {{ dup.name ?? 'Unnamed' }} ({{ dup.collection }}, matched on
                    {{ dup.matchedOn.join(' + ') }})
                  </li>
                </ul>
                <p class="mt-2">
                  Link to the existing person (merge decision) or create anyway (keep
                  separate).
                </p>
              </template>
            </UAlert>
            <UAlert
              v-if="convertError"
              class="mt-3"
              color="error"
              variant="subtle"
              :description="convertError"
            />
            <div class="mt-3 flex flex-wrap gap-2">
              <UButton
                size="sm"
                label="Convert (create person)"
                icon="i-lucide-user-plus"
                :loading="converting"
                @click="convert('create')"
              />
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <UInput
                v-model="linkPersonId"
                placeholder="Existing person id"
                class="w-48"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                label="Link existing"
                :loading="converting"
                :disabled="!linkPersonId"
                @click="convert('link')"
              />
            </div>
          </div>
          <p v-else class="text-sm text-gray-500">
            Conversion needs the people-create grant for your role.
          </p>
        </UCard>
      </div>

      <VisitorFormModal
        v-model:open="showEdit"
        :visitor="visitor"
        :branches="branches.data.value ?? []"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
