# ADR-0010 — Slice 5: campus care, prior-year data and hardening

**Status:** Accepted · **Date:** 2026-10-20 · **Owner:** CTO (MediaTech) · **Issue:** AFC-465
**Sources:** [prd-expansion](../planning/prd-expansion.md) §7, §9.2, §13–14 · [data-model-expansion](../planning/data-model-v4.md) · [data-model-expansion](../planning/data-model-expansion.md) §7, §13–14 · ADR-0009 (campaign-tick precedent)

## Context

Slice 5 closes the PRD: the campus-care domain (§7: institutions, students, coaching programmes/timetable/facilitators, attendance, progress, results, AFCF/AFCMF, financial support, NYSC, check-ups) plus prior-year CSV import/compare with per-domain templates, and hardening (retention/consent automation, cost reporting, dedupe, monitoring, runbooks). Nothing in this domain exists in code beyond the `campus_institutions` reference table created as a placeholder in migration `20261020_0002_hierarchy.sql` (Slice 1, "reference only; full campus care stays in Slice 5").

## Decisions

1. **Campus schema extends the placeholder, never forks it.** New migration `20261020_0003_campus.sql` ALTERs `campus_institutions` to the §7.1 field set and creates `campus_students`, `coaching_programmes`, `coaching_timetable`, `coaching_facilitators`, `coaching_students`, `coaching_class_attendance`, `coaching_progress`, `exam_results`, `coaching_resources`, `coaching_feedback`, `campus_financial_support` per data-model-expansion §7. Same contract as 0002: header comment states what/why, no CASCADE (hierarchy parents RESTRICT, person links SET NULL), denorm `branch`/`zone` Flow-maintained (§13, no opaque triggers), app role gets SELECT + INSERT/UPDATE on operational columns and NO DELETE on structure, idempotent seeds, paired down-script that refuses while rows reference. *(Architecture lens: one model, no fork; Deployment lens: rollback path ships with the migration.)*
2. **Minor safeguarding is enforced, not displayed.** Campus students who are minors inherit PRD §7.1 unchanged: guardian consent required, scores/medical/financial-support fields restricted to campus coordinator + branch admin + own student (matrix §11.1 pattern), no public exposure, adult-to-minor private messaging stays prohibited. Enforcement lives in the Directus policy + capabilities/role-matrix translation; the UI only hides. Campus go-live with minor data is gated on a recorded SecurityEngineer verdict, same gate pattern as member-OTP in ADR-0009. *(Security & least privilege lens; Risk lens: minors data is a one-way door.)*
3. **Prior-year import is validate-report-idempotent.** One CSV template per domain (attendance, blessings, people, finance — US-U2/US-X2). Server-side validation, per-row error report, idempotent natural keys (`(branch,month)`, `(branch,period)`, `(session,category,sex)`, person identity), `source = import` marking. Compare views (attendance, blessings, people, finance) are aggregate queries with a current-vs-prior toggle (US-A4), permission-scoped, CSV export streaming the same query. *(Testing lens: idempotency is a test, not a claim — re-import in CI must produce zero new rows.)*
4. **Hardening reuses the ADR-0009 runtime, adds no new service.** Retention/consent automation = Directus Flows for triggers + existing worker tick for state (never a nested-Flow state machine). Cost reporting = per-run cost on campaign/communications runs (owner: area admin). Dedupe = phone-identity warning with branch-admin merge decision (US-N1 AC4 pattern), never silent auto-merge. Monitoring = health/queue/schedule checks with Telegram staff alerts; runbook = docs + exercised restore/import drills. *(Build vs buy lens: no new service, secret, or dependency. Observability lens: logs/metrics before launch. Cost lens: every naira of SMS/provider spend has an owner.)*
5. **Sequence: schema → campus APIs/UI → import/compare → hardening.** Campus scope tests (§14: class-attendance idempotent, results/support scope-safe, NYSC transitions) land with the schema. Import/compare lands on real tables, not stubs. Runbook is exercised (restore drill + import drill), not just written. *(Delivery lens: cheapest order that keeps every step testable.)*

## Alternatives considered

- **Separate campus database/service** — rejected; youth/campus are segments of the shared church DB (prd-expansion §6.1), a second store buys sync debt for no isolation gain (isolation is policy-filter, §10).
- **Fixed headcount columns for coaching attendance** — rejected for the same reason as attendance split (§3.3): normalised rows keep new subjects/categories schema-free.
- **Client-side CSV validation only** — rejected; client checks are bypassable, the server resolver is the enforcement point (ADR-0009 consent precedent).
- **Silent auto-merge dedupe** — rejected; merging two people's sacramental/financial history without a human decision is an irreversible action.

## Consequences

- Coder tracks (delegated, AFC-465 children): (a) campus schema migration + scope tests; (b) campus APIs/UI (timetable, facilitators, attendance, progress, results, AFCF/AFCMF, support, NYSC, check-ups); (c) prior-year import/compare per domain; (d) hardening (retention/consent automation, cost reporting, dedupe, monitoring, runbook).
- SecurityEngineer verdict required before campus go-live with minor data (tracked child).
- QA browser verification of compare views, import error reporting, and runbook drills (tracked child).
- Tech-debt ledger: `exam_results.scores` JSON shape (extend deliberately, never to raw SQL — same rule as the campaign `filter` allowlist); `delivered_at` proxy assumption carries over to campus reminders until BSP confirms.
- Rollback: each migration ships its down-script; deploys stay on the existing branch/container, no new infra.

## Sign-off

- CTO: accepted (this ADR). SecurityEngineer: required before campus minor-data go-live (tracked as AFC-465 child). CEO/Board: procurement lead times unchanged (Termii/BSP/template approval, decision C7); safeguarding policy OQ-1 still gates youth/minor production data entry.
