<script setup lang="ts">
/**
 * Campaign editor — read surface (AFC-527, wireframes v3 screen 10, US-C1).
 *
 * Shows the step list (delay type, channel, template + approval state),
 * audience + consent-gate preview with eligible/excluded counts and reasons
 * (from the latest stored run; before the first run the preview says so
 * instead of inventing numbers), and the status / kill-switch state.
 *
 * Stated choice: steps render read-only. Steps are board config written
 * through the reviewed template gate (migration 0006 stated choice 5), not
 * code and not an unreviewed app write — this slice adds reads only, so the
 * editor surface is the step list with its gate state, and activation stays
 * behind the bulk-threshold approval. Anchor sections per prd-addendum-v4
 * §1.4.
 *
 * AFC-538 finding 2 (owner: CTO MediaTech): the wireframe send-test button
 * is deferred. No sandboxed single-recipient send exists on this page; if it
 * is scoped later it needs its own story (single recipient + approval, no
 * bulk path, consent-gated) and a SecurityEngineer review before any send
 * endpoint ships.
 */

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const id = String(route.params.id)

interface CampaignStep {
  id: string
  sequence: number
  name: string
  delay_type: string
  delay_value: string | null
  channel_key: string
  channel_enabled: boolean | null
  template_key: string | null
  template_approval_status: string | null
  template_provider_id: string | null
  condition: Record<string, unknown>
  max_sends_per_person: number | null
  is_entry_step: boolean
  is_fallback_step: boolean
  is_terminal: boolean
  active: boolean
}

interface CampaignRun {
  id: string
  status: string
  window_start: string | null
  sent_count: number
  delivered_count: number
  failed_count: number
}

interface CampaignDetail {
  id: string
  key: string
  name: string
  purpose: string
  campaign_type: string
  consent_policy: string
  status: string
  branch: string | null
  max_sends_per_person_per_week: number
  fallback_sms_after_hours: number
  quiet_hours_override: boolean
  paused_at: string | null
  paused_by: string | null
  pause_reason: string | null
  steps: CampaignStep[]
  runs: CampaignRun[]
  consent_gate_preview:
    | { has_run: true, run_id: string, window_start: string | null, audience_size: number, eligible_count: number, excluded_count: number, excluded_reasons: Record<string, number> }
    | { has_run: false }
}

const { data, pending, error, refresh } = await useAsyncData(
  `campaign-${id}`,
  () => api.get<{ data: CampaignDetail }>(`/api/campaigns/${id}`),
)

const campaign = computed(() => data.value?.data ?? null)
const preview = computed(() => campaign.value?.consent_gate_preview ?? { has_run: false as const })

const sections = [
  { id: 'overview', label: 'Overview' },
  { id: 'audience', label: 'Audience and consent gate' },
  { id: 'steps', label: 'Steps' },
  { id: 'runs', label: 'Runs' },
]

function statusColor(status: string): 'success' | 'warning' | 'neutral' | 'error' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'failed') return 'error'
  return 'neutral'
}
</script>

