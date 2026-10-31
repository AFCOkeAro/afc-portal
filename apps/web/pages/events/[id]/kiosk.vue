<script setup lang="ts">
/**
 * Public kiosk self-check-in (AFC-985 Phase 1).
 *
 * Locked-down surface per wireframe S3 (docs/wireframes/...-kiosk.html):
 * find by ticket code OR by name, confirm, check in. Two deliberate
 * deviations from the older AFC-307 wireframe, both ordered by the Phase 1
 * scope (approved plan rev 5) and stated here rather than picked silently:
 *
 *  1. Name search EXISTS here though S3 forbade it (attendee-enumeration
 *     worry, D-K5). Mitigations, all enforced server-side by
 *     resolveCheckIn + the check-in route: a name must narrow to exactly one
 *     live row or the server answers 409 with a COUNT (never a roster); this
 *     page renders that count and nothing else. No roster is ever listed.
 *  2. Offline-first outbox EXISTS here though S3 deferred it. Offline taps
 *     store intents (ticket/name + timestamp + client key) in this tablet's
 *     localStorage — no roster cached, nothing enumerable — and replay posts
 *     them through the same route with mode=kiosk, so the child/consent gate
 *     runs on replay too.
 *
 * Auth note: this route is public (no staff login on the device), but the
 * POST keeps the existing update-grant gate — no new public write path is
 * invented here. A tablet without the grant gets the amber device-refused
 * state (Kiosk 8 analog) directing to the usherer's desk. Widening that
 * boundary is a CTO decision, not a kiosk default.
 *
 * Safeguarding: under-13 / missing-guardian-consent rows never self-check-in
 * (rose exception-desk states, Kiosk 5/6). Already-attended is an idempotent
 * notice (Kiosk 4), never an error. Cancelled rows show the exception-desk
 * message (Kiosk 7 analog).
 */
import {
  extractCheckInCode,
  extractCheckInCount,
  extractCheckInName,
  isTerminalKioskCode,
  useKioskOutbox,
} from '~/composables/useKioskOutbox'

definePageMeta({ layout: 'public' })

type Stage = 'idle' | 'confirm' | 'sending' | 'done'
type Tab = 'ticket' | 'name'

interface DoneResult {
  kind: 'success' | 'already' | 'refusal' | 'queued'
  name: string
  ticketCode: string
  at: string
  /** Terminal server code for refusals (checkin_child, …). */
  code?: string
  /** Match count for ambiguous names — rendered, never a roster. */
  count?: number
}

const route = useRoute()
const id = String(route.params.id ?? '')
const outbox = useKioskOutbox(id)

const tab = ref<Tab>('ticket')
const ticketInput = ref('')
const nameInput = ref('')
const stage = ref<Stage>('idle')
const result = ref<DoneResult | null>(null)
const deviceRefused = ref(false)
const syncMessage = ref('')
const eventTitle = ref('Church event')
let clearTimer: ReturnType<typeof setTimeout> | null = null

const queuedCount = computed(() => outbox.queuedCount.value)
const online = computed(() => outbox.online.value)

const AGE_LABELS: Record<string, string> = {
  adult: 'Adult',
  youth: 'Youth (18+)',
  teen: 'Teen (13–17)',
  child: 'Child (under 13)',
  unknown: '',
}

function displayNameOf(row: Record<string, unknown>): string {
  const name =
    `${String(row.registrant_first_name ?? '').trim()} ${String(row.registrant_last_name ?? '').trim()}`.trim()
  if (name) return name
  const code = String(row.ticket_code ?? '').trim()
  return code || 'Guest'
}

function loadEventTitle(): void {
  $fetch<{ data: { title?: string } }>(`/api/public/events/${id}`)
    .then((feed) => {
      if (feed.data.title) eventTitle.value = feed.data.title
    })
    .catch(() => {
      /* Offline or unpublished: the badge falls back to 'Church event'. */
    })
}

function startOver(): void {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  stage.value = 'idle'
  result.value = null
  ticketInput.value = ''
  nameInput.value = ''
}

function scheduleAutoClear(): void {
  if (clearTimer) clearTimeout(clearTimer)
  // The success screen clears itself so the next attendee cannot see the
  // previous name (S3 K3). The button below does the same immediately.
  clearTimer = setTimeout(startOver, 12000)
}

