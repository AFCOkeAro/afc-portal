# Credential-surface scanner

**What this is.** The detector for the Paperclip-side arms of §2.2 trigger 1
in [`credential-inventory.md`](credential-inventory.md): it scans every
surface an agent can paste a credential into — comments, documents,
artefacts, approvals, run logs — for credential material, and proves each
detector by firing it on a real designated record. The git-tree arm stays
with AFC-251; this covers the arms that had nothing.

| | |
| --- | --- |
| **Built** | AFC-312 (spec), rebuilt AFC-429 after the original was lost |
| **Reviewed** | AFC-319 (SecurityEngineer, independent of the provisioning path) |
| **Owner** | CTO — accountable for rotation when a finding is a real credential |
| **Script** | `scripts/credential-surface-scan.mjs` (Node, no dependencies) |
| **Schedule** | Routine *AFC-312 credential-surface scan* (`abc1261f-b914-4319-ae78-f318c56704e7`), cron `0 3 * * *` UTC, activity-gated; plus on-demand runs |

## 1. Detectors

Two detectors, not one. The known-value arm is exact and catches opaque
values a shape can never catch; the assignment arm is high-recall with a
measured false-positive rate. Reporting only one would either miss the
threat model (opaque pastes) or claim zero false positives it cannot
support.

**Assignment-shape detection** (`findAssignments`, script :333; names:
`isKeywordName` :247, `looksHighEntropy` :292, `classifyAssignment` :270).
Three shapes, in order: `export NAME=value`, `NAME=value`, `name: value`.
Per (line, name) the keyword arm fires first — a compound credential name
(`POSTGRES_PASSWORD`, `YOUTUBE_CLIENT_SECRET`, ...) reports
`keyword-assignment` — else the entropy arm reports `entropy-assignment`
when the right-hand side looks generated (≥ 20 token-ish chars, not a UUID,
Shannon ≥ 4.5 bits/char over ≥ 12 distinct characters). At most one finding
per (line, name). The finding carries the candidate NAME only
(`reportableKey`, :220, truncates at 128 chars); the matched value is
classified and dropped inside the detector and never leaves it.

Two deliberate blind spots, stated so they read as decisions, not gaps.
Bare generic names (`key`, `token`, `secret`, ...) fire only with a
high-entropy right-hand side (`classifyAssignment`, :270-279) — otherwise
every prior scan report's own `key=NAME` echoes would bury triage. And
`SECRET=hunter2`-class short plaintext beside a bare generic is missed by
this arm; provisioned secrets are covered exactly by the second arm.

**Exact known-value detection** (`findKnownValues`, :409). Substring match
against values held in memory only: the scanning identity's Paperclip
secret grants (`loadKnownValues`, :931; list :938, fetch :944), an
operator-supplied `--known-values-file`, and the synthetic demo canary
(`demoCanary`, :169). Values shorter than 8 chars are ignored. Findings
name surface, record, line, column only (`renderFinding`, :1110); which
value matched is kept internally as a source NAME for the control check
and stripped before rendering.

## 2. Positive controls

Two designated comments on AFC-312 carry `<!-- afc-surface-scan:control -->`
(`CONTROL_MARKER`, :85):

- assignment fixture (`CONTROL_ASSIGNMENT_RECORD` = `af0030a3-…`) — fires
  the assignment arm;
- opaque uniform-class hex value (`CONTROL_KNOWN_VALUE_RECORD` =
  `2c2ea843-…`) — fires the known-value arm via the demo canary, proving
  the arm that must catch a value whose shape gives nothing away.

A record carrying the marker classifies as `expected` but is still listed
with its record id (`scanRecords`, :1005). `--require-control=assignment,
known-value` fails the run (exit 2) unless each arm fired on its
designated record (`checkControls`, :1088); the known-value check
additionally requires the hit to have arrived via the demo canary, so a
secret-store value firing there could not masquerade as the control.

Control-proof run (must exit 0, 2 expected, 0 unexpected, both PASS):

```sh
node scripts/credential-surface-scan.mjs \
  --only-issue=AFC-312 --surfaces=issue,comment,document \
  --include-demo-canary --require-control=assignment,known-value
```

