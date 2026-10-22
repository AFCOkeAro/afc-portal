<script setup lang="ts">
import type { EventDetail } from '~/types/portal'

/**
 * Member event invitation form (AFC-527, wireframes v3 screen 8, US-E1).
 *
 * Preview-before-confirm: the member sees the exact rendered message from
 * POST /api/invites/preview and confirms that text via POST /api/invites —
 * no blind sends. Guardian number + attestation are required for
 * child/teen/unknown-age invitees (server + DB enforce it too). The daily /
 * weekly limit state (10/day, 50/week) is shown before the limit is hit;
 * over-limit submits return blocked_rate_limit for branch-admin approval.
 *
 * Member surface: no `staff` middleware — the OTP member role lands here once
 * enabled. Staff sessions may also submit (branch_admin holds create).
 * Anchor sections per prd-addendum-v4 §1.4 (nav of anchors, real headings,
 * focus moves to the heading, no focus traps).
 */

const route = useRoute()
const api = useApi()
const id = String(route.params.id)

const {
  data: event,
  pending: eventPending,
  error: eventError,
} = await useAsyncData(`event-invite-${id}`, () =>
  api.get<EventDetail>(`/api/events/${id}`),
)

/**
 * AFC-538 finding 3 (owner: CTO MediaTech): live per-user quota read. The
 * scoped GET /api/invites/quota returns the caller's own limits + rolling
 * counts (advisory; the POST ledger claim stays authoritative). Falls back
 * to the schema defaults (10/day, 50/week) when the read fails.
 */
const { data: quota } = await useAsyncData('event-invite-quota', () =>
  api.get<{
    data: {
      daily_limit: number
      weekly_limit: number
      sent_day: number
      sent_week: number
      remaining_day: number
      remaining_week: number
      counts_verified: boolean
    }
  }>('/api/invites/quota'),
)
const quotaDaily = computed(() => quota.value?.data.daily_limit ?? 10)
const quotaWeekly = computed(() => quota.value?.data.weekly_limit ?? 50)
const quotaSentDay = computed(() => quota.value?.data.sent_day ?? null)
const quotaSentWeek = computed(() => quota.value?.data.sent_week ?? null)
const quotaStale = computed(() =>
  quota.value ? quota.value.data.counts_verified === false : false,
)

const inviteeName = ref('')
const inviteePhone = ref('')
const relationship = ref('friend')
const ageBand = ref('adult')
const channelChoice = ref('auto')
const guardianPhone = ref('')
const guardianAttested = ref(false)
const inviterNote = ref('')

const preview = ref<{
  rendered: string
  channel_choice: string
  eligibility: { eligible: boolean; requires_approval: boolean }
} | null>(null)
const previewing = ref(false)
const submitting = ref(false)
const fieldErrors = ref<Record<string, string>>({})
const formError = ref('')
const created = ref<{ id: string; status: string; blocked_reason: string | null } | null>(
  null,
)

const relationshipOptions = [
  { label: 'Friend', value: 'friend' },
  { label: 'Family', value: 'family' },
  { label: 'Coworker', value: 'coworker' },
  { label: 'Neighbour', value: 'neighbour' },
  { label: 'Invited by guest', value: 'invited_by_guest' },
  { label: 'Other', value: 'other' },
]
const ageBandOptions = [
  { label: 'Adult', value: 'adult' },
  { label: 'Youth', value: 'youth' },
  { label: 'Teen (guardian required)', value: 'teen' },
  { label: 'Child (guardian required)', value: 'child' },
  { label: 'Unknown (guardian required)', value: 'unknown' },
]
const channelOptions = [
  { label: 'Let us choose', value: 'auto' },
  { label: 'WhatsApp', value: 'whatsapp' },
  { label: 'SMS', value: 'sms' },
]

const needsGuardian = computed(
  () =>
    ageBand.value === 'child' || ageBand.value === 'teen' || ageBand.value === 'unknown',
)
const needsAttestation = computed(
  () => ageBand.value === 'child' || ageBand.value === 'teen',
)

