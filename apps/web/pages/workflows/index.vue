<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { TriggerChainView } from '~/components/WorkflowTriggerChain.vue'

/**
 * Workflow trigger-chain preview (AFC-868, sample: Upon Joining a Group).
 *
 * Read-only renderer for the wait-then-send spine of one campaign: the
 * trigger pill plus one card per step with its wait label, channel icon,
 * weekday pill and sendable/held/blocked dot. The dots reuse the comms
 * consent and quiet-hours rules (same window and gates as the campaign
 * tick); step editing is not offered here — builder editing stays in
 * AFC-586 scope.
 *
 * Stated choice: the weekday pills are a PREVIEW from the anchor date
 * (default today), not a scheduled run. Before a campaign has steps the
 * spine says so instead of inventing nodes.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const router = useRouter()

const CHAIN_KEYS = [
  { label: 'New-visitor welcome drip', value: 'new_visitor_welcome_drip' },
  { label: 'New-convert drip', value: 'new_convert_drip' },
  { label: 'Newcomer weekly check-in', value: 'newcomer_weekly_checkin' },
]

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

const chainKey = ref(queryParam('key') ?? 'new_visitor_welcome_drip')
const anchorDay = ref(queryParam('anchor') ?? todayIso())

/** Same-page strip navigation (AFC-588 pattern): query-only, sync the form. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const keyNext = typeof next.key === 'string' ? next.key : null
    if (keyNext && keyNext !== chainKey.value) chainKey.value = keyNext
    const anchorNext = typeof next.anchor === 'string' ? next.anchor : null
    if (anchorNext && anchorNext !== anchorDay.value) anchorDay.value = anchorNext
  },
)

const query = computed(() => ({
  key: chainKey.value,
  anchor: new Date(`${anchorDay.value}T09:00:00Z`).toISOString(),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'workflow-trigger-chain',
  () =>
    api.get<{ data: TriggerChainView }>('/api/workflows/trigger-chain', {
      query: query.value,
    }),
  { watch: [query] },
)

const chain = computed(() => data.value?.data ?? null)

function applyFilters(): void {
  router.push({
    query: { ...route.query, key: chainKey.value, anchor: anchorDay.value },
  })
}
</script>

<template>
  <div>
    <PageHeader
      title="Workflow trigger chain"
      description="Read-only preview of the wait-then-send spine for one campaign. Builder editing stays in AFC-586 scope — no step editing here."
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
      <div class="mb-4 grid max-w-2xl gap-3 sm:grid-cols-2">
        <UFormField label="Campaign">
          <USelect
            v-model="chainKey"
            :items="CHAIN_KEYS"
            class="w-full"
            @update:model-value="applyFilters()"
          />
        </UFormField>
        <UFormField label="Anchor date (preview only)">
          <UInput
            v-model="anchorDay"
            type="date"
            class="w-full"
            @update:model-value="applyFilters()"
          />
        </UFormField>
      </div>

      <UAlert
        v-if="error"
        class="mb-4"
        color="error"
        variant="subtle"
        title="Could not load the trigger chain"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <UCard v-else-if="chain">
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">
            {{ chain.campaign_name }}
          </h2>
        </template>
        <p class="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Preview from {{ anchorDay }} — weekday pills shift with the anchor and the Lagos
          quiet-hours rule. Not a scheduled run.
        </p>
        <WorkflowTriggerChain :chain="chain" />
      </UCard>
    </PermissionGate>
  </div>
</template>
