# Drill log — AFC-486 (Slice 5d hardening)

Append-only evidence that the runbook drills were exercised. Each entry
names the date, the actor, what ran, and the observed output. Entries
distinguish what was verified in the authoring environment from what
must still run in the DB/CI harness — a drill that cannot show its
output is a drill that has not happened.

## 2026-10-20 — Coder (AFC-486): route-layer drills (verified here)

- `node --test tests/web/hardening.contract.mjs` — STOP parsing
  (STOP vs STOP ALL), hash-only identity, cost estimate + rate-card
  ownership, dedupe warning/decision rules, tick SLO + queue triage +
  alert shape, Flow wiring (both Flows scheduled, no new service),
  migration shape (four tables, no roles, rollback refusal).
- `node --test tests/web/prior-year-import.contract.mjs` — import
  drill route half: templates, per-row validation, idempotent natural
  keys, compare + CSV parity, Flow wiring.
- `scripts/retention-literal-gate.sh` on the touched paths — clean.
- `scripts/migration-privilege-gate.sh` — migration 0015 mints no
  roles, grants no CREATEROLE/superuser (ADR-0002).

## 2026-10-20 — Coder (AFC-486): full control suite (verified here)

- `node scripts/run-db-tests.mjs` (PGlite scratch database, created
  empty and closed on exit — no live database contacted): full chain
  0001→0015 applied as directus_migrator, engine installed.
  **33 suites passed, 0 failed, 1399 assertions, 0 failing** —
  including `ok 81_prior_year_import.sql` and `ok 82_hardening.sql`.
- Restore drill database half: suite §82.7 (rerun changes nothing) +
  §82.8 (down-script refusal `restrict_violation` probed while rows
  exist) green on the scratch database; rollback is real (down script
  drops only the four tables + three predicates, refuses while
  populated — `rollback/20261020_0015_hardening.down.sql`).
- Import drill database half: suite 81 green — idempotent re-import
  per domain (re-import yields zero new rows), ledger UNIQUE-per-batch
  + RESTRICT, no-PII pin, rollback refusal.
- Pause drill database half: suite §74.4 (kill-switch: paused status /
  disabled channel excluded from the very next due-read, rows held not
  deleted) green in the same run; monitor half logged append-only by
  suite §82.6 + the `pause_drill` check in hardening_monitoring.json.

## Pending — human-in-the-loop (stated, not implied)

- QA/browser verification of compare views, import error reporting, and
  the runbook procedures: no QA seat exists on this team — stated, not
  implied (see incident-path.md).

## 2026-10-20 — Coder (AFC-486): pause-all walkthrough (procedure only)

- Read-through of docs/runbooks/pause-all.md against the shipped
  routes: pause = `campaigns.status = paused` + optional
  `communication_channels.enabled = false`; confirm on next tick via
  `campaign_due_enrollments(now())` + `GET /api/hardening/status`
  (queue_depth draining); resume from `next_step_at` with send-key
  UNIQUE (no double-send). Live-fire pause on a real campaign was NOT
  performed — it needs a non-production environment with staff present.