const sections = [
  { id: 'invitee', label: 'Invitee' },
  { id: 'channel', label: 'Channel' },
  { id: 'preview', label: 'Preview and confirm' },
  { id: 'limits', label: 'Limits' },
]

function payload() {
  return {
    event: id,
    invitee_name: inviteeName.value,
    invitee_phone: inviteePhone.value,
    invitee_relationship: relationship.value,
    invitee_age_band: ageBand.value,
    channel_choice: channelChoice.value,
    guardian_phone: guardianPhone.value || undefined,
    guardian_attested: guardianAttested.value,
    inviter_note: inviterNote.value || undefined,
  }
}

function applyError(cause: unknown): void {
  const err = cause as { fields?: Record<string, string>; message?: string }
  fieldErrors.value = err.fields ?? {}
  formError.value = err.message ?? 'Could not submit the invitation'
}

async function renderPreview(): Promise<void> {
  previewing.value = true
  formError.value = ''
  fieldErrors.value = {}
  try {
    const result = await api.post<{ data: typeof preview.value }>(
      '/api/invites/preview',
      payload(),
    )
    preview.value = result.data
    document
      .getElementById('preview')
      ?.querySelector('h2')
      ?.focus({ preventScroll: false })
  } catch (cause) {
    preview.value = null
    applyError(cause)
  } finally {
    previewing.value = false
  }
}

