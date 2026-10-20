<script setup lang="ts">
/**
 * Delivery-log detail for staff (AFC-527, data-model-v4 §5.1).
 *
 * One header with its recipient rows. Internals are stripped server-side
 * for roles below branch admin; roles without the recipient grant get the
 * header with a null recipient block, never a partial one. Read-only.
 */

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const id = String(route.params.id)

interface RecipientRow {
  id: string
  channel: string
  consent_basis: string
  message_rendered: string | null
  status: string
  exclusion_reason: string | null
  contact_value?: string | null
  error_detail?: string | null
  provider_message_id?: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
}

interface LogDetail {
  id: string
  source_kind: string
  campaign: string | null
  event_invite: string | null
  consent_policy: string | null
  branch_name: string | null
  status: string
  estimated_cost: number | null
  created_at: string
  recipients: RecipientRow[] | null
  recipient_counts: {
    total: number
    queued: number
    sent: number
    delivered: number
    read: number
    failed: number
    excluded: number
    excluded_reasons: Record<string, number>
  } | null
}

const { data, pending, error } = await useAsyncData(`delivery-log-${id}`, () =>
  api.get<LogDetail>(`/api/communications/${id}`),
)

const log = computed(() => data.value ?? null)
</script>

<template>
  <div>
    <PageHeader
      title="Delivery detail"
      description="Header with per-recipient rows. Contact values and provider detail appear only for roles that hold them."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Delivery log"
          to="/communications"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load the delivery record"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="log" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Message header</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Source</dt>
            <dd>{{ log.source_kind }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ log.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Branch</dt>
            <dd>{{ log.branch_name ?? 'area-wide' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Consent policy</dt>
            <dd>{{ log.consent_policy ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Campaign</dt>
            <dd class="font-mono">{{ log.campaign ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Event invite</dt>
            <dd class="font-mono">{{ log.event_invite ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Estimated cost</dt>
            <dd class="tabular-nums">{{ log.estimated_cost ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Created</dt>
            <dd>{{ log.created_at }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">
            Recipients ({{ log.recipient_counts?.total ?? 'withheld' }})
          </h2>
        </template>
        <p
          v-if="log.recipients === null"
          class="text-sm text-gray-600 dark:text-gray-300"
        >
          Recipient rows are withheld for this role — the header above is the complete
          view.
        </p>
        <p
          v-else-if="log.recipients.length === 0"
          class="text-sm text-gray-600 dark:text-gray-300"
        >
          No recipients.
        </p>
        <div v-else class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Channel</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2 font-medium">Consent basis</th>
                <th class="px-3 py-2 font-medium">Reason / detail</th>
                <th class="px-3 py-2 font-medium">Timeline</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="recipient in log.recipients" :key="recipient.id">
                <td class="px-3 py-2">{{ recipient.channel }}</td>
                <td class="px-3 py-2">
                  <UBadge color="neutral" variant="subtle">{{ recipient.status }}</UBadge>
                </td>
                <td class="px-3 py-2">{{ recipient.consent_basis }}</td>
                <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                  {{ recipient.exclusion_reason ?? recipient.error_detail ?? '—' }}
                </td>
                <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                  {{ recipient.sent_at ?? '—' }} → {{ recipient.delivered_at ?? '—' }} →
                  {{ recipient.read_at ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>
    </div>
  </div>
</template>
