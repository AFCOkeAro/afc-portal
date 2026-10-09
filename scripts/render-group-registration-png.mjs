#!/usr/bin/env node
/*
 * Render docs/wireframes/church-portal-group-registration.html to PNGs (AFC-317).
 *
 * Drives Chromium over the DevTools protocol using Node's built-in fetch and
 * WebSocket, so nothing changes in package.json. Same shape and discipline as
 * scripts/render-checkin-badge-kiosk-png.mjs and scripts/render-events-png.mjs:
 * a manifest is the checklist, and the script exits non-zero unless renders
 * produced equals manifest entries and every rendered width matches the manifest.
 *
 * All frames in this set are full-width staff surfaces captured as whole
 * sections at 1440 — the group-registration flow is a desk admin task.
 *
 *   GROUP_HTML=... GROUP_PNG_DIR=... node scripts/render-group-registration-png.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HTML =
  process.env.GROUP_HTML ?? path.join(REPO, 'docs/wireframes/church-portal-group-registration.html');
const OUT_DIR =
  process.env.GROUP_PNG_DIR ?? path.join(REPO, 'docs/wireframes/group-registration-png');
const MANIFEST = path.join(OUT_DIR, 'render-manifest.json');
const REPORT = path.join(OUT_DIR, 'render-report.json');
const CHROME = process.env.CHROME_BIN;

const VIEWPORT = { width: 1440, height: 900 };
const CAPTURE_WIDTH = 1440;
const MAX_CAPTURE_HEIGHT = 16384;

if (!CHROME) {
  console.error('CHROME_BIN is not set. Point it at a Chrome/Chromium binary.');
  process.exit(2);
}

if (!fs.existsSync(MANIFEST)) {
  console.error(`No manifest at ${MANIFEST}. Refusing to treat that as "0 renders needed".`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const entries = manifest.screens ?? [];
if (entries.length === 0) {
  console.error(`No screens in ${MANIFEST}. Refusing to treat that as "0 renders needed".`);
  process.exit(2);
}

const userDataDir = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? os.tmpdir(), 'groupreg-png-'));
const port = 9222 + (process.pid % 900);

const child = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

let stderr = '';
child.stderr.on('data', (b) => {
  stderr += b.toString();
});

function cleanup() {
  try {
    child.kill('SIGKILL');
  } catch {}
  try {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

async function waitForDevTools() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return (await res.json()).webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Chromium did not expose a DevTools endpoint on port ${port}.\n${stderr.slice(-2000)}`);
}

class Cdp {
  #ws;
  #next = 1;
  #pending = new Map();
  #listeners = new Map();

  static async connect(url) {
    const cdp = new Cdp();
    cdp.#ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener('open', resolve, { once: true });
      cdp.#ws.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')), { once: true });
    });
    cdp.#ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = cdp.#pending.get(msg.id);
        if (!p) return;
        cdp.#pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? null)})`));
        else p.resolve(msg.result);
        return;
      }
      for (const fn of cdp.#listeners.get(msg.method) ?? []) fn(msg.params);
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = this.#next++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify(payload));
    });
  }

  on(method, fn) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(fn);
  }

  close() {
    this.#ws.close();
  }
}

const wsUrl = await waitForDevTools();
const cdp = await Cdp.connect(wsUrl);

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  deviceScaleFactor: 1,
  mobile: false,
}, sessionId);

const loaded = new Promise((resolve) => cdp.on('Page.loadEventFired', () => resolve()));
const consoleMessages = [];
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error' || p.type === 'warning') {
    consoleMessages.push({
      type: p.type,
      text: (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '),
    });
  }
});
cdp.on('Runtime.exceptionThrown', (p) => {
  consoleMessages.push({ type: 'exception', text: p.exceptionDetails?.text ?? 'unknown' });
});

await cdp.send('Page.navigate', { url: 'file://' + HTML }, sessionId);
await loaded;

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception ?? {}));
  }
  return r.result.value;
}

const fontStatus = await evaluate(
  `(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return document.fonts.status; })()`,
);

const layoutWidth = await evaluate(`document.documentElement.scrollWidth`);

/** Geometry of every capture target, keyed by frame id. */
const geometry = await evaluate(`(() => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };
  const out = {};
  for (const fig of document.querySelectorAll('figure.frame')) {
    if (!fig.id) continue;
    out[fig.id] = { section: box(fig) };
  }
  return out;
})()`);

