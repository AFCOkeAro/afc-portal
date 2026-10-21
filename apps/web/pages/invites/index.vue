<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Staff invitation management (AFC-527, US-E3).
 *
 * Branch-scoped list with the US-E3 filter set (event, inviter, status,
 * date) plus CSV export. Failed sends show the provider error and retry
 * once, idempotently; opt-outs are permanent and have no approval path;
 * limit breaches surface for approval. Staff see full rows; members use
 * /me/invitations (redacted).
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const route = useRoute()

interface InviteRow {
  id: string
  event: string
  branch: string | null
  inviter_person: string | null
  inviter_user: string | null
  invitee_name: string | null
  invitee_phone: string | null
  invitee_age_band: string | null
  channel_choice: string | null
  status: string | null
  approval_required: boolean | null
  blocked_reason: string | null
  created_at: string | null
}

function queryParam(name: string): string {
  const value = route.query[name]
  return typeof value === 'string' ? value : ''
}

const eventFilter = ref(queryParam('event'))
const inviterFilter = ref(queryParam('inviter'))
const statusFilter = ref(queryParam('status') || 'all')
const page = ref(1)
const limit = 25

/** Same-page strip navigation (AFC-588): query-only link, sync the filters. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    statusFilter.value = statusNext ?? 'all'
  },
)

const canManage = computed(() => permissions.can(COLLECTIONS.events, 'read'))

const query = computed(() => ({
  page: page.value,
  limit,
  ...(eventFilter.value ? { event: eventFilter.value } : {}),
  ...(inviterFilter.value ? { inviter: inviterFilter.value } : {}),
  ...(statusFilter.value !== 'all' ? { status: statusFilter.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'staff-invites',
  () =>
    api.get<{ data: InviteRow[]; meta: { total: number } }>('/api/invites', {
      query: query.value,
    }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

// Preloaded caller-scoped event list for the searchable filter below.
// Same GET /api/events list route the Events page uses; no new endpoints.
const eventsQuery = await useAsyncData('staff-invites-events', () =>
  api.get<{ data: Array<{ id: string; title: string }> }>('/api/events', {
    query: { limit: 100 },
  }),
)
const eventOptions = computed(() => [
  { label: 'All events', value: '' },
  ...(eventsQuery.data.value?.data ?? []).map((row) => ({
    label: row.title,
    value: row.id,
  })),
])

/** Dashboard strip (AFC-588): figures from list-meta counts, no new backend. */
async function countInvites(params: Record<string, string>): Promise<number> {
  const res = await api.get<{ data: InviteRow[]; meta: { total: number } }>(
    '/api/invites',
    { query: { page: 1, limit: 1, ...params } },
  )
  return res.meta.total
}

const { data: stripCounts } = await useAsyncData('staff-invites-strip', () =>
  Promise.all([
    countInvites({}),
    countInvites({ status: 'pending_approval' }),
    countInvites({ status: 'sent' }),
    countInvites({ status: 'failed' }),
  ]),
)

const stripItems = computed(() => [
  {
    label: 'Invitations',
    value: stripCounts.value?.[0] ?? null,
    to: '/invites?status=all',
    hint: 'Open filtered list',
  },
  {
    label: 'Pending approval',
    value: stripCounts.value?.[1] ?? null,
    to: '/invites?status=pending_approval',
    hint: 'Open filtered list',
  },
  {
    label: 'Sent',
    value: stripCounts.value?.[2] ?? null,
    to: '/invites?status=sent',
    hint: 'Open filtered list',
  },
  {
    label: 'Failed',
    value: stripCounts.value?.[3] ?? null,
    to: '/invites?status=failed',
    hint: 'Open filtered list',
  },
])

const acting = ref<string | null>(null)
const actionError = ref('')
const actionDone = ref('')

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Pending approval', value: 'pending_approval' },
  { label: 'Queued', value: 'queued' },
  { label: 'Sent', value: 'sent' },
  { label: 'Delivered', value: 'delivered' },
  { label: 'Failed', value: 'failed' },
  { label: 'Blocked (opt-out)', value: 'blocked_optout' },
  { label: 'Blocked (rate limit)', value: 'blocked_rate_limit' },
  { label: 'Withdrawn', value: 'withdrawn' },
  { label: 'Registered', value: 'registered' },
]

