# PRD Addendum — Reporting Menu (Data Views, Reports, Metrics, Attendance Analytics, Data Integrity, Interactions, Insights, Website)

**Issue:** AFC-587 · **Parent:** AFC-460 (PRD implementation) · **Ancestor:** AFC-146 (Church Portal)
**Owner:** UXDesigner · **Status:** Draft for board + CTO review · **Version:** 2026-10-21
**Planning only — no production code, no deployments, no secrets. Low-fidelity layout intent only.**

**Companion docs:** [wireframes-reporting](/AFC/issues/AFC-587#document-wireframes-reporting) (`docs/wireframes/wireframes-reporting.md` + `docs/wireframes/church-portal-reporting-wireframes.html`)
**Extends:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147), [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) (AFC-150), [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4) (AFC-151)
**Read order:** where this addendum conflicts on reporting, **this addendum wins** for the Reporting menu; everything else is unchanged and not repeated here.

> **Phase-gate note (hire gate).** The UXDesigner role is board-approved for high-fidelity design but must not produce high-fidelity design until the CEO green-lights it (design system + skills readiness). This addendum and its wireframes stay **low-fidelity planning artifacts** in the existing set style (grey blocks, no tokens, no component library, no WCAG pass). Visual design remains deferred and gated.

---

## 0. What this adds

Today reporting is **per-domain with no unified home**: attendance report + CSV (`/reports/attendance`), blessings records, newcomer funnel + follow-up status (`/reports/newcomers`), campaign run reports, finance/WECA records, welfare case lists. Staff cannot answer "how are we doing?" from one place, saved scopes cannot be reused, and scheduled/exports are ad hoc.

This addendum defines a single **Reporting** menu with 8 items. It is **design-then-estimate**: capability definitions, permission model, and data-model implications for CTO estimation. No build commitment in this issue.

---

## 1. The 8 items — one-line definitions

| # | Item | One-line definition: what question it answers, for which role |
| --- | --- | --- |
| 1 | **Data Views** | "Give me the reusable filtered list I always need" — a **saved, scoped query** (filters + columns + sort, e.g. "My branch newcomers unassigned > 3 days") for **branch/zone/area staff** who re-run the same slice weekly. |
| 2 | **Reports** | "Give me the governed pack I can file or send" — a **scheduled or on-demand exportable pack** (PDF/CSV with run history, e.g. monthly attendance pack) for **branch admins, area admins, and auditors**. |
| 3 | **Metrics** | "Are we healthy right now?" — **KPI cards + short trends** (attendance, newcomers, follow-up SLA, welfare load) for **area/zone/branch leaders** at a glance. |
| 4 | **Attendance Analytics** | "Why is attendance moving, beyond the raw report?" — **breakdowns, comparisons, and retention/cohort views over the existing attendance report** (by category/sex, branch/zone, prior-period compare, newcomer-to-member conversion) for **area/zone analysts and branch admins**. Does not replace `/reports/attendance`. |
| 5 | **Data Integrity** | "What data can I not trust yet?" — **completeness, duplicate, and audit flags** (missing consent, missing branch, possible duplicates, stale follow-ups) with fix actions, for **branch admins and data stewards**; area sees aggregates only. |
| 6 | **Interactions** | "Who did we contact, how, and with what consent?" — a **scoped log of contacts/visits and message touches with consent basis** (follow-ups, visits, campaign sends) for **welfare officers and branch admins**; masked where not permitted. |
| 7 | **Insights** | "So what should I do next?" — **narrative highlights computed from the numbers above** (e.g. "follow-up SLA slipped in 2 branches") with drill-through to the underlying view, for **area/zone leaders**; every insight links to its source, never a bare claim. |
| 8 | **Website** | **CONFIRMED 2026-10-21 (board answer: A)** — "How is our public site performing?" — **public-site visits + registration-funnel cards** (visits per public event page, registrations started vs completed) for **area admins and branch admins** (own-branch slices). Aggregate counts only, no PII. Candidate B (CMS/page editing) is rejected for Reporting — file separately if ever needed. |

**Design lenses cited:** *Information Scent* (each item name must predict its content — hence the one-line questions); *Hick's Law / Choice Overload* (8 items max, grouped 4+4: Measure → Views/Metrics/Attendance/Reports; Trust → Integrity/Interactions/Insights/Website); *Recognition over Recall* (saved views over rebuilt filters); *Progressive Disclosure* (Metrics cards first, drill to Views/Analytics).

