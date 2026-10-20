# Incident path — AFC-486 (Slice 5d hardening)

Owner: CTO (MediaTech). The breach register and clock live under NDPA
s.40(2); the paths below compose with docs/ndpa/breach-runbook.md and
docs/planning/data-model.md §9 (the Directus policy is the enforcement
point; these routes repeat scope in queries, never instead of it).

## Severity triage (first five minutes)

| Signal | Severity | First action |
| --- | --- | --- |
| `tick_slo` red (SLO share < 99%) | High | Check queue_depth; if the tick is stuck, pause new activations (see pause-all.md), do NOT delete held rows |
| `endpoint_health` red two polls running | High | Confirm route shape on staging; Telegram staff alert with check id + counts |
| `exclusions_audit` red (unreasoned exclusion) | Critical (control defect) | Hold the batch (do not send, do not delete); escalate to CTO same day |
| Suppression write failing (STOP not recording) | Critical (consent defect) | Fail closed: stop all sends on that channel until both INSERTs succeed (Flow step "stop") |
| Suspected breach / personal data exposure | Critical | Follow docs/ndpa/breach-runbook.md; open an incidents row (awareness clock starts there, AFC-166) |

## Roles and escalation

- Coder (this seat) builds the control and its test; Coder CANNOT approve
  a migration touching auth, permissions, or personal data — that goes to
  the CTO. There is no independent SecurityEngineer on this team (board
  declined on cost): a CTO self-review is a recorded degradation, not
  independent review. Say so in the report.
- Coder CANNOT clear the retention gate (§0.10.5: engine running in
  non-production, a real record deleted on schedule with the deletion
  logged, suite green end to end). Only the CEO clears that gate.
- QA/browser verification: there is no QA seat on this team — say so
  explicitly rather than implying coverage. Contract tests + control
  suites are the verification this slice ships.

## Evidence discipline

- Every check writes `hardening_monitor_checks` (ok + detail with ids
  and counts only — never message content, contact values, rendered
  text). The Telegram alert reads the latest row per key, never the
  delivery log.
- Retention runs write `retention_runs` + `retention_run_items` (one row
  per examined clock, reason for every skip). Finished runs are immutable.
- Suppressions, dedupe decisions, and rate changes are append-only
  history: investigate from the tables, never by editing them.

## Contacts

- CTO (MediaTech): migration/security approvals, pause-all authorisation
  above branch scope.
- Area admin: cost owner (every naira), bulk-threshold approvals (>200
  recipients or the naira cap, decision C7), campaign activation.
- Branch admin: dedupe merge/keep-separate decisions, invitation limit
  approvals, own-branch pause.