/** The one-row query the confirm screen sends — exactly one of the two. */
function currentQuery(): { ticket_code?: string; name?: string } | null {
  const ticket = ticketInput.value.trim()
  const name = nameInput.value.trim()
  if (tab.value === 'ticket' && ticket) return { ticket_code: ticket }
  if (tab.value === 'name' && name) return { name }
  return null
}

function goConfirm(): void {
  if (!currentQuery()) return
  deviceRefused.value = false
  result.value = null
  stage.value = 'confirm'
}

/**
 * Refusal copy: rose panel, glyph + label (never colour alone), and the next
 * human step. Names appear only where the wireframe shows them (consent
 * block names the row; child/void states do not).
 */
function refusalFor(code: string, serverName: string): DoneResult {
  const at = new Date().toLocaleTimeString()
  if (code === 'checkin_needs_guardian') {
    return {
      kind: 'refusal',
      code,
      name: serverName || 'Guest',
      ticketCode: ticketInput.value.trim(),
      at,
    }
  }
  return { kind: 'refusal', code, name: '', ticketCode: '', at }
}

async function postCheckIn(query: {
  ticket_code?: string
  name?: string
}): Promise<{ data: Record<string, unknown>; already: boolean }> {
  // $fetch, not the shared useApi wrapper: the kiosk must branch on the
  // server's terminal code (checkin_child, …), which lives nested at
  // error.data.data.code — the wrapper normalises that away. Same route,
  // same cookies, same gate; only the error shape is richer.
  const response = await $fetch<{
    data: Record<string, unknown>
    meta: { already: boolean }
  }>(`/api/events/${id}/check-in`, {
    method: 'POST',
    body: { ...query, mode: 'kiosk' },
  })
  return { data: response.data, already: response.meta.already }
}

/** HTTP status out of a $fetch failure (0 when there was no response). */
function failureStatus(cause: unknown): number {
  if (!cause || typeof cause !== 'object') return 0
  const holder = cause as {
    statusCode?: unknown
    status?: unknown
    response?: { status?: unknown }
  }
  for (const candidate of [holder.response?.status, holder.statusCode, holder.status]) {
    if (typeof candidate === 'number') return candidate
  }
  return 0
}

async function confirmCheckIn(): Promise<void> {
  const query = currentQuery()
  if (!query) return
  stage.value = 'sending'
  syncMessage.value = ''

  // FIRST: the intent is saved on this device before any network or print.
  const intent = outbox.saveCheckInLocalFirst(query)
  const ticketForPrint = query.ticket_code || ticketInput.value.trim() || intent.key

  if (!navigator.onLine) {
    // Offline: queue the intent AND the print job (jam-proof order), then
    // show the queued state. The name fills in from the replay response.
    const job = outbox.queuePrintAfterCheckIn({
      ticketCode: ticketForPrint,
      name: query.name ?? '',
    })
    void job
    result.value = {
      kind: 'queued',
      name: query.name ?? '',
      ticketCode: ticketForPrint,
      at: new Date(intent.createdAt).toLocaleTimeString(),
    }
    stage.value = 'done'
    return
  }

  try {
    const { data, already } = await postCheckIn(query)
    const name = displayNameOf(data)
    const ticket = String(data.ticket_code ?? ticketForPrint)
    const at = new Date().toLocaleTimeString()
    const ageGroup = typeof data.age_group === 'string' ? data.age_group : ''
    lastCategory.value = AGE_LABELS[ageGroup] ?? ageGroup
    outbox.markIntentSettled(intent.key, already ? 'already' : 'synced')
    // SECOND: the print job queues only after the check-in is recorded.
    const job = outbox.queuePrintAfterCheckIn({ ticketCode: ticket, name })
    void job
    result.value = {
      kind: already ? 'already' : 'success',
      name,
      ticketCode: ticket,
      at,
    }
  } catch (cause) {
    const status = failureStatus(cause)
    if (status === 401 || status === 403) {
      // This tablet holds no check-in grant: amber device state, and the
      // intent stays pending for a grant-holding replay — never dropped.
      deviceRefused.value = true
      stage.value = 'idle'
      return
    }
    const code = extractCheckInCode(cause)
    if (code && isTerminalKioskCode(code)) {
      outbox.markIntentSettled(intent.key, 'needs-desk', code)
      if (code === 'checkin_ambiguous') {
        result.value = {
          kind: 'refusal',
          code,
          name: '',
          ticketCode: '',
          at: new Date().toLocaleTimeString(),
          count: extractCheckInCount(cause),
        }
      } else {
        result.value = refusalFor(code, extractCheckInName(cause))
      }
    } else {
      // Network or server failure: the intent stays pending for replay.
      // (Attempts are bumped by replayQueue; here we just show the state.)
      result.value = {
        kind: 'queued',
        name: query.name ?? '',
        ticketCode: ticketForPrint,
        at: new Date().toLocaleTimeString(),
      }
    }
  } finally {
    stage.value = 'done'
    if (result.value && result.value.kind !== 'queued') scheduleAutoClear()
  }
}