---

## 2. Users

| Role | Reporting needs | Default landing |
| --- | --- | --- |
| Area admin | Cross-branch health, compares, scheduled area packs, integrity aggregates | Metrics → Attendance Analytics → Reports |
| Zone pastor / Zone admin | Zone-scoped health, officer workload, integrity for owned branches | Metrics (zone scope) → Data Views |
| Branch admin | Own-branch lists, exports, fix-my-data queue | Data Views → Data Integrity → Reports |
| Welfare officer | Follow-up queue, contact log, consent visibility | Interactions → Data Views (assigned) |
| Dept leader (youth/campus) | Youth/campus slices only | Metrics (dept scope) → Data Views |
| Volunteer / attendance taker | **No Reporting menu.** Capture screens only. Drill links they cannot read render nothing. | — |
| Auditor (read-only, area-scoped) | Run history, exports, integrity summaries; no PII beyond permission rules | Reports → Data Integrity (aggregates) |
| Public / member | **No Reporting menu.** | — |

Capability-driven navigation (`/api/me/permissions`) applies: **a section or item the user cannot read is not rendered** — not greyed out, not hidden behind a click (convention from wireframes-v3 §Layout conventions).

---

## 3. Capability list (v1)

1. **Reporting landing** (`/reporting`): 8-item index with one-line purpose per item, role-scoped; recent views, scheduled reports, and open integrity count surfaced.
2. **Data Views** (`/reporting/views`, `/reporting/views/:id`): create from any list via "Save as view" (scope + filters + columns + sort); run, rename, duplicate, delete (own) / admin-manage (shared); shared views carry scope floor (a branch-shared view never leaks cross-branch rows).
3. **Reports** (`/reporting/reports`, `/reporting/reports/:id/runs/:runId`): catalogue of governed packs; on-demand run + scheduled runs (daily/weekly/monthly); run history with parameters, row counts, duration, actor; CSV/PDF export; single idempotent retry (convention from campaign run report, wireframes-v3 S12).
4. **Metrics** (`/reporting/metrics`, `/reporting/metrics/:key`): KPI cards with 4–8 week sparkline; every count is a **clickable drill link** to the filtered underlying list (AFC-150 §1.1 UI contract); scope + period selectors; empty states name the action that fills them. **Metric detail (Rock RMS borrowing, CTO 2026-10-21):** a grouped **metric catalogue tree** (e.g. Attendance / Blessings / Giving-and-returns / Newcomer care / Welfare — our equivalent of Rock's homepage/hosting/insights/tithing/weekly groups), a **partitioned trend chart** (partitions = branch, zone, service type; Rock's Campus × Service), and a **values table** underneath with one row per period × partition. **Manual measure entries are allowed but permission-gated** (area admin + designated data stewards only) and **every manual entry writes an audit row** (actor, timestamp, old → new, reason) — never open editing. **Seeded first metrics:** weekly attendance + blessings figures already importable via the prior-year CSV pipeline (prd-expansion §9.2 / US-U2) become the first catalogue entries, so the chart has history on day one.
5. **Attendance Analytics** (`/reporting/attendance`): builds on `/reports/attendance`: breakdowns by category/sex/service-type, branch/zone compare, prior-period compare, newcomer attendance → integration funnel tie-in; CSV respects current filters + permissions.
6. **Data Integrity** (`/reporting/integrity`): flag queue by severity (error/warn/info) with counts; flag types: missing required (phone, branch, consent), possible duplicate (name+phone fuzzy), stale follow-up (> N days), consent gap (minor without guardian consent), orphaned record; each flag has **one fix action** (merge, assign, fill, suppress with reason); suppressions are audited.
7. **Interactions** (`/reporting/interactions`): unified contact timeline (follow-up logs, visits/drop-offs, campaign sends) with channel + consent basis per row; phone masked outside permission; no provider IDs/errors for non-staff (convention from "My invitations", wireframes-v3 S9).
8. **Insights** (`/reporting/insights`): computed narrative cards ("Follow-up SLA slipped from 82% → 68% in 2 branches"), each with **source link, period, scope, and computation note**; dismiss/defer with reason; no bare claims, no auto-actions in v1.
9. **Website — confirmed scope** (`/reporting/website`): 2–3 cards — visits per public event page, registrations started vs completed (funnel), both over the selected period; scope + period selectors shared with Metrics; every count drills to the underlying registration rows where permitted, otherwise shows aggregates only. Detail screen follows the R2/R4 card pattern (defined, not drawn — Pareto 80/20). Feed: existing `event_registrations` rows + minimal page-view events on public pages only.

