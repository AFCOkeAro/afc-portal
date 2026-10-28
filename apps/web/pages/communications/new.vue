<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * New Communication — configure step (AFC-869, Rock-solid reference).
 *
 * Step 1 of the configure → template → schedule flow: name / list / topic,
 * medium (Email / SMS / Personal Preference) with consent-gated Reachable
 * Audience badges, Personal-vs-Bulk classification, and Schedule Now/Later.
 * Read-only preview: this page writes nothing and sends nothing — the
 * "Next: Choose Template" step is visibly future until its own slice lands.
 *
 * Guards (unchanged, surfaced not recomputed): audience counts come from
 * GET /api/communications/reachable (opt-out/suppression/validity/minor
 * rule + grant, counts only); caps from GET /api/invites/quota and the
 * kill switch from GET /api/hardening/status. Quiet-hours shifting still
 * happens at send time in the tick.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

const canCompose = computed(() => permissions.can(COLLECTIONS.communications, 'create'))

const name = ref('')
const list = ref('manual')
const topic = ref('general')

const listOptions = [
  { label: 'Manual Recipient List', value: 'manual' },
  { label: 'All members in my scope', value: 'all_members' },
  { label: 'My branch members', value: 'branch_members' },
]

const topicOptions = [
  { label: 'General', value: 'general' },
  { label: 'Service updates', value: 'service_updates' },
  { label: 'Events', value: 'events' },
  { label: 'Pastoral care', value: 'pastoral_care' },
  { label: 'Welfare', value: 'welfare' },
  { label: 'Youth', value: 'youth' },
]

type Medium = 'email' | 'sms' | 'personal'
const medium = ref<Medium>('email')

type Classification = 'personal' | 'bulk'
const classification = ref<Classification>('personal')

const scheduleMode = ref<'now' | 'later'>('now')
const scheduledAt = ref('')

interface ReachablePreview {
  channel: string
  classification: string
  branch: string | null
  total_in_scope: number
  sms: { reachable: number; excluded_reasons: Record<string, number> }
  email: { reachable: number; excluded_reasons: Record<string, number> }
  personal_preference: { reachable: number; via_sms: number; via_email: number }
  suppressions_verified: boolean
  gates_note: string
}

const previewQuery = computed(() => ({ classification: classification.value }))

const { data: preview, pending: previewPending } = await useAsyncData(
  'communication-reachable',
  () =>
    api.get<{ data: ReachablePreview }>('/api/communications/reachable', {
      query: previewQuery.value,
    }),
  { watch: [previewQuery] },
)

const { data: quota } = await useAsyncData('communication-quota', () =>
  api
    .get<{
      data: {
        daily_limit: number
        weekly_limit: number
        remaining_day: number
        remaining_week: number
      }
    }>('/api/invites/quota')
    .catch(() => null),
)

const { data: hardening } = await useAsyncData('communication-hardening', () =>
  api
    .get<{ data?: { paused?: boolean; reason?: string | null } }>(
      '/api/hardening/status',
    )
    .catch(() => null),
)

const killSwitchHeld = computed(() => hardening.value?.data?.paused === true)

function badgeFor(kind: Medium): string {
  if (previewPending.value || !preview.value) return '…'
  const data = preview.value.data
  if (kind === 'email') return String(data.email.reachable)
  if (kind === 'sms') return String(data.sms.reachable)
  return String(data.personal_preference.reachable)
}

function excludedSummary(kind: 'email' | 'sms'): string {
  const reasons = preview.value?.data[kind].excluded_reasons ?? {}
  const entries = Object.entries(reasons)
  if (entries.length === 0) return 'Everyone in scope is reachable.'
  return entries.map(([reason, count]) => `${count} ${reason.replaceAll('_', ' ')}`).join(' · ')
}

const nameError = computed(() =>
  name.value.trim() === '' ? 'Give the communication a name.' : '',
)