async function syncNow(): Promise<void> {
  syncMessage.value = ''
  const outcome = await outbox.replayQueue(async (intent) => {
    const query =
      intent.ticket_code !== undefined && intent.ticket_code !== ''
        ? { ticket_code: intent.ticket_code }
        : { name: intent.name ?? '' }
    return postCheckIn(query)
  })
  if (outcome.stillPending > 0) {
    syncMessage.value = `${outcome.stillPending} still waiting — the connection dropped again. They stay queued.`
  } else if (outcome.synced + outcome.already + outcome.needsDesk === 0) {
    syncMessage.value = 'Nothing queued. The kiosk is up to date.'
  } else {
    const parts: string[] = []
    if (outcome.synced > 0) parts.push(`${outcome.synced} checked in`)
    if (outcome.already > 0) parts.push(`${outcome.already} already checked in`)
    if (outcome.needsDesk > 0) {
      parts.push(`${outcome.needsDesk} need the welcome desk`)
    }
    syncMessage.value = `Synced: ${parts.join(' · ')}.`
  }
}

function badgeLink(): string {
  const row = result.value
  if (!row) return ''
  const params = new URLSearchParams({
    ticket: row.ticketCode,
    name: row.name || row.ticketCode,
    event: eventTitle.value,
    category: lastCategory.value ?? '',
    at: row.at,
  })
  return `/events/${id}/badge?${params.toString()}`
}

const lastCategory = ref<string | null>(null)

onMounted(() => {
  loadEventTitle()
  outbox.refresh()
  // Opportunistic replay: a tablet coming back online drains its own queue.
  if (navigator.onLine) void syncNow()
  window.addEventListener('online', handleOnline)
})

onBeforeUnmount(() => {
  window.removeEventListener('online', handleOnline)
  if (clearTimer) clearTimeout(clearTimer)
})

function handleOnline(): void {
  void syncNow()
}
</script>

