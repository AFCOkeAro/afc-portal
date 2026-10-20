# Restore drill — AFC-486 (Slice 5d hardening)

Owner: CTO (MediaTech). Cadence: quarterly, and before every production
deploy that touches the schema. No new infra: the drill runs on the
existing backup path (services/directus/backup) and the existing test
harness.

## Preconditions

- A verified backup copy exists (see services/directus/backup). The drill
  NEVER runs against the live database: restore targets a scratch database
  only.
- The down scripts refuse while their tables hold rows. A restore drill
  that "succeeds" by dropping evidence is a failure — the refusal is the
  control working.

## Steps

1. Confirm the live database is untouched: record its name and the fact
   that no connection was opened to it (`PG_URL` names a host only; the
   runner creates its own scratch database and drops it on exit — see
   scripts/lib/scratch-db.mjs).
2. Restore the backup into a scratch database (or re-apply the migration
   chain into an empty database — the runner does exactly this on every
   `pnpm test:db` run).
3. Run the control suite: `pnpm test:db`. Expected: all suites green,
   including 82_hardening (STOP suppression, cost estimate, dedupe CHECK,
   SLO predicate, guards, rerun, rollback refusal, no-PII).
4. Attempt the 0015 down script against the populated scratch database.
   Expected: `restrict_violation` — refusal while any hardening table holds
   rows. Record the refusal text.
5. Empty the four hardening tables in dependency order on the SCRATCH
   database only, re-run the down script, confirm the tables drop, then
   re-apply 0015 and confirm the suite passes again (rollback is real, not
   theoretical).

## Pass criteria

- Suite green; down-script refusal observed and logged; re-apply clean.
- Evidence appended to drill-log.md (date, actor, outputs).

## Last exercised

2026-10-20 — Coder (AFC-486). Scratch restore via `pnpm test:db`
(PGlite scratch database, created and dropped by the runner): full chain
0001→0015 applied, engine installed, all suites incl. 82_hardening green.
Down-script refusal verified by suite §82.8 (restrict_violation probed).
See drill-log.md.