function plan(entry) {
  const g = geometry[entry.id];
  if (!g) return { file: null, clip: null, rule: null, problem: `no capture target for "${entry.id}"` };

  const target = g.section;
  const width = CAPTURE_WIDTH;
  const rule = `figure.frame at ${CAPTURE_WIDTH}`;

  const clip = {
    x: Math.max(0, target.x - Math.round((width - target.width) / 2)),
    y: target.y,
    width,
    height: target.height,
  };
  return { file: `${entry.id}.png`, clip, rule, problem: null };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const problems = [];
const widthsWrong = [];
let produced = 0;

for (const entry of entries) {
  const p = plan(entry);
  const record = {
    id: entry.id,
    file: p.file,
    rule: p.rule,
  };

  if (p.problem) {
    record.rendered = false;
    record.reason = p.problem;
    results.push(record);
    problems.push({ entry, p });
    continue;
  }
  if (p.clip.height > MAX_CAPTURE_HEIGHT) {
    record.rendered = false;
    record.reason = `clip height ${p.clip.height} exceeds Chromium's ${MAX_CAPTURE_HEIGHT}px single-capture limit`;
    results.push(record);
    problems.push({ entry, p });
    continue;
  }
  if (p.clip.x + p.clip.width > layoutWidth) {
    record.rendered = false;
    record.reason = `clip needs columns ${p.clip.x}..${p.clip.x + p.clip.width} but the layout is only ${layoutWidth}px wide; the capture would be silently padded`;
    results.push(record);
    problems.push({ entry, p });
    continue;
  }

  const { data } = await cdp.send(
    'Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: true, clip: { ...p.clip, scale: 1 } },
    sessionId,
  );
  const bytes = Buffer.from(data, 'base64');
  fs.writeFileSync(path.join(OUT_DIR, p.file), bytes);

  const pngWidth = bytes.readUInt32BE(16);
  const pngHeight = bytes.readUInt32BE(20);

  record.rendered = true;
  record.clip = p.clip;
  record.png_width = pngWidth;
  record.png_height = pngHeight;
  record.bytes = bytes.length;
  record.width_matches_expectation = pngWidth === p.clip.width;
  if (!record.width_matches_expectation) widthsWrong.push(p.file);
  produced += 1;
  results.push(record);
  process.stdout.write(
    `  ${p.file.padEnd(20)} ${pngWidth}x${pngHeight}  ${String(bytes.length).padStart(8)} B\n`,
  );
}

cdp.close();
child.kill('SIGKILL');
cleanup();

const report = {
  source_of_truth: path.relative(REPO, HTML),
  manifest: path.relative(REPO, MANIFEST),
  out_dir: path.relative(REPO, OUT_DIR),
  viewport: VIEWPORT,
  device_scale_factor: 1,
  capture_width: CAPTURE_WIDTH,
  layout_width: layoutWidth,
  chrome: CHROME,
  generated_by: 'scripts/render-group-registration-png.mjs',
  regenerable: true,
  manifest_entries: entries.length,
  renders_produced: produced,
  not_rendered: entries.length - produced,
  width_mismatch: widthsWrong,
  console: consoleMessages,
  font_status: fontStatus,
  results,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');

console.log('');
console.log(`manifest entries : ${entries.length}`);
console.log(`renders produced : ${produced}`);
console.log(`not rendered     : ${entries.length - produced}`);
console.log(`width mismatches : ${widthsWrong.length === 0 ? 'none' : widthsWrong.join(', ')}`);
console.log(`console messages : ${consoleMessages.length === 0 ? 'none' : JSON.stringify(consoleMessages)}`);
console.log(`report           : ${path.relative(REPO, REPORT)}`);

for (const { entry, p } of problems) {
  console.error(`NOT RENDERED ${entry.id}: ${p.problem}`);
}

process.exit(produced === entries.length && widthsWrong.length === 0 && consoleMessages.length === 0 ? 0 : 1);
