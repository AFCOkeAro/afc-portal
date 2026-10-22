<script setup lang="ts">
/**
 * Participant comms from the registration selection (AFC-649 §E).
 *
 * Existing paths only, no new provider and no new send endpoint:
 * every message goes through POST /api/invites/preview + POST /api/invites,
 * which enforces the consent gates server-side (STOP numbers land as
 * `blocked_optout`, quota overruns as `blocked_rate_limit` held for
 * branch-admin approval). Acceptance gates on this page:
 * explicit opt-in per channel (WhatsApp / SMS checkboxes, at least one),
 * quiet-hours note from the campaigns catalogue, caps from
 * GET /api/invites/quota, kill-switch from GET /api/hardening/status
 * (sends blocked while paused). Per-row result report; nothing is
 * fire-and-forget.
 *
 * Safeguarding: the registrant's own `age_group` sets the invite age band
 * (never defaulted to adult); child/teen/unknown rows need the
 * registration's guardian number plus staff attestation, otherwise they
 * are reported as skipped, never sent.
 */
import type { RegistrationRow } from '~/types/portal'

const props = defineProps<{
  open: boolean
  eventId: string
  eventTitle: string
  registrations: RegistrationRow[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: []
}>()

const api = useApi()

const optWhatsapp = ref(false)
const optSms = ref(false)
const note = ref('')
const guardianAttested = ref(false)
const phase = ref<'gates' | 'preview' | 'report'>('gates')
const working = ref(false)
const formError = ref('')

interface RowResult {
  id: string
  name: string
  phone: string
  state: 'preview-ok' | 'skipped' | 'sent' | 'held' | 'blocked' | 'error'
  detail: string
}

const results = ref<RowResult[]>([])

/** At least one row survived preview (script-side so the template stays typeless). */
const hasPreviewable = computed(() =>
  results.value.some((entry: RowResult) => entry.state === 'preview-ok'),
)

const { data: quota } = await useAsyncData(`event-comms-quota-${props.eventId}`, () =>
  api
    .get<{
      data: {
        daily_limit: number
        weekly_limit: number
        sent_day: number
        sent_week: number
        remaining_day: number
        remaining_week: number
      }
    }>('/api/invites/quota')
    .catch(() => null),
)

const { data: hardening } = await useAsyncData(
  `event-comms-hardening-${props.eventId}`,
  () =>
    api
      .get<{ data?: { paused?: boolean; reason?: string | null } }>(
        '/api/hardening/status',
      )
      .catch(() => null),
)

const killSwitchHeld = computed(() => hardening.value?.data?.paused === true)
const quotaExhausted = computed(
  () =>
    quota.value !== null &&
    quota.value !== undefined &&
    (quota.value.data.remaining_day ?? 1) <= 0,
)

function ageBandOf(row: RegistrationRow): string {
  const group = String((row as { age_group?: string }).age_group ?? 'unknown')
  return ['adult', 'youth', 'teen', 'child', 'unknown'].includes(group)
    ? group
    : 'unknown'
}

function needsGuardian(row: RegistrationRow): boolean {
  return ageBandOf(row) !== 'adult' && ageBandOf(row) !== 'youth'
}

function close(): void {
  emit('update:open', false)
}

watch(
  () => props.open,
  (open: boolean) => {
    if (!open) return
    phase.value = 'gates'
    formError.value = ''
    results.value = []
    optWhatsapp.value = false
    optSms.value = false
    note.value = ''
    guardianAttested.value = false
  },
  { immediate: true },
)

function channelChoice(): string {
  if (optWhatsapp.value && !optSms.value) return 'whatsapp'
  if (optSms.value && !optWhatsapp.value) return 'sms'
  return 'auto'
}

/** Badge label per result state (script-side so the template stays typeless). */
function resultLabel(state: RowResult['state']): string {
  switch (state) {
    case 'preview-ok':
      return 'Ready'
    case 'skipped':
      return 'Skipped'
    case 'sent':
      return 'Sent'
    case 'held':
      return 'Held for approval'
    case 'blocked':
      return 'Blocked (opt-out)'
    case 'error':
      return 'Failed'
  }
}

function payloadFor(row: RegistrationRow): Record<string, unknown> {
  return {
    event: props.eventId,
    invitee_name: row.person_name ?? '',
    invitee_phone: row.phone ?? '',
    invitee_relationship: 'other',
    invitee_age_band: ageBandOf(row),
    channel_choice: channelChoice(),
    guardian_phone: (row as { guardian_phone?: string }).guardian_phone || undefined,
    guardian_attested: guardianAttested.value,
    inviter_note: note.value.trim() || undefined,
  }
}

async function runPreview(): Promise<void> {
  formError.value = ''
  if (!optWhatsapp.value && !optSms.value) {
    formError.value = 'Opt in to at least one channel — WhatsApp, SMS, or both.'
    return
  }
  if (killSwitchHeld.value) {
    formError.value = 'Messaging is paused by the kill switch — nothing was previewed.'
    return
  }
  if (quotaExhausted.value) {
    formError.value = 'The daily invite cap is exhausted — nothing was previewed.'
    return
  }
  const minors = props.registrations.filter((row) => needsGuardian(row))
  if (minors.length > 0 && !guardianAttested.value) {
    formError.value = `${minors.length} selected ${minors.length === 1 ? 'registrant needs' : 'registrants need'} a guardian number plus attestation — confirm attestation or deselect them.`
    return
  }
  working.value = true
  try {
    const next: RowResult[] = []
    for (const row of props.registrations) {
      const name = row.person_name ?? 'Unnamed'
      const phone = row.phone ?? ''
      if (!phone) {
        next.push({
          id: row.id,
          name,
          phone: '—',
          state: 'skipped',
          detail: 'No phone number on the registration.',
        })
        continue
      }
      if (needsGuardian(row) && !(row as { guardian_phone?: string }).guardian_phone) {
        next.push({
          id: row.id,
          name,
          phone,
          state: 'skipped',
          detail: 'Minor-band registrant without a guardian number — not sent.',
        })
        continue
      }
      try {
        const preview = await api.post<{ data: { rendered: string } }>(
          '/api/invites/preview',
          payloadFor(row),
        )
        next.push({
          id: row.id,
          name,
          phone,
          state: 'preview-ok',
          detail: preview.data.rendered,
        })
      } catch (cause) {
        const err = cause as { message?: string }
        next.push({
          id: row.id,
          name,
          phone,
          state: 'error',
          detail: err.message ?? 'Preview failed.',
        })
      }
    }
    results.value = next
    phase.value = 'preview'
  } finally {
    working.value = false
  }
}

async function confirmSend(): Promise<void> {
  working.value = true
  formError.value = ''
  try {
    const byId = new Map(props.registrations.map((row) => [row.id, row]))
    const next = [...results.value]
    for (const entry of next) {
      if (entry.state !== 'preview-ok') continue
      const row = byId.get(entry.id)
      if (!row) continue
      try {
        const created = await api.post<{
          data: { status: string; blocked_reason: string | null }
        }>('/api/invites', payloadFor(row))
        if (created.data.status === 'blocked_optout') {
          entry.state = 'blocked'
          entry.detail =
            created.data.blocked_reason ?? 'Number opted out (STOP) — never messaged.'
        } else if (created.data.status === 'blocked_rate_limit') {
          entry.state = 'held'
          entry.detail =
            created.data.blocked_reason ??
            'Over the cap — held for branch-admin approval.'
        } else {
          entry.state = 'sent'
          entry.detail = `Queued as ${created.data.status}.`
        }
      } catch (cause) {
        const err = cause as { message?: string }
        entry.state = 'error'
        entry.detail = err.message ?? 'Send failed.'
      }
    }
    results.value = next
    phase.value = 'report'
    emit('sent')
  } finally {
    working.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    title="Message selected participants"
    :description="`Existing invitation path only — ${registrations.length} selected from ${eventTitle}.`"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="formError"
          color="error"
          variant="subtle"
          :description="formError"
        />
        <UAlert
          v-if="killSwitchHeld"
          color="warning"
          variant="subtle"
          title="Kill switch is holding all messaging"
          description="Resolve the pause on the hardening page before sending anything."
        />

        <div v-if="phase === 'gates'">
          <h3 class="text-sm font-semibold">1 · Consent and gates</h3>
          <div class="mt-2 space-y-2">
            <UCheckbox
              v-model="optWhatsapp"
              label="WhatsApp — only participants who opted in to WhatsApp"
            />
            <UCheckbox
              v-model="optSms"
              label="SMS — only participants who opted in to SMS"
            />
          </div>
          <p class="mt-2 text-xs text-gray-500">
            Quiet-hours: messages are held to 08:00 unless an operational-essential
            campaign override applies (see the campaigns catalogue). Caps:
            <span v-if="quota">
              {{ quota.data.remaining_day }} of {{ quota.data.daily_limit }} daily sends
              left, {{ quota.data.remaining_week }} of
              {{ quota.data.weekly_limit }} weekly.
            </span>
            <span v-else>cap read unavailable — the send-time check still applies.</span>
            A number that replied STOP is never messaged again.
          </p>
          <UFormField
            label="Note (optional, 140 characters)"
            class="mt-3"
            help="No links or phone numbers — the message carries the official RSVP link."
          >
            <UTextarea v-model="note" :rows="2" maxlength="140" class="w-full" />
          </UFormField>
          <UCheckbox
            v-model="guardianAttested"
            class="mt-3"
            label="A guardian agreed to messages for every selected child/teen/unknown-age registrant, and staff may verify it"
          />
        </div>

        <div v-if="phase !== 'gates'">
          <h3 class="text-sm font-semibold">
            {{
              phase === 'preview' ? '2 · Preview before confirming' : '3 · Result report'
            }}
          </h3>
          <ul class="mt-2 space-y-2">
            <li
              v-for="entry in results"
              :key="entry.id"
              class="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800"
            >
              <div class="flex items-center justify-between gap-2">
                <p class="font-medium">{{ entry.name }} · {{ entry.phone }}</p>
                <UBadge
                  :color="
                    entry.state === 'sent'
                      ? 'success'
                      : entry.state === 'held' || entry.state === 'preview-ok'
                        ? 'warning'
                        : entry.state === 'skipped'
                          ? 'neutral'
                          : 'error'
                  "
                  variant="subtle"
                >
                  {{ resultLabel(entry.state) }}
                </UBadge>
              </div>
              <p
                class="mt-1 text-xs whitespace-pre-wrap text-gray-600 dark:text-gray-300"
              >
                {{ entry.detail }}
              </p>
            </li>
          </ul>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" label="Close" @click="close" />
        <UButton
          v-if="phase === 'gates'"
          label="Preview messages"
          icon="i-lucide-eye"
          :loading="working"
          :disabled="registrations.length === 0"
          @click="runPreview()"
        />
        <UButton
          v-if="phase === 'preview'"
          label="Confirm and send"
          icon="i-lucide-send"
          color="success"
          :loading="working"
          :disabled="!hasPreviewable"
          @click="confirmSend()"
        />
      </div>
    </template>
  </UModal>
</template>