The demo canary is synthetic: it authenticates nothing, is held by no
holder, and rotates nothing. It is built at runtime by joining short seed
fragments, so no full credential-shaped literal is committed to the tree —
including by `--self-test`, which builds its own fixtures the same way
and asserts the joined canary appears nowhere in the script's own source.

## 3. Reachability: every surface, the call that reads it, the line

All reads go through the Paperclip API (`createApi`, :450; 30 s timeout,
16-way fan-out via `mapPool`, :525). The only filesystem reads are the
operator-supplied `--known-values-file` (:931-990) and, in `--self-test`
only, the script's own source; the only write is `--out`. There are no
tree reads.

| Surface (report spelling) | Endpoint(s) | Script |
| --- | --- | --- |
| `issue` (title+description, one record per issue, from the compact list) | `GET /api/companies/{id}/issues?view=compact` | :563 |
| `comment` | `GET /api/issues/{id}/comments` | :618 |
| `queued_comment` | `GET /api/issues/{id}/queued-comments` | :630 |
| `document` | `GET /api/issues/{id}/documents` | :643 |
| `document_revision` | `GET …/documents/{key}/revisions` | :651 |
| `annotation` (+ thread comments) | `GET …/documents/{key}/annotations`, `GET …/annotations/{threadId}/comments` | :663, :671 |
| `work_product` (title+summary) | `GET /api/issues/{id}/work-products` | :694 |
| `attachment` (via work-product `contentPath` + issue attachments, deduped; text only, 2 MB cap, binaries noted) | `GET {contentPath}`, `GET /api/issues/{id}/attachments` | :707-744, `fetchAttachmentText` :789 |
| `approval` | `GET /api/issues/{id}/approvals` | :747 |
| `approval_comment` | `GET /api/approvals/{id}/comments` | :757 |
| `skill_comment` | `GET /api/companies/{id}/skills`, `GET …/skills/{skillId}/comments` | :821, :830 |
| `routine` (title+description) | `GET /api/companies/{id}/routines` | :851 |
| `run_log` (exact known-value match; assignment suppressed by default, `--assignments-on-run-logs` re-enables) | `GET /api/companies/{id}/heartbeat-runs`, `GET /api/heartbeat-runs/{id}/log` | :877, :895 |

Company-scoped findings (`skill_comment`, `routine`, `run_log`) put a
stable scope locator (`skill:<id>`, `routine:<id>`, `run:<id>`) in the
`issue` field — always an id, never scanned text, so a tainted title can
never ride into the report through that field.

## 4. Measured evidence (never "no false positives")

Every run prints corpus size and unexpected count; the rate is measured,
not asserted. Zero-count surfaces are omitted from the table, not claimed
clean.

- **2026-10-08 full run (prior script):** 3034 records / 175.98 MB.
  Known-value: **0** findings (clean-corpus negative control).
  Assignment: **32** unexpected over the record corpus — documentation
  showing config *shape* (infra-spec placeholder tables, a `NUXT_STUB_AUTH`
  dev stub, `YOUTUBE_*` setup templates), triage material, not silent
  passes. Run logs then: assignment suppressed by default on the measured
  1901-hits-over-1197-runs evidence, dominated by environment metadata.
- **2026-10-16 full run (rebuilt script, `--max-run-log-bytes=500000`):**
  3455 records / 130.52 MB (136859791 bytes). Known-value: **0** findings
  over the whole corpus. Assignment: **24** unexpected — same triage class
  (`YOUTUBE_*` templates, infra-spec placeholders, one `GH_TOKEN`
  candidate, one `rule_key` candidate). Expected: 1 (assignment control;
  the full run does not pass `--include-demo-canary`, so the known-value
  control is absent by construction, as in the prior full run).
  Secret store: 1 grant (`github-gh_token`), value held in memory only.
  Run logs: 948 of the newest 1000 runs carry a log, 0 truncated at the cap.
- **Control-proof runs** exit 0 with 2 expected, 0 unexpected, both control
  checks PASS, and a programmatic check that the report contains neither
  the canary nor the fixture value, raw or JSON-escaped.

## 5. What is not watched (stated, not guessed)

- **External chat messages** — not reachable by any mechanism we have. No
  provider connection exposes them to the API. Compensating control:
  §3 review question Q7 plus the NDPA breach-runbook path
  (`credential-inventory.md` §2.2).
