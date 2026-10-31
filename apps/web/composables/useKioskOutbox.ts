/**
 * Kiosk offline outbox (AFC-985 Phase 1).
 *
 * Ordering guarantee — check-in saves locally FIRST, the print job queues
 * SECOND. A printer jam therefore never loses a check-in: the intent is
 * already in localStorage before any print is attempted, and replay sends
 * intents through the same POST /api/events/[id]/check-in route the online
 * path uses (with `mode: 'kiosk'`, so the child/consent gate runs on replay
 * too). No new backend table: the outbox lives in this tablet's localStorage,
 * keyed per event.
 *
 * Replay safety: the server treats an already-attended row as idempotent
 * (`meta.already`), so posting one intent twice (retry after a timeout) can
 * never write two check-ins. Terminal 409s (child, missing consent,
 * cancelled, ambiguous, not found) settle the intent as `needs-desk` — kept
 * for the exception desk, never retried.
 *
 * The pure helpers below are Nuxt-free so they are unit-testable in plain
 * node; only `useKioskOutbox` touches localStorage / navigator / Vue.
 */

export const KIOSK_OUTBOX_VERSION = 1

export type KioskIntentOutcome = 'pending' | 'synced' | 'already' | 'needs-desk'

export interface KioskCheckInIntent {
  /** Client idempotency key: one queued tap, one key, retried safely. */
  key: string
  eventId: string
  ticket_code?: string
  name?: string
  createdAt: string
  attempts: number
  outcome: KioskIntentOutcome
  /** Terminal server code for needs-desk intents (e.g. checkin_child). */
  code?: string
}

export interface KioskPrintJob {
  key: string
  eventId: string
  ticketCode: string
  name: string
  createdAt: string
  /** A jam leaves the job `queued` — reprint from the queue, never re-tap. */
  status: 'queued' | 'done'
}

export interface KioskOutboxState {
  version: number
  intents: KioskCheckInIntent[]
  prints: KioskPrintJob[]
}

export function outboxStorageKey(eventId: string): string {
  return `afc.kiosk.outbox.v${KIOSK_OUTBOX_VERSION}.${eventId}`
}

export function emptyOutbox(): KioskOutboxState {
  return { version: KIOSK_OUTBOX_VERSION, intents: [], prints: [] }
}

/** Parse stored JSON defensively: a corrupt box yields an empty one, never a throw. */
export function parseOutbox(raw: string | null): KioskOutboxState {
  if (!raw) return emptyOutbox()
  try {
    const parsed = JSON.parse(raw) as Partial<KioskOutboxState>
    if (!Array.isArray(parsed.intents) || !Array.isArray(parsed.prints)) {
      return emptyOutbox()
    }
    return {
      version: KIOSK_OUTBOX_VERSION,
      intents: parsed.intents.filter(
        (intent): intent is KioskCheckInIntent =>
          Boolean(intent) && typeof intent.key === 'string',
      ),
      prints: parsed.prints.filter(
        (job): job is KioskPrintJob => Boolean(job) && typeof job.key === 'string',
      ),
    }
  } catch {
    return emptyOutbox()
  }
}