**Drawn in this issue (6 screens):** Reporting landing (R1), Data View (R2), Report run/export (R3), Attendance Analytics (R4), Data Integrity flags (R5), **Metric detail with catalogue tree + partitioned chart + values table (R6, Rock RMS borrowing)**. Not drawn: Interactions and Insights full screens — structure follows the Data View / Report run patterns above; drawing all 8 now would bloat review (*Occam's Razor / Pareto 80/20*: the 6 drawn screens cover landing, list-detail, run/export, analytics, fix-queue, and metric-catalogue patterns).

---

## 4. Non-goals (v1)

1. **No ad-hoc SQL for staff.** All queries go through saved views / governed reports with scope enforcement server-side. Directus Studio stays admin-only.
2. **No PII exports beyond existing permission rules.** Exports carry the same field-level restrictions as the screen (medical/safeguarding notes, DOB, consent fields); minors' data never appears on public endpoints; use synthetic examples in specs.
3. **No third-party BI embed in v1** (Metabase/PowerBI/superset iframe). Revisit only with SSO + row-level scope proof.
4. **No Website CMS in v1.** Website in Reporting means read-only traffic/funnel analytics (board answer A, §7); page editing/authoring is a separate product and stays out. No public-site tracking beyond the minimal page-view events that feed the funnel cards (data minimisation).
5. **No automated actions from Insights** (no auto-assign, no auto-send). Insights propose; humans dispose.
6. **No cross-branch PII for branch-scoped roles**, even in aggregates (counts only where rows are not permitted).

---

## 5. Permission model (who sees which item)

| Item | Super admin | Area admin | Zone admin | Branch admin | Welfare officer | Dept leader | Volunteer | Public |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Data Views | CRUD all | CRUD (area-shared) | CRUD (zone) | CRUD own + use shared | Use assigned | Use dept scope | – | – |
| Reports | CRUD | Run + schedule | Run + schedule (zone) | Run (own) | Run follow-up packs (own) | Run dept packs | – | – |
| Metrics | All | All | Zone | Own branch | Own queue | Dept scope | – | – |
| Attendance Analytics | All | All | Zone | Own branch | – | Dept scope | – | – |
| Data Integrity | All | Aggregates + drill | Zone aggregates + drill | Own flags + fix | Own flags | Dept flags | – | – |
| Interactions | All | All (consent basis visible) | Zone | Own branch (masked as needed) | Own + assigned | Dept scope | – | – |
| Insights | All | All | Zone | Own branch | Own queue | Dept scope | – | – |
| Website | Area (aggregates) + branch (own slices) | Area admin | Branch admin (own) | – | – | – | – | – |

Enforcement is **server-side Directus policies**; the frontend only hides UI (PRD §6). Field-level restrictions (medical notes, welfare description/outcome, DOB, consent) apply inside every item. Sensitive reads by privileged roles are logged (PRD §7.2).

---

## 6. Data-model implications (for CTO estimation — no migration in this issue)

New collections are **proposals**; naming follows `snake_case` conventions (data-model.md §1):

| Proposed collection | Purpose | Key fields (indicative) |
| --- | --- | --- |
| `reporting_views` | Saved scoped queries | `owner, scope_type (area/zone/branch/dept), scope_ref, base_collection, filters (json), columns (json), sort, is_shared, created_by` |
| `reporting_reports` | Governed pack definitions | `key, title, scope_type, parameters (json), schedule (none/daily/weekly/monthly), format (csv/pdf), is_active` |
| `reporting_report_runs` | Immutable run history | `report (M2O), parameters (json), status, row_count, file, started_by, duration_ms, assumptions_note` — mirrors campaign run report pattern |
| `reporting_insights` | Computed narrative cards | `key, title, body, scope_type/scope_ref, period, source_ref (json: view/report + params), severity, status (open/dismissed/deferred), computed_at` |
| `reporting_integrity_flags` | Fix queue | `flag_type, severity, record_ref (collection+id, generic), detail (json, no PII in log), status (open/fixed/suppressed), suppressed_by/reason, resolved_by/at` |
| `reporting_metrics` | Metric catalogue (Rock RMS borrowing) | `key (unique), title, group (attendance/blessings/giving/newcomer/welfare), unit, partitions (json: e.g. ["branch","service_type"]), source (derived/import/manual), seed_ref (e.g. prior-year import batch), is_active` |
| `reporting_metric_values` | One value per period × partition, incl. manual entries | `metric (M2O), period (date), partition (json), value (numeric), origin (derived/import/manual), entered_by, entered_at, reason, supersedes (self-FK, immutable history — corrections append, never overwrite)` |
| `reporting_schedules` (or columns on `reporting_reports`) | Schedule ticks | `report (M2O), cron, next_run_at, last_run_at, notify_to (roles, not raw addresses)` — CTO to decide table vs columns at estimate |

**No new PII collections.** Views/runs reference existing rows; exports inherit permission filters. `reporting_integrity_flags.detail` must not duplicate PII — store record refs + flag reason only. Retention: run files follow the portal backup/retention posture (PRD §7.5); personal-data retention unchanged.

---

## 7. Website — RESOLVED (board answer A, 2026-10-21)

**Q-WEB-1: What is "Website" in the Reporting menu? — Answered: A (public-site analytics).**
- **What A means:** scope `/reporting/website` as 2–3 traffic/funnel cards fed by existing registrations + minimal page-view events on public pages only; aggregate counts, no PII; branch admins see own-branch slices.
- **What B would have meant (rejected):** remove Website from Reporting, open a standalone Website/CMS epic — not taken.
- **Wireframes:** the landing tile R1 now shows the confirmed Website scope; the detail screen follows the R2/R4 card pattern (defined in §3 item 9, not drawn to keep review tight).

*(Superseded question record — kept for traceability.)*
- **Candidate A (taken): public-site analytics** — visits and registration funnel on public event/Youth Summit pages. *Why:* stays inside reporting (read-only numbers), needs no CMS, respects data minimisation.
- **Candidate B (rejected): public-site content management** — pages/sermons/announcements editing. *Why not:* a different product (authoring, publishing workflow, media); file as a separate issue if needed.

---

## 8. Acceptance mapping (AFC-587)

| Acceptance | Where met |
| --- | --- |
| All 8 items defined (Website meaning confirmed, not assumed) | §1 (one-line each); Website CONFIRMED as public-site analytics per board answer A (2026-10-21), resolved in §7 |
| Addendum names users / capabilities / non-goals / permissions / collections | §2 / §3 / §4 / §5 / §6 |
| Wireframes match the existing set format | `docs/wireframes/church-portal-reporting-wireframes.html` (same CSS/legend/frame conventions as v2/v3) + `docs/wireframes/wireframes-reporting.md` index; 6 screens: landing, data view, report run/export, attendance analytics, integrity flags, **metric detail (catalogue + partitioned chart + values table)** |

---

## 9. UX notes (lenses applied, for review traceability)

- **Cognitive Load / Miller's 7±2 / Chunking:** 8 items grouped 4+4 with one-line questions; landing shows at most 3 recents + 3 schedules + integrity count above the fold.
- **Hick's Law:** Metrics cards ≤ 6; analytics breakdowns ≤ 5 dimensions per screen.
- **Fitts's Law / thumb zones:** primary actions (Run, Export, Fix) are full-width on mobile-first capture-adjacent screens; capture screens themselves are untouched.
- **Jakob's Law / consistency:** run-history, drill-links, amber/restricted + rose/no-consent markings, and capability-driven nav reuse v2/v3 conventions exactly.
- **Forgiveness:** destructive or cross-scope acts (delete shared view, suppress flag, pause schedule) require confirm + reason; single idempotent retry on runs.
- **Accessibility (POUR, first-class constraint):** low-fi now; hi-fi/WCAG 2.1 AA pass stays gated with the design system — wireframes use `nav`/anchor semantics, visible focus, no colour-only meaning (labels + text accompany amber/rose/teal).
- **Ethics:** no dark patterns; Insights never auto-act; suppression reasons are mandatory so "fixing" numbers leaves a trail.

---

*Planning only. Estimation/build follows by Coder + CTO on separate issues.*
