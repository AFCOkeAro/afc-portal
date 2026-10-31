/**
 * useAfcSyncQueue — offline outbox + session-draft store (AFC-959).
 *
 * TypeScript port of the `afc-sync-queue` vanilla helper for Nuxt. The core
 * (`createOutbox`, `drafts`, backoff) is framework-free and SSR-safe: no
 * `window`/`localStorage`/`navigator` access happens at import time or on
 * the server. `useAfcSyncQueue()` wraps one shared outbox in Vue
 * reactivity, boots it on the client, and tracks online state.
 *
 * Storage: IndexedDB `afc-sync-queue` (store `outbox`) when available,
 * `localStorage` `afc:outbox:v1` fallback. Drafts: `draft:{formId}` in
 * localStorage — device-local, never transmitted except as the user's own
 * submit. Boot rehydrates the banner/panel: mid-flight rows return to
 * queued, never dropped.
 */

export const OUTBOX_LS_KEY = 'afc:outbox:v1'
export const draftKey = (formId: string): string => `draft:${formId}`

const IDB_DB = 'afc-sync-queue'
const IDB_STORE = 'outbox'

export const COPY = {
  offlineBanner:
    'You are offline — changes save on this device and sync when reconnected.',
  queuedOptimistic: 'Saved on device • will sync',
  retryNow: 'Retry now',
  pendingCount: (n: number): string =>
    n === 1 ? '1 change waiting' : `${n} changes waiting`,
  draftRestoredToast: 'Draft restored',
  sessionEndedTitle: 'Session ended — your work is saved on this device.',
  sessionEndedCta: 'Log in again',
  resumeTitle: 'Resume where you left off',
  sharedDeviceNote: 'On a shared device? Discard draft after use.',
  slowFallback: "Still trying... Retry or continue offline",
  conflictKeptServer:
    'Server already has a newer record — kept the server version. Nothing was overwritten.',
} as const

export type OutboxStatus = 'queued' | 'retrying' | 'sending' | 'failed'

export interface OutboxItem {
  id: string
  idempotencyKey: string
  type: string
  label: string
  payload: Record<string, unknown>
  queuedAt: string
  status: OutboxStatus
  attempts: number
  lastError: string | null
}

export interface SendResult {
  ok?: boolean
  conflict?: boolean
  error?: string
}

export type Sender = (item: OutboxItem) => Promise<SendResult>

export function uuid(): string {
  try {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** Exponential backoff 1s/2s/4s… capped at 60s, plus jitter. */
export function backoffDelay(
  attempt: number,
  opts?: { base?: number; cap?: number; jitter?: () => number },
): number {
  const base = opts?.base ?? 1000
  const cap = opts?.cap ?? 60000
  const jitterFn = opts?.jitter ?? (() => Math.random() * 500)
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt))
  return exp + jitterFn()
}

export function shouldShowProgress(elapsedMs: number): boolean {
  return elapsedMs > 2000
}

export function formatStep(label: string, done: number, total: number): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return `${label} ${done} of ${total}... ${pct}%`
}

export interface KeyValueStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
  }
}

export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.getItem('__afc_probe__')
      return localStorage
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStorage()
}

export function isOnline(): boolean {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.onLine === 'boolean'
    ) {
      return navigator.onLine
    }
  } catch {
    /* fall through */
  }
  return true
}

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(IDB_DB, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    } catch (e) {
      reject(e)
    }
  })
}

export interface OutboxOptions {
  storage?: KeyValueStorage
  now?: () => Date
  sender?: Sender
  autoRetry?: boolean
  jitter?: () => number
}

export interface Outbox {
  boot: () => Promise<OutboxItem[]>
  enqueue: (
    type: string,
    label: string,
    payload?: Record<string, unknown>,
    opts?: { id?: string; idempotencyKey?: string },
  ) => OutboxItem
  flush: () => Promise<OutboxItem[]>
  retryNow: () => Promise<OutboxItem[]>
  retryItem: (id: string) => Promise<OutboxItem[]>
  onChange: (fn: (snap: OutboxItem[]) => void) => () => void
  snapshot: () => OutboxItem[]
  pendingCount: () => number
}

