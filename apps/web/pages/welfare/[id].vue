<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated, PersonRow, WelfareDetail } from '~/types/portal'

definePageMeta({ middleware: ['staff', 'welfare'] })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const showContribution = ref(false)
const savingStatus = ref(false)
const savingContribution = ref(false)
const savingNote = ref(false)
const showNoteForm = ref(false)
const actionError = ref('')
const contributionError = ref('')
const noteError = ref('')

const note = reactive({
  detail: '',
  body: '',
})

const contribution = reactive({
  contribution_type: 'cash',
  amount: '',
  description: '',
  contributor: '',
  status: 'pending',
})

const {
  data: welfareCase,
  pending,
  error,
  refresh,
} = await useAsyncData(`welfare-${id}`, () =>
  api.get<WelfareDetail>(`/api/welfare/${id}`),
)

const branches = await useAsyncData('welfare-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const people = await useAsyncData('welfare-people', () =>
  api.get<Paginated<PersonRow>>('/api/people', {
    query: { limit: 200, status: 'active', sort: 'last_name' },
  }),
)

const canUpdate = computed(() => permissions.can(COLLECTIONS.welfareCases, 'update'))
const canCreateContribution = computed(() =>
  permissions.can(COLLECTIONS.welfareContributions, 'create'),
)
const canUpdateContribution = computed(() =>
  permissions.can(COLLECTIONS.welfareContributions, 'update'),
)
const restrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.welfareCases)
  return hidden.length ? `Not shown on this account: ${hidden.join(', ')}.` : ''
})

const typeOptions = [
  { label: 'Cash', value: 'cash' },
  { label: 'Goods', value: 'goods' },
  { label: 'Service', value: 'service' },
]

const contributionStatusOptions = [
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Disbursed', value: 'disbursed' },
]

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const contributionColor: Record<string, 'success' | 'warning' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  disbursed: 'success',
}

async function setStatus(status: string): Promise<void> {
  savingStatus.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/welfare/${id}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value = (cause as { message?: string }).message ?? 'Could not update case'
  } finally {
    savingStatus.value = false
  }
}

async function addContribution(): Promise<void> {
  contributionError.value = ''
  savingContribution.value = true
  try {
    await api.post(`/api/welfare/${id}/contributions`, {
      contribution_type: contribution.contribution_type,
      amount: contribution.amount || undefined,
      description: contribution.description || undefined,
      contributor: contribution.contributor || undefined,
      status: contribution.status,
    })
    Object.assign(contribution, {
      contribution_type: 'cash',
      amount: '',
      description: '',
      contributor: '',
      status: 'pending',
    })
    showContribution.value = false
    await refresh()
  } catch (cause) {
    contributionError.value =
      (cause as { message?: string }).message ?? 'Could not record that contribution'
  } finally {
    savingContribution.value = false
  }
}

async function setContributionStatus(
  contributionId: string,
  status: string,
): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/welfare/contributions/${contributionId}`, { status })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update that contribution'
  }
}

async function addNote(): Promise<void> {
  noteError.value = ''
  savingNote.value = true
  try {
    await api.post(`/api/welfare/${id}/notes`, {
      detail: note.detail || undefined,
      body: note.body || undefined,
    })
    Object.assign(note, { detail: '', body: '' })
    showNoteForm.value = false
    await refresh()
  } catch (cause) {
    noteError.value =
      (cause as { message?: string }).message ?? 'Could not save that note'
  } finally {
    savingNote.value = false
  }
}

const auth = useAuth()

async function takeCase(): Promise<void> {
  actionError.value = ''
  try {
    const session = await auth.ensureSession()
    const me = session?.user.id
    if (!me) {
      actionError.value = 'Your session has ended. Sign in again.'
      return
    }
    await api.patch(`/api/welfare/${id}`, { assigned_to: me })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update the assignment'
  }
}

async function unassignCase(): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/welfare/${id}`, { assigned_to: null })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update the assignment'
  }
}

