/* ==========================================================================
   AFC Church Portal — afc-sync-queue v1.0.0 (AFC-959: P2 states 4+8, P5 states 2+5+10)
   --------------------------------------------------------------------------
   Framework-free offline outbox + queue UI + session-draft restore + resilient
   loading/slow/success helpers. No build step. Pair with AFC tokens +
   components:

     <link rel="stylesheet" href="../design-system/tokens/afc-tokens.css">
     <link rel="stylesheet" href="../design-system/components/afc-components.css">
     <link rel="stylesheet" href="./afc-sync-queue.css">

   Spec source: AFC-956 `portal-improvements` P2 + P5 (normative copy kept
   verbatim in COPY below). No invented style values — every visual comes
   from --afc-* tokens via afc-sync-queue.css.

   Storage: IndexedDB `afc-sync-queue` (store `outbox`) when available,
   localStorage `afc:outbox:v1` fallback. Drafts: `draft:{formId}` in
   localStorage (device-local, never transmitted except as the user's own
   submit). Boot rehydrates banner + panel: no silent drop.

   Data rules: synthetic seeds only; data minimisation (payloads carry only
   the fields the task needs); never log personal data.
   ========================================================================== */
'use strict';

(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module && module.exports) module.exports = mod;
  if (root) root.AfcSyncQueue = mod;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : undefined), function () {
  /* ------------------------------------------------------------------ copy */
  const COPY = {
    offlineBanner: 'You are offline — changes save on this device and sync when reconnected.',
    queuedOptimistic: 'Saved on device • will sync',
    retryNow: 'Retry now',
    pendingCount: (n) => (n === 1 ? '1 change waiting' : `${n} changes waiting`),
    draftRestoredToast: 'Draft restored',
    sessionEndedTitle: 'Session ended — your work is saved on this device.',
    sessionEndedCta: 'Log in again',
    resumeTitle: 'Resume where you left off',
    sharedDeviceNote: 'On a shared device? Discard draft after use.',
    slowFallback: 'Still trying... Retry or continue offline',
    conflictKeptServer: 'Server already has a newer record — kept the server version. Nothing was overwritten.',
  };

  const OUTBOX_LS_KEY = 'afc:outbox:v1';
  const draftKey = (formId) => `draft:${formId}`;
  const IDB_DB = 'afc-sync-queue';
  const IDB_STORE = 'outbox';

  /* ------------------------------------------------------------- utilities */
  function uuid() {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch (_e) { /* fall through */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowIso(now) {
    try {
      return (now ? now() : new Date()).toISOString();
    } catch (_e) {
      return new Date().toISOString();
    }
  }

  /* Exponential backoff 1s/2s/4s... capped at 60s, plus jitter.
     Pure function so the gate ("backoff verified") can assert the ladder. */
  function backoffDelay(attempt, opts) {
    const o = opts || {};
    const base = o.base != null ? o.base : 1000;
    const cap = o.cap != null ? o.cap : 60000;
    const jitterFn = o.jitter || (() => Math.random() * 500);
    const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
    return exp + jitterFn();
  }

  function shouldShowProgress(elapsedMs) {
    return elapsedMs > 2000;
  }

  function formatStep(label, done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return `${label} ${done} of ${total}... ${pct}%`;
  }

  /* ---------------------------------------------------------- storage shim */
  function memoryStorage() {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    };
  }

  function defaultStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.getItem('__afc_probe__');
        return localStorage;
      }
    } catch (_e) { /* fall through */ }
    return memoryStorage();
  }

  function idbAvailable() {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (_e) {
      return false;
    }
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(IDB_DB, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbAll(db) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const rq = tx.objectStore(IDB_STORE).getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbPut(db, item) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  function idbDel(db, id) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e);
      }
    });
  }

  /* ---------------------------------------------------------------- outbox */
  function createOutbox(opts) {
    const o = opts || {};
    const storage = o.storage || defaultStorage();
    const now = o.now || (() => new Date());
    const sender = o.sender || (() => Promise.resolve({ ok: true }));
    const listeners = new Set();
    let items = [];
    let loaded = false;
    let flushing = false;
    let flushQueued = false;
    let db = null;

    const emit = () => {
      const snap = snapshot();
      listeners.forEach((fn) => {
        try { fn(snap); } catch (_e) { /* listener errors never break the queue */ }
      });
    };

    function snapshot() {
      return items.map((i) => ({ ...i }));
    }

    function persistLs() {
      try {
        storage.setItem(OUTBOX_LS_KEY, JSON.stringify(items));
      } catch (_e) { /* quota/privacy mode: in-memory copy still serves this session */ }
    }

    function loadLs() {
      try {
        const raw = storage.getItem(OUTBOX_LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_e) {
        return [];
      }
    }

    async function persist(item) {
      persistLs();
      if (db) {
        try { await idbPut(db, item); } catch (_e) { /* LS copy is authoritative fallback */ }
      }
    }

    async function remove(id) {
      items = items.filter((i) => i.id !== id);
      persistLs();
      if (db) {
        try { await idbDel(db, id); } catch (_e) { /* ignore */ }
      }
      emit();
    }

    async function boot() {
      if (loaded) return snapshot();
      if (idbAvailable()) {
        try {
          db = await idbOpen();
          const rows = await idbAll(db);
          if (rows.length) {
            items = rows;
            persistLs(); /* keep the fallback mirror warm for file:// + private mode */
          } else {
            items = loadLs();
            for (const it of items) {
              try { await idbPut(db, it); } catch (_e) { /* ignore */ }
            }
          }
        } catch (_e) {
          db = null;
          items = loadLs();
        }
      } else {
        items = loadLs();
      }
      /* Rehydrate: anything mid-flight at reload returns to queued — never dropped. */
      let touched = false;
      items = items.map((it) => {
        if (it.status === 'retrying' || it.status === 'sending') {
          touched = true;
          return { ...it, status: 'queued' };
        }
        return it;
      });
      if (touched) persistLs();
      loaded = true;
      emit();
      return snapshot();
    }

    /* Enqueue is a synchronous local write: ack path stays <=100ms by design
       (no network, no IndexedDB round-trip on the ack path — IDB mirrors async). */
    function enqueue(type, label, payload, opts2) {
      const oo = opts2 || {};
      const item = {
        id: oo.id || uuid(),
        idempotencyKey: oo.idempotencyKey || uuid(),
        type,
        label,
        payload: payload || {},
        queuedAt: nowIso(now),
        status: 'queued',
        attempts: 0,
        lastError: null,
      };
      items.push(item);
      persistLs();
      if (db) idbPut(db, item).catch(() => {});
      emit();
      /* Opportunistic flush; never blocks the ack. */
      flush().catch(() => {});
      return { ...item };
    }

    async function sendOne(item) {
      item.status = item.status === 'queued' ? 'retrying' : item.status;
      emit();
      try {
        const res = await sender(item);
        if (res && res.conflict) {
          /* Conflict = server-wins, surfaced as a card. Never silent overwrite. */
          item.status = 'failed';
          item.lastError = COPY.conflictKeptServer;
          await persist(item);
          emit();
          return { id: item.id, outcome: 'conflict' };
        }
        if (res && res.ok === false) throw new Error((res && res.error) || 'Send failed');
        await remove(item.id);
        return { id: item.id, outcome: 'sent' };
      } catch (e) {
        item.attempts += 1;
        item.status = 'failed';
        item.lastError = (e && e.message) || 'Send failed';
        await persist(item);
        emit();
        const delay = backoffDelay(item.attempts - 1, { jitter: o.jitter || (() => 0) });
        if (o.autoRetry !== false && typeof setTimeout !== 'undefined' && isOnline()) {
          const snapshotId = item.id;
          setTimeout(() => {
            const cur = items.find((i) => i.id === snapshotId);
            if (cur && cur.status === 'failed') {
              cur.status = 'queued';
              emit();
              flush().catch(() => {});
            }
          }, delay);
        }
        return { id: item.id, outcome: 'error', retryInMs: delay };
      }
    }

    async function flush() {
      await boot();
      /* Collapse concurrent flushes but never drop one: a flush that lands
         while another is in flight sets the flag and the runner takes
         another pass. Without this, retryNow could lose a race with the
         enqueue-time opportunistic flush and leave work queued. */
      if (flushing) {
        flushQueued = true;
        return snapshot();
      }
      flushing = true;
      try {
        do {
          flushQueued = false;
          const pending = items.filter((i) => i.status === 'queued' || i.status === 'failed');
          for (const it of pending) {
            if (!isOnline()) break;
            const live = items.find((i) => i.id === it.id);
            if (!live) continue;
            /* eslint-disable no-await-in-loop */
            await sendOne(live);
          }
        } while (flushQueued);
      } finally {
        flushing = false;
      }
      emit();
      return snapshot();
    }

    async function retryNow() {
      items = items.map((it) => (it.status === 'failed'
        ? { ...it, status: 'queued', lastError: it.lastError }
        : it));
      persistLs();
      emit();
      return flush();
    }

    function retryItem(id) {
      const it = items.find((i) => i.id === id);
      if (!it) return Promise.resolve(snapshot());
      it.status = 'queued';
      emit();
      return flush();
    }

    function onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    }

    function pendingCount() {
      return items.filter((i) => i.status !== 'sent').length;
    }

    return {
      boot, enqueue, flush, retryNow, retryItem, onChange, snapshot, pendingCount,
      _remove: remove,
    };
  }

  /* --------------------------------------------------------------- online? */
  function isOnline() {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
        return navigator.onLine;
      }
    } catch (_e) { /* fall through */ }
    return true;
  }

  /* ---------------------------------------------------------- offline UI */
  function bindOfflineBanner(bannerEl, opts) {
    if (!bannerEl) return () => {};
    const o = opts || {};
    const onlineText = o.onlineText || null;
    const update = () => {
      const online = typeof o.isOnline === 'function' ? o.isOnline() : isOnline();
      bannerEl.hidden = online;
      if (!online) bannerEl.setAttribute('role', 'status');
    };
    update();
    let detach = () => {};
    try {
      if (typeof window !== 'undefined' && window.addEventListener) {
        const on = () => update();
        window.addEventListener('online', on);
        window.addEventListener('offline', on);
        detach = () => {
          window.removeEventListener('online', on);
          window.removeEventListener('offline', on);
        };
      }
    } catch (_e) { /* non-DOM context */ }
    if (onlineText && typeof o.onOnline === 'function') {
      try {
        if (typeof window !== 'undefined' && window.addEventListener) {
          window.addEventListener('online', () => o.onOnline());
        }
      } catch (_e) { /* ignore */ }
    }
    update._detach = detach;
    return detach;
  }

  function statusChip(status) {
    if (status === 'failed') return '<span class="afc-badge afc-badge--danger">Failed</span>';
    if (status === 'retrying') return '<span class="afc-badge afc-badge--info">Retrying</span>';
    if (status === 'sent') return '<span class="afc-badge afc-badge--success">Sent</span>';
    return '<span class="afc-badge afc-badge--warn">Queued</span>';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Queue panel renderer. Framework-free so static portal pages can use it.
     Container keeps aria-live polite; the offline banner owns role="status". */
  function renderQueuePanel(container, outbox, opts) {
    if (!container || !outbox) return;
    const o = opts || {};
    const snap = outbox.snapshot();
    const pending = snap.length;
    const countLabel = pending === 0
      ? 'Queue is empty — everything has synced.'
      : COPY.pendingCount(pending);

    let html = '';
    html += '<div class="afc-sync-queue__head">';
    html += `<p class="afc-label afc-label--muted">Sync queue</p>`;
    html += `<p class="afc-meta"><span class="afc-num" data-queue-count>${pending}</span> · ${escapeHtml(countLabel)}</p>`;
    html += `<button type="button" class="afc-btn afc-btn--secondary afc-sync-queue__retry" data-retry-now ${pending === 0 ? 'disabled' : ''}>${escapeHtml(COPY.retryNow)}</button>`;
    html += '</div>';

    if (pending === 0) {
      html += '<p class="afc-meta afc-sync-queue__empty">Nothing waiting. New entries appear here when you work offline.</p>';
    } else {
      html += '<ul class="afc-sync-queue__list">';
      snap.forEach((it) => {
        html += '<li class="afc-card afc-sync-queue__row" data-queue-id="' + escapeHtml(it.id) + '">';
        html += '<div class="afc-sync-queue__rowmain">';
        html += `<p class="afc-sync-queue__label">${escapeHtml(it.label)}</p>`;
        html += `<p class="afc-meta">Queued <span class="afc-num">${escapeHtml(it.queuedAt)}</span> · <span class="afc-sync-queue__optimistic">${escapeHtml(COPY.queuedOptimistic)}</span></p>`;
        if (it.lastError) {
          html += `<p class="afc-field__error" role="alert">${escapeHtml(it.lastError)}</p>`;
        }
        html += '</div>';
        html += '<div class="afc-sync-queue__rowside">';
        html += statusChip(it.status);
        html += `<button type="button" class="afc-btn afc-btn--ghost afc-sync-queue__retry" data-retry-item="${escapeHtml(it.id)}">Retry</button>`;
        html += '</div>';
        html += '</li>';
      });
      html += '</ul>';
    }
    container.innerHTML = html;

    const retryNowBtn = container.querySelector('[data-retry-now]');
    if (retryNowBtn) {
      retryNowBtn.addEventListener('click', () => {
        if (typeof o.onRetryNow === 'function') o.onRetryNow();
        else outbox.retryNow().catch(() => {});
      });
    }
    container.querySelectorAll('[data-retry-item]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-retry-item');
        if (typeof o.onRetryItem === 'function') o.onRetryItem(id);
        else outbox.retryItem(id).catch(() => {});
      });
    });
  }

  function bindQueuePanel(container, outbox, opts) {
    if (!container || !outbox) return () => {};
    renderQueuePanel(container, outbox, opts);
    return outbox.onChange(() => renderQueuePanel(container, outbox, opts));
  }

  /* ---------------------------------------------------------------- drafts */
  const draftStore = {
    key: draftKey,
    save(formId, data, storage) {
      const st = storage || defaultStorage();
      try {
        st.setItem(this.key(formId), JSON.stringify({ savedAt: nowIso(), data: data || {} }));
        return true;
      } catch (_e) {
        return false;
      }
    },
    load(formId, storage) {
      const st = storage || defaultStorage();
      try {
        const raw = st.getItem(this.key(formId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        return parsed && parsed.data ? parsed.data : null;
      } catch (_e) {
        return null;
      }
    },
    clear(formId, storage) {
      const st = storage || defaultStorage();
      try { st.removeItem(this.key(formId)); } catch (_e) { /* ignore */ }
    },
    /* 401/expiry mid-entry: autosave the full draft to the device BEFORE any
       redirect. Drafts never leave the device except as the user's own submit. */
    handleExpiredSession(formId, data, storage) {
      this.save(formId, data, storage);
      return { redirectTo: 'login', draftSaved: true };
    },
  };

  function restoreDraftIntoForm(form, data) {
    if (!form || !data) return 0;
    let restored = 0;
    Object.keys(data).forEach((name) => {
      const field = form.elements ? form.elements.namedItem(name) : form.querySelector(`[name="${name}"]`);
      if (!field) return;
      const value = data[name];
      if (field instanceof Object && 'type' in field && (field.type === 'checkbox' || field.type === 'radio')) {
        field.checked = Boolean(value);
      } else if (field && typeof field.value !== 'undefined') {
        field.value = value == null ? '' : String(value);
      }
      restored += 1;
    });
    return restored;
  }

  function collectForm(form) {
    const data = {};
    if (!form) return data;
    const els = form.elements ? Array.from(form.elements) : [];
    els.forEach((el) => {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox' || el.type === 'radio') data[el.name] = el.checked;
      else data[el.name] = el.value;
    });
    return data;
  }

  /* ------------------------------------------------------------------ API */
  return {
    COPY,
    OUTBOX_LS_KEY,
    draftKey,
    uuid,
    backoffDelay,
    shouldShowProgress,
    formatStep,
    memoryStorage,
    defaultStorage,
    isOnline,
    createOutbox,
    bindOfflineBanner,
    renderQueuePanel,
    bindQueuePanel,
    statusChip,
    escapeHtml,
    drafts: draftStore,
    collectForm,
    restoreDraftIntoForm,
  };
});