- **Run logs older than the API's list cap.** The heartbeat-run list
  honours `limit` but ignores `offset` and caps a response (observed:
  1000), with no cursor — runs older than the cap are out of reach. The
  scanner notes the cap on every run (`collectRunLogs`, :864-891) instead
  of implying full history.
- **Non-text and oversize attachments** are skipped with a per-item note
  (content type or NUL byte; 2 MB fetch cap, `ATTACHMENT_MAX_BYTES`, :107).
  A credential inside an image or zip is not scanned by this tool.

## 6. Output contract and exit codes

Findings name surface, record/issue id, line, column, detector — and, for
the assignment arm, the candidate name. Nothing else. Before anything is
printed or written, the rendered report is searched for every known value
in raw and JSON-escaped form (`contractClean`, :1188; `jsonEscaped`,
:230); on any hit the report is suppressed and the process exits 3 with a
fixed string. Failure paths emit status/path only (`fail`, :1385;
`truncError` caps error excerpts at 160 chars, :436) — secret-fetch errors
record status, never body (:944-963).

Exit codes: **0** completed, every required control (if any) PASSed
(unexpected findings alone do not fail — they are triage for the routine
owner); **1** runtime failure; **2** usage error, a required control
missing, or `--strict-controls` tripping; **3** output-contract violation
(no report printed or written at all).

## 7. Flags

`--self-test` (offline, 26 assertions, no network) ·
`--live-known-value-check` (exercises the secret-store path end to end
against a synthetic in-memory haystack; prints grant names and counts
only) · `--only-issue=<UUID|AFC-NNN>` · `--include-demo-canary` ·
`--require-control=assignment,known-value` · `--max-run-log-bytes=<n>`
(default 500000, per run log) · `--out=<path>` · `--assignments-on-run-logs` ·
`--known-values-file=<path>` (one value per line, `#` comments skipped) ·
`--surfaces=<subset>` · `--strict-controls` ·
`--api-url/--api-key/--company-id` (override `PAPERCLIP_*` env).

Wiring: `pnpm gate:credential-surface` runs the offline self-test and is
part of `pnpm gate:self-test`; CI runs it in the gate self-test step. The
corpus scan is NOT a CI tree gate — it cannot run there (it reads the
live API with a run-scoped identity); it runs inside a Paperclip agent
run and on the routine above.

## 8. Hardening note (AFC-319 O1, owner: CTO)
Any record carrying `CONTROL_MARKER` classifies `expected`, so a marker
planted beside a real paste would keep exit 0 — the finding still prints
with its record id, so a reader sees it. The scanner warns on every
expected finding outside the two designated record ids
(`DESIGNATED_CONTROL_RECORDS`, :97; `o1Warnings`, :1054) and
`--strict-controls` turns that warning into exit 2. Recommended standing
 posture: run the scheduled scan with `--strict-controls` once the
 designated set is stable, so a novel marker placement pages instead of
 printing.

## 9. Run-log hygiene (AFC-810, owner: Coder; verification: CTO)

Echo source, stated plainly: agent tool output is captured verbatim into
`/heartbeat-runs/{id}/log`, and this scanner reads those logs with the
exact known-value detector. Any secret-bearing content present in the
agent process environment is therefore one `env` away from the corpus.
The Oct 2026 full run found exactly that: 42 known-value hits for a
single secret-store grant (a staging username, not a password or key)
across 8 run logs, with hit lines deep inside large tool-output dumps —
environment content echoed into logged output. The assignment arm's
standing measurement says the same thing in bulk (1901 hits over 1197
runs, dominated by environment metadata, which is why that arm stays off
on `run_log` by default).

The rule, for every agent run against this repo:

- Never run raw `env`, `printenv`, `export -p`, bare `set`, or
  `env | grep ...` in a tool call. The pipe prints matching VALUES, and
  the values land in the run log.
- When you need to know which variables exist, run
  `bash scripts/safe-env-names.sh` — names only, sorted, values never in
  the pipeline (`compgen -e`, no redaction step to get wrong).
- Read a single value only through its purpose-built path (e.g. the
  scanner's memory-only secret fetch), never by dumping the environment.

Residual exposure for the 8 pre-fix logs is tracked on the AFC-810 issue
thread (immutable or cleaned, with the CTO's no-rotation rationale), not
here: this document states the mechanism and the rule; the thread owns
the per-log disposition.
