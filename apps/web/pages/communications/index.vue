<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Delivery-log list for staff (AFC-527, US-C2 AC4 + data-model-v4 §5.1).
 *
 * Permission-scoped reads of `communications` headers with per-status
 * recipient counts. Recipient internals (contact_value, error_detail,
 * provider_message_id) never cross the list route — roles without the
 * recipient grant see a null count block, never a partial one. Read-only:
 * this page enables no send path.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

interface RecipientCounts {
  total: number
  queued: number
  sent: number
  delivered: number
  read: number
  failed: number
  excluded: number
  excluded_reasons: Record<string, number>
}

interface LogRow {
  id: string
  source_kind: string
  campaign: string | null
  event_invite: string | null
  branch_name: string | null
  status: string
  estimated_cost: number | null
  created_at: string
  recipient_counts: RecipientCounts | null
}

const sourceKind = ref('all')
const status = ref('all')
const page = ref(1)
const limit = 25

const canRead = computed(() => permissions.can(COLLECTIONS.communications, 'read'))

const query = computed(() => ({
  page: page.value,
  limit,
  ...(sourceKind.value !== 'all' ? { source_kind: sourceKind.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'delivery-log',
  () =>
    api.get<{ data: LogRow[]; meta: { total: number } }>('/api/communications', {
      query: query.value,
    }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const sourceOptions = [
  { label: 'Any source', value: 'all' },
  { label: 'Manual', value: 'manual' },
  { label: 'Campaign', value: 'campaign' },
  { label: 'Invite', value: 'invite' },
  { label: 'Welcome form', value: 'welcome_form' },
  { label: 'Birthday webhook', value: 'birthday_webhook' },
]
const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Queued', value: 'queued' },
  { label: 'Sending', value: 'sending' },
  { label: 'Sent', value: 'sent' },
  { label: 'Partial', value: 'partial' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' },
]
</script>

<template>
  <div>
    <PageHeader
      title="Delivery log"
      description="One header per message with recipient counts. Internals stay redacted per role."
    >
      <template #actions>
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

    <PermissionGate :collection="COLLECTIONS.communications" action="read">
      <div class="mb-4 grid max-w-2xl gap-3 sm:grid-cols-3">
        <UFormField label="Source">
          <USelect
            v-model="sourceKind"
            :items="sourceOptions"
            class="w-full"
            @update:model-value="page = 1"
          />
        </UFormField>
        <UFormField label="Status">
          <USelect
            v-model="status"
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
        title="Could not load the delivery log"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <UCard v-else>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Messages ({{ total }})</h2>
        </template>
        <p v-if="rows.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
          No messages match.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Message</th>
                <th class="px-3 py-2 font-medium">Source</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Counts</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="row in rows" :key="row.id">
                <td class="px-3 py-2">
                  <NuxtLink
                    :to="`/communications/${row.id}`"
                    class="font-mono text-teal-700 underline dark:text-teal-300"
                  >
                    {{ row.id.slice(0, 8) }}
                  </NuxtLink>
                  <p class="text-xs text-gray-500">
                    {{ row.branch_name ?? 'area-wide' }} · {{ row.created_at }}
                  </p>
                </td>
                <td class="px-3 py-2">{{ row.source_kind }}</td>
                <td class="px-3 py-2">
                  <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
                </td>
                <td
                  class="px-3 py-2 text-xs tabular-nums text-gray-600 dark:text-gray-300"
                >
                  <span v-if="row.recipient_counts">
                    {{ row.recipient_counts.total }} total ·
                    {{ row.recipient_counts.delivered }} delivered ·
                    {{ row.recipient_counts.read }} read ·
                    {{ row.recipient_counts.failed }} failed ·
                    {{ row.recipient_counts.excluded }} excluded
                  </span>
                  <span v-else>counts withheld for this role</span>
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
      </UCard>
    </PermissionGate>

    <UAlert
      v-if="!canRead"
      color="warning"
      variant="subtle"
      title="No access"
      description="Your role cannot read the delivery log."
    />
  </div>
</template>
