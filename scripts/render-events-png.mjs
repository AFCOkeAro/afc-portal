#!/usr/bin/env node
/**
 * render-events-png.mjs — render the Church Portal Events hi-fi wireframes to PNG.
 *
 * The one source of truth is the tracked HTML file. This script reads
 * docs/wireframes/events-hifi-png/render-manifest.json as the checklist: every
 * entry in that manifest is rendered to exactly one file, so the number of
 * files in the tree is provable rather than asserted. The mapping from a
 * manifest entry to a filename and a clip rectangle is defined by the entry's
 * own fields, not by hand, and is written into render-report.json.
 *
 * Capture rules, one per manifest entry shape:
 *
 *   desktop + kind "device-frame"   -> .stage__canvas   at 1440 wide  -> E<n>@1440.png
 *   desktop + kind null             -> .screen__inner   at 1440 wide  -> E<n>.png
 *   mobile  + kind "device-frame"   -> Nth .phone__screen, natural w   -> E<n>@390[-N].png
 *   mobile  + kind null             -> .screen__inner   at 1440 wide  -> E<n>.png
 *
 * "N" is the manifest entry's `index` field; index 1 is the unsuffixed
 * @390.png and index N>1 is @390-N.png.
 *
 * A 1440-wide capture is centred on its target: clip.x is pushed left by
 * (1440 - target.width) / 2 so a 1320-wide section lands with 60px of document
 * either side, and the capture never runs past the right edge of the layout.
 *
 * Zero runtime dependencies. It drives a headless Chromium over the DevTools
 * protocol using Node's built-in fetch and WebSocket, so nothing has to be
 * added to package.json or pnpm-lock.yaml to reproduce the exports.
 *
 * Usage:
 *   CHROME_BIN=/path/to/chrome node scripts/render-events-png.mjs
 *
 * Exit code is non-zero when renders produced != manifest entries, so this can
 * be wired into CI as the check that the exports are complete.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HTML = process.env.EVENTS_HTML ?? path.join(REPO, 'docs/wireframes/church-portal-events-hifi.html');
const OUT_DIR = process.env.EVENTS_PNG_DIR ?? path.join(REPO, 'docs/wireframes/events-hifi-png');
const MANIFEST = process.env.EVENTS_MANIFEST ?? path.join(OUT_DIR, 'render-manifest.json');
const REPORT = process.env.EVENTS_REPORT ?? path.join(OUT_DIR, 'render-report.json');
const CHROME = process.env.CHROME_BIN;

const VIEWPORT = { width: 1440, height: 900 };
const CAPTURE_WIDTH = 1440;
/** Chromium refuses a single capture taller than this; unused at these sizes but checked. */
const MAX_CAPTURE_HEIGHT = 16384;

if (!CHROME) {
  console.error('CHROME_BIN is not set. Point it at a Chrome/Chromium binary.');
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const entries = manifest.screens ?? [];
if (entries.length === 0) {
  console.error(`No screens in ${MANIFEST}. Refusing to treat that as "0 renders needed".`);
  process.exit(2);
}

const userDataDir = fs.mkdtempSync(path.join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? '/tmp', 'events-png-'));
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
    consoleMessages.push({ type: p.type, text: (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ') });
  }
});
cdp.on('Runtime.exceptionThrown', (p) => {
  consoleMessages.push({ type: 'exception', text: p.exceptionDetails?.text ?? 'unknown' });
});

await cdp.send('Page.navigate', { url: 'file://' + HTML }, sessionId);
await loaded;

async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + JSON.stringify(r.exceptionDetails.exception ?? {}));
  return r.result.value;
}

await evaluate(`(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return document.fonts.status; })()`);

/*
 * Un-clip the device frames before measuring or capturing.
 *
 * `.stage__canvas` is 1440 CSS px wide but sits inside `.stage__scroll`, a
 * 1206px-wide `overflow-x:auto` box inside `.stage`, which is itself
 * `overflow:hidden`. Left alone, the document's layout width is only 1472px, so
 * a 1440-wide capture starting at the canvas's x runs off the end of the layout
 * and Chromium silently returns the missing columns as flat background. The
 * export then shows a screen with its right-hand side sheared off: on E1 the
 * STATUS column of the events table loses its chips. That is exactly the class
 * of defect a render is supposed to catch, so the exports are taken with the
 * scroll box opened up.
 *
 * This changes nothing inside the mockup itself — the canvas still lays out at
 * exactly 1440 — it only stops the wireframe chrome from hiding it.
 */
const captureCss = await evaluate(`(() => {
  const css = [
    '.stage__scroll{overflow:visible !important;}',
    '.stage{overflow:visible !important;}',
    '.screen__inner{overflow:visible !important;}',
  ].join('');
  const el = document.createElement('style');
  el.id = 'events-png-capture-css';
  el.textContent = css;
  document.head.appendChild(el);
  return css;
})()`);

await evaluate(`(async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return true; })()`);