function exportHref(): string {
  const params = new URLSearchParams()
  if (eventFilter.value) params.set('event', eventFilter.value)
  if (inviterFilter.value) params.set('inviter', inviterFilter.value)
  if (statusFilter.value !== 'all') params.set('status', statusFilter.value)
  const suffix = params.toString()
  return `/api/invites/export${suffix ? `?${suffix}` : ''}`
}

async function act(id: string, action: 'approve' | 'retry' | 'withdraw'): Promise<void> {
  acting.value = `${action}:${id}`
  actionError.value = ''
  actionDone.value = ''
  try {
    await api.post(`/api/invites/${id}/${action}`)
    actionDone.value = `Invite ${action === 'approve' ? 'approved and queued' : action === 'retry' ? 're-queued once' : 'withdrawn'}.`
    await refresh()
  } catch (cause) {
    actionError.value =
      cause instanceof Error ? cause.message : `Could not ${action} the invite`
  } finally {
    acting.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Event invitations"
      description="Branch-scoped invites with approval, single retry and permanent opt-outs."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-download"
          label="Export CSV"
          :to="exportHref()"
          external
        />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Refresh"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <PermissionGate :collection="COLLECTIONS.events" action="read">
      <div v-if="canManage" class="mb-4 grid max-w-3xl gap-3 sm:grid-cols-4">
        <UFormField label="Event">
          <EntitySelect
            v-model="eventFilter"
            :items="eventOptions"
            placeholder="Select event…"
            :loading="eventsQuery.pending"
            class="w-full"
            @update:model-value="page = 1"
          />
        </UFormField>
        <UFormField label="Inviter user id">
          <UInput
            v-model="inviterFilter"
            placeholder="user uuid"
            class="w-full"
            @update:model-value="page = 1"
          />
        </UFormField>
        <UFormField label="Status">
          <USelect
            v-model="statusFilter"
            :items="statusOptions"
            class="w-full"
            @update:model-value="page = 1"
          />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        class="mb-4"
        color="error"
        variant="subtle"
        title="Could not load invitations"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <UCard v-else>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Invitations ({{ total }})</h2>
        </template>
        <p v-if="rows.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
          No invitations match.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Invitee</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Reason / error</th>
                <th class="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="row in rows" :key="row.id">
                <td class="px-3 py-2">
                  <p class="font-medium">{{ row.invitee_name ?? '—' }}</p>
                  <p class="font-mono text-xs text-gray-500">
                    {{ row.invitee_phone ?? '—' }} · {{ row.channel_choice ?? 'auto' }}
                  </p>
                </td>
                <td class="px-3 py-2">
                  <UBadge color="neutral" variant="subtle">{{
                    (row.status ?? 'unknown').replaceAll('_', ' ')
                  }}</UBadge>
                </td>
                <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                  {{ row.blocked_reason ?? '—' }}
                </td>
                <td class="px-3 py-2">
                  <div class="flex flex-wrap gap-1">
                    <UButton
                      v-if="
                        row.status === 'pending_approval' ||
                        row.status === 'blocked_rate_limit'
                      "
                      size="xs"
                      color="success"
                      variant="outline"
                      label="Approve"
                      :loading="acting === `approve:${row.id}`"
                      @click="act(row.id, 'approve')"
                    />
                    <UButton
                      v-if="row.status === 'failed'"
                      size="xs"
                      color="neutral"
                      variant="outline"
                      label="Retry once"
                      :loading="acting === `retry:${row.id}`"
                      @click="act(row.id, 'retry')"
                    />
                    <UButton
                      v-if="
                        ['pending_approval', 'queued', 'blocked_rate_limit'].includes(
                          row.status ?? '',
                        )
                      "
                      size="xs"
                      color="neutral"
                      variant="outline"
                      label="Withdraw"
                      :loading="acting === `withdraw:${row.id}`"
                      @click="act(row.id, 'withdraw')"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mt-3 flex items-center gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            label="Previous"
            :disabled="page <= 1"
            @click="page = Math.max(1, page - 1)"
          />
          <span class="text-xs text-gray-500">Page {{ page }} of {{ pageCount }}</span>
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            label="Next"
            :disabled="page >= pageCount"
            @click="page = Math.min(pageCount, page + 1)"
          />
        </div>
        <UAlert
          v-if="actionError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Action failed"
          :description="actionError"
        />
        <UAlert
          v-if="actionDone"
          class="mt-3"
          color="success"
          variant="subtle"
          title="Done"
          :description="actionDone"
        />
      </UCard>
    </PermissionGate>
  </div>
</template>
