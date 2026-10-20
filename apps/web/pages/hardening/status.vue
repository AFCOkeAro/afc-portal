<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

interface HardeningCheck {
  key: string
  ok: boolean | null
  detail: string | null
  recorded_at: string | null
}

interface HardeningStatus {
  checks: HardeningCheck[]
  queue_depth: number | null
  tick_slo_ratio: number | null
  rates: Array<{ channel: string; unit_cost: number | null; currency: string }> | null
  can_publish_rates: boolean
  pending_migration_0015: boolean
}

const { data, pending, error, refresh } = await useAsyncData('hardening-status', () =>
  api.get<HardeningStatus>('/api/hardening/status'),
)

const canPause = computed(() => permissions.can(COLLECTIONS.communications, 'create'))
const canPauseAll = computed(
  () => data.value?.can_publish_rates === true && canPause.value,
)
const pausing = ref(false)
const pauseError = ref<string | null>(null)
const pauseResult = ref<{
  paused: number
  paused_ids: string[]
  channels_disabled: string[]
  pause_drill_check_id: string | null
  announcement: { title: string; body: string }
} | null>(null)
const reason = ref('suspected wrong template — pause-all single action (AFC-525)')
const disableChannels = ref(false)

async function pauseAll(): Promise<void> {
  pausing.value = true
  pauseError.value = null
  pauseResult.value = null
  try {
    pauseResult.value = await api.post('/api/hardening/pause-all', {
      body: { reason: reason.value, disable_channels: disableChannels.value },
    })
    await refresh()
  } catch (err) {
    pauseError.value = err instanceof Error ? err.message : 'Pause-all failed'
  } finally {
    pausing.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Hardening status"
      description="Queue depth, tick SLO, monitor checks and the single-action pause-all kill switch (rows held, never deleted)."
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

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load hardening status"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data" class="grid gap-4">
      <UAlert
        v-if="data.pending_migration_0015"
        color="warning"
        variant="subtle"
        title="Monitor store pending"
        description="Migration 0015 has not applied here yet; checks report null instead of failing."
      />

      <div class="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Queue depth"
          :value="data.queue_depth === null ? 'unknown' : String(data.queue_depth)"
          hint="Due-but-unprocessed enrollments"
        />
        <StatCard
          label="Tick SLO share"
          :value="
            data.tick_slo_ratio === null
              ? 'unknown'
              : `${Math.round(data.tick_slo_ratio * 100)}%`
          "
          hint="Due steps beginning within 5 min"
        />
        <StatCard
          label="Checks reporting"
          :value="`${data.checks.filter((c: HardeningCheck) => c.ok !== null).length}/${data.checks.length}`"
          hint="Latest outcome per check key"
        />
      </div>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Monitor checks</h2>
        </template>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Check</th>
                <th class="px-3 py-2 font-medium">Outcome</th>
                <th class="px-3 py-2 font-medium">Detail</th>
                <th class="px-3 py-2 font-medium">Recorded</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="check in data.checks" :key="check.key">
                <td class="px-3 py-2 font-medium">{{ check.key }}</td>
                <td class="px-3 py-2">
                  <UBadge
                    :color="
                      check.ok === null ? 'neutral' : check.ok ? 'success' : 'error'
                    "
                    variant="subtle"
                  >
                    {{ check.ok === null ? 'pending' : check.ok ? 'ok' : 'red' }}
                  </UBadge>
                </td>
                <td class="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {{ check.detail ?? '—' }}
                </td>
                <td class="px-3 py-2 text-gray-600 dark:text-gray-300">
                  {{ check.recorded_at ?? '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <PermissionGate :collection="COLLECTIONS.communications" action="create">
        <UCard v-if="canPauseAll">
          <template #header>
            <h2 class="font-semibold">Pause-all (single action)</h2>
          </template>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            Pauses every active campaign and, when asked, disables the channel. Held rows
            are kept and resume from <code>next_step_at</code> — nothing is deleted. Logs
            <code>pause_drill</code> and returns the staff-channel announcement.
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <UInput v-model="reason" aria-label="Pause reason" class="w-full" />
            <UFormField label="Also disable channel">
              <USwitch v-model="disableChannels" />
            </UFormField>
          </div>
          <UButton
            class="mt-3"
            color="error"
            icon="i-lucide-octagon-pause"
            label="Pause all now"
            :loading="pausing"
            @click="pauseAll()"
          />
          <UAlert
            v-if="pauseError"
            class="mt-3"
            color="error"
            variant="subtle"
            title="Pause-all failed"
            :description="pauseError"
          />
          <UAlert
            v-if="pauseResult"
            class="mt-3"
            color="success"
            variant="subtle"
            :title="`Paused ${pauseResult.paused} campaign(s)`"
            :description="`${pauseResult.announcement.title}: ${pauseResult.announcement.body} · check ${pauseResult.pause_drill_check_id}`"
          />
        </UCard>
      </PermissionGate>
    </div>
  </div>
</template>