/** Geometry of every capture target in the document, keyed by screen id. */
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
  for (const sec of document.querySelectorAll('section.screen')) {
    const inner = sec.querySelector(':scope > .screen__inner');
    if (!inner) continue;
    const scroller = sec.querySelector(':scope > .screen__inner > .stage > .stage__scroll');
    const canvas = sec.querySelector(':scope > .screen__inner > .stage > .stage__scroll > .stage__canvas') ?? scroller;
    out[sec.id] = {
      inner: box(inner),
      frame: canvas ? box(canvas) : null,
      phones: [...sec.querySelectorAll('.phone__screen')].map(box),
    };
  }
  return out;
})()`);

const layoutWidth = await evaluate(`document.documentElement.scrollWidth`);

/** True when the clip asks for columns the layout does not have. Chromium pads those silently. */
function clipFitsLayout(clip) {
  return clip.x + clip.width <= layoutWidth;
}

/** Manifest entry -> { file, clip, rule }. Pure function of the manifest + geometry. */
function plan(entry) {
  const g = geometry[entry.id];
  if (!g) return { file: null, clip: null, rule: null, problem: `no <section class="screen" id="${entry.id}"> in the HTML` };

  const isFrame = entry.kind === 'device-frame';
  const wantedWidth = entry.device === 'mobile' && isFrame ? null : CAPTURE_WIDTH;

  let target;
  let rule;
  let suffix;
  if (isFrame && entry.device === 'desktop') {
    if (!g.frame) return { file: null, clip: null, rule: null, problem: `${entry.id} has no .stage__canvas` };
    target = g.frame;
    rule = '.stage__canvas at 1440';
    suffix = '@1440';
  } else if (isFrame) {
    const n = entry.index ?? 1;
    target = g.phones[n - 1];
    if (!target) return { file: null, clip: null, rule: null, problem: `${entry.id} has ${g.phones.length} .phone__screen element(s); manifest asks for index ${n}` };
    rule = `.phone__screen[${n}] at its natural width`;
    suffix = n === 1 ? '@390' : `@390-${n}`;
  } else {
    target = g.inner;
    rule = '.screen__inner at 1440';
    suffix = '';
  }

  const width = wantedWidth ?? target.width;
  const clip = {
    x: Math.max(0, target.x - Math.round((width - target.width) / 2)),
    y: target.y,
    width,
    height: target.height,
  };
  return {
    file: `${entry.id}${suffix}.png`,
    clip,
    rule,
    problem: null,
  };
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const results = [];
const problems = [];
let produced = 0;
const widthsWrong = [];

for (const entry of entries) {
  const p = plan(entry);
  const record = {
    id: entry.id,
    device: entry.device,
    kind: entry.kind ?? null,
    index: entry.index ?? null,
    manifest_rendered_width: entry.rendered_width,
    manifest_rendered_height: entry.rendered_height,
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
  if (!clipFitsLayout(p.clip)) {
    record.rendered = false;
    record.reason = `clip needs columns ${p.clip.x}..${p.clip.x + p.clip.width} but the layout is only ${layoutWidth}px wide; the capture would be silently padded`;
    results.push(record);
    problems.push({ entry, p });
    continue;
  }

  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { ...p.clip, scale: 1 },
  }, sessionId);
  const bytes = Buffer.from(data, 'base64');
  fs.writeFileSync(path.join(OUT_DIR, p.file), bytes);

  // PNG IHDR is the first 24 bytes: 8-byte signature, then width and height.
  const pngWidth = bytes.readUInt32BE(16);
  const pngHeight = bytes.readUInt32BE(20);

  record.rendered = true;
  record.clip = p.clip;
  record.png_width = pngWidth;
  record.png_height = pngHeight;
  record.bytes = bytes.length;
  record.height_delta_vs_manifest = pngHeight - entry.rendered_height;
  record.width_matches_manifest = pngWidth === entry.rendered_width;
  if (!record.width_matches_manifest) widthsWrong.push(p.file);
  produced += 1;
  results.push(record);
  process.stdout.write(`  ${p.file.padEnd(16)} ${pngWidth}x${pngHeight}  ${String(bytes.length).padStart(8)} B\n`);
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
  capture_css: captureCss,
  chrome: CHROME,
  generated_by: 'scripts/render-events-png.mjs',
  regenerable: true,
  manifest_entries: entries.length,
  renders_produced: produced,
  not_rendered: entries.length - produced,
  width_mismatch: widthsWrong,
  console: consoleMessages,
  font_status: 'loaded',
  results,
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');

console.log('');
console.log(`manifest entries : ${entries.length}`);
console.log(`renders produced : ${produced}`);
console.log(`not rendered     : ${entries.length - produced}`);
console.log(`width mismatches : ${widthsWrong.length === 0 ? 'none' : widthsWrong.join(', ')}`);
console.log(`report           : ${path.relative(REPO, REPORT)}`);

for (const { entry, p } of problems) {
  console.error(`NOT RENDERED ${entry.id} (${entry.device}, kind=${entry.kind ?? 'null'}, index=${entry.index ?? '-'}): ${p.problem}`);
}

process.exit(produced === entries.length && widthsWrong.length === 0 ? 0 : 1);
