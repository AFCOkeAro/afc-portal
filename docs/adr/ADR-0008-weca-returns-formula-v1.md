# ADR-0008 — WECA returns formula v1: compute MF + 5% funds, remit MF + intervention + Faith City

**Status:** Accepted (decision), CTO 2026-10-20. Implementation delegated ([AFC-450](/AFC/issues/AFC-450)).
**Supersedes:** nothing. **Closes the pending-formula dependency in:** `docs/planning/prd-expansion.md` §5,
`docs/planning/data-model-expansion.md` §5.2, `docs/wireframes/wireframes-expansion.md` row 11.
**Origin:** Board answer to interaction `cb89849b` on [AFC-146](/AFC/issues/AFC-146):
WECA returns formula received as a spreadsheet
(`docs.google.com/spreadsheets/d/1vE07nMhcI9FEFd9fOPbmod4YQx1y5-XK`,
Area Lagos North, monthly sheets January–September 2026).
**Affects:** `services/directus/schema/migrations/` (new finance migration + rollback),
`packages/shared` (collections, schemas), `tests/db/` (new returns test), `docs/planning/*` (pending → implemented).

---

## Decision

Per-branch monthly WECA return is computed from tithe & offering income `E` (NGN) by these rules,
stored as formula version `weca-2026-01` (rates/thresholds as JSON config, not literals in function bodies):

1. **R1 — MF band rate (Ministerial Fund contribution, auto-computed).**
   `25,000 ≤ E < 75,000` → `0.10 × E`. `E ≥ 75,000` → `0.20 × E`. `E < 25,000` → `0`
   (no MF line). The sheet writes the band ceiling as `74,999.99`; with 2dp money no value
   falls strictly between `74,999.99` and `75,000`, so `< 75,000` is exact, not a reinterpretation.
2. **R2 — Area projects 5% and savings fund 5% (auto-computed, NOT remitted).**
   `E > 0` → `0.05 × E` each. These two lines are retained at area/branch level; they never
   enter the remittance total (evidence: every monthly `TOTAL REMITTANCE DUE = MF_low +
   MF_high + intervention + Faith City`, area/savings excluded, verified all 9 months).
3. **R3 — Intervention fund and Faith City project (manual inputs, NOT auto-computed).**
   Captured per branch as entered by the treasurer; nullable, default 0 in the total.
   When present, intervention equals 10% of income in the board's data, but it is **not**
   derived: across 9 months × ~30 branches/month, only one branch row per month carries a
   nonzero intervention value. Auto-computing it for all branches would contradict the
   board's own returns. Same for Faith City (no formula cells anywhere in the workbook).
4. **R4 — Remittance total.** `total_due = mf_low_total + mf_high_total + intervention_total +
   faith_city_total`, aggregated over the return's branch lines. Area/savings excluded per R2.
5. **R5 — Versioning and status.** Formula lives in `weca_return_formulas`
   (version, effective_from, rules JSON, source note). Each return records the
   `formula_version` used. `computation_status`: `formula_pending` while no formula
   version is effective → `calculated` once computed under a version → `submitted` →
   `confirmed` (existing lifecycle, unchanged).
6. **R6 — Rounding.** Compute on exact decimals; round each output line to 2dp (kobo),
   half-up. Stored sheet values show ±₦0.01 display rounding only; no rule violation found.
7. **R7 — Scope boundary.** Finance track only. No youth/camp data is modelled, stored, or
   touched by this change (board retention gate unchanged).

## Context

The sheet was ingested via public `export?format=xlsx` and parsed at the XML level
(formula cells `<f>` vs typed values `<v>`), not from display text. Findings:

- Live formula cells confirm the MF band logic verbatim:
  `IF(AND(E>=25000,E<=74999.99),E*0.1,"")`, `IF(E>=75000,E*0.2,"")`,
  `IF(E>0,E*0.05,"")` (area/savings), and one intervention instance `IF(E>0,E*0.1,"")`.