<template>
  <div>
    <PageHeader
      :title="campaign ? campaign.name : 'Campaign'"
      description="Steps, audience and consent-gate preview, runs. Status changes go through the audited kill switch."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Catalogue"
          to="/campaigns"
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

    <UAlert
      v-if="error"
      class="mb-4"
      color="error"
      variant="subtle"
      title="Could not load the campaign"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="campaign">
      <UAlert
        v-if="campaign.status === 'paused'"
        class="mb-4"
        color="warning"
        variant="subtle"
        title="Paused — the kill switch holds this campaign"
        :description="`Paused${campaign.paused_at ? ` at ${campaign.paused_at}` : ''}${campaign.pause_reason ? `: ${campaign.pause_reason}` : ''}. Pending steps resume from next_step_at; nothing queued was deleted.`"
      />

      <SectionNav :sections="sections" />

      <section id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Overview</h2>
          </template>
          <dl class="grid gap-3 text-sm sm:grid-cols-2">
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Key</dt><dd class="font-mono">{{ campaign.key }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Status</dt><dd><UBadge :color="statusColor(campaign.status)" variant="subtle">{{ campaign.status }}</UBadge></dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Type</dt><dd>{{ campaign.campaign_type }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Consent policy</dt><dd>{{ campaign.consent_policy.replaceAll('_', ' ') }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Weekly cap per person</dt><dd class="tabular-nums">{{ campaign.max_sends_per_person_per_week }}</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">SMS fallback after</dt><dd class="tabular-nums">{{ campaign.fallback_sms_after_hours }}h</dd></div>
            <div class="flex justify-between gap-4"><dt class="text-gray-500">Quiet-hours override</dt><dd>{{ campaign.quiet_hours_override ? 'operational-essential only' : 'no — held to 08:00' }}</dd></div>
          </dl>
        </UCard>
      </section>

      <section id="audience" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Audience and consent gate</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Audience and consent-gate preview</h2>
          </template>
          <div v-if="preview.has_run === false">
            <p class="text-sm text-gray-600 dark:text-gray-300">
              No run has executed yet, so there are no eligible / excluded counts to show.
              Counts appear here after the first scheduler tick.
            </p>
          </div>
          <div v-else class="grid gap-4 sm:grid-cols-3">
            <StatCard label="Audience" :value="String(preview.audience_size)" hint="Resolved before consent" />
            <StatCard label="Eligible" :value="String(preview.eligible_count)" hint="Passed consent and caps" />
            <StatCard label="Excluded" :value="String(preview.excluded_count)" hint="Blocked with a reason" />
          </div>
          <div v-if="preview.has_run === true && Object.keys(preview.excluded_reasons).length > 0" class="mt-4">
            <h3 class="text-sm font-semibold">Exclusion reasons</h3>
            <ul class="mt-1 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300">
              <li v-for="(count, reason) in preview.excluded_reasons" :key="reason">
                {{ reason }} — <span class="tabular-nums">{{ count }}</span>
              </li>
            </ul>
          </div>
        </UCard>
      </section>

      <section id="steps" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Steps</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Steps ({{ campaign.steps.length }})</h2>
          </template>
          <p v-if="campaign.steps.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
            No steps configured yet. Steps are board config written through the reviewed
            template gate — a WhatsApp step cannot run until its template is provider-approved.
          </p>
          <div v-else class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th class="px-3 py-2 font-medium">#</th>
                  <th class="px-3 py-2 font-medium">Step</th>
                  <th class="px-3 py-2 font-medium">Delay</th>
                  <th class="px-3 py-2 font-medium">Channel</th>
                  <th class="px-3 py-2 font-medium">Template gate</th>
                  <th class="px-3 py-2 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="step in campaign.steps" :key="step.id">
                  <td class="px-3 py-2 tabular-nums">{{ step.sequence }}</td>
                  <td class="px-3 py-2 font-medium">{{ step.name }}</td>
                  <td class="px-3 py-2">{{ step.delay_type }}{{ step.delay_value ? ` (${step.delay_value})` : '' }}</td>
                  <td class="px-3 py-2">
                    {{ step.channel_key }}
                    <UBadge v-if="step.channel_enabled === false" color="error" variant="subtle">disabled</UBadge>
                  </td>
                  <td class="px-3 py-2">
                    <span v-if="step.template_key">{{ step.template_key }} · {{ step.template_approval_status }}</span>
                    <span v-else class="text-gray-500">body override</span>
                  </td>
                  <td class="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                    {{ [step.is_entry_step ? 'entry' : '', step.is_fallback_step ? 'fallback' : '', step.is_terminal ? 'terminal' : '', step.active ? '' : 'inactive'].filter(Boolean).join(' · ') || '—' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Send-test is not offered on this page (AFC-538 finding 2, owner CTO):
            the wireframe test button is deferred until a sandboxed single-recipient
            send with approval is scoped as its own story. No test send leaves this page.
          </p>
        </UCard>
      </section>

      <section id="runs" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Runs</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Runs ({{ campaign.runs.length }})</h2>
          </template>
          <p v-if="campaign.runs.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
            No runs yet.
          </p>
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="run in campaign.runs" :key="run.id" class="flex flex-wrap items-center gap-3 py-2">
              <NuxtLink :to="`/campaigns/${campaign.id}/runs/${run.id}`" class="text-sm font-medium text-teal-700 underline dark:text-teal-300">
                {{ run.window_start ?? run.id }}
              </NuxtLink>
              <UBadge :color="statusColor(run.status)" variant="subtle">{{ run.status }}</UBadge>
              <span class="text-xs text-gray-500">sent {{ run.sent_count }} · delivered {{ run.delivered_count }} · failed {{ run.failed_count }}</span>
            </li>
          </ul>
        </UCard>
      </section>
    </div>
  </div>
</template>