<template>
  <main class="kiosk">
    <header class="kiosk__bar">
      <span class="kiosk__event">{{ eventTitle }}</span>
      <span>Kiosk self check-in</span>
    </header>

    <!-- Queued/unsynced strip: always visible, even on the idle screen. -->
    <div class="kiosk__queue" role="status" :data-online="online ? 'yes' : 'no'">
      <span v-if="online" class="kiosk__queue-dot" aria-hidden="true">●</span>
      <span v-else class="kiosk__queue-dot" aria-hidden="true">○</span>
      <span v-if="queuedCount === 0">
        {{
          online ? 'Online — nothing waiting to sync.' : 'Offline — nothing queued yet.'
        }}
      </span>
      <span v-else>
        ⧗ {{ queuedCount }} waiting to sync{{ online ? '' : ' (offline)' }}
      </span>
      <button
        v-if="online && queuedCount > 0"
        type="button"
        class="kiosk__sync"
        :disabled="outbox.replaying.value"
        @click="syncNow"
      >
        {{ outbox.replaying.value ? 'Syncing…' : 'Sync now' }}
      </button>
    </div>
    <p v-if="syncMessage" class="kiosk__syncmsg" role="status">
      {{ syncMessage }}
    </p>

    <!-- Amber device state: this tablet holds no check-in grant. -->
    <section v-if="deviceRefused" class="kiosk__body" aria-live="polite">
      <div class="kiosk__state kiosk__state--warn">
        <h2>
          <span aria-hidden="true">! </span>This tablet cannot check anyone in today
        </h2>
        <p>
          Please go to the <strong>usherer's desk</strong>. An usherer can check you in by
          name.
        </p>
      </div>
      <button
        type="button"
        class="kiosk__btn kiosk__btn--ghost"
        @click="deviceRefused = false"
      >
        Back
      </button>
    </section>

    <!-- Idle / attract (Kiosk 1). -->
    <section v-else-if="stage === 'idle'" class="kiosk__body">
      <div class="kiosk__prompt">
        <p class="kiosk__big">Check yourself in</p>
        <p class="kiosk__muted">Type your ticket code, or search your name</p>
      </div>
      <div class="kiosk__tabs" role="tablist" aria-label="Find your registration">
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'ticket'"
          class="kiosk__tab"
          :data-on="tab === 'ticket'"
          @click="tab = 'ticket'"
        >
          Ticket code
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'name'"
          class="kiosk__tab"
          :data-on="tab === 'name'"
          @click="tab = 'name'"
        >
          Name
        </button>
      </div>
      <template v-if="tab === 'ticket'">
        <label class="kiosk__label" for="kiosk-ticket">Ticket code</label>
        <input
          id="kiosk-ticket"
          v-model="ticketInput"
          class="kiosk__input"
          type="text"
          inputmode="text"
          autocomplete="off"
          autocapitalize="characters"
          placeholder="e.g. AFT-26-0417"
          @keyup.enter="goConfirm"
        />
      </template>
      <template v-else>
        <label class="kiosk__label" for="kiosk-name">Your full name</label>
        <input
          id="kiosk-name"
          v-model="nameInput"
          class="kiosk__input"
          type="text"
          autocomplete="off"
          placeholder="e.g. Adaeze Okonkwo"
          @keyup.enter="goConfirm"
        />
        <p class="kiosk__muted">
          The name must match exactly one registration — otherwise the welcome desk helps
          you.
        </p>
      </template>
      <button
        type="button"
        class="kiosk__btn kiosk__btn--primary"
        :disabled="!currentQuery()"
        @click="goConfirm"
      >
        Continue
      </button>
    </section>

    <!-- Confirm (Kiosk 2 analog): nothing is sent until confirmed. -->
    <section v-else-if="stage === 'confirm'" class="kiosk__body" aria-live="polite">
      <p class="kiosk__code">{{ ticketInput.trim() || nameInput.trim() }}</p>
      <p class="kiosk__muted">
        {{
          tab === 'ticket'
            ? 'Ticket code for this event'
            : 'Name to look up for this event'
        }}
      </p>
      <button
        type="button"
        class="kiosk__btn kiosk__btn--primary"
        @click="confirmCheckIn"
      >
        ✓ Check me in
      </button>
      <button type="button" class="kiosk__btn kiosk__btn--ghost" @click="stage = 'idle'">
        Clear
      </button>
    </section>

    <!-- Sending. -->
    <section v-else-if="stage === 'sending'" class="kiosk__body" aria-live="polite">
      <p class="kiosk__big">Checking you in…</p>
      <p class="kiosk__muted">Your check-in is already saved on this tablet.</p>
    </section>

    <!-- Done: success / already / refusal / queued. -->
    <section v-else class="kiosk__body" aria-live="polite">
      <template v-if="result?.kind === 'success'">
        <div class="kiosk__state kiosk__state--ok">
          <h2><span aria-hidden="true">✓ </span>You are checked in</h2>
          <p>
            <strong>{{ result.name }}</strong>
          </p>
          <p>
            Checked in at <strong>{{ result.at }}</strong> · status
            <strong>attended</strong>
          </p>
        </div>
        <NuxtLink :to="badgeLink()" class="kiosk__btn kiosk__btn--primary">
          ⎙ Print my badge
        </NuxtLink>
        <p class="kiosk__muted">
          This screen clears itself in a few seconds. Please keep your badge and take your
          seat.
        </p>
      </template>

      <template v-else-if="result?.kind === 'already'">
        <div class="kiosk__state kiosk__state--ok">
          <h2><span aria-hidden="true">✓ </span>Already checked in</h2>
          <p>
            <strong>{{ result.name }}</strong>
          </p>
          <p>You are checked in. You do not need to do anything else.</p>
        </div>
        <NuxtLink :to="badgeLink()" class="kiosk__btn kiosk__btn--primary">
          ⎙ Reprint my badge
        </NuxtLink>
        <p class="kiosk__muted">
          Nothing was changed the second time. This is one check-in, seen twice.
        </p>
      </template>

      <template v-else-if="result?.kind === 'queued'">
        <div class="kiosk__state kiosk__state--warn">
          <h2><span aria-hidden="true">⧗ </span>Saved on this tablet</h2>
          <p>
            The connection is down, so your check-in is <strong>queued</strong> — it is
            not lost.
          </p>
          <p>
            It syncs itself when the connection returns. Your badge print is queued with
            it.
          </p>
        </div>
        <p class="kiosk__muted">
          If the printer jams, tell the welcome desk — your check-in is safe.
        </p>
      </template>

      <template v-else-if="result?.code === 'checkin_needs_guardian'">
        <div class="kiosk__state kiosk__state--stop">
          <h2><span aria-hidden="true">✕ </span>Blocked — consent not recorded</h2>
          <p>
            <strong>{{ result.name }}</strong>
          </p>
          <p>
            Please go to the <strong>welcome desk</strong>. A team member will help you
            there.
          </p>
        </div>
        <p class="kiosk__muted">
          Nothing was recorded, and nothing will be recorded from this screen.
        </p>
      </template>

      <template v-else-if="result?.code === 'checkin_child'">
        <div class="kiosk__state kiosk__state--stop">
          <h2><span aria-hidden="true">✕ </span>This code is for a child</h2>
          <p><strong>Please go to the welcome desk.</strong></p>
          <p>A child's sign-in is completed there, by a person.</p>
        </div>
        <p class="kiosk__muted">
          This kiosk does not record a minor, so it recorded nothing.
        </p>
      </template>

      <template v-else-if="result?.code === 'checkin_cancelled'">
        <div class="kiosk__state kiosk__state--stop">
          <h2><span aria-hidden="true">✕ </span>This badge is no longer valid</h2>
          <p><strong>Please go to the usherer's desk.</strong></p>
          <p>They can find you and check you in by name. Your place is not lost.</p>
        </div>
      </template>

      <template v-else-if="result?.code === 'checkin_ambiguous'">
        <div class="kiosk__state kiosk__state--stop">
          <h2>
            <span aria-hidden="true">✕ </span>That name matches
            {{ result.count }} registrations
          </h2>
          <p><strong>Please go to the usherer's desk</strong> with your ticket code.</p>
          <p>This kiosk never lists names — the desk will find you.</p>
        </div>
      </template>

      <template v-else>
        <div class="kiosk__state kiosk__state--stop">
          <h2><span aria-hidden="true">✕ </span>No registration matches that</h2>
          <p>Check the code and try again, or <strong>go to the welcome desk</strong>.</p>
        </div>
      </template>

      <button type="button" class="kiosk__btn kiosk__btn--ghost" @click="startOver">
        Start over
      </button>
    </section>

    <footer class="kiosk__foot">
      <span>No staff login on this device</span>
      <span>No bulk roster on this screen</span>
    </footer>
  </main>