const notes = computed(
  () => welfareCase.value?.events.filter((item) => item.event_type === 'note') ?? [],
)
const trail = computed(
  () => welfareCase.value?.events.filter((item) => item.event_type !== 'note') ?? [],
)
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/welfare"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to welfare"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this case"
      :description="error.message"
    />

    <template v-else-if="welfareCase">
      <PageHeader
        :title="`Case ${welfareCase.case_ref}`"
        :description="`${welfareCase.category} · ${welfareCase.branch_name || 'No branch'} · opened ${formatDate(welfareCase.opened_at)}`"
      >
        <template #actions>
          <UBadge
            :color="welfareCase.confidentiality === 'area' ? 'info' : 'neutral'"
            variant="subtle"
          >
            {{ welfareCase.confidentiality ?? 'branch' }}
          </UBadge>
          <PermissionGate :collection="COLLECTIONS.welfareCases" action="update">
            <UButton label="Edit case" icon="i-lucide-pencil" @click="showEdit = true" />
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
      <UAlert
        v-if="restrictedMessage"
        class="mb-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Restricted on this account"
        :description="restrictedMessage"
      />

      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requested" :value="welfareCase.amount_requested || '0.00'" />
        <StatCard label="Assisted" :value="welfareCase.amount_assisted || '0.00'" />
        <StatCard label="Contributed" :value="welfareCase.contribution_total" />
        <StatCard
          label="Status"
          :value="(welfareCase.status ?? 'open').replace(/_/g, ' ')"
          :hint="welfareCase.priority ?? 'normal'"
        />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Case</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Person</dt>
              <dd>{{ welfareCase.person_name || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Assigned to</dt>
              <dd>{{ welfareCase.assigned_to || 'Unassigned' }}</dd>
            </div>
            <div
              v-if="canUpdate"
              class="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-800"
            >
              <UButton
                v-if="!welfareCase.assigned_to"
                size="xs"
                variant="outline"
                label="Take case"
                @click="takeCase"
              />
              <UButton
                v-else
                size="xs"
                color="neutral"
                variant="ghost"
                label="Unassign"
                @click="unassignCase"
              />
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Priority</dt>
              <dd class="capitalize">{{ welfareCase.priority ?? 'normal' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Opened</dt>
              <dd>{{ formatDateTime(welfareCase.opened_at) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Closed</dt>
              <dd>{{ formatDateTime(welfareCase.closed_at) }}</dd>
            </div>
          </dl>
          <div
            v-if="canUpdate"
            class="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <UButton
              size="xs"
              label="In progress"
              :loading="savingStatus"
              @click="setStatus('in_progress')"
            />
            <UButton
              size="xs"
              color="success"
              variant="outline"
              label="Resolved"
              :loading="savingStatus"
              @click="setStatus('resolved')"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              label="Close"
              :loading="savingStatus"
              @click="setStatus('closed')"
            />
          </div>
        </UCard>

        <UCard class="xl:col-span-2">
          <template #header
            ><h2 class="text-base font-semibold">Description</h2></template
          >
          <p
            v-if="welfareCase.description"
            class="whitespace-pre-line text-sm text-gray-600 dark:text-gray-300"
          >
            {{ welfareCase.description }}
          </p>
          <p v-else class="text-sm text-gray-500 dark:text-gray-400">
            No description on this account.
          </p>
          <div
            v-if="welfareCase.outcome_notes"
            class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800"
          >
            <p class="text-sm font-medium">Outcome</p>
            <p class="mt-1 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">
              {{ welfareCase.outcome_notes }}
            </p>
          </div>
        </UCard>
      </div>

      <UCard class="mt-6">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">Contributions</h2>
            <UButton
              v-if="canCreateContribution"
              size="xs"
              label="Add contribution"
              icon="i-lucide-plus"
              @click="showContribution = !showContribution"
            />
          </div>
        </template>

        <form
          v-if="showContribution"
          class="mb-4 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
          @submit.prevent="addContribution"
        >
          <UAlert
            v-if="contributionError"
            color="error"
            variant="subtle"
            :description="contributionError"
          />
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Type">
              <USelect
                v-model="contribution.contribution_type"
                :items="typeOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Amount">
              <UInput
                v-model="contribution.amount"
                type="number"
                min="0"
                step="0.01"
                class="w-full"
              />
            </UFormField>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Contributor">
              <UInput
                v-model="contribution.contributor"
                class="w-full"
                placeholder="Optional"
              />
            </UFormField>
            <UFormField label="Status">
              <USelect
                v-model="contribution.status"
                :items="contributionStatusOptions"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="Description">
            <UTextarea v-model="contribution.description" :rows="2" class="w-full" />
          </UFormField>
          <UButton
            type="submit"
            label="Record contribution"
            :loading="savingContribution"
          />
        </form>

        <EmptyState
          v-if="welfareCase.contributions.length === 0"
          title="No contributions yet"
          description="Cash, goods and services recorded against this case will appear here."
        />
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Date</th>
                <th class="px-3 py-2 font-medium">Type</th>
                <th class="px-3 py-2 font-medium">Contributor</th>
                <th class="px-3 py-2 font-medium">Amount</th>
                <th class="px-3 py-2 font-medium">Description</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th v-if="canUpdateContribution" class="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="row in welfareCase.contributions" :key="row.id">
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ formatDate(row.contributed_at) }}
                </td>
                <td class="px-3 py-3 capitalize">{{ row.contribution_type }}</td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.contributor || '—' }}
                </td>
                <td class="px-3 py-3 tabular-nums">{{ row.amount || '—' }}</td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.description || '—' }}
                </td>
                <td class="px-3 py-3">
                  <UBadge
                    :color="contributionColor[row.status] ?? 'neutral'"
                    variant="subtle"
                    >{{ row.status }}</UBadge
                  >
                </td>
                <td v-if="canUpdateContribution" class="px-3 py-3">
                  <div class="flex gap-1">
                    <UButton
                      v-if="row.status === 'pending'"
                      size="xs"
                      label="Approve"
                      @click="setContributionStatus(row.id, 'approved')"
                    />
                    <UButton
                      v-if="row.status === 'approved'"
                      size="xs"
                      variant="outline"
                      label="Disburse"
                      @click="setContributionStatus(row.id, 'disbursed')"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UCard class="mt-6">
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-semibold">Case notes</h2>
            <div class="flex items-center gap-2">
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >{{ notes.length }} notes</span
              >
              <UButton
                size="xs"
                variant="outline"
                label="Add note"
                icon="i-lucide-plus"
                @click="showNoteForm = !showNoteForm"
              />
            </div>
          </div>
        </template>

        <form
          v-if="showNoteForm"
          class="mb-4 space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
          @submit.prevent="addNote"
        >
          <UAlert
            v-if="noteError"
            color="error"
            variant="subtle"
            :description="noteError"
          />
          <UFormField label="Summary">
            <UInput
              v-model="note.detail"
              class="w-full"
              placeholder="One line for the timeline"
            />
          </UFormField>
          <UFormField label="Note">
            <UTextarea
              v-model="note.body"
              :rows="4"
              class="w-full"
              placeholder="Freeform case note"
            />
          </UFormField>
          <UButton type="submit" label="Save note" :loading="savingNote" />
        </form>

        <EmptyState
          v-if="notes.length === 0"
          title="No notes yet"
          description="Pastoral visits and observations recorded here stay on the audit trail."
        />
        <ol
          v-else
          class="relative space-y-4 border-l border-gray-200 pl-6 dark:border-gray-800"
        >
          <li v-for="item in notes" :key="item.id" class="relative">
            <span
              class="absolute -left-[31px] flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700"
            >
              <UIcon name="i-lucide-notebook-pen" class="size-3 text-gray-500" />
            </span>
            <p class="text-sm font-medium">{{ item.summary }}</p>
            <p
              v-if="item.body"
              class="mt-1 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300"
            >
              {{ item.body }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              note · {{ formatDateTime(item.created_at) }}
            </p>
          </li>
        </ol>
      </UCard>

      <UCard class="mt-6">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">Case trail</h2>
            <span class="text-xs text-gray-500 dark:text-gray-400"
              >{{ trail.length }} entries</span
            >
          </div>
        </template>
        <EmptyState
          v-if="trail.length === 0"
          title="No case activity yet"
          description="Status changes and contributions will be recorded here."
        />
        <ol
          v-else
          class="relative space-y-4 border-l border-gray-200 pl-6 dark:border-gray-800"
        >
          <li v-for="item in trail" :key="item.id" class="relative">
            <span
              class="absolute -left-[31px] flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700"
            >
              <UIcon name="i-lucide-circle" class="size-3 text-gray-500" />
            </span>
            <p class="text-sm font-medium">{{ item.summary }}</p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ item.event_type }} · {{ formatDateTime(item.created_at) }}
            </p>
          </li>
        </ol>
      </UCard>

      <WelfareFormModal
        v-model:open="showEdit"
        :welfare-case="welfareCase"
        :branches="branches.data.value ?? []"
        :people="people.data.value?.data ?? []"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
