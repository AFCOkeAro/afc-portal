<script setup lang="ts">
/**
 * Campaign run report (AFC-527, wireframes v3 screen 12, US-C2).
 *
 * Auditable batch record for one step execution window: audience, eligible,
 * excluded (by reason), queued, sent, delivered, read, failed, opted-out,
 * estimated/actual cost, plus the run notes stating which activity signals
 * were available (OQ-R5: `delivered` is the proxy when the provider supplies
 * no read receipts). Read-only; the single idempotent invite retry for failed
 * invite sends lives on the invites routes.
 * AFC-538 finding 5 (owner: CTO MediaTech): link-only discoverability — the
 * report links to the failed-invites queue where the existing retry route
 * (POST /api/invites/:id/retry, failed-only, idempotent-once) is offered.
 * No new send path is added here.
 */

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const id = String(route.params.id)
const runId = String(route.params.runId)

interface RunReport {
  id: string
  campaign_key: string
  campaign_name: string
  campaign_status: string
  campaign_consent_policy: string
  step_name: string | null
  window_start: string | null
  window_end: string | null
  trigger: string
  status: string
  audience_size: number
  eligible_count: number
  excluded_count: number
  excluded_reasons: Record<string, number>
  queued_count: number
  sent_count: number
  delivered_count: number
  read_count: number
  failed_count: number
  opted_out_count: number
  estimated_cost: number | null
  actual_cost: number | null
  currency: string
  worker_run_id: string | null
  started_at: string | null
  completed_at: string | null
  notes: string | null
}

const { data, pending, error } = await useAsyncData(`campaign-run-${runId}`, () =>
  api.get<{ data: RunReport }>(`/api/campaigns/${id}/runs/${runId}`),
)

const run = computed(() => data.value?.data ?? null)

const counters = computed(() => {
  const report = run.value
  if (!report) return []
  return [
    {
      label: 'Audience',
      value: String(report.audience_size),
      hint: 'Resolved before consent',
    },
    {
      label: 'Eligible',
      value: String(report.eligible_count),
      hint: 'Passed consent and caps',
    },
    {
      label: 'Excluded',
      value: String(report.excluded_count),
      hint: 'Blocked with a reason',
    },
    { label: 'Queued', value: String(report.queued_count), hint: 'Held by the tick' },
    { label: 'Sent', value: String(report.sent_count), hint: 'Handed to the provider' },
    {
      label: 'Delivered',
      value: String(report.delivered_count),
      hint: 'Provider confirmed',
    },
    {
      label: 'Read',
      value: String(report.read_count),
      hint: 'Read receipt, where supplied',
    },
    {
      label: 'Failed',
      value: String(report.failed_count),
      hint: 'Redacted error on the log',
    },
    {
      label: 'Opted out',
      value: String(report.opted_out_count),
      hint: 'STOP recorded permanently',
    },
  ]
})
</script>

<template>
  <div>
    <PageHeader
      :title="run ? `Run report — ${run.campaign_name}` : 'Run report'"
      description="Audience, delivery and cost for one step execution window. Immutable once written."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Campaign"
          :to="`/campaigns/${id}`"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-rotate-ccw"
          label="Failed invites — retry once"
          to="/invites?status=failed"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load the run report"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="run" class="grid gap-4">
      <div class="grid gap-4 sm:grid-cols-3">
        <StatCard
          v-for="counter in counters"
          :key="counter.label"
          :label="counter.label"
          :value="counter.value"
          :hint="counter.hint"
        />
      </div>

      <UCard>
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Run detail</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Campaign</dt>
            <dd class="font-mono">{{ run.campaign_key }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Step</dt>
            <dd>{{ run.step_name ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ run.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Trigger</dt>
            <dd>{{ run.trigger }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Window</dt>
            <dd>{{ run.window_start ?? '—' }} → {{ run.window_end ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Estimated cost</dt>
            <dd class="tabular-nums">
              {{ run.estimated_cost ?? '—' }} {{ run.currency }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Actual cost</dt>
            <dd class="tabular-nums">{{ run.actual_cost ?? '—' }} {{ run.currency }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Worker run</dt>
            <dd class="font-mono">{{ run.worker_run_id ?? '—' }}</dd>
          </div>
        </dl>
        <div v-if="Object.keys(run.excluded_reasons).length > 0" class="mt-4">
          <h3 class="text-sm font-semibold">Excluded by reason</h3>
          <ul class="mt-1 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300">
            <li v-for="(count, reason) in run.excluded_reasons" :key="reason">
              {{ reason }} — <span class="tabular-nums">{{ count }}</span>
            </li>
          </ul>
        </div>
        <div class="mt-4">
          <h3 class="text-sm font-semibold">Signal availability (run notes)</h3>
          <p class="mt-1 text-sm text-gray-600 whitespace-pre-wrap dark:text-gray-300">
            {{ run.notes ?? 'No notes recorded for this run.' }}
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>