export function createOutbox(opts?: OutboxOptions): Outbox {
  const storage = opts?.storage ?? defaultStorage()
  const now = opts?.now ?? (() => new Date())
  const sender: Sender = opts?.sender ?? (() => Promise.resolve({ ok: true }))
  const listeners = new Set<(snap: OutboxItem[]) => void>()
  let items: OutboxItem[] = []
  let loaded = false
  let flushing = false
  let flushQueued = false
  let db: IDBDatabase | null = null

  const snapshot = (): OutboxItem[] => items.map((i) => ({ ...i }))

  const emit = (): void => {
    const snap = snapshot()
    listeners.forEach((fn) => {
      try {
        fn(snap)
      } catch {
        /* listener errors never break the queue */
      }
    })
  }

  const persistLs = (): void => {
    try {
      storage.setItem(OUTBOX_LS_KEY, JSON.stringify(items))
    } catch {
      /* quota/privacy mode: in-memory copy still serves this session */
    }
  }

  const loadLs = (): OutboxItem[] => {
    try {
      const raw = storage.getItem(OUTBOX_LS_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as OutboxItem[]) : []
    } catch {
      return []
    }
  }

  const idbPut = (item: OutboxItem): Promise<void> =>
    new Promise((resolve, reject) => {
      try {
        if (!db) return resolve()
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).put(item)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      } catch (e) {
        reject(e)
      }
    })

  const idbDel = (id: string): Promise<void> =>
    new Promise((resolve, reject) => {
      try {
        if (!db) return resolve()
        const tx = db.transaction(IDB_STORE, 'readwrite')
        tx.objectStore(IDB_STORE).delete(id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      } catch (e) {
        reject(e)
      }
    })

  const persist = async (item: OutboxItem): Promise<void> => {
    persistLs()
    if (db) {
      try {
        await idbPut(item)
      } catch {
        /* LS copy is authoritative fallback */
      }
    }
  }

  const remove = async (id: string): Promise<void> => {
    items = items.filter((i) => i.id !== id)
    persistLs()
    if (db) {
      try {
        await idbDel(id)
      } catch {
        /* ignore */
      }
    }
    emit()
  }

  const boot = async (): Promise<OutboxItem[]> => {
    if (loaded) return snapshot()
    if (typeof indexedDB !== 'undefined') {
      try {
        db = await idbOpen()
        const rows: OutboxItem[] = await new Promise((resolve, reject) => {
          try {
            const tx = (db as IDBDatabase).transaction(IDB_STORE, 'readonly')
            const rq = tx.objectStore(IDB_STORE).getAll()
            rq.onsuccess = () => resolve((rq.result as OutboxItem[]) ?? [])
            rq.onerror = () => reject(rq.error)
          } catch (e) {
            reject(e)
          }
        })
        if (rows.length > 0) {
          items = rows
          persistLs()
        } else {
          items = loadLs()
          for (const it of items) {
            try {
              await idbPut(it)
            } catch {
              /* ignore */
            }
          }
        }
      } catch {
        db = null
        items = loadLs()
      }
    } else {
      items = loadLs()
    }
    /* Rehydrate: anything mid-flight at reload returns to queued — never dropped. */
    let touched = false
    items = items.map((it) => {
      if (it.status === 'retrying' || it.status === 'sending') {
        touched = true
        return { ...it, status: 'queued' as OutboxStatus }
      }
      return it
    })
    if (touched) persistLs()
    loaded = true
    emit()
    return snapshot()
  }

  const flush = async (): Promise<OutboxItem[]> => {
    await boot()
    /* Collapse concurrent flushes but never drop one. */
    if (flushing) {
      flushQueued = true
      return snapshot()
    }
    flushing = true
    try {
      do {
        flushQueued = false
        const pendingItems = items.filter(
          (i) => i.status === 'queued' || i.status === 'failed',
        )
        for (const it of pendingItems) {
          if (!isOnline()) break
          const live = items.find((i) => i.id === it.id)
          if (!live) continue
          await sendOne(live)
        }
      } while (flushQueued)
    } finally {
      flushing = false
    }
    emit()
    return snapshot()
  }

  const sendOne = async (
    item: OutboxItem,
  ): Promise<{ id: string; outcome: 'sent' | 'conflict' | 'error'; retryInMs?: number }> => {
    if (item.status === 'queued') item.status = 'retrying'
    emit()
    try {
      const res = await sender(item)
      if (res?.conflict) {
        /* Conflict = server-wins, surfaced as a card. Never silent overwrite. */
        item.status = 'failed'
        item.lastError = COPY.conflictKeptServer
        await persist(item)
        emit()
        return { id: item.id, outcome: 'conflict' }
      }
      if (res?.ok === false) throw new Error(res?.error || 'Send failed')
      await remove(item.id)
      return { id: item.id, outcome: 'sent' }
    } catch (e) {
      item.attempts += 1
      item.status = 'failed'
      item.lastError = e instanceof Error ? e.message : 'Send failed'
      await persist(item)
      emit()
      const delay = backoffDelay(item.attempts - 1, {
        jitter: opts?.jitter ?? (() => 0),
      })
      if (opts?.autoRetry !== false && typeof setTimeout !== 'undefined' && isOnline()) {
        const snapshotId = item.id
        setTimeout(() => {
          const cur = items.find((i) => i.id === snapshotId)
          if (cur && cur.status === 'failed') {
            cur.status = 'queued'
            emit()
            flush().catch(() => {})
          }
        }, delay)
      }
      return { id: item.id, outcome: 'error', retryInMs: delay }
    }
  }

  /* Enqueue is a synchronous local write: the ack path stays fast (no
     network, no IndexedDB round-trip on ack — IDB mirrors async). */
  const enqueue = (
    type: string,
    label: string,
    payload: Record<string, unknown> = {},
    enqueueOpts?: { id?: string; idempotencyKey?: string },
  ): OutboxItem => {
    const item: OutboxItem = {
      id: enqueueOpts?.id ?? uuid(),
      idempotencyKey: enqueueOpts?.idempotencyKey ?? uuid(),
      type,
      label,
      payload,
      queuedAt: now().toISOString(),
      status: 'queued',
      attempts: 0,
      lastError: null,
    }
    items.push(item)
    persistLs()
    if (db) idbPut(item).catch(() => {})
    emit()
    flush().catch(() => {})
    return { ...item }
  }

  const retryNow = async (): Promise<OutboxItem[]> => {
    items = items.map((it) =>
      it.status === 'failed' ? { ...it, lastError: it.lastError } : it,
    )
    items = items.map((it) =>
      it.status === 'failed'
        ? { ...it, status: 'queued' as OutboxStatus }
        : it,
    )
    persistLs()
    emit()
    return flush()
  }

  const retryItem = async (id: string): Promise<OutboxItem[]> => {
    const it = items.find((i) => i.id === id)
    if (!it) return snapshot()
    it.status = 'queued'
    emit()
    return flush()
  }

  const onChange = (fn: (snap: OutboxItem[]) => void): (() => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }

  /* Sent rows are removed on ack, so everything held is still pending. */
  const pendingCount = (): number => items.length

  return {
    boot,
    enqueue,
    flush,
    retryNow,
    retryItem,
    onChange,
    snapshot,
    pendingCount,
  }
}