export function newIntentKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `k-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

export function buildIntent(
  eventId: string,
  query: { ticket_code?: string; name?: string },
  key: string = newIntentKey(),
  createdAt: string = new Date().toISOString(),
): KioskCheckInIntent {
  return {
    key,
    eventId,
    ticket_code: query.ticket_code,
    name: query.name,
    createdAt,
    attempts: 0,
    outcome: 'pending',
  }
}

/**
 * Enqueue a check-in intent. A re-tap with the same key is a no-op (the tap
 * is already saved), so double-tapping the confirm button cannot queue two
 * intents for one check-in.
 */
export function enqueueIntent(
  state: KioskOutboxState,
  intent: KioskCheckInIntent,
): KioskOutboxState {
  if (state.intents.some((existing) => existing.key === intent.key)) {
    return state
  }
  return { ...state, intents: [...state.intents, intent] }
}

/** Queue a badge print AFTER the check-in intent is saved (jam-proof order). */
export function enqueuePrint(
  state: KioskOutboxState,
  job: KioskPrintJob,
): KioskOutboxState {
  if (state.prints.some((existing) => existing.key === job.key)) {
    return state
  }
  return { ...state, prints: [...state.prints, job] }
}

export function settleIntent(
  state: KioskOutboxState,
  key: string,
  outcome: KioskIntentOutcome,
  code?: string,
): KioskOutboxState {
  return {
    ...state,
    intents: state.intents.map((intent) =>
      intent.key === key ? { ...intent, outcome, code } : intent,
    ),
  }
}

export function bumpIntentAttempts(
  state: KioskOutboxState,
  key: string,
): KioskOutboxState {
  return {
    ...state,
    intents: state.intents.map((intent) =>
      intent.key === key ? { ...intent, attempts: intent.attempts + 1 } : intent,
    ),
  }
}

export function markPrintDone(state: KioskOutboxState, key: string): KioskOutboxState {
  return {
    ...state,
    prints: state.prints.map((job) =>
      job.key === key ? { ...job, status: 'done' as const } : job,
    ),
  }
}

/** Rename a queued print job once replay returns the server-held name. */
export function updatePrintName(
  state: KioskOutboxState,
  key: string,
  name: string,
): KioskOutboxState {
  return {
    ...state,
    prints: state.prints.map((job) => (job.key === key ? { ...job, name } : job)),
  }
}

/** Intents still waiting for a successful replay. */
export function pendingIntents(state: KioskOutboxState): KioskCheckInIntent[] {
  return state.intents.filter((intent) => intent.outcome === 'pending')
}

/** The kiosk UI's queued/unsynced count: pending intents + queued prints. */
export function unsyncedCount(state: KioskOutboxState): number {
  return (
    pendingIntents(state).length +
    state.prints.filter((job) => job.status === 'queued').length
  )
}

/** Exponential backoff with a 5-minute ceiling: 5s, 15s, 45s, … */
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(5_000 * 3 ** Math.max(0, attempts), 300_000)
}

/**
 * Terminal server codes settle an intent as needs-desk (exception desk),
 * never retried: the server has decided, and re-posting would only repeat
 * the refusal. `checkin_cancelled` included — a void badge goes to the
 * usherer's desk, not back through the queue.
 */
export const KIOSK_TERMINAL_CODES = [
  'checkin_child',
  'checkin_needs_guardian',
  'checkin_cancelled',
  'checkin_ambiguous',
  'checkin_not_found',
] as const

export function isTerminalKioskCode(code: string): boolean {
  return (KIOSK_TERMINAL_CODES as readonly string[]).includes(code)
}

/**
 * Pull the server's terminal code out of whatever shape the HTTP layer
 * gives us ($fetch error .data, ApiRequestError.code, h3 data.code, or a
 * message that names the code). Returns '' when the failure carries no code
 * — the caller treats that as a retryable network/server error, never as a
 * refusal. Generic placeholder codes (unknown_error, …) are skipped so a
 * deeper shape can still yield the real code.
 */
const PLACEHOLDER_CODES = ['unknown_error', 'server_error', 'network_error']

function pushCode(candidates: unknown[], candidate: unknown): void {
  if (
    typeof candidate === 'string' &&
    candidate &&
    !PLACEHOLDER_CODES.includes(candidate)
  ) {
    candidates.push(candidate)
  }
}

export function extractCheckInCode(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return ''
  const holder = cause as {
    code?: unknown
    data?: unknown
    message?: unknown
    response?: { _data?: unknown }
  }
  const candidates: unknown[] = []
  pushCode(candidates, holder.code)
  const layers: unknown[] = [holder.data, holder.response?._data]
  for (const layer of layers) {
    if (layer && typeof layer === 'object') {
      const flat = layer as { code?: unknown; data?: unknown }
      pushCode(candidates, flat.code)
      if (flat.data && typeof flat.data === 'object') {
        pushCode(candidates, (flat.data as { code?: unknown }).code)
      }
    }
  }
  if (candidates.length > 0) return candidates[0] as string
  if (typeof holder.message === 'string') {
    const hit = holder.message.match(/checkin_[a-z_]+/)
    if (hit) return hit[0]
  }
  return ''
}

/** The single matched name a needs-guardian refusal carries ('' otherwise). */
export function extractCheckInName(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return ''
  const holder = cause as { data?: unknown; response?: { _data?: unknown } }
  const layers: unknown[] = [holder.data, holder.response?._data]
  for (const layer of layers) {
    if (layer && typeof layer === 'object') {
      const flat = layer as { name?: unknown; data?: unknown }
      if (typeof flat.name === 'string') return flat.name
      if (flat.data && typeof flat.data === 'object') {
        const inner = (flat.data as { name?: unknown }).name
        if (typeof inner === 'string') return inner
      }
    }
  }
  return ''
}

/** The match count an ambiguous-name refusal carries (0 otherwise). */
export function extractCheckInCount(cause: unknown): number {
  if (!cause || typeof cause !== 'object') return 0
  const holder = cause as { data?: unknown; response?: { _data?: unknown } }
  const layers: unknown[] = [holder.data, holder.response?._data]
  for (const layer of layers) {
    if (layer && typeof layer === 'object') {
      const flat = layer as { count?: unknown; data?: unknown }
      if (typeof flat.count === 'number' && Number.isFinite(flat.count)) {
        return flat.count
      }
      if (flat.data && typeof flat.data === 'object') {
        const inner = (flat.data as { count?: unknown }).count
        if (typeof inner === 'number' && Number.isFinite(inner)) return inner
      }
    }
  }
  return 0
}

/* ------------------------------------------------------------------ */
/* The Nuxt composable: persistence + replay around the pure helpers.  */
/* ------------------------------------------------------------------ */

export interface KioskReplayPost {
  (intent: KioskCheckInIntent): Promise<{
    already: boolean
    data: Record<string, unknown>
  }>
}

export function useKioskOutbox(eventId: string) {
  const storageKey = outboxStorageKey(eventId)
  const state = ref<KioskOutboxState>(emptyOutbox())
  const replaying = ref(false)
  const online = ref(typeof navigator === 'undefined' ? true : navigator.onLine)

  function readStored(): KioskOutboxState {
    if (typeof localStorage === 'undefined') return emptyOutbox()
    return parseOutbox(localStorage.getItem(storageKey))
  }

  function persist(next: KioskOutboxState): void {
    state.value = next
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      /* Storage full or unavailable (private mode): the in-memory state
         still drives this session; the queued count stays visible. */
    }
  }

  function refresh(): void {
    state.value = readStored()
  }

  /** Save a check-in intent locally FIRST — before any network or print. */
  function saveCheckInLocalFirst(query: {
    ticket_code?: string
    name?: string
  }): KioskCheckInIntent {
    const intent = buildIntent(eventId, query)
    persist(enqueueIntent(readStored(), intent))
    return intent
  }

  /** Queue a badge print SECOND — only ever after the intent is saved. */
  function queuePrintAfterCheckIn(job: {
    ticketCode: string
    name: string
  }): KioskPrintJob {
    const record: KioskPrintJob = {
      key: newIntentKey(),
      eventId,
      ticketCode: job.ticketCode,
      name: job.name,
      createdAt: new Date().toISOString(),
      status: 'queued',
    }
    persist(enqueuePrint(readStored(), record))
    return record
  }

  function markIntentSettled(
    key: string,
    outcome: KioskIntentOutcome,
    code?: string,
  ): void {
    persist(settleIntent(readStored(), key, outcome, code))
  }

  function markPrintRecordDone(key: string): void {
    persist(markPrintDone(readStored(), key))
  }

  /**
   * Replay every pending intent through the check-in route. One slow or dead
   * network must not stall the rest: each intent settles independently.
   * Already-attended answers count as success (idempotent replay).
   */
  async function replayQueue(post: KioskReplayPost): Promise<{
    synced: number
    already: number
    needsDesk: number
    stillPending: number
  }> {
    if (replaying.value) {
      const pending = pendingIntents(state.value).length
      return { synced: 0, already: 0, needsDesk: 0, stillPending: pending }
    }
    replaying.value = true
    let synced = 0
    let already = 0
    let needsDesk = 0
    try {
      for (const intent of pendingIntents(readStored())) {
        try {
          const result = await post(intent)
          if (result.already) {
            already += 1
            persist(settleIntent(readStored(), intent.key, 'already'))
          } else {
            synced += 1
            persist(settleIntent(readStored(), intent.key, 'synced'))
          }
        } catch (cause) {
          const terminal = extractCheckInCode(cause)
          if (terminal && isTerminalKioskCode(terminal)) {
            needsDesk += 1
            persist(settleIntent(readStored(), intent.key, 'needs-desk', terminal))
          } else {
            // Network or server error: keep pending with a bumped attempt
            // count so the next replay backs off.
            persist(bumpIntentAttempts(readStored(), intent.key))
          }
        }
      }
    } finally {
      replaying.value = false
    }
    return {
      synced,
      already,
      needsDesk,
      stillPending: pendingIntents(readStored()).length,
    }
  }

  const queuedCount = computed(() => unsyncedCount(state.value))
  const pendingCount = computed(() => pendingIntents(state.value).length)

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      online.value = true
    })
    window.addEventListener('offline', () => {
      online.value = false
    })
  }

  onMounted(refresh)

  return {
    state,
    online,
    replaying,
    queuedCount,
    pendingCount,
    refresh,
    saveCheckInLocalFirst,
    queuePrintAfterCheckIn,
    markIntentSettled,
    markPrintRecordDone,
    replayQueue,
  }
}