async function confirmInvite(): Promise<void> {
  submitting.value = true
  formError.value = ''
  try {
    const result = await api.post<{
      data: { id: string; status: string; blocked_reason: string | null }
    }>('/api/invites', payload())
    created.value = {
      id: String(result.data.id),
      status: String(result.data.status),
      blocked_reason: (result.data.blocked_reason as string | null) ?? null,
    }
    preview.value = null
  } catch (cause) {
    applyError(cause)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Invite someone to this event"
      description="One message only — the invitee must register or opt in before any further messages (US-E1)."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Back to event"
          :to="`/events/${id}`"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="eventError"
      class="mb-4"
      color="error"
      variant="subtle"
      title="Could not load the event"
      :description="eventError.message"
    />

    <div v-if="eventPending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="event">
      <p class="mb-4 text-sm text-gray-600 dark:text-gray-300">
        Inviting to <strong>{{ event.title }}</strong>
        <span v-if="event.start_at"> · {{ event.start_at }}</span>
        <span v-if="event.location"> · {{ event.location }}</span>
      </p>

      <!-- Visitor invitation + management (AFC-649 §F): scoped by the
        visitor/invite list routes' own area/zone/branch filters. -->
      <UCard class="mb-8">
        <div class="flex flex-wrap items-center gap-2">
          <p class="mr-auto text-sm text-gray-600 dark:text-gray-300">
            Invitations and visitor follow-ups for this event live in the scoped lists.
          </p>
          <UButton
            size="sm"
            color="neutral"
            variant="outline"
            icon="i-lucide-users"
            label="Manage visitors"
            :to="`/visitors?event=${id}`"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-send"
            label="Sent invitations"
            :to="`/invites?event=${id}`"
          />
          <UButton
            size="sm"
            color="neutral"
            variant="ghost"
            icon="i-lucide-chart-column"
            label="Event reports"
            :to="`/events/${id}?tab=reports`"
          />
        </div>
      </UCard>

      <UAlert
        v-if="created"
        class="mb-4"
        :color="created.status === 'blocked_optout' ? 'error' : 'success'"
        variant="subtle"
        :title="`Invitation ${created.status.replaceAll('_', ' ')}`"
        :description="
          created.blocked_reason ??
          'The single invitation message is queued. Track it under My invitations.'
        "
      />

      <SectionNav :sections="sections" />

      <section id="invitee" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Invitee</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Invitee details</h2>
          </template>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Invitee name" :error="fieldErrors.invitee_name" required>
              <UInput v-model="inviteeName" autocomplete="off" class="w-full" />
            </UFormField>
            <UFormField label="Invitee phone" :error="fieldErrors.invitee_phone" required>
              <UInput
                v-model="inviteePhone"
                inputmode="tel"
                autocomplete="off"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Relationship">
              <USelect
                v-model="relationship"
                :items="relationshipOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Age band" :error="fieldErrors.invitee_age_band" required>
              <USelect v-model="ageBand" :items="ageBandOptions" class="w-full" />
            </UFormField>
          </div>
          <div v-if="needsGuardian" class="mt-4 grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Guardian phone number"
              :error="fieldErrors.guardian_phone"
              help="Invitees under 18 are messaged via their guardian, never directly."
              required
            >
              <UInput
                v-model="guardianPhone"
                inputmode="tel"
                autocomplete="off"
                class="w-full"
              />
            </UFormField>
            <UFormField
              v-if="needsAttestation"
              label="Guardian consent"
              :error="fieldErrors.guardian_attested"
            >
              <UCheckbox
                v-model="guardianAttested"
                label="A guardian agreed to this invitation and staff may verify it"
              />
            </UFormField>
          </div>
          <UFormField
            label="Personal note (optional, 140 characters)"
            :error="fieldErrors.inviter_note"
            class="mt-4"
            help="No links or phone numbers — the invitation carries the official RSVP link."
          >
            <UTextarea v-model="inviterNote" :rows="2" maxlength="140" class="w-full" />
          </UFormField>
        </UCard>
      </section>

      <section id="channel" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Channel</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Channel choice</h2>
          </template>
          <UFormField label="Preferred channel" :error="fieldErrors.channel_choice">
            <USelect v-model="channelChoice" :items="channelOptions" class="w-full" />
          </UFormField>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
            WhatsApp needs an approved template; SMS is always available with consent.
            “Let us choose” picks the consented channel for you.
          </p>
        </UCard>
      </section>

      <section id="preview" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Preview and confirm</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">
              Rendered preview before confirming
            </h2>
          </template>
          <UAlert
            v-if="formError"
            class="mb-3"
            color="error"
            variant="subtle"
            title="Check the form"
            :description="formError"
          />
          <div class="flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-eye"
              label="Show rendered message"
              :loading="previewing"
              @click="renderPreview()"
            />
            <UButton
              color="success"
              icon="i-lucide-send"
              label="Confirm and send invitation"
              :disabled="preview === null"
              :loading="submitting"
              @click="confirmInvite()"
            />
          </div>
          <div
            v-if="preview"
            class="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm whitespace-pre-wrap dark:border-gray-800 dark:bg-gray-900"
            aria-live="polite"
          >
            {{ preview.rendered }}
          </div>
          <p
            v-if="preview?.eligibility.requires_approval"
            class="mt-2 text-sm text-amber-600"
          >
            This event needs staff approval for invitations — your invite will wait as
            pending approval.
          </p>
        </UCard>
      </section>

      <section id="limits" class="mt-8 scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Limits</h2>
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Daily and weekly limits</h2>
          </template>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            <span v-if="quotaSentDay !== null && quotaSentWeek !== null">
              You have sent <strong class="tabular-nums">{{ quotaSentDay }}</strong> in
              the last 24h (limit <strong class="tabular-nums">{{ quotaDaily }}</strong
              >) and <strong class="tabular-nums">{{ quotaSentWeek }}</strong> in the last
              7 days (limit <strong class="tabular-nums">{{ quotaWeekly }}</strong
              >).
              <span v-if="quotaStale"
                >Counts could not be verified just now — the send-time check still
                applies.</span
              >
            </span>
            <span v-else>
              Each member may send
              <strong
                >{{ quotaDaily }} invitations per day and {{ quotaWeekly }} per
                week</strong
              >.
            </span>
            Above the limit the invitation is held for your branch admin to approve —
            nothing is sent silently. A number that replied STOP is never messaged again.
          </p>
        </UCard>
      </section>
    </div>
  </div>
</template>
