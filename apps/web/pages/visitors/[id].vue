<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, VisitorRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

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
} = await useAsyncData(`visitor-${id}`, () => api.get<VisitorRow>(`/api/visitors/${id}`))

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

      <VisitorFormModal
        v-model:open="showEdit"
        :visitor="visitor"
        :branches="branches.data.value ?? []"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