/* ---------------------------------------------------------------- drafts */
/** Session drafts: autosaved to the device, never transmitted except as
 * the user's own submit. On 401/expiry mid-entry, call
 * `handleExpiredSession` BEFORE any redirect so the draft survives logout. */
export const drafts = {
  save(formId: string, data: Record<string, unknown>, storage?: KeyValueStorage): boolean {
    const st = storage ?? defaultStorage()
    try {
      st.setItem(
        draftKey(formId),
        JSON.stringify({ savedAt: new Date().toISOString(), data: data ?? {} }),
      )
      return true
    } catch {
      return false
    }
  },
  load(formId: string, storage?: KeyValueStorage): Record<string, unknown> | null {
    const st = storage ?? defaultStorage()
    try {
      const raw = st.getItem(draftKey(formId))
      if (!raw) return null
      const parsed = JSON.parse(raw) as { data?: Record<string, unknown> }
      return parsed?.data ?? null
    } catch {
      return null
    }
  },
  clear(formId: string, storage?: KeyValueStorage): void {
    const st = storage ?? defaultStorage()
    try {
      st.removeItem(draftKey(formId))
    } catch {
      /* ignore */
    }
  },
  handleExpiredSession(
    formId: string,
    data: Record<string, unknown>,
    storage?: KeyValueStorage,
  ): { redirectTo: string; draftSaved: boolean } {
    this.save(formId, data, storage)
    return { redirectTo: 'login', draftSaved: true }
  },
}

/* ------------------------------------------------------------ composable */
let sharedOutbox: Outbox | null = null

/**
 * Shared client-side outbox. The first caller creates it; every caller
 * sees the same reactive snapshot. Safe to call during SSR — boot and
 * listeners attach on the client only.
 */
export function useAfcSyncQueue(): {
  online: Ref<boolean>
  booted: Ref<boolean>
  pending: Ref<number>
  items: Ref<OutboxItem[]>
  enqueue: Outbox['enqueue']
  retryNow: () => Promise<OutboxItem[]>
  retryItem: (id: string) => Promise<OutboxItem[]>
} {
  if (!sharedOutbox) sharedOutbox = createOutbox()
  const outbox = sharedOutbox

  const online = ref(isOnline())
  const booted = ref(false)
  const items = ref<OutboxItem[]>(outbox.snapshot())
  const pending = computed(() => items.value.length)

  if (import.meta.client) {
    onMounted(() => {
      outbox
        .boot()
        .then((snap) => {
          items.value = snap
          booted.value = true
        })
        .catch(() => {
          booted.value = true
        })
    })
    onMounted(() => {
      const off = outbox.onChange((snap) => {
        items.value = snap
      })
      const update = () => {
        online.value = isOnline()
        if (isOnline()) outbox.flush().catch(() => {})
      }
      window.addEventListener('online', update)
      window.addEventListener('offline', update)
      onUnmounted(() => {
        off()
        window.removeEventListener('online', update)
        window.removeEventListener('offline', update)
      })
    })
  }

  return {
    online,
    booted,
    pending,
    items,
    enqueue: outbox.enqueue,
    retryNow: () => outbox.retryNow(),
    retryItem: (id: string) => outbox.retryItem(id),
  }
}
