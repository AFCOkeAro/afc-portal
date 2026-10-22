# Wireframes — Reporting Menu (AFC-587)

**Issue:** AFC-587 · **Parent:** AFC-460 · **Owner:** UXDesigner · **Version:** 2026-10-21
**Planning only — low-fidelity layout intent, not production UI.**

## How to view

The renderable file is `docs/wireframes/church-portal-reporting-wireframes.html` — a self-contained HTML file, open it in a browser. Same CSS/legend/frame conventions as the AFC-150 v2 and AFC-151 v3 sets (grey blocks = placeholders, teal = clickable drill counts, amber = restricted/pending, rose = no-consent/blocked).

## Relationship to the earlier sets

| Set | Screens | Status after this addendum |
| --- | --- | --- |
| [AFC-147 wireframes](/AFC/issues/AFC-147#document-wireframes) | 14 (login/role landing, area & branch dashboards, person, events, registration, attendance, roster, visitor intake, welfare, Youth Summit) | Stand |
| [AFC-150 wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion) | 21 (hierarchy, attendance by category/sex, blessings, household, finance, youth, campus, calendar, reports hub, leadership, office, admin) | Stands; `/reports` hub remains for per-domain reports |
| [AFC-151 wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3) | 12 (single-page profiles, newcomer board/journey, invitations, campaigns) | Stands; run-history pattern (S12) reused by R3 |
| **This set (AFC-587)** | 6 (below) | New Reporting home; does not replace per-domain reports |

## Screens (6)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| R1 | **Reporting landing** | `/reporting` | 8-item index grouped Measure (4) + Trust (4); scope + period; KPI strip; Website tile shows confirmed scope (public-site visits + registration funnel, board answer A) |
| R2 | **Data View** | `/reporting/views/:id` | Saved scoped list (filters + columns + sort); run/duplicate/save-as; assign-all; consent-marked rows; permission-scoped CSV |
| R3 | **Report run + export** | `/reporting/reports/:id/runs/:runId` | KPI strip (branches/rows/duration/period); immutable run history; CSV/PDF; single idempotent retry; assumptions note |
| R4 | **Attendance Analytics** | `/reporting/attendance` | Scope/group/period-compare selectors; zone M/F chart Sep vs Aug; change + conversion stats; drill links; builds on (not replaces) `/reports/attendance` |
| R5 | **Data Integrity flags** | `/reporting/integrity` | Severity counts; flag queue with one fix action each (merge, capture consent, assign, suppress + reason); area sees aggregates only |
| R6 | **Metric detail (Rock RMS borrowing)** | `/reporting/metrics/:key` | Grouped catalogue tree; partitioned trend chart (branch/zone/service type; prior-year seed); values table per period × partition with permission-gated manual entries + immutable audit history |

## Layout conventions (unchanged from v2/v3)

- Capability-driven navigation (`/api/me/permissions`); an item the user cannot read is not rendered.
- Clickable analytics counts (teal, underlined) drill into the underlying filtered data.
- Restricted/pending visually marked (amber); blocked/no-consent marked distinctly (rose).
- Mobile-first stacking for lists and fix queues; primary actions full-width on narrow screens.
- Every insight/flag links to its source; suppression needs a reason and is audited.
- All names and numbers are synthetic placeholders; no customer or real member data.

## What is deliberately not drawn yet

- Interactions and Insights full screens (follow R2 list-detail / R3 run-history patterns), and the Website detail screen (follows the R2/R4 card pattern — defined in the addendum §3 item 9; drawing all 9 now would bloat review — Pareto 80/20).
- Visual design, component library, iconography, dark mode, motion, and the WCAG 2.1 AA pass — **deferred**, gated on the design-system readiness per the UXDesigner hire phase gate.

---

*Companion: [prd-addendum-reporting](/AFC/issues/AFC-587#document-prd-addendum-reporting). Planning only.*
