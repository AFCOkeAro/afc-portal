#!/usr/bin/env node
/**
 * AFC-312 credential-surface scanner.
 *
 * Rebuilt on AFC-429 from the AFC-312 acceptance criteria, the AFC-312 Done
 * comment (AC1-AC6 evidence), and the AFC-319 independent-review verdict,
 * after the original script was found to exist nowhere (not in this worktree,
 * not on origin/main, not in git history or dangling objects).
 *
 * What it does
 * ------------
 * Scans the Paperclip-side surfaces named in docs/security/credential-
 * inventory.md section 2.2 trigger 1 for credential material, using two
 * detectors:
 *
 *   1. Assignment-shape detection (high recall, measured false positives).
 *      Catches `NAME=value` / `export NAME=value` / `name: value` shapes
 *      where the name carries a credential keyword (PASSWORD, SECRET, TOKEN,
 *      or KEY as a delimiter-bound segment) or the right-hand side looks
 *      like generated secret material. Reports the candidate NAME only --
 *      never the matched text, never the value.
 *   2. Exact known-value detection (high precision, catches opaque values).
 *      Catches values whose shape gives nothing away (no keyword, no `=`,
 *      uniform character class) by exact substring match against values
 *      held in memory only: the scanning identity's Paperclip secret grants,
 *      an operator-supplied --known-values-file, and the synthetic demo
 *      canary (see below). Reports surface, record, line, column only.
 *
 * Hard constraint (output contract)
 * ---------------------------------
 * The scanner, its output, its exit codes, and every failure path must never
 * print, log, persist, or transmit a matched value. Findings name the
 * surface, the record/issue id, the line, the column, and the detector --
 * nothing else. Before anything is printed or written, the rendered report
 * is searched for every known value in raw and JSON-escaped form; on any hit
 * the report is suppressed and the process exits 3 with a fixed string.
 *
 * Positive controls
 * -----------------
 * Two designated comments on AFC-312 carry `<!-- afc-surface-scan:control -->`:
 * an assignment-shape fixture (fires the assignment arm) and an opaque
 * uniform-class hex value (fires the known-value arm via the demo canary).
 * A record carrying the marker classifies as `expected` but is still listed
 * with its record id. `--require-control=assignment,known-value` fails the
 * run (exit 2) unless each required arm fired on its designated record.
 *
 * The demo canary is synthetic: it authenticates nothing, is held by no
 * holder, and rotates nothing. It is built at runtime by joining short seed
 * fragments so that no full credential-shaped literal is committed to the
 * tree -- including by the self-test, which builds its own fixtures the
 * same way.
 *
 * What this script never touches
 * ------------------------------
 * The git tree. The only filesystem reads are the operator-supplied
 * --known-values-file and (in --self-test only) this script's own source
 * for the no-full-literal self-check. The only filesystem write is the
 * operator-supplied --out report path. Everything else arrives over the
 * Paperclip API.
 *
 * Exit codes
 * ----------
 *   0  completed; every required control (if any) PASSed.
 *   1  runtime failure (API unreachable, bad flags file, unwritable --out).
 *      Failure paths emit status/path only, never corpus text or values.
 *   2  usage error, a required control did not fire, or --strict-controls
 *      tripped on an expected finding outside the designated record set.
 *   3  output-contract violation: the rendered report contained a known
 *      value, so nothing was printed or written at all.
 *
 * Unexpected findings alone do NOT fail the run: they are triage material
 * for the routine owner (CTO), per the routine's step 3. A run with 32
 * unexpected findings and PASSing controls exits 0.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Section 1. Constants: markers, designated controls, surfaces, limits.
// ---------------------------------------------------------------------------

/** Marker that classifies a record's findings as `expected` (still listed). */
export const CONTROL_MARKER = '<!-- afc-surface-scan:control -->';

/** Issue carrying the two designated positive-control records. */
export const CONTROL_ISSUE_ID = 'c6b35eca-db42-463b-b065-6999096c7273';
export const CONTROL_ISSUE_IDENTIFIER = 'AFC-312';

/** Designated assignment-shape control record (comment on AFC-312). */
export const CONTROL_ASSIGNMENT_RECORD = 'af0030a3-0925-4219-ac07-5d55a85f4ee6';
/** Designated opaque known-value control record (comment on AFC-312). */
export const CONTROL_KNOWN_VALUE_RECORD = '2c2ea843-f19f-4773-bd25-17186af15eff';

/** Records on which an `expected` classification is legitimate (AFC-319 O1). */
export const DESIGNATED_CONTROL_RECORDS = new Set([
  CONTROL_ASSIGNMENT_RECORD,
  CONTROL_KNOWN_VALUE_RECORD,
]);

/** Default per-run-log scan cap, in bytes (routine passes this explicitly). */
export const DEFAULT_MAX_RUN_LOG_BYTES = 500000;
/** Known values shorter than this are ignored (they match everything). */
export const MIN_KNOWN_VALUE_LEN = 8;
/** Attachment bodies larger than this are not fetched (noted, not scanned). */
export const ATTACHMENT_MAX_BYTES = 2000000;
/** How many per-item reachability notes are printed before summarising. */
const NOTE_LIST_CAP = 35;
/** HTTP timeout per API call, in milliseconds. */
const API_TIMEOUT_MS = 30000;
/** Parallel API calls during corpus collection. */
const API_CONCURRENCY = 16;

/**
 * Scannable surfaces. Names use the historical report spelling so run
 * reports stay comparable across runs.
 */
export const SURFACES = [
  'issue',
  'comment',
  'queued_comment',
  'document',
  'document_revision',
  'annotation',
  'work_product',
  'attachment',
  'approval',
  'approval_comment',
  'skill_comment',
  'routine',
  'run_log',
];

/** Detectors a required control may name via --require-control. */
const REQUIREABLE_CONTROLS = new Set(['assignment', 'known-value']);

/** Schedule of record: the routine that runs this scanner. */
export const SCAN_ROUTINE_ID = 'abc1261f-b914-4319-ae78-f318c56704e7';
export const SCAN_ROUTINE_CRON = '0 3 * * * UTC';

// ---------------------------------------------------------------------------
// Section 2. Demo canary: synthetic opaque value, fragments joined at runtime.
// ---------------------------------------------------------------------------

/**
 * Seed fragments for the synthetic demo canary. Each fragment alone is
 * inert; joined they form the opaque uniform-class hex value posted as the
 * known-value positive control on AFC-312. The fragments are short on
 * purpose: no full credential-shaped literal may live in the tree, and a
 * tree grep for the joined value must return zero hits.
 *
 * The canary authenticates nothing, is held by no holder, and rotates
 * nothing. It exists so the exact-match arm can be SEEN firing on a real
 * record instead of being asserted to work.
 */
const DEMO_CANARY_FRAGMENTS = [
  'c4ae',
  '37c3',
  '6823',
  '1fc7',
  'ed0c',
  '09f6',
  'f0ff',
  '5da3',
];

/** Join the seed fragments into the synthetic opaque canary (memory only). */
export function demoCanary() {
  return DEMO_CANARY_FRAGMENTS.join('');
}

// ---------------------------------------------------------------------------
// Section 3. Text utilities: line maps, byte sizes, safe truncation.
// ---------------------------------------------------------------------------

/**
 * Split text into lines with 1-based line numbers and absolute offsets.
 * Offsets are UTF-16 code-unit offsets (String#indexOf semantics), matching
 * the historical report format.
 */
export function splitLines(text) {
  const lines = [];
  let offset = 0;
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    lines.push({ no: i + 1, text: parts[i], offset });
    offset += parts[i].length + 1; // +1 for the consumed newline
  }
  return lines;
}

/** Locate the 1-based line/column/offset of an absolute offset in text. */
export function locate(text, absOffset) {
  const lines = splitLines(text);
  let current = lines[0];
  for (const line of lines) {
    if (line.offset <= absOffset) current = line;
    else break;
  }
  return { line: current.no, column: absOffset - current.offset + 1, offset: absOffset };
}

/** Byte length of text (corpus accounting is in bytes, not characters). */
export function byteLen(text) {
  return Buffer.byteLength(text, 'utf8');
}

