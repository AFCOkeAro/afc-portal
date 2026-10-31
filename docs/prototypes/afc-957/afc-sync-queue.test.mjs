/* AFC-959 focused tests: afc-sync-queue outbox + drafts + copy + gates.
   Run: node church-portal/afc-sync-queue.test.mjs
   Zero dependencies. Synthetic seeds only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

await import('./afc-sync-queue.js');
const Q = globalThis.AfcSyncQueue;

const ROOT = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed += 1; console.log(`ok - ${name}`); })
    .catch((e) => {
      console.error(`FAIL - ${name}\n  ${e && e.stack ? e.stack : e}`);
      process.exitCode = 1;
    });
}

async function main() {
  /* 1 — backoff ladder 1s/2s/4s... capped at 60s (+ deterministic jitter 0). */
  await ok('backoff ladder + 60s cap', () => {
    const zero = { jitter: () => 0 };
    assert.equal(Q.backoffDelay(0, zero), 1000);
    assert.equal(Q.backoffDelay(1, zero), 2000);
    assert.equal(Q.backoffDelay(2, zero), 4000);
    assert.equal(Q.backoffDelay(3, zero), 8000);
    assert.equal(Q.backoffDelay(10, zero), 60000);
    assert.equal(Q.backoffDelay(20, zero), 60000);
    const withJitter = Q.backoffDelay(1, { jitter: () => 250 });
    assert.ok(withJitter >= 2000 && withJitter <= 2500, `jitter band, got ${withJitter}`);
  });

  /* 2 — enqueue ack is a synchronous local write (<=100ms by construction). */
  await ok('enqueue ack is local + UUID + idempotency key', () => {
    const store = Q.memoryStorage();
    const box = Q.createOutbox({ storage: store, autoRetry: false, sender: () => Promise.resolve({ ok: true }) });
    const t0 = Date.now();
    const item = box.enqueue('attendance', 'Attendance — 12 Oct, 42 present', { present: 42 });
    const ackMs = Date.now() - t0;
    assert.ok(ackMs <= 100, `ack took ${ackMs}ms`);
    assert.match(item.id, /^[0-9a-f-]{36}$/);
    assert.match(item.idempotencyKey, /^[0-9a-f-]{36}$/);
    assert.equal(item.status, 'queued');
    assert.ok(item.queuedAt);
  });

  /* 3 — offline keeps work queued; optimistic copy is exact. */
  await ok('offline failure stays queued with per-item error', async () => {
    const store = Q.memoryStorage();
    const box = Q.createOutbox({
      storage: store, autoRetry: false,
      sender: () => Promise.reject(new Error('Network unavailable — kept on this device.')),
    });
    await box.boot();
    box.enqueue('attendance', 'Attendance — 12 Oct, 42 present', { present: 42 });
    await box.flush();
    const snap = box.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].status, 'failed');
    assert.ok(snap[0].lastError);
    assert.equal(box.pendingCount(), 1);
    assert.equal(Q.COPY.queuedOptimistic, 'Saved on device • will sync');
  });

  /* 4 — reload rehydrates: no silent drop; mid-flight normalises to queued. */
  await ok('boot rehydrates across reload, no silent drop', async () => {
    const store = Q.memoryStorage();
    const a = Q.createOutbox({ storage: store, autoRetry: false, sender: () => Promise.resolve({ ok: true }) });
    await a.boot();
    a.enqueue('welfare-visit', 'Welfare visit — Household A', { household: 'A' });
    const b = Q.createOutbox({ storage: store, autoRetry: false, sender: () => Promise.resolve({ ok: true }) });
    const snap = await b.boot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].label, 'Welfare visit — Household A');
    assert.ok(['queued', 'failed'].includes(snap[0].status));
  });

  /* 5 — conflict = server-wins surfaced, never silent overwrite. */
  await ok('conflict surfaces server-wins card', async () => {
    const store = Q.memoryStorage();
    const box = Q.createOutbox({ storage: store, autoRetry: false, sender: () => Promise.resolve({ conflict: true }) });
    await box.boot();
    box.enqueue('attendance', 'Attendance — 12 Oct, 42 present', {});
    await box.flush();
    const snap = box.snapshot();
    assert.equal(snap.length, 1, 'conflicted item stays visible as a card');
    assert.equal(snap[0].status, 'failed');
    assert.equal(snap[0].lastError, Q.COPY.conflictKeptServer);
  });

  /* 6 — Retry-now drains the queue when back online. */
  await ok('retryNow drains failed items when online', async () => {
    const store = Q.memoryStorage();
    let online = false;
    const box = Q.createOutbox({
      storage: store, autoRetry: false,
      sender: () => (online ? Promise.resolve({ ok: true }) : Promise.reject(new Error('offline'))),
    });
    await box.boot();
    box.enqueue('finance-export', 'Finance export — Sunday offerings (This week)', {});
    await box.flush();
    assert.equal(box.pendingCount(), 1);
    online = true;
    await box.retryNow();
    assert.equal(box.pendingCount(), 0, 'zero loss on reconnect');
  });

  /* 7 — drafts: device-local draft:{formId}, full restore, clear only on submit/discard. */
  await ok('draft save/load/clear + expiry autosave', () => {
    const store = Q.memoryStorage();
    assert.equal(Q.draftKey('attendance-capture'), 'draft:attendance-capture');
    const data = { service: 'sunday-1000', present: '42', note: 'Second service full' };
    assert.ok(Q.drafts.save('attendance-capture', data, store));
    assert.deepEqual(Q.drafts.load('attendance-capture', store), data);
    const redir = Q.drafts.handleExpiredSession('newcomer-intake', { name: 'Adaeze' }, store);
    assert.equal(redir.draftSaved, true);
    assert.deepEqual(Q.drafts.load('newcomer-intake', store), { name: 'Adaeze' });
    Q.drafts.clear('attendance-capture', store);
    assert.equal(Q.drafts.load('attendance-capture', store), null);
  });

  /* 8 — normative copy kept verbatim. */
  await ok('normative copy verbatim', () => {
    assert.equal(Q.COPY.offlineBanner, 'You are offline — changes save on this device and sync when reconnected.');
    assert.equal(Q.COPY.sessionEndedTitle, 'Session ended — your work is saved on this device.');
    assert.equal(Q.COPY.sessionEndedCta, 'Log in again');
    assert.equal(Q.COPY.resumeTitle, 'Resume where you left off');
    assert.equal(Q.COPY.draftRestoredToast, 'Draft restored');
    assert.equal(Q.COPY.sharedDeviceNote, 'On a shared device? Discard draft after use.');
    assert.equal(Q.COPY.slowFallback, 'Still trying... Retry or continue offline');
  });

  /* 9 — progress helpers: 2s threshold + determinate step text. */
  await ok('slow-task threshold + step format', () => {
    assert.equal(Q.shouldShowProgress(1999), false);
    assert.equal(Q.shouldShowProgress(2001), true);
    assert.equal(Q.formatStep('Uploading attendance', 3, 8), 'Uploading attendance 3 of 8... 38%');
    assert.equal(Q.formatStep('Exporting offerings', 6, 6), 'Exporting offerings 6 of 6... 100%');
  });

  /* 10 — CSS gate: tokens only (no hex/rgb literals), reduced-motion present. */
  await ok('afc-sync-queue.css tokens-only + reduced-motion', () => {
    const css = fs.readFileSync(path.join(ROOT, 'afc-sync-queue.css'), 'utf8');
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'no hex literals');
    assert.ok(!/rgba?\s*\(/.test(css), 'no rgb() literals');
    assert.ok(css.includes('var(--afc-'), 'uses AFC tokens');
    assert.ok(css.includes('--afc-status-warn-bg'), 'warn tone for offline banner');
    assert.ok(css.includes('--afc-status-success-bg'), 'success tone');
    assert.ok(css.includes('--afc-bg-action'), 'action tone for progress bar');
    assert.ok(css.includes('--afc-paper-200'), 'paper-200 track/skeleton range');
    assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion rule');
    assert.ok(css.includes('--afc-control-min'), '44px target floor');
    assert.ok(css.includes('--afc-dur-feedback'), 'feedback duration token');
  });

  /* 11 — HTML gates per screen: banner copy + roles + progress + success + ledger. */
  await ok('demo screens carry required states', () => {
    const files = ['attendance-capture.html', 'finance-export.html', 'newcomer-intake.html', 'welfare-visit-notes.html', 'sync-settings.html'];
    for (const f of files) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(html.includes('You are offline — changes save on this device and sync when reconnected.'), `${f} offline copy`);
      assert.ok(html.includes('afc-tokens.css') && html.includes('afc-components.css'), `${f} links AFC system`);
      assert.ok(!/design-system\/tokens\/afc-tokens\.css/.test(html) || html.includes('../design-system/tokens/afc-tokens.css'), `${f} token path`);
    }
    const att = fs.readFileSync(path.join(ROOT, 'attendance-capture.html'), 'utf8');
    assert.ok(att.includes('role="status"'), 'attendance role=status');
    assert.ok(att.includes('aria-busy="true"'), 'attendance aria-busy');
    assert.ok(att.includes('Loading attendance...'), 'attendance loading label');
    assert.ok(att.includes('role="progressbar"'), 'attendance determinate progress');
    assert.ok(att.includes('Cancel'), 'attendance cancel');
    assert.ok(att.includes('View report'), 'attendance primary next action');
    assert.ok(att.includes('Record welfare note'), 'attendance secondary');
    assert.ok(att.includes('Session ended — your work is saved on this device.'), 'attendance expiry card');
    assert.ok(att.includes('On a shared device? Discard draft after use.'), 'attendance shared-device note');
    assert.ok(att.includes('Draft restored') || att.includes('draftRestoredToast'), 'attendance draft toast path');
    const fin = fs.readFileSync(path.join(ROOT, 'finance-export.html'), 'utf8');
    assert.ok(fin.includes('data-ledger'), 'finance durable ledger');
    assert.ok(fin.includes('afc:ledger:v1'), 'finance ledger persists');
  });

  console.log(`\n${passed} checks passed.`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