</template>

<style scoped>
.kiosk {
  min-height: 100vh;
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background: var(--afc-bg-surface);
  color: var(--afc-ink-900);
}
.kiosk__bar {
  background: var(--afc-ink-900);
  color: white;
  padding: var(--afc-space-2) var(--afc-space-3);
  font-size: var(--afc-text-sm);
  display: flex;
  justify-content: space-between;
  gap: var(--afc-space-2);
}
.kiosk__event {
  color: var(--afc-text-on-dark-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kiosk__queue {
  display: flex;
  align-items: center;
  gap: var(--afc-space-2);
  padding: var(--afc-space-2) var(--afc-space-3);
  font-size: var(--afc-text-sm);
  background: var(--afc-paper-200);
  border-bottom: 1px solid var(--afc-ink-50);
}
.kiosk__queue-dot {
  font-size: var(--afc-text-xs);
}
.kiosk__sync {
  margin-left: auto;
  border-radius: var(--afc-radius-pill);
  border: 1px solid var(--afc-action-600);
  color: var(--afc-action-600);
  background: transparent;
  min-height: var(--afc-control-min);
  padding: 0 var(--afc-space-4);
  font-weight: 600;
  cursor: pointer;
}
.kiosk__sync:disabled {
  opacity: 0.6;
  cursor: wait;
}
.kiosk__syncmsg {
  margin: 0;
  padding: var(--afc-space-1) var(--afc-space-3);
  font-size: var(--afc-text-xs);
  color: var(--afc-ink-400);
}
.kiosk__body {
  padding: var(--afc-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--afc-space-3);
  flex: 1;
  justify-content: center;
}
.kiosk__prompt {
  text-align: center;
  padding: var(--afc-space-6) var(--afc-space-3);
  border: 1px dashed var(--afc-ink-50);
  border-radius: var(--afc-radius-md);
  background: var(--afc-bg-canvas);
}
.kiosk__big {
  font-size: var(--afc-text-2xl);
  font-weight: 600;
  margin: 0 0 var(--afc-space-1);
}
.kiosk__muted {
  margin: 0;
  font-size: var(--afc-text-sm);
  color: var(--afc-ink-400);
  text-align: center;
}
.kiosk__tabs {
  display: flex;
  gap: var(--afc-space-2);
}
/* Pills mean interactive; 44px minimum targets (kiosk, standing, one hand). */
.kiosk__tab {
  flex: 1;
  border-radius: var(--afc-radius-pill);
  border: 1px solid var(--afc-ink-50);
  background: transparent;
  color: var(--afc-ink-900);
  min-height: var(--afc-control-min);
  font-weight: 600;
  cursor: pointer;
}
.kiosk__tab[data-on='true'] {
  background: var(--afc-ink-900);
  border-color: var(--afc-ink-900);
  color: white;
}
.kiosk__label {
  font-size: var(--afc-text-sm);
  font-weight: 600;
}
.kiosk__input {
  border: 1px solid var(--afc-ink-50);
  border-radius: var(--afc-radius-md);
  min-height: var(--afc-control-min);
  padding: 0 var(--afc-space-3);
  font-size: var(--afc-text-lg);
  width: 100%;
}
.kiosk__code {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
  text-align: center;
  margin: 0;
  overflow-wrap: anywhere;
}
.kiosk__btn {
  border-radius: var(--afc-radius-pill);
  min-height: var(--afc-control-min);
  font-weight: 600;
  font-size: var(--afc-text-base);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  cursor: pointer;
  width: 100%;
}
.kiosk__btn--primary {
  background: var(--afc-action-600);
  border: 1px solid var(--afc-action-600);
  color: white;
}
.kiosk__btn--primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.kiosk__btn--ghost {
  background: transparent;
  border: 1px solid var(--afc-ink-50);
  color: var(--afc-ink-900);
}
/* Status carries label + glyph, never colour alone. */
.kiosk__state {
  border-radius: var(--afc-radius-md);
  padding: var(--afc-space-3);
  border: 1px solid var(--afc-ink-50);
}
.kiosk__state h2 {
  margin: 0 0 var(--afc-space-1);
  font-size: var(--afc-text-lg);
}
.kiosk__state p {
  margin: var(--afc-space-1) 0 0;
  font-size: var(--afc-text-sm);
}
.kiosk__state--ok {
  background: var(--afc-status-success-bg);
  border-color: var(--afc-status-success);
  color: var(--afc-status-success);
}
.kiosk__state--ok p {
  color: var(--afc-status-success);
}
.kiosk__state--warn {
  background: var(--afc-status-warn-bg);
  border-color: var(--afc-status-warn);
  color: var(--afc-status-warn);
}
.kiosk__state--warn p {
  color: var(--afc-status-warn);
}
.kiosk__state--stop {
  background: var(--afc-status-danger-bg);
  border-color: var(--afc-status-danger);
  color: var(--afc-status-danger);
}
.kiosk__state--stop p {
  color: var(--afc-status-danger);
}
.kiosk__foot {
  background: var(--afc-paper-200);
  border-top: 1px solid var(--afc-ink-50);
  padding: var(--afc-space-2) var(--afc-space-3);
  font-size: var(--afc-text-xs);
  color: var(--afc-ink-400);
  display: flex;
  justify-content: space-between;
  gap: var(--afc-space-2);
}
@media (prefers-reduced-motion: reduce) {
  .kiosk *,
  .kiosk *::before,
  .kiosk *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