const laterError = computed(() => {
  if (scheduleMode.value !== 'later') return ''
  if (!scheduledAt.value) return 'Pick a date and time for Later.'
  const at = new Date(scheduledAt.value)
  if (Number.isNaN(at.getTime())) return 'That date and time is not valid.'
  if (at.getTime() <= Date.now()) return 'Later must be in the future.'
  return ''
})
</script>

<template>
  <div>
    <PageHeader
      title="New Communication"
      description="Step 1 · Configure — recipients, medium, classification and schedule. Template selection follows in the next step."
    />

    <PermissionGate :collection="COLLECTIONS.communications" action="create">
      <UAlert
        v-if="killSwitchHeld"
        class="mb-4"
        color="warning"
        variant="subtle"
        title="Messaging is paused by the kill switch"
        :description="`Nothing can be sent until the pause is lifted${hardening?.data?.reason ? `: ${hardening.data.reason}` : ''}. You can still configure the draft below.`"
      />

      <div class="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>Caps:</span>
        <span v-if="quota">
          {{ quota.data.remaining_day }} of {{ quota.data.daily_limit }} daily sends
          left, {{ quota.data.remaining_week }} of
          {{ quota.data.weekly_limit }} weekly.
        </span>
        <span v-else>cap read unavailable — the send-time check still applies.</span>
        <span>
          Quiet hours 20:00–07:00 Lagos shift sends to 08:00 unless the campaign
          is operational-essential.
        </span>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-base font-semibold" tabindex="-1">
              Configure Communication
            </h2>
            <UBadge color="primary" variant="subtle">
              {{ preview?.data.total_in_scope ?? '…' }} in scope
            </UBadge>
          </div>
        </template>

        <div class="space-y-6">
          <section aria-label="Recipients">
            <h3 class="text-sm font-semibold">Recipients</h3>
            <div class="mt-2 grid gap-3 sm:grid-cols-2">
              <UFormField label="Communication Name" required :error="nameError || undefined">
                <UInput v-model="name" placeholder="e.g. Easter service invitation" class="w-full" />
              </UFormField>
              <UFormField label="Topic">
                <USelect v-model="topic" :items="topicOptions" class="w-full" />
              </UFormField>
            </div>
            <div class="mt-3 grid gap-3 sm:grid-cols-2">
              <UFormField label="Communication List" required>
                <USelect v-model="list" :items="listOptions" class="w-full" />
              </UFormField>
              <div class="flex items-end">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-eye"
                  label="View List"
                  to="/people"
                  target="_blank"
                />
              </div>
            </div>
          </section>

          <section aria-label="Medium">
            <h3 class="text-sm font-semibold">Medium</h3>
            <div class="mt-2 grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Medium">
              <button
                type="button"
                role="radio"
                :aria-checked="medium === 'email'"
                class="rounded-xl border p-4 text-center transition"
                :class="medium === 'email' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 dark:border-gray-800'"
                @click="medium = 'email'"
              >
                <UIcon name="i-lucide-mail" class="mx-auto size-6" />
                <p class="mt-1 font-semibold">Email</p>
                <p class="mt-1 text-xs text-gray-500">Send an email to everyone in your targeted segment.</p>
                <p class="mt-2">
                  <UBadge color="primary" variant="subtle">Reachable Audience: {{ badgeFor('email') }}</UBadge>
                </p>
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="medium === 'sms'"
                class="rounded-xl border p-4 text-center transition"
                :class="medium === 'sms' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 dark:border-gray-800'"
                @click="medium = 'sms'"
              >
                <UIcon name="i-lucide-message-square-text" class="mx-auto size-6" />
                <p class="mt-1 font-semibold">SMS</p>
                <p class="mt-1 text-xs text-gray-500">Send a text message to your targeted segment.</p>
                <p class="mt-2">
                  <UBadge color="primary" variant="subtle">Reachable Audience: {{ badgeFor('sms') }}</UBadge>
                </p>
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="medium === 'personal'"
                class="rounded-xl border p-4 text-center transition"
                :class="medium === 'personal' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 dark:border-gray-800'"
                @click="medium = 'personal'"
              >
                <UIcon name="i-lucide-user" class="mx-auto size-6" />
                <p class="mt-1 font-semibold">Personal Preference</p>
                <p class="mt-1 text-xs text-gray-500">Notify each person via their best consented channel.</p>
                <p class="mt-2">
                  <UBadge color="primary" variant="subtle">Reachable Audience: {{ badgeFor('personal') }}</UBadge>
                </p>
              </button>
            </div>
            <p class="mt-2 text-xs text-gray-500">
              <span v-if="medium === 'personal' && preview">
                {{ preview.data.personal_preference.via_sms }} via SMS,
                {{ preview.data.personal_preference.via_email }} via email.
              </span>
              <span v-else-if="medium !== 'personal'">{{ excludedSummary(medium) }}</span>
              Counts exclude opt-outs, invalid contacts and minors without guardian
              consent{{ classification === 'bulk' ? ', plus everyone without an explicit opt-in' : '' }}.
              <span v-if="preview && !preview.data.suppressions_verified">
                Suppression registry unread — counts unverified, the send-time check still applies.
              </span>
            </p>
          </section>

          <section aria-label="Message Classification">
            <h3 class="text-sm font-semibold">Message Classification</h3>
            <div class="mt-2 grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Message Classification">
              <button
                type="button"
                role="radio"
                :aria-checked="classification === 'personal'"
                class="rounded-xl border p-4 text-left transition"
                :class="classification === 'personal' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 dark:border-gray-800'"
                @click="classification = 'personal'"
              >
                <p class="font-semibold">Personal / Need-to-Know</p>
                <p class="mt-1 text-xs text-gray-500">
                  Direct messages an individual expects or considers important or
                  timely. Reachable without a marketing opt-in; opt-outs and
                  suppressions still excluded.
                </p>
              </button>
              <button
                type="button"
                role="radio"
                :aria-checked="classification === 'bulk'"
                class="rounded-xl border p-4 text-left transition"
                :class="classification === 'bulk' ? 'border-orange-500 ring-1 ring-orange-500' : 'border-gray-200 dark:border-gray-800'"
                @click="classification = 'bulk'"
              >
                <p class="font-semibold">Bulk / Marketing</p>
                <p class="mt-1 text-xs text-gray-500">
                  Marketing messages sent to large groups; regulated by law, and
                  misuse can cause fines and reputational harm. Requires an
                  explicit opt-in per recipient.
                </p>
              </button>
            </div>
          </section>

          <section aria-label="Schedule">
            <h3 class="text-sm font-semibold">Schedule</h3>
            <UFormField label="When to Send" required class="mt-2">
              <div class="flex items-center gap-4">
                <label class="flex items-center gap-1 text-sm">
                  <input v-model="scheduleMode" type="radio" value="now" /> Now
                </label>
                <label class="flex items-center gap-1 text-sm">
                  <input v-model="scheduleMode" type="radio" value="later" /> Later
                </label>
              </div>
            </UFormField>
            <UFormField
              v-if="scheduleMode === 'later'"
              label="Send at"
              :error="laterError || undefined"
              help="Inside 20:00–07:00 Lagos the send shifts to 08:00 unless operational-essential."
            >
              <UInput v-model="scheduledAt" type="datetime-local" class="w-full sm:max-w-xs" />
            </UFormField>
          </section>
        </div>

        <template #footer>
          <div class="flex items-center justify-between gap-2">
            <p class="text-xs text-gray-500">
              {{ preview?.data.gates_note ?? '' }}
            </p>
            <UButton
              color="primary"
              label="Next: Choose Template"
              icon="i-lucide-arrow-right"
              disabled
              title="Template selection lands in the next slice — configure only in this step."
            />
          </div>
        </template>
      </UCard>

      <UAlert
        v-if="!canCompose"
        class="mt-4"
        color="warning"
        variant="subtle"
        title="No access"
        description="Your role cannot compose communications."
      />
    </PermissionGate>
  </div>
</template>
