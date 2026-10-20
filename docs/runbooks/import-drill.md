# Import drill — AFC-486 (Slice 5d hardening)

Owner: area admin (imports run branch-scoped; the ledger is audit).
Covers the prior-year import path end to end (ADR-0010 decision 3):
template → validate → idempotent insert → ledger → compare.

## Preconditions

- Use the smallest defensible file: one domain, ≤10 rows, branch codes
  from the seeded hierarchy (0002: e.g. LEGUN, OKE-ARO).
- Imports are idempotent by natural key; re-import must produce zero new
  domain rows (updated/skipped, never twins). The drill asserts this.

## Steps

1. Download the template: `GET /api/imports/:domain/template` (header row
   must match the domain template exactly — a header error writes nothing).
2. POST the CSV to `/api/imports/:domain`. Record the per-row report:
   received / imported / updated / skipped / errors[] (row numbers point
   at the file the user sees).
3. Fix any error rows, re-POST the SAME file. Expected: zero new rows
   (the ledger gains a new batch; the domain tables do not gain rows).
4. Open the matching compare view (`compare_prior_year` toggle / compare
   route) and confirm the prior-year side moved by exactly the imported
   batch — the view and its CSV export stream the same query, so check
   both agree on totals.
5. Confirm the ledger: one `prior_year_imports` batch with
   `source = import`, per-row `prior_year_import_items` with natural keys,
   and NO raw PII in the items table (people items carry the SHA-256
   identity hash only — suite §81.7 / §82.9).

## Pass criteria

- Per-row error report returned; re-import yields zero new rows; compare
  view and CSV agree; ledger has batch + items with source = import.
- Evidence appended to drill-log.md.

## Last exercised

2026-10-20 — Coder (AFC-486). Route-layer half verified by
tests/web/prior-year-import.contract.mjs (templates, validation, natural
keys, idempotent upserts, compare + CSV parity, Flow wiring) and the
database half by suite 81 (idempotent re-import per domain, ledger shape,
no-PII, rollback refusal). Full `pnpm test:db` green on the drill date.
See drill-log.md.