- Every data row in all 9 sheets satisfies R1+R2 (sole deviations: sub-kobo stored-value
  rounding, e.g. January ITOKI `I=39791.7425` vs exact `39791.74`).
- Every monthly summary satisfies R4 to the kobo
  (e.g. January `26,205.00 + 2,511,234.73 + 8,245.00 + 5,091,800.00 = 7,637,484.73`).
- Income itself is sometimes a sum of components (March KOLAWOLE `E = 61700+27200+31100+
  10000+596060`). Capture stores the final income figure; income decomposition is out of scope.
- Attendance column is informational and plays no part in the computation.

Representative January (Lagos North) fixture rows for tests:

| Branch | E (income) | MF 10% | MF 20% | Intervention | Area 5% | Savings 5% | Faith City |
| --- | --- | --- | --- | --- | --- | --- | --- |
| OKE-ARO | 1,952,150.00 | — | 390,430.00 | — | 97,607.50 | 97,607.50 | 38,000.00 |
| LEGUN | 40,800.00 | 4,080.00 | — | — | 2,040.00 | 2,040.00 | — |
| MATOGUN | 22,700.00 | — | — | — | 1,135.00 | 1,135.00 | — |
| OLOMOWEWE | 82,450.00 | — | 16,490.00 | 8,245.00 | 4,122.50 | 4,122.50 | — |

January remittance: `26,205.00 + 2,511,234.73 + 8,245.00 + 5,091,800.00 = 7,637,484.73`.

## Alternatives considered

- **A1 — Auto-compute intervention at 10% for every branch.** Rejected (testing-strategy
  lens: a test asserting this fails against all 9 months of board data; 29/30 rows/month
  are blank). The one live intervention formula sits on a single branch row; the pattern
  is treasurer-discretionary, and guessing otherwise fabricates liability figures.
- **A2 — Fold area/savings 5% lines into the remittance total.** Rejected. The sheet's
  own summary formula `SUM(E43:E46)` = MF_low + MF_high + intervention + Faith City
  excludes them every month. Remitting them would overstate WECA dues.
- **A3 — Hard-code rates/thresholds in the computation function.** Rejected
  (architecture lens: configuration vs code separation, per the precedent in
  `20261006_0004_retention.sql` — board-ratified numbers live in versioned config rows,
  functions read them). A future board revision must be a new formula version + data row,
  not a code deploy.
- **A4 — Reproduce the workbook layout (one sheet per month, merged cells) in the app.**
  Rejected. The workbook is the board's reporting surface; the portal stores normalized
  `(branch, period)` lines and can render the summary view from them.

## Consequences

- New migration creates `branch_financial_records`, `weca_returns`, `weca_return_formulas`
  (per `data-model-expansion.md` §5, adapted to R1–R5) with matching rollback file
  (migration-rollback gate must pass). `computation_status = formula_pending` rows stay
  nullable until a formula version is effective — the dark-ship precedent from the
  retention migration applies: no plausible-looking default formula is seeded.
- Finance capture does **not** already exist in code (verified: zero `financ*`/`weca*`
  identifiers outside docs). The delegated subtask therefore builds capture + computation
  together; the "already ships" premise in AFC-450 is corrected, scope unchanged.
- Cost lens: pure arithmetic on captured rows; no new compute, API, or storage driver.
- Security lens: amounts visible per the existing §10 matrix (`branch_financial_records`
  all-amounts → branch admin own / area+ / finance lead; `weca_returns` computed →
  area+ / finance lead). No new grants, no secrets.
- Observability/deployment lens: standard migration path with rollback file; `pnpm test`
  (all gates incl. `test:db`) must pass.
- Follow-up (not this change): summary-view rendering of the monthly sheet surface from
  normalized lines; formula-version change workflow when the board revises rates.

**Signed off:** CTO (MediaTech) 2026-10-20. Board formula source: interaction `cb89849b`
answer (human-only resolver, server-verified). Coder implements; QA validates user-facing
surfaces only if wireframe/screen changes are included (none expected).
