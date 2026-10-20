<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Campaign catalogue (AFC-527, wireframes v3 screen 11, US-C1 + US-C5).
 *
 * Lists the seeded campaign families with type, consent policy, status and
 * last-run result. The kill switch is the existing single-action
 * POST /api/hardening/pause-all (area admin only): pausing takes effect
 * within one scheduler tick, holds queued rows (never deletes), and is
 * audited with actor/reason/scope. No new send or pause endpoint is added
 * in this slice — reads only.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

interface LastRun {
  id: string
  status: string
  window_start: string | null
  sent_count: number
  delivered_count: number
  failed_count: number
}

interface CampaignRow {
  id: string
  key: string
  name: string
  purpose: string
  campaign_type: string
  consent_policy: string
  status: string
  branch: string | null
  step_count: number
  last_run: LastRun | null
}

const statusFilter = ref('all')

const { data, pending, error, refresh } = await useAsyncData(
  'campaigns-catalogue',
  () => api.get<{ data: CampaignRow[] }>('/api/campaigns', {
    query: statusFilter.value === 'all' ? {} : { status: statusFilter.value },
  }),
  { watch: [statusFilter] },
)

const rows = computed(() => data.value?.data ?? [])

const canPauseAll = computed(
  () => permissions.can(COLLECTIONS.communications, 'create'),
)
const pausing = ref(false)
const pauseError = ref('')
const pauseDone = ref('')
const pauseReason = ref('suspected wrong template — pause-all from the campaign catalogue (AFC-527)')

const statusOptions = [
  { label: 'Any status', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Archived', value: 'archived' },
]

function statusColor(status: string): 'success' | 'warning' | 'neutral' | 'error' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'archived') return 'neutral'
  return 'neutral'
}

async function pauseAll(): Promise<void> {
  pausing.value = true
  pauseError.value = ''
  pauseDone.value = ''
  try {
    const result = await api.post<{ paused: number, pause_drill_check_id: string | null }>(
      '/api/hardening/pause-all',
      { reason: pauseReason.value },
    )
    pauseDone.value = `Paused ${result.paused} campaign(s) within one tick; rows held, drill check ${result.pause_drill_check_id ?? 'unlogged'}.`
    await refresh()
  } catch (cause) {
    pauseError.value = cause instanceof Error ? cause.message : 'Pause-all failed'
  } finally {
    pausing.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Campaigns"
      description="The seeded welfare-automation families. Pause-all stops every active campaign within one tick."
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

    <PermissionGate :collection="COLLECTIONS.communications" action="create">
      <UCard v-if="canPauseAll" class="mb-4 border-red-200 dark:border-red-900">
        <template #header>
          <h2 class="text-base font-semibold" tabindex="-1">Kill switch — pause all automation</h2>
        </template>
        <p class="text-sm text-gray-600 dark:text-gray-300">
          Pauses every active campaign and logs the drill with actor, reason and scope.
          Messages already queued are held, not deleted. Visible on every campaign screen.
        </p>
        <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <UInput v-model="pauseReason" aria-label="Pause reason" class="w-full" />
          <UButton
            color="error"
            icon="i-lucide-octagon-pause"
            label="Pause all now"
            :loading="pausing"
            @click="pauseAll()"
          />
        </div>
        <UAlert
          v-if="pauseError"
          class="mt-3"
          color="error"
          variant="subtle"
          title="Pause-all failed"
          :description="pauseError"
        />
        <UAlert
          v-if="pauseDone"
          class="mt-3"
          color="success"
          variant="subtle"
          title="Paused"
          :description="pauseDone"
        />
      </UCard>
    </PermissionGate>

    <UAlert
      v-if="error"
      class="mb-4"
      color="error"
      variant="subtle"
      title="Could not load campaigns"
      :description="error.message"
    />

    <div class="mb-4 flex max-w-xs items-center gap-2">
      <UFormField label="Status" class="w-full">
        <USelect v-model="statusFilter" :items="statusOptions" class="w-full" />
      </UFormField>
    </div>

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UCard v-else>
      <template #header>
        <h2 class="text-base font-semibold" tabindex="-1">
          Catalogue ({{ rows.length }})
        </h2>
      </template>
      <p v-if="rows.length === 0" class="text-sm text-gray-600 dark:text-gray-300">
        No campaigns are seeded here yet. The nine expected family keys are:
        whatsapp_sms_fallback, newcomer_weekly_checkin, birthday_anniversary_greeting,
        new_visitor_welcome_drip, new_convert_drip, weekly_memory_verse, service_reminder,
        meeting_reminder, event_invitation.
      </p>
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">Campaign</th>
              <th class="px-3 py-2 font-medium">Type</th>
              <th class="px-3 py-2 font-medium">Consent</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Steps</th>
              <th class="px-3 py-2 font-medium">Last run</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="row in rows" :key="row.id">
              <td class="px-3 py-2">
                <NuxtLink :to="`/campaigns/${row.id}`" class="font-medium text-teal-700 underline dark:text-teal-300">
                  {{ row.name }}
                </NuxtLink>
                <p class="text-xs text-gray-500">{{ row.key }}</p>
              </td>
              <td class="px-3 py-2">{{ row.campaign_type }}</td>
              <td class="px-3 py-2">{{ row.consent_policy.replaceAll('_', ' ') }}</td>
              <td class="px-3 py-2">
                <UBadge :color="statusColor(row.status)" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td class="px-3 py-2 tabular-nums">{{ row.step_count }}</td>
              <td class="px-3 py-2 text-gray-600 dark:text-gray-300">
                <span v-if="row.last_run">
                  {{ row.last_run.status }} · sent {{ row.last_run.sent_count }} ·
                  failed {{ row.last_run.failed_count }}
                </span>
                <span v-else>—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
