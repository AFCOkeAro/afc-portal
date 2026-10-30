<script setup lang="ts">
/**
 * WorkflowTriggerChain (AFC-868): read-only trigger-chain renderer matching
 * the "Upon Joining a Group" sample — a purple trigger pill with a vertical
 * dotted spine, then one wait-then-send card per node (wait label, channel
 * icon, day pill, status dot). A conditional step renders a decision
 * diamond above its card with diverging YES (green, step runs) and NO
 * (red, step skipped) edges that rejoin at the next step.
 *
 * Purely presentational: every figure comes from the `chain` prop (the
 * GET /api/workflows/trigger-chain shape). No fetch, no write, no builder
 * editing — step editing stays in AFC-586 scope.
 */

export interface TriggerChainNodeView {
  sequence: number
  name: string
  condition_label: string | null
  yes_to: string | null
  no_to: string | null
  wait_days: number | null
  wait_label: string
  channel_key: string
  channel_icon: 'chat' | 'sms' | 'email' | 'calendar'
  scheduled_at: string | null
  day_pill: string | null
  status: 'sendable' | 'held' | 'blocked'
  status_reason: string | null
  quiet_hours_note: string
  consent_note: string
  template_note: string | null
}

export interface TriggerChainView {
  trigger_label: string
  campaign_key: string
  campaign_name: string
  consent_policy: string
  anchor_at: string
  node_count: number
  nodes: TriggerChainNodeView[]
}

defineProps<{
  chain: TriggerChainView
}>()

const CHANNEL_ICONS: Record<TriggerChainNodeView['channel_icon'], string> = {
  chat: 'i-lucide-message-square-text',
  sms: 'i-lucide-smartphone',
  email: 'i-lucide-mail',
  calendar: 'i-lucide-calendar-days',
}

function statusDotClass(status: TriggerChainNodeView['status']): string {
  if (status === 'sendable') return 'bg-green-500'
  return 'bg-red-500'
}

function statusText(node: TriggerChainNodeView): string {
  if (node.status === 'sendable') return 'Sendable'
  if (node.status === 'held')
    return `Held${node.status_reason ? `: ${node.status_reason.replaceAll('_', ' ')}` : ''}`
  return `Blocked${node.status_reason ? `: ${node.status_reason.replaceAll('_', ' ')}` : ''}`
}
</script>

<template>
  <div data-testid="workflow-trigger-chain">
    <!-- Trigger pill (sample: purple pill, workflow icon + trigger name). -->
    <div class="flex items-center gap-3">
      <span
        class="inline-flex items-center gap-2 rounded-full bg-purple-600 px-4 py-2 text-sm font-semibold text-white"
      >
        <UIcon name="i-lucide-workflow" class="size-4" />
        {{ chain.trigger_label }}
      </span>
    </div>

    <!-- Vertical dotted spine with the wait-then-send cards. -->
    <ol
      v-if="chain.nodes.length > 0"
      class="mt-2 space-y-4 border-l-2 border-dotted border-purple-300 pl-6 dark:border-purple-700"
    >
      <li
        v-for="node in chain.nodes"
        :key="node.sequence"
        data-testid="trigger-chain-node"
        class="relative"
      >
        <span
          class="absolute -left-[31px] top-5 size-2.5 rounded-full ring-2 ring-white dark:ring-gray-900"
          :class="statusDotClass(node.status)"
          :title="statusText(node)"
        />
        <div
          v-if="node.condition_label"
          data-testid="trigger-chain-decision"
          :aria-label="`Decision: ${node.condition_label}`"
          class="mb-2 flex items-start gap-3"
        >
          <span
            aria-hidden="true"
            class="mt-0.5 inline-flex size-8 shrink-0 rotate-45 items-center justify-center rounded-[6px] bg-purple-600 text-white"
          >
            <span class="-rotate-45 text-sm font-bold">?</span>
          </span>
          <div class="min-w-0">
            <p class="text-sm font-semibold text-gray-900 dark:text-white">
              {{ node.condition_label }}
            </p>
            <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <span
                class="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-300"
              >
                <span class="inline-block h-px w-4 bg-green-500" aria-hidden="true" />
                Yes → runs this step{{
                  node.yes_to ? `, then ${node.yes_to}` : ', then the workflow ends'
                }}
              </span>
              <span
                class="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300"
              >
                <span class="inline-block h-px w-4 bg-red-500" aria-hidden="true" />
                No → skips to {{ node.no_to ?? 'the end of the workflow' }}
              </span>
            </div>
          </div>
        </div>
        <UCard>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm font-semibold">{{ node.wait_label }}</span>
            <UBadge
              v-if="node.condition_label"
              color="warning"
              variant="subtle"
              title="This step runs only when the decision above answers yes"
            >
              Runs on YES
            </UBadge>
            <UBadge
              v-if="node.day_pill"
              color="neutral"
              variant="subtle"
              :title="`Previewed send weekday from the anchor date`"
            >
              {{ node.day_pill }}
            </UBadge>
            <span
              class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
              :title="`Channel: ${node.channel_key}`"
            >
              <UIcon :name="CHANNEL_ICONS[node.channel_icon]" class="size-4" />
              {{ node.channel_key }}
            </span>
            <span
              class="inline-flex items-center gap-1.5 text-xs font-medium"
              :class="
                node.status === 'sendable'
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              "
            >
              <span class="size-2 rounded-full" :class="statusDotClass(node.status)" />
              {{ statusText(node) }}
            </span>
          </div>
          <p class="mt-1 text-sm text-gray-700 dark:text-gray-200">
            {{ node.sequence }}. {{ node.name }}
          </p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ node.quiet_hours_note }} · {{ node.consent_note
            }}{{ node.template_note ? ` · ${node.template_note}` : '' }}
          </p>
        </UCard>
      </li>
    </ol>

    <p
      v-else
      class="mt-4 text-sm text-gray-600 dark:text-gray-300"
      data-testid="trigger-chain-empty"
    >
      No steps configured yet. Steps are board config written through the reviewed
      template gate — add steps to this campaign to preview its trigger chain.
    </p>
  </div>
</template>