/** Megabyte rendering for the corpus table (two decimals, like prior runs). */
export function mb(bytes) {
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/**
 * Candidate names come from detector regex captures, which are already
 * restricted to identifier-ish characters. Belt and suspenders: truncate
 * absurd lengths so a pathological match can never bloat or smuggle content
 * into the report through the key field.
 */
export function reportableKey(name) {
  const s = String(name);
  return s.length > 128 ? s.slice(0, 128) : s;
}

/**
 * JSON-escaped form of a value, for the output-contract check: a report that
 * escapes a value instead of printing it raw is still a report that carries
 * the value.
 */
export function jsonEscaped(value) {
  return JSON.stringify(value).slice(1, -1);
}

// ---------------------------------------------------------------------------
// Section 4. Detector 1: assignment-shape detection (name only, never value).
// ---------------------------------------------------------------------------

/** Credential keywords: PASSWORD/PASSWD/SECRET/TOKEN anywhere in the name. */
const KEYWORD_RE = /(?:PASSWORD|PASSWD|SECRET|TOKEN)/i;
/**
 * KEY counts only as a full underscore-delimited segment (ACCESS_KEY yes,
 * KEYBOARD no, MONKEY no). Checked against the upper-cased candidate name.
 */
const KEY_SEGMENT_RE = /(^|_)(KEY|KEYS)(_|$)/;

/** Does this candidate name carry credential meaning? */
export function isKeywordName(name) {
  const upper = String(name).toUpperCase();
  return KEYWORD_RE.test(upper) || KEY_SEGMENT_RE.test(upper);
}

/**
 * Bare generic names (`key`, `token`, `secret`, ...) appear constantly in
 * code and prose that moves no secret (object keys, prior scan reports'
 * `key=NAME` echoes). A bare generic fires only when the right-hand side
 * itself looks generated; compound credential names (POSTGRES_PASSWORD,
 * YOUTUBE_CLIENT_SECRET, ...) fire on the keyword alone. Residual miss,
 * stated: a short plaintext unknown secret beside a bare generic name
 * (SECRET=hunter2) is missed by this arm -- the exact known-value arm is
 * what covers provisioned secrets.
 */
const GENERIC_SINGLETON_RE = /^(KEYS?|TOKENS?|SECRETS?|PASSWORDS?|PASSWDS?)$/i;

/**
 * Classify one (name, right-hand side) pair. Returns 'keyword-assignment',
 * 'entropy-assignment', or null (not a finding). Keyword arm first; the
 * entropy arm only classifies pairs the keyword arm declined, so each
 * (line, name) yields at most one finding.
 */
export function classifyAssignment(name, rhs) {
  if (rhs == null || String(rhs).trim() === '') return null;
  if (isKeywordName(name)) {
    if (GENERIC_SINGLETON_RE.test(String(name).trim())) {
      return looksHighEntropy(rhs) ? 'entropy-assignment' : null;
    }
    return 'keyword-assignment';
  }
  return looksHighEntropy(rhs) ? 'entropy-assignment' : null;
}

/**
 * Heuristic for "generated secret material" on the right-hand side.
 * Tuned for recall, not precision: misses are silent, false positives are
 * measured and printed on every run, never asserted away. Three gates keep
 * the obvious non-secrets out:
 *   - minimum length 20 over a token-ish alphabet (words and paths fail);
 *   - UUID-shaped tokens are identifiers, not secrets;
 *   - Shannon entropy >= 4.5 bits/char with >= 12 distinct characters
 *     (prose, repeated words, and structured IDs sit well below; random
 *     alphanumeric secret material sits at ~5 and above).
 */
export function looksHighEntropy(rhs) {
  let token = rhs.trim().replace(/^["']|["';,]+$/g, '').replace(/-->\s*$/, '');
  if (token.length < 20) return false;
  if (!/^[A-Za-z0-9_\-+/=]{20,}$/.test(token)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return false;
  const freq = new Map();
  for (const ch of token) freq.set(ch, (freq.get(ch) || 0) + 1);
  if (freq.size < 12) return false;
  let h = 0;
  for (const n of freq.values()) {
    const p = n / token.length;
    h -= p * Math.log2(p);
  }
  return h >= 4.5;
}

/**
 * Assignment shapes, in priority order:
 *   1. `export NAME=value` (shell shape)
 *   2. `NAME=value` (env/ini shape; NAME starts with letter/underscore)
 *   3. `name: value` (yaml shape; indented or quoted keys allowed)
 *
 * Classification per (line, name): keyword arm first -- a credential-named
 * left-hand side reports `keyword-assignment` -- else the entropy arm
 * reports `entropy-assignment` when the right-hand side looks generated.
 * Anything else is not a finding. At most one finding per (line, name);
 * matches whose value side is empty never fire.
 */
const EXPORT_RE = /(?:^|[;\s&|])export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\S+)/g;
const ENV_ASSIGN_RE = /(^|[\s;,&|([])([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(\S+)/g;
const YAML_ASSIGN_RE = /^\s*["']?([A-Za-z0-9_][A-Za-z0-9_.\-]{0,63}?)["']?\s*:\s*(\S+)\s*$/gm;

/**
 * Scan one text for assignment shapes. Returns findings with the candidate
 * name only ({line, column, offset, key, pattern}); the matched value is
 * classified (entropy arm) or ignored (keyword arm) and then dropped --
 * it never leaves this function.
 *
 * @param {string} text
 * @returns {Array<{line:number,column:number,offset:number,key:string,pattern:string}>}
 */
export function findAssignments(text) {
  const out = [];
  const seen = new Set();
  const emit = (absOffset, name, pattern) => {
    const key = reportableKey(name.trim());
    if (!key) return;
    const { line, column, offset } = locate(text, absOffset);
    const dedupe = `${line}:${key}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    out.push({ line, column, offset, key, pattern });
  };

  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(text)) !== null) {
    const name = m[1];
    const rhs = m[2];
    if (!rhs) continue;
    // Guard against zero-length loops on pathological input.
    if (m[0].length === 0) { EXPORT_RE.lastIndex++; continue; }
    const pattern = classifyAssignment(name, rhs);
    if (!pattern) continue;
    const nameOffset = m.index + m[0].indexOf(name);
    emit(nameOffset, name, pattern);
  }

  ENV_ASSIGN_RE.lastIndex = 0;
  while ((m = ENV_ASSIGN_RE.exec(text)) !== null) {
    const name = m[2];
    const rhs = m[3];
    if (!rhs) continue;
    if (m[0].length === 0) { ENV_ASSIGN_RE.lastIndex++; continue; }
    // Skip URL query strings (?token=...) and HTML entities: the `=` there
    // is transport, not assignment. A `?` or `&` immediately before the name
    // (past the separator capture) marks transport.
    const sepAndPre = m[1];
    const before = text.slice(Math.max(0, m.index - 1), m.index) + sepAndPre;
    if (/[?&]\s*$/.test(before)) continue;
    const nameOffset = m.index + m[0].indexOf(name, m[1].length);
    const pattern = classifyAssignment(name, rhs);
    if (pattern) emit(nameOffset, name, pattern);
  }

  YAML_ASSIGN_RE.lastIndex = 0;
  while ((m = YAML_ASSIGN_RE.exec(text)) !== null) {
    const name = m[1];
    const rhs = m[2];
    if (!rhs) continue;
    if (m[0].length === 0) { YAML_ASSIGN_RE.lastIndex++; continue; }
    if (/^https?:$/i.test(name.trim())) continue;
    const pattern = classifyAssignment(name, rhs);
    if (pattern) {
      const nameOffset = m.index + m[0].indexOf(name);
      emit(nameOffset, name, pattern);
    }
  }

  // Drop any accidental null-pattern emissions (defensive; emit guards anyway).
  return out.filter((f) => f.pattern).sort((a, b) => a.line - b.line || a.column - b.column);
}

// ---------------------------------------------------------------------------
// Section 5. Detector 2: exact known-value detection (opaque-safe).
// ---------------------------------------------------------------------------

/**
 * Scan text for exact occurrences of known values. Values shorter than
 * MIN_KNOWN_VALUE_LEN are skipped (they match everything). Returns
 * locations only -- which value matched is recorded internally as `via`
 * (a source NAME, never printed) and stripped before rendering.
 *
 * @param {string} text
 * @param {Array<{source:string, value:string}>} knownValues (memory only)
 * @returns {Array<{line:number,column:number,offset:number,via:string}>}
 */
export function findKnownValues(text, knownValues) {
  const out = [];
  for (const { source, value } of knownValues) {
    if (typeof value !== 'string' || value.length < MIN_KNOWN_VALUE_LEN) continue;
    let from = 0;
    for (;;) {
      const idx = text.indexOf(value, from);
      if (idx === -1) break;
      const { line, column, offset } = locate(text, idx);
      out.push({ line, column, offset, via: source });
      from = idx + 1; // overlapping-safe advance
      if (from >= text.length) break;
    }
  }
  return out.sort((a, b) => a.line - b.line || a.column - b.column);
}

// ---------------------------------------------------------------------------
// Section 6. API client: authenticated fetch with silent failure paths.
// ---------------------------------------------------------------------------

/**
 * Truncate error payload text to 160 chars. Error payloads come from API
 * error envelopes, not from corpus records, so a short excerpt is safe to
 * surface -- but it is still capped so a failure path can never become a
 * corpus exfiltration path.
 */
export function truncError(x) {
  const s = typeof x === 'string' ? x : safeErrorMessage(x);
  return s.length > 160 ? s.slice(0, 160) : s;
}

function safeErrorMessage(x) {
  try {
    if (x == null) return 'unknown error';
    if (typeof x === 'string') return x;
    if (x instanceof Error) return x.message;
    return JSON.stringify(x);
  } catch {
    return 'unrenderable error';
  }
}

/** Create an API client bound to a base URL and bearer token (memory only). */
export function createApi({ baseUrl, apiKey }) {
  const base = String(baseUrl).replace(/\/+$/, '');
  async function req(path, { method = 'GET' } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} for ${path}: ${truncError(text)}`);
        err.status = res.status;
        err.path = path;
        throw err;
      }
      try {
        return JSON.parse(text);
      } catch {
        const err = new Error(`non-JSON response for ${path}`);
        err.status = res.status;
        err.path = path;
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { req };
}

/**
 * Normalise list endpoints that return either a bare array or an envelope
 * ({comments, entries, data, items, ...}). Unknown shapes yield [] rather
 * than a crash: a surface that cannot be listed is noted, not fatal, except
 * for the issue list itself.
 */
export function asList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const k of ['comments', 'entries', 'data', 'items', 'results', 'runs', 'revisions', 'annotations', 'threads']) {
      if (Array.isArray(payload[k])) return payload[k];
    }
  }
  return [];
}

/**
 * Collect every string leaf out of an API record for scanning. This is
 * deliberately indiscriminate: scanned text lives in memory and findings
 * name locations only, so over-collection cannot leak into the report.
 * (The report's `key` field comes from detector regex captures, and the
 * `record`/`issue` fields are ids -- never scanned text.)
 */
export function collectStrings(value, depth = 0) {
  const out = [];
  if (typeof value === 'string') {
    if (value) out.push(value);
  } else if (Array.isArray(value)) {
    if (depth < 6) for (const v of value) out.push(...collectStrings(v, depth + 1));
  } else if (value && typeof value === 'object') {
    if (depth < 6) for (const v of Object.values(value)) out.push(...collectStrings(v, depth + 1));
  }
  return out;
}

/** Run async tasks with bounded parallelism, preserving order. */
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Section 7. Corpus records: one scannable text unit per record.
// ---------------------------------------------------------------------------

/**
 * A corpus record: { surface, issue, record, path, text }.
 *  - surface: one of SURFACES (historical spelling).
 *  - issue: the issue identifier (AFC-NNN) for issue-scoped surfaces, or a
 *    stable scope locator (`skill:<id>`, `routine:<id>`, `run:<id>`) for
 *    company-scoped surfaces. Always an id -- never scanned text, so it can
 *    never carry a value into the report.
 *  - record: the record id (comment id, document key, run id, ...).
 *  - path: which field of the record was scanned (body, title/description,
 *    revisions[N].body, content, ...).
 *  - text: the scannable text (memory only, never printed).
 */

/** Fetch the compact issue list (carries title+description for the issue surface). */
export async function listIssues(api) {
  const payload = await api.req(`/api/companies/${api.companyId}/issues?view=compact`);
  const issues = asList(payload);
  if (!issues.length) throw new Error('issue list is empty or unreadable');
  return issues;
}

/** Resolve --only-issue (UUID or AFC-NNN identifier) to a full issue entry. */
export function resolveOnlyIssue(issues, ref) {
  const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidish.test(ref)) {
    const hit = issues.find((i) => i && i.id === ref);
    if (!hit) throw new Error(`--only-issue: no issue with id ${ref}`);
    return hit;
  }
  const hit = issues.find(
    (i) => i && typeof i.identifier === 'string' && i.identifier.toLowerCase() === String(ref).toLowerCase(),
  );
  if (!hit) throw new Error(`--only-issue: no issue with identifier ${ref}`);
  return hit;
}

/**
 * Collect corpus records issue by issue. Every per-record fetch is
 * individually guarded: one unreadable record notes itself and the run
 * continues. Only a total issue-list failure is fatal.
 *
 * @returns {{records:Array, notes:Array<string>, counts:Object}}
 */
export async function collectIssueRecords(api, issues, surfaces) {
  const records = [];
  const notes = [];
  const counts = {};
  const want = (s) => surfaces.has(s);

  const batched = await mapPool(issues, API_CONCURRENCY, async (issue) => {
    const local = [];
    const localNotes = [];
    const identifier = issue.identifier || issue.id;
    const get = async (path) => api.req(path);

    const push = (surface, record, path, text) => {
      if (typeof text !== 'string' || !text) return;
      local.push({ surface, issue: identifier, record, path, text });
    };

    // -- issue surface: title + description as one record.
    if (want('issue')) {
      const title = typeof issue.title === 'string' ? issue.title : '';
      const desc = typeof issue.description === 'string' ? issue.description : '';
      push('issue', issue.id, 'title/description', `${title}\n${desc}`.trim());
    }

    // -- comment surface.
    if (want('comment')) {
      try {
        const comments = asList(await get(`/api/issues/${issue.id}/comments`));
        for (const c of comments) {
          if (c && typeof c.body === 'string' && c.body) push('comment', c.id || issue.id, 'body', c.body);
        }
      } catch (e) {
        localNotes.push(`comment:${identifier}: ${truncError(e.message || e)}`);
      }
    }

    // -- queued_comment surface.
    if (want('queued_comment')) {
      try {
        const q = await get(`/api/issues/${issue.id}/queued-comments`);
        for (const e of asList(q && q.entries !== undefined ? q.entries : q)) {
          const text = collectStrings(e).join('\n');
          if (text) push('queued_comment', (e && e.id) || issue.id, 'entry', text);
        }
      } catch (e) {
        localNotes.push(`queued_comment:${identifier}: ${truncError(e.message || e)}`);
      }
    }

    // -- document / document_revision / annotation surfaces.
    if (want('document') || want('document_revision') || want('annotation')) {
      try {
        const docs = asList(await get(`/api/issues/${issue.id}/documents`));
        for (const d of docs) {
          if (!d || typeof d.key !== 'string') continue;
          if (want('document') && typeof d.body === 'string' && d.body) {
            push('document', d.key, 'body', d.body);
          }
          if (want('document_revision')) {
            try {
              const revs = asList(await get(`/api/issues/${issue.id}/documents/${encodeURIComponent(d.key)}/revisions`));
              revs.forEach((r, idx) => {
                if (r && typeof r.body === 'string' && r.body) {
                  push('document_revision', d.key, `revisions[${r.revisionNumber ?? idx}].body`, r.body);
                }
              });
            } catch (e) {
              localNotes.push(`document_revision:${identifier}:${d.key}: ${truncError(e.message || e)}`);
            }
          }
          if (want('annotation')) {
            try {
              const threads = asList(await get(`/api/issues/${issue.id}/documents/${encodeURIComponent(d.key)}/annotations`));
              for (const t of threads) {
                const tid = (t && (t.threadId || t.id)) || d.key;
                const text = collectStrings(t).join('\n');
                if (text) push('annotation', String(tid), 'thread', text);
                if (t && (t.threadId || t.id)) {
                  try {
                    const tc = await get(
                      `/api/issues/${issue.id}/documents/${encodeURIComponent(d.key)}/annotations/${encodeURIComponent(t.threadId || t.id)}/comments`,
                    );
                    const ctext = asList(tc).map((c) => (c && typeof c.body === 'string' ? c.body : '')).filter(Boolean).join('\n');
                    if (ctext) push('annotation', String(tid), 'thread-comments', ctext);
                  } catch (e) {
                    localNotes.push(`annotation:${identifier}:${d.key}: ${truncError(e.message || e)}`);
                  }
                }
              }
            } catch (e) {
              localNotes.push(`annotation:${identifier}:${d.key}: ${truncError(e.message || e)}`);
            }
          }
        }
      } catch (e) {
        localNotes.push(`document:${identifier}: ${truncError(e.message || e)}`);
      }
    }

    // -- work_product surface (title + summary; attachments fetched below).
    let workProducts = [];
    if (want('work_product') || want('attachment')) {
      try {
        workProducts = asList(await get(`/api/issues/${issue.id}/work-products`));
        if (want('work_product')) {
          for (const w of workProducts) {
            if (!w) continue;
            const text = [w.title, w.summary].filter((s) => typeof s === 'string' && s).join('\n');
            if (text) push('work_product', w.id || issue.id, 'title+summary', text);
          }
        }
      } catch (e) {
        localNotes.push(`work_product:${identifier}: ${truncError(e.message || e)}`);
      }
    }

    // -- attachment surface: work-product contentPaths + issue attachments,
    //   deduped by contentPath (the same file is often reachable both ways).
    if (want('attachment')) {
      const targets = [];
      const seenPaths = new Set();
      const addTarget = (id, contentPath) => {
        if (seenPaths.has(contentPath)) return;
        seenPaths.add(contentPath);
        targets.push({ id, contentPath });
      };
      for (const w of workProducts) {
        const cp = w && w.metadata && w.metadata.contentPath;
        if (typeof cp === 'string' && cp) addTarget((w.externalId || w.id || 'work-product'), cp);
      }
      try {
        const atts = asList(await get(`/api/issues/${issue.id}/attachments`));
        for (const a of atts) {
          if (a && typeof a.contentPath === 'string' && a.contentPath) {
            addTarget(a.id, a.contentPath);
          }
        }
      } catch (e) {
        localNotes.push(`attachment:${identifier}: list: ${truncError(e.message || e)}`);
      }
      const fetched = await mapPool(targets, 4, async (t) => fetchAttachmentText(api, t.contentPath));
      fetched.forEach((r, i) => {
        if (r.ok && r.value && r.value.text) {
          push('attachment', targets[i].id, 'content', r.value.text);
          if (r.value.truncated) localNotes.push(`attachment:${targets[i].id}: truncated at ${ATTACHMENT_MAX_BYTES} bytes`);
        } else if (!r.ok) {
          localNotes.push(`attachment:${targets[i].id}: ${truncError(r.error && (r.error.message || r.error))}`);
        } else if (r.ok && r.value && r.value.skipped) {
          localNotes.push(`attachment:${targets[i].id}: skipped (${r.value.skipped})`);
        }
      });
    }

    // -- approval + approval_comment surfaces.
    if (want('approval') || want('approval_comment')) {
      try {
        const approvals = asList(await get(`/api/issues/${issue.id}/approvals`));
        for (const a of approvals) {
          if (!a) continue;
          if (want('approval')) {
            const text = collectStrings(a).join('\n');
            if (text) push('approval', a.id || issue.id, 'approval', text);
          }
          if (want('approval_comment') && (a.id || a.approvalId)) {
            const aid = a.id || a.approvalId;
            try {
              const acs = asList(await get(`/api/approvals/${aid}/comments`));
              for (const c of acs) {
                const text = c && typeof c.body === 'string' ? c.body : collectStrings(c).join('\n');
                if (text) push('approval_comment', aid, 'body', text);
              }
            } catch (e) {
              localNotes.push(`approval_comment:${identifier}:${aid}: ${truncError(e.message || e)}`);
            }
          }
        }
      } catch (e) {
        localNotes.push(`approval:${identifier}: ${truncError(e.message || e)}`);
      }
    }

    return { local, localNotes };
  });

  for (const r of batched) {
    if (!r.ok) {
      notes.push(`issue-scan: ${truncError(r.error && (r.error.message || r.error))}`);
      continue;
    }
    records.push(...r.value.local);
    notes.push(...r.value.localNotes);
  }
  for (const rec of records) counts[rec.surface] = (counts[rec.surface] || 0) + 1;
  return { records, notes, counts };
}

/** Fetch one attachment as text; binary / oversize / errors are noted, never thrown. */
export async function fetchAttachmentText(api, contentPath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${api.baseUrl}${contentPath}`, {
      headers: { Authorization: `Bearer ${api.apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return { skipped: `HTTP ${res.status}` };
    const ctype = res.headers.get('content-type') || '';
    if (ctype && !/text|json|markdown|xml|javascript/.test(ctype)) {
      return { skipped: `non-text (${ctype.slice(0, 60)})` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.includes(0)) return { skipped: 'binary (NUL byte)' };
    if (buf.length > ATTACHMENT_MAX_BYTES) {
      return { text: buf.slice(0, ATTACHMENT_MAX_BYTES).toString('utf8'), truncated: true };
    }
    return { text: buf.toString('utf8') };
  } catch (e) {
    throw new Error(`${contentPath}: ${truncError(e.message || e)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Collect skill_comment records across company skills. */
export async function collectSkillComments(api, surfaces) {
  const records = [];
  const notes = [];
  if (!surfaces.has('skill_comment')) return { records, notes };
  let skills = [];
  try {
    skills = asList(await api.req(`/api/companies/${api.companyId}/skills?limit=500`));
  } catch (e) {
    notes.push(`skill_comment: skill list: ${truncError(e.message || e)}`);
    return { records, notes };
  }
  const got = await mapPool(skills, API_CONCURRENCY, async (s) => {
    if (!s || !s.id) return [];
    const out = [];
    try {
      const cs = asList(await api.req(`/api/companies/${api.companyId}/skills/${s.id}/comments`));
      for (const c of cs) {
        const text = c && typeof c.body === 'string' ? c.body : collectStrings(c).join('\n');
        if (text) out.push({ surface: 'skill_comment', issue: `skill:${s.id}`, record: (c && c.id) || s.id, path: 'body', text });
      }
    } catch (e) {
      notes.push(`skill_comment:skill:${s.id}: ${truncError(e.message || e)}`);
    }
    return out;
  });
  for (const r of got) if (r.ok) records.push(...r.value);
  else notes.push(`skill_comment: ${truncError(r.error && (r.error.message || r.error))}`);
  return { records, notes };
}

/** Collect routine records (title + description; the scan schedule itself). */
export async function collectRoutines(api, surfaces) {
  const records = [];
  const notes = [];
  if (!surfaces.has('routine')) return { records, notes };
  try {
    const routines = asList(await api.req(`/api/companies/${api.companyId}/routines?limit=500`));
    for (const r of routines) {
      if (!r) continue;
      const text = [r.title, r.description].filter((s) => typeof s === 'string' && s).join('\n');
      if (text) records.push({ surface: 'routine', issue: `routine:${r.id}`, record: r.id, path: 'title+description', text });
    }
  } catch (e) {
    notes.push(`routine: list: ${truncError(e.message || e)}`);
  }
  return { records, notes };
}

/** Collect run_log records, newest runs first, each truncated at the cap. */
export async function collectRunLogs(api, surfaces, maxRunLogBytes) {
  const records = [];
  const notes = [];
  const stats = { runs: 0, withLog: 0, truncated: 0, truncatedIds: [] };
  if (!surfaces.has('run_log')) return { records, notes, stats };
  let runs = [];
  try {
    // The run list honours `limit` but ignores `offset`, and the server caps
    // a single response (observed: 1000). There is no cursor, so runs older
    // than the cap are unreachable through this endpoint. That is a stated
    // coverage limit, not a silent one: the count is noted below and in the
    // doc's unwatched-surface section. Dedupe defensively in case paging
    // behaviour ever changes.
    const page = asList(await api.req(`/api/companies/${api.companyId}/heartbeat-runs?limit=5000`));
    const seen = new Set();
    for (const r of page) {
      if (!r || !r.id || seen.has(r.id)) continue;
      seen.add(r.id);
      runs.push(r);
    }
    if (page.length >= 1000) {
      notes.push(`run_log: run list capped by the API at ${page.length} entries (no offset support); older runs are out of reach this run`);
    }
  } catch (e) {
    notes.push(`run_log: run list: ${truncError(e.message || e)}`);
    return { records, notes, stats };
  }
  stats.runs = runs.length;
  const got = await mapPool(runs, API_CONCURRENCY, async (r) => {
    if (!r || !r.id) return null;
    try {
      const log = await api.req(`/api/heartbeat-runs/${r.id}/log`);
      const content = typeof log === 'string' ? log : typeof log.content === 'string' ? log.content : collectStrings(log).join('\n');
      if (!content) return { empty: true };
      if (content.length > maxRunLogBytes) {
        return { text: content.slice(0, maxRunLogBytes), truncated: true, bytes: content.length };
      }
      return { text: content };
    } catch (e) {
      return { error: truncError(e.message || e) };
    }
  });
  got.forEach((r, i) => {
    const id = runs[i] && runs[i].id;
    if (!r.ok || !r.value || r.value.empty || r.value.error) return;
    stats.withLog++;
    records.push({ surface: 'run_log', issue: `run:${id}`, record: id, path: 'log', text: r.value.text });
    if (r.value.truncated) {
      stats.truncated++;
      if (stats.truncatedIds.length < NOTE_LIST_CAP) stats.truncatedIds.push(id);
    }
  });
  notes.push(`run_log: ${stats.withLog} of ${stats.runs} runs carry a log`);
  for (const id of stats.truncatedIds) notes.push(`run_log: skipped (run ${id} truncated at ${maxRunLogBytes} bytes)`);
  if (stats.truncated > stats.truncatedIds.length) notes.push(`... and ${stats.truncated - stats.truncatedIds.length} more`);
  return { records, notes, stats };
}

// ---------------------------------------------------------------------------
// Section 8. Known-value loading: secret store, file, demo canary.
// ---------------------------------------------------------------------------

/**
 * Load known values into memory. Returns { values:[{source, value}],
 * sourceNames:[...], notes:[...] }. Values are never printed, logged, or
 * persisted -- sourceNames carries names only for the report header.
 */
export async function loadKnownValues(api, { knownValuesFile, includeDemoCanary }) {
  const values = [];
  const sourceNames = [];
  const notes = [];

  // -- Paperclip secret store: values this identity is granted.
  try {
    const listed = await api.req('/api/agents/me/secrets');
    const grants = asList(listed && listed.secrets !== undefined ? listed.secrets : listed);
    for (const g of grants) {
      const key = g && (g.key || g.name || g.id);
      if (!key) continue;
      try {
        const got = await api.req(`/api/agents/me/secrets/${encodeURIComponent(key)}/value`, { method: 'POST' });
        const value =
          typeof got === 'string' ? got
          : got && typeof got.value === 'string' ? got.value
          : got && got.secret && typeof got.secret.value === 'string' ? got.secret.value
          : got && typeof got.data === 'string' ? got.data
          : null;
        if (typeof value === 'string' && value.length >= MIN_KNOWN_VALUE_LEN) {
          values.push({ source: `secret-store:${key}`, value });
          sourceNames.push(`secret-store:${key}`);
        } else {
          // Status only, never the body: a failure path must not become a tap.
          notes.push(`secret-store:${key}: unreadable or too short (status only)`);
        }
      } catch (e) {
        notes.push(`secret-store:${key}: ${truncError(e.message || e)}`);
      }
    }
    if (!grants.length) notes.push('secret-store: 0 key(s) granted to this identity');
    else notes.push(`secret-store: ${grants.length} key(s) granted to this identity; values held in memory only, never written`);
  } catch (e) {
    notes.push(`secret-store: list failed: ${truncError(e.message || e)}`);
  }

  // -- Operator-supplied known-values file: one value per line.
  if (knownValuesFile) {
    try {
      const raw = readFileSync(knownValuesFile, 'utf8');
      let n = 0;
      for (const line of raw.split('\n')) {
        const v = line.trim();
        if (!v || v.startsWith('#')) continue;
        if (v.length < MIN_KNOWN_VALUE_LEN) continue;
        values.push({ source: `known-values-file:${basename(knownValuesFile)}`, value: v });
        n++;
      }
      sourceNames.push(`known-values-file:${basename(knownValuesFile)} (${n} value(s))`);
    } catch (e) {
      throw new Error(`cannot read --known-values-file ${knownValuesFile}: ${truncError(e.message || e)}`);
    }
  }

  // -- Synthetic demo canary (proves the opaque-value arm on a real record).
  if (includeDemoCanary) {
    values.push({ source: 'demo-canary', value: demoCanary() });
    sourceNames.push('demo-canary');
  }

  return { values, sourceNames, notes };
}

// ---------------------------------------------------------------------------
// Section 9. Scanning: run detectors over records, classify, check controls.
// ---------------------------------------------------------------------------

/**
 * Scan records. Assignment detection is suppressed on run_log by default
 * (measured: ~1900 assignment-shaped hits over ~1200 runs, dominated by
 * environment metadata) and re-enabled there only with
 * --assignments-on-run-logs. Known-value exact match runs everywhere.
 */
export function scanRecords(records, knownValues, { assignmentsOnRunLogs }) {
  const expected = [];
  const unexpected = [];
  const o1Warnings = [];
  let scannedRecords = 0;
  let scannedBytes = 0;

  for (const rec of records) {
    scannedRecords++;
    scannedBytes += byteLen(rec.text);
    const runAssignment = rec.surface === 'run_log' ? !!assignmentsOnRunLogs : true;

    const hits = [];
    if (runAssignment) {
      for (const h of findAssignments(rec.text)) {
        hits.push({
          detector: 'assignment',
          surface: rec.surface,
          issue: rec.issue,
          record: rec.record,
          path: rec.path,
          line: h.line,
          column: h.column,
          offset: h.offset,
          key: h.key,
          pattern: h.pattern,
        });
      }
    }
    for (const h of findKnownValues(rec.text, knownValues)) {
      hits.push({
        detector: 'known-value',
        surface: rec.surface,
        issue: rec.issue,
        record: rec.record,
        path: rec.path,
        line: h.line,
        column: h.column,
        offset: h.offset,
        pattern: 'exact-known-value',
        via: h.via, // internal only; stripped before rendering
      });
    }

    const isControl = rec.text.includes(CONTROL_MARKER);
    for (const hit of hits) {
      if (isControl) {
        hit.control = 'expected';
        expected.push(hit);
        if (!DESIGNATED_CONTROL_RECORDS.has(String(hit.record))) {
          o1Warnings.push(hit);
        }
      } else {
        unexpected.push(hit);
      }
    }
  }

  unexpected.sort(compareFindings);
  expected.sort(compareFindings);
  return { expected, unexpected, o1Warnings, scannedRecords, scannedBytes };
}

function compareFindings(a, b) {
  return (
    String(a.surface).localeCompare(String(b.surface)) ||
    String(a.issue).localeCompare(String(b.issue)) ||
    String(a.record).localeCompare(String(b.record)) ||
    a.line - b.line ||
    a.column - b.column
  );
}

/**
 * Evaluate --require-control against the findings. Assignment PASS needs an
 * expected assignment finding on the designated assignment record;
 * known-value PASS needs an expected known-value finding on the designated
 * known-value record that arrived via the demo canary (a secret-store value
 * firing there would be a real exposure, not a control -- it would land in
 * `unexpected` anyway since that record carries no marker for secrets...
 * no: the marker classifies the RECORD, so any hit there is `expected`;
 * the via check is what keeps the control honest).
 */
export function checkControls(expected, requireControls) {
  const checks = [];
  if (requireControls.has('assignment')) {
    const pass = expected.some(
      (f) => f.detector === 'assignment' && String(f.record) === CONTROL_ASSIGNMENT_RECORD,
    );
    checks.push({ name: 'assignment', pass, detail: 'fired on the designated control record' });
  }
  if (requireControls.has('known-value')) {
    const pass = expected.some(
      (f) => f.detector === 'known-value' && String(f.record) === CONTROL_KNOWN_VALUE_RECORD && f.via === 'demo-canary',
    );
    checks.push({ name: 'known-value', pass, detail: 'fired on the designated control record' });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Section 10. Report rendering and the output-contract guard.
// ---------------------------------------------------------------------------

/** Render one finding line. Internal fields (`via`) are never rendered. */
export function renderFinding(f) {
  let s = `  - detector=${f.detector} surface=${f.surface} issue=${f.issue} record=${f.record} path=${f.path} line=${f.line} column=${f.column} offset=${f.offset}`;
  if (f.detector === 'assignment') s += ` key=${f.key} pattern=${f.pattern}`;
  else s += ` pattern=${f.pattern}`;
  if (f.control) s += ` control=${f.control}`;
  return s;
}

/**
 * Render the full report text. This is the exact string the contract guard
 * checks before anything is printed or written.
 */
export function renderReport({ started, finished, mode, sourceNames, corpus, expected, unexpected, checks, notes, o1Warnings, totalBytes }) {
  const L = [];
  L.push('AFC-312 credential-surface scan');
  L.push(`started:  ${started}`);
  L.push(`finished: ${finished}`);
  L.push(`mode:     ${mode}`);
  L.push('');
  L.push('Known-value sources (names only; values are never written anywhere):');
  if (sourceNames.length) for (const n of sourceNames) L.push(`  - ${n}`);
  else L.push('  - (none: secret store granted nothing, no file, no demo canary)');
  L.push('');
  L.push('Corpus:');
  const names = Object.keys(corpus.counts).sort();
  for (const name of names) {
    const c = corpus.counts[name];
    if (!c.records) continue;
    let extra = '';
    if (c.note) extra = `  ${c.note}`;
    L.push(`  ${name.padEnd(20)} ${String(c.records).padStart(5)} records ${mb(c.bytes).padStart(9)}${extra}`);
  }
  L.push(`  ${'TOTAL'.padEnd(20)} ${String(corpus.totalRecords).padStart(5)} records ${mb(corpus.totalBytes).padStart(9)}`);
  L.push('');
  L.push(`Findings -- designated control records (expected): ${expected.length}`);
  for (const f of expected) L.push(renderFinding(f));
  L.push(`Findings -- unexpected: ${unexpected.length}`);
  for (const f of unexpected) L.push(renderFinding(f));
  L.push('');
  L.push('Measured false-positive rate (unexpected findings / corpus records):');
  L.push(`  ${unexpected.length} unexpected over ${corpus.totalRecords} scanned records (${totalBytes} bytes)`);
  L.push('');
  L.push('Control checks (a detector that has never fired is a claim, not a control):');
  if (checks.length) {
    for (const c of checks) L.push(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name} ${c.detail}`);
  } else {
    L.push('  (no --require-control requested; firing history above)');
  }
  if (o1Warnings.length) {
    L.push('');
    L.push('Expected-but-undesignated records (AFC-319 O1: a marker beside a real paste keeps exit 0):');
    const byRecord = new Map();
    for (const f of o1Warnings) {
      const k = String(f.record);
      byRecord.set(k, (byRecord.get(k) || 0) + 1);
    }
    for (const [record, n] of [...byRecord.entries()].sort()) {
      L.push(`  WARNING  ${n} expected finding(s) on non-designated record ${record}`);
    }
    L.push('  Recommendation: fail or warn when an expected finding lands on a non-designated record id (--strict-controls fails).');
  }
  L.push('');
  L.push('Reachability / run notes:');
  if (notes.length) for (const n of notes) L.push(`  - ${n}`);
  else L.push('  - (none)');
  L.push('');
  L.push('Output contract: checked against every known value before this report was printed.');
  L.push('  A violation aborts with exit 3 and prints no report at all.');
  return L.join('\n') + '\n';
}

/**
 * Output-contract guard: search the RENDERED report for every known value,
 * raw and JSON-escaped. Returns true when clean. Any hit means the report
 * must be suppressed -- the caller exits 3 with a fixed string and prints
 * nothing else. (Values compared in memory only; the boolean result is the
 * only thing that leaves this function.)
 */
export function contractClean(rendered, knownValues) {
  for (const { value } of knownValues) {
    if (typeof value !== 'string' || !value) continue;
    if (rendered.includes(value)) return false;
    const esc = jsonEscaped(value);
    if (esc !== value && rendered.includes(esc)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Section 11. Commands: --self-test, --live-known-value-check, corpus runs.
// ---------------------------------------------------------------------------

function assertSelfTest(state, cond, label) {
  state.total++;
  if (!cond) {
    state.failures.push(label);
  } else {
    state.passed++;
  }
}

/**
 * Offline self-test: 26 assertions, no network. Fixtures are built from
 * concatenated fragments so no credential-shaped literal is committed to
 * the tree by the test itself.
 */
export async function selfTest() {
  const state = { total: 0, passed: 0, failures: [] };
  const t = (cond, label) => assertSelfTest(state, cond, label);
  // Fragments joined at runtime: the tree holds pieces, never a full value.
  const fragA = ['T3st', 'V4lu3'];
  const fragB = ['D3m0', 'Synth'];
  const valA = fragA.join('') + 'X9qZ'; // synthetic mixed-class token
  const valB = fragB.join('') + 'K7wQ';

  // 1-3: keyword arm fires on PASSWORD/SECRET/TOKEN names, name only.
  let h = findAssignments(`line one\nAFC_SURFACE_SCAN_SELFTEST_PASSWORD=${valA}\n`);
  t(h.length === 1 && h[0].key === 'AFC_SURFACE_SCAN_SELFTEST_PASSWORD' && h[0].pattern === 'keyword-assignment', 'keyword PASSWORD fires, name only');
  t(!JSON.stringify(h).includes(valA), 'keyword finding carries no value text');
  h = findAssignments(`X_TOKEN = ${valB}\n`);
  t(h.length === 1 && h[0].key === 'X_TOKEN' && h[0].pattern === 'keyword-assignment', 'keyword TOKEN with spaces fires');

  // 4: export shape.
  h = findAssignments(`export APP_SECRET=${valA}\n`);
  t(h.length === 1 && h[0].key === 'APP_SECRET' && h[0].pattern === 'keyword-assignment', 'export shape fires');

  // 5: yaml key: shape.
  h = findAssignments(`  client_secret: ${valB}\n`);
  t(h.length === 1 && h[0].key === 'client_secret' && h[0].pattern === 'keyword-assignment', 'yaml key: shape fires');

  // 6: plain prose is not an assignment.
  h = findAssignments('The password policy requires rotation every 90 days.\nNothing here is assigned.\n');
  t(h.length === 0, 'prose yields no assignment finding');

  // 7-9: known-value arm: exact, opaque-safe, length-gated.
  const canary = demoCanary();
  let k = findKnownValues(`prefix ${canary} suffix`, [{ source: 'demo-canary', value: canary }]);
  t(k.length === 1 && k[0].line === 1, 'known-value exact match on opaque hex');
  k = findKnownValues('c4ae37c368231fc7ed0c09f6f0ff5da4', [{ source: 'demo-canary', value: canary }]);
  t(k.length === 0, 'known-value does not fire on a near-miss');
  k = findKnownValues('short abcdefg here', [{ source: 't', value: 'abcdefg' }]);
  t(k.length === 0, 'known values under the length floor are ignored');

  // 10-11: CONTROL_MARKER classification.
  const scanned = scanRecords(
    [
      { surface: 'comment', issue: 'AFC-312', record: 'r1', path: 'body', text: `${CONTROL_MARKER}\nA_MARKER_PASSWORD=${valA}\n` },
      { surface: 'comment', issue: 'AFC-999', record: 'r2', path: 'body', text: `A_PLAIN_PASSWORD=${valA}\n` },
    ],
    [],
    { assignmentsOnRunLogs: false },
  );
  t(scanned.expected.length === 1 && scanned.expected[0].control === 'expected', 'marker classifies expected');
  t(scanned.unexpected.length === 1 && !('control' in scanned.unexpected[0]), 'unmarked finding stays unexpected');

  // 12-14: run_log assignment suppression default + override; known-value always.
  const logText = `PATH=/usr/bin\nMY_PASSWORD=${valA}\n`;
  let lr = scanRecords([{ surface: 'run_log', issue: 'run:x', record: 'x', path: 'log', text: logText }], [], { assignmentsOnRunLogs: false });
  t(lr.expected.length + lr.unexpected.length === 0, 'assignment suppressed on run logs by default');
  lr = scanRecords([{ surface: 'run_log', issue: 'run:x', record: 'x', path: 'log', text: logText }], [], { assignmentsOnRunLogs: true });
  t(lr.unexpected.length === 1, '--assignments-on-run-logs re-enables the arm');
  lr = scanRecords(
    [{ surface: 'run_log', issue: 'run:x', record: 'x', path: 'log', text: `log line ${canary}` }],
    [{ source: 'demo-canary', value: canary }],
    { assignmentsOnRunLogs: false },
  );
  t(lr.unexpected.length === 1 && lr.unexpected[0].detector === 'known-value', 'known-value still fires on run logs by default');

  // 15-17: output-contract guard (raw, JSON-escaped, violation path).
  const cleanReport = renderReport({
    started: 't', finished: 't', mode: 'self-test', sourceNames: ['demo-canary'],
    corpus: { counts: {}, totalRecords: 0, totalBytes: 0 },
    expected: [], unexpected: [], checks: [], notes: [], o1Warnings: [], totalBytes: 0,
  });
  t(contractClean(cleanReport, [{ source: 'demo-canary', value: canary }]), 'clean report passes the contract guard');
  t(!contractClean(`leaked ${canary} here`, [{ source: 'demo-canary', value: canary }]), 'raw value trips the guard');
  t(!contractClean(`leaked ${jsonEscaped(canary)} here`, [{ source: 'demo-canary', value: canary }]), 'escaped value trips the guard');

  // 18-19: no full literal in the tree; canary is opaque by construction.
  const selfSource = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  t(!selfSource.includes(canary), 'own source holds fragments only, never the joined canary');
  t(/^[0-9a-f]{32}$/.test(canary), 'canary is uniform-class hex with no keyword or punctuation');

  // 20-21: --require-control parsing.
  t(parseRequireControl('assignment,known-value').has('assignment'), 'require-control parses a list');
  let rejected = false;
  try { parseRequireControl('assignment,bogus'); } catch { rejected = true; }
  t(rejected, 'unknown require-control value is rejected');

  // 22-23: --surfaces parsing and the run-log byte cap default.
  t(parseSurfaces('issue,comment').size === 2 && parseSurfaces('issue,comment').has('comment'), 'surfaces parse to a set');
  t(DEFAULT_MAX_RUN_LOG_BYTES === 500000, 'default run-log cap is 500000 bytes');

  // 24: reportableKey truncates pathological names.
  t(reportableKey('K'.repeat(200)).length === 128, 'overlong candidate names truncate');

  // 25-26: location math and corpus accounting.
  const loc = locate('ab\ncdef\n', 4);
  t(loc.line === 2 && loc.column === 2 && loc.offset === 4, 'line/column/offset math');
  const acc = scanRecords([{ surface: 'issue', issue: 'AFC-1', record: 'i', path: 't', text: 'hello' }], [], { assignmentsOnRunLogs: false });
  t(acc.scannedRecords === 1 && acc.scannedBytes === 5, 'corpus counters count records and bytes');

  if (state.failures.length) {
    console.error(`credential-surface-scan self-test FAILED (${state.passed}/${state.total} assertions)`);
    for (const f of state.failures) console.error(`  - ${f}`);
    return 1;
  }
  console.log(`credential-surface-scan self-test OK (${state.total} assertions)`);
  return 0;
}

/**
 * Live known-value check: exercises the production secret path end to end
 * (list grants, fetch values, detect them in a synthetic in-memory haystack,
 * verify the rendered check report is value-free) without ever emitting a
 * value. Prints grant NAMES and counts only.
 */
export async function liveKnownValueCheck(api) {
  const started = new Date().toISOString();
  let grants = [];
  try {
    const listed = await api.req('/api/agents/me/secrets');
    grants = asList(listed && listed.secrets !== undefined ? listed.secrets : listed);
  } catch (e) {
    fail(`secret list failed: ${truncError(e.message || e)}`);
    return 1;
  }
  const names = grants.map((g) => g && (g.key || g.name || g.id)).filter(Boolean);
  const fetched = [];
  const fetchNotes = [];
  for (const key of names) {
    try {
      const got = await api.req(`/api/agents/me/secrets/${encodeURIComponent(key)}/value`, { method: 'POST' });
      const value =
        typeof got === 'string' ? got
        : got && typeof got.value === 'string' ? got.value
        : got && got.secret && typeof got.secret.value === 'string' ? got.secret.value
        : null;
      if (typeof value === 'string' && value.length >= MIN_KNOWN_VALUE_LEN) {
        fetched.push({ source: `secret-store:${key}`, value });
      } else {
        fetchNotes.push(`secret-store:${key}: unreadable or too short (status only)`);
      }
    } catch (e) {
      fetchNotes.push(`secret-store:${key}: ${truncError(e.message || e)}`);
    }
  }
  // Synthetic in-memory haystack: sentinels around each value, never printed.
  const haystack = fetched.map((f, i) => `SYNTHETIC-HAYSTACK-${i}\n${f.value}\n`).join('');
  const hits = findKnownValues(haystack, fetched);
  const allFound = fetched.every((f, i) => hits.some((h) => h.via === f.source && h.line === i * 2 + 2));
  const checkReport = [
    'credential-surface-scan live known-value check',
    `started: ${started}`,
    `grants: ${names.length}`,
    ...names.map((n) => `grant: secret-store:${n}`),
    ...fetchNotes.map((n) => `note: ${n}`),
    `detector: ${fetched.length === 0 ? 'not exercised (no values fetched)' : allFound ? 'OK' : 'FAIL'}`,
  ].join('\n') + '\n';
  if (!contractClean(checkReport, fetched)) {
    process.stderr.write('credential-surface-scan: output-contract violation; report suppressed\n');
    return 3;
  }
  process.stdout.write(checkReport);
  if (fetched.length > 0 && !allFound) {
    fail('live known-value check: detector missed a fetched value in the synthetic haystack');
    return 2;
  }
  if (fetched.length === 0) {
    console.log('note: 0 values fetched; known-value arm rests on --known-values-file and --include-demo-canary in this identity');
  }
  return 0;
}

/** Fatal-shape failure: status/path only, never corpus text, never values. */
export function fail(message) {
  process.stderr.write(`credential-surface-scan: error: ${message}\n`);
}

// ---------------------------------------------------------------------------
// Section 12. CLI parsing.
// ---------------------------------------------------------------------------

export function parseRequireControl(raw) {
  const set = new Set();
  for (const part of String(raw).split(',')) {
    const name = part.trim();
    if (!name) continue;
    if (!REQUIREABLE_CONTROLS.has(name)) {
      throw new Error(`unknown --require-control value: ${name} (want assignment and/or known-value)`);
    }
    set.add(name);
  }
  return set;
}

export function parseSurfaces(raw) {
  const set = new Set();
  for (const part of String(raw).split(',')) {
    const name = part.trim();
    if (!name) continue;
    if (!SURFACES.includes(name)) {
      throw new Error(`unknown surface: ${name} (want ${SURFACES.join(',')})`);
    }
    set.add(name);
  }
  if (!set.size) throw new Error('--surfaces selected nothing');
  return set;
}

export function parseArgs(argv) {
  const opts = {
    selfTest: false,
    liveKnownValueCheck: false,
    onlyIssue: null,
    includeDemoCanary: false,
    requireControl: new Set(),
    maxRunLogBytes: DEFAULT_MAX_RUN_LOG_BYTES,
    out: null,
    assignmentsOnRunLogs: false,
    knownValuesFile: null,
    surfaces: new Set(SURFACES),
    apiUrl: process.env.PAPERCLIP_API_URL || null,
    apiKey: process.env.PAPERCLIP_API_KEY || null,
    companyId: process.env.PAPERCLIP_COMPANY_ID || null,
    strictControls: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--self-test') opts.selfTest = true;
    else if (arg === '--live-known-value-check') opts.liveKnownValueCheck = true;
    else if (arg === '--include-demo-canary') opts.includeDemoCanary = true;
    else if (arg === '--assignments-on-run-logs') opts.assignmentsOnRunLogs = true;
    else if (arg === '--strict-controls') opts.strictControls = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('--only-issue=')) opts.onlyIssue = arg.slice('--only-issue='.length);
    else if (arg.startsWith('--require-control=')) opts.requireControl = parseRequireControl(arg.slice('--require-control='.length));
    else if (arg.startsWith('--max-run-log-bytes=')) {
      const n = Number(arg.slice('--max-run-log-bytes='.length));
      if (!Number.isInteger(n) || n < 0) throw new Error('--max-run-log-bytes wants a non-negative integer');
      opts.maxRunLogBytes = n;
    } else if (arg.startsWith('--out=')) opts.out = arg.slice('--out='.length);
    else if (arg.startsWith('--known-values-file=')) opts.knownValuesFile = arg.slice('--known-values-file='.length);
    else if (arg.startsWith('--surfaces=')) opts.surfaces = parseSurfaces(arg.slice('--surfaces='.length));
    else if (arg.startsWith('--api-url=')) opts.apiUrl = arg.slice('--api-url='.length);
    else if (arg.startsWith('--api-key=')) opts.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--company-id=')) opts.companyId = arg.slice('--company-id='.length);
    else throw new Error(`unknown argument: ${arg}`);
  }
  // Flag names only in errors (never echoed values): usage errors must not
  // become a channel for pasted values either.
  if (!opts.onlyIssue && opts.requireControl.size) {
    // require-control without a scope is allowed (full corpus proves controls too).
  }
  return opts;
}

export function usage() {
  return [
    'usage: node scripts/credential-surface-scan.mjs [options]',
    '',
    '  --self-test                  offline checks (26 assertions), no network',
    '  --live-known-value-check     exercise the secret-store path end to end',
    '  --only-issue=<id|IDENT>      scan one issue (UUID or AFC-NNN)',
    '  --include-demo-canary        add the synthetic opaque canary to known values',
    '  --require-control=<list>     assignment and/or known-value; missing arm exits 2',
    '  --max-run-log-bytes=<n>      per-run-log scan cap (default 500000)',
    '  --out=<path>                 write the report to a file as well as stdout',
    '  --assignments-on-run-logs    run the assignment arm on run logs (default: off)',
    '  --known-values-file=<path>   one known value per line (memory only)',
    '  --surfaces=<list>            comma-separated subset of:',
    `                               ${SURFACES.join(',')}`,
    '  --strict-controls            exit 2 on expected findings outside designated records',
    '  --api-url/--api-key/--company-id  override PAPERCLIP_* env',
    '',
    'exit codes: 0 ok (required controls PASS) · 1 runtime failure ·',
    '            2 usage/control failure · 3 output-contract violation (no report)',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Section 13. Corpus runs: control-proof (--only-issue) and full.
// ---------------------------------------------------------------------------

/** Attach the API base/key/company to the client object for path building. */
function bindApi(api, { apiKey, companyId, baseUrl }) {
  api.apiKey = apiKey;
  api.companyId = companyId;
  api.baseUrl = String(baseUrl).replace(/\/+$/, '');
  return api;
}

export async function runCorpus(opts) {
  const started = new Date().toISOString();
  if (!opts.apiUrl || !opts.apiKey || !opts.companyId) {
    fail('missing API configuration (need --api-url/--api-key/--company-id or PAPERCLIP_API_URL/PAPERCLIP_API_KEY/PAPERCLIP_COMPANY_ID)');
    return 1;
  }
  let api = bindApi(createApi({ baseUrl: opts.apiUrl, apiKey: opts.apiKey }), {
    apiKey: opts.apiKey,
    companyId: opts.companyId,
    baseUrl: opts.apiUrl,
  });

  // -- Known values first (memory only): secrets, file, canary.
  let known;
  try {
    known = await loadKnownValues(api, {
      knownValuesFile: opts.knownValuesFile,
      includeDemoCanary: opts.includeDemoCanary,
    });
  } catch (e) {
    fail(e.message);
    return 1;
  }

  // -- Issue scope: everything, or the one designated record holder.
  let issues;
  try {
    issues = await listIssues(api);
  } catch (e) {
    fail(`cannot list issues: ${truncError(e.message || e)}`);
    return 1;
  }
  let mode = 'full';
  if (opts.onlyIssue) {
    try {
      const one = resolveOnlyIssue(issues, opts.onlyIssue);
      issues = [one];
      mode = `only-issue=${one.identifier || one.id}`;
    } catch (e) {
      fail(e.message);
      return 1;
    }
  }

  // -- Collect records across every requested surface.
  const notes = [...known.notes];
  const perSurfaceBytes = {};
  const perSurfaceCounts = {};
  const bump = (surface, text) => {
    perSurfaceCounts[surface] = (perSurfaceCounts[surface] || 0) + 1;
    perSurfaceBytes[surface] = (perSurfaceBytes[surface] || 0) + byteLen(text);
  };

  const t0 = Date.now();
  const issuePart = await collectIssueRecords(api, issues, opts.surfaces);
  const skillPart = await collectSkillComments(api, opts.surfaces);
  const routinePart = await collectRoutines(api, opts.surfaces);
  const runPart = await collectRunLogs(api, opts.surfaces, opts.maxRunLogBytes);
  notes.push(...issuePart.notes, ...skillPart.notes, ...routinePart.notes, ...runPart.notes);

  const records = [...issuePart.records, ...skillPart.records, ...routinePart.records, ...runPart.records];
  for (const r of records) bump(r.surface, r.text);

  // -- Scan.
  const { expected, unexpected, o1Warnings, scannedRecords, scannedBytes } = scanRecords(records, known.values, {
    assignmentsOnRunLogs: opts.assignmentsOnRunLogs,
  });

  const corpus = { counts: {}, totalRecords: scannedRecords, totalBytes: scannedBytes };
  for (const name of Object.keys(perSurfaceCounts)) {
    corpus.counts[name] = { records: perSurfaceCounts[name], bytes: perSurfaceBytes[name] };
  }
  if (runPart.stats && runPart.stats.truncated) {
    corpus.counts.run_log = corpus.counts.run_log || { records: 0, bytes: 0 };
    corpus.counts.run_log.note = `${runPart.stats.truncated} truncated`;
  }

  const checks = checkControls(expected, opts.requireControl);
  const finished = new Date().toISOString();
  const rendered = renderReport({
    started,
    finished,
    mode,
    sourceNames: known.sourceNames,
    corpus,
    expected,
    unexpected,
    checks,
    notes,
    o1Warnings,
    totalBytes: scannedBytes,
  });

  // -- Output contract: the rendered report must be value-free, or nothing
  //    is printed or written at all.
  if (!contractClean(rendered, known.values)) {
    process.stderr.write('credential-surface-scan: output-contract violation; report suppressed\n');
    return 3;
  }

  if (opts.out) {
    try {
      mkdirSync(dirname(resolve(opts.out)), { recursive: true });
      writeFileSync(opts.out, rendered, 'utf8');
    } catch (e) {
      fail(`cannot write --out ${opts.out}: ${truncError(e.message || e)}`);
      return 1;
    }
  }
  process.stdout.write(rendered);
  void t0;

  const controlsFail = checks.some((c) => !c.pass);
  if (controlsFail) return 2;
  if (opts.strictControls && o1Warnings.length) {
    fail(`strict-controls: ${o1Warnings.length} expected finding(s) on non-designated record(s)`);
    return 2;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Section 14. Entry point (only when executed, never on import).
// ---------------------------------------------------------------------------

const invokedAsScript = (() => {
  try {
    return resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  (async () => {
    let opts;
    try {
      opts = parseArgs(process.argv.slice(2));
    } catch (e) {
      fail(e.message);
      process.stdout.write(`${usage()}\n`);
      process.exit(2);
    }
    if (opts.help) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (opts.selfTest) process.exit(await selfTest());
    const needApi = opts.liveKnownValueCheck || !opts.selfTest;
    let api = null;
    if (needApi) {
      if (!opts.apiUrl || !opts.apiKey || !opts.companyId) {
        fail('missing API configuration (need --api-url/--api-key/--company-id or PAPERCLIP_API_URL/PAPERCLIP_API_KEY/PAPERCLIP_COMPANY_ID)');
        process.exit(1);
      }
      api = bindApi(createApi({ baseUrl: opts.apiUrl, apiKey: opts.apiKey }), {
        apiKey: opts.apiKey,
        companyId: opts.companyId,
        baseUrl: opts.apiUrl,
      });
    }
    if (opts.liveKnownValueCheck) process.exit(await liveKnownValueCheck(api));
    process.exit(await runCorpus(opts));
  })();
}
