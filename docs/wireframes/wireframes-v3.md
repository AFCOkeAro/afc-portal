# Wireframes v3 — Church Portal (round-4 scope)

**Issue:** AFC-151 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech) · **Version:** v3 (2026-10-05)
**Planning only — low-fidelity layout intent, not production UI.**
**Companion docs:** [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4), [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4), [integrations-addendum](/AFC/issues/AFC-151#document-integrations-addendum), [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr)

## How to view

The renderable file is an artifact work product on this issue: **Church Portal — Wireframes v3 (12 screens, round-4 scope)** — a self-contained HTML file, open it in a browser. Workspace copy: `docs/wireframes/church-portal-wireframes-v3.html`.

**Screens 1 and 2 are scrollable in the browser.** Scroll inside them to see the tab strip stay pinned and the active tab follow the section in view — that is the board's requirement, made visible rather than described.

## Relationship to the earlier sets

| Set | Screens | Status after this addendum |
| --- | --- | --- |
| [AFC-147 wireframes](/AFC/issues/AFC-147#document-wireframes) | 14 (login/role landing, area & branch dashboards, person, events, public registration, attendance capture, Sunday roster, visitor intake/follow-up, welfare, Youth Summit) | **Screens 2 and 9 (person profile, area/branch dashboard) are replaced** by the single-page versions below |
| [AFC-150 wireframes](/AFC/issues/AFC-150#document-wireframes-expansion) | 21 (zone/branch/BSC, attendance by category/sex, blessings, household+map, finance, WECA, youth, campus, coaching, calendar, reports, leadership, office, admin) | **Screen 3 (branch profile) and screen 2 (branch dashboard) are replaced**; the rest stand |
| **This set (v3)** | 12 | Adds the round-4 screens |

## Screens (12)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| 1 | **Person profile — single page** | `/people/:id#section` | Sticky anchor tabs; sections: summary, contact & consent, milestones, attendance, newcomer journey, welfare, messages, celebrations, documents. Section absent if not permitted; deep-linkable; print/CSV per section |
| 2 | **Branch dashboard — single page** | `/branches/:slug#section` | Sticky anchor tabs; blocks: today, attendance, newcomer funnel, follow-ups due, welfare, this week, events, messages, tasks. Clickable counts, lazy per block, empty states with the action that fills them |
| 3 | **Newcomer board** | `/newcomers` | 5-stage funnel with drill-down, officer workload, unassigned >3 days, "assign all" |
| 4 | **Newcomer record — welcome** | `/newcomers/:id` | Journey tracker (Identify → Welcome → Pack → Drop-off → Follow-up), consent toggles incl. guardian, WhatsApp + SMS welcome send with rendered preview, send status and the 4-hour fallback check |
| 5 | **Welcome pack + drop-off** | `/newcomers/:id#pack` | The six pack items with per-branch stock and reorder threshold; completion blocked until required items are checked; drop-off visit scheduling and outcome list |
| 6 | **Follow-up log & assignment** | `/newcomers/:id#follow-ups` | Contact timeline with outcomes, next step, assignment (Welfare-position holders only), tasks, welfare-case offer |
| 7 | **Newcomer reports** | `/reports/newcomers` | Funnel by stage (new, in stage, avg days, overdue, converted), follow-up status per officer, dormancy, period/scope filters, permission-scoped CSV |
| 8 | **Member event invitation** | `/events/:id/invite` | Event, invitee name/phone/relationship/age band, channel choice, personal note, rendered message preview with template variables, rate-limit counters, guardian rule for minors |
| 9 | **My invitations** | `/me/invitations` | Member's own invitations with status only; masked phone; no provider ids or errors; "ask staff to stop"; own consent screen |
| 10 | **Campaign editor** | `/campaigns/:id` | Step list with delay type, channel, template + approval state, audience, consent policy, eligible/excluded preview, send-test |
| 11 | **Campaign catalogue** | `/campaigns` | The nine seeded campaign keys with type, trigger, channel, consent policy, last run result, status; "pause all automation" kill switch |
| 12 | **Campaign run report** | `/campaigns/:id/runs/:runId` | Audience/eligible/excluded/delivered/read/failed/cost counters, exclusions by reason, immutable delivery log, single idempotent retry, run assumptions note |

## Round-4 requirements → where they are visible

| Board requirement | Screens |
| --- | --- |
| One-page profile & dashboard, tabs stay visible while scrolling, tabs link to sections | **1, 2** (sticky strip, scroll-spy, deep links) |
| Input newcomer data | 3, 4 |
| Send SMS + WhatsApp template | 4 (both), 5 (dropoff appointment SMS) |
| Weekly check-in & service reminder | 3 (fallback badge), 6 (scheduled task), 10 (campaign steps) |
| Follow up (log outcomes) | 6 |
| Assign to a welfare officer | 3 (workload, assign all), 6 (owner picker) |
| Report (funnel + follow-up status) | 7 (also a block on 2) |
| Onboarding journey as 5 states | 4 (tracker), 5 (pack + dropoff), 7 (funnel) |
| Member event invitation + message | 8, 9 |
| Welfare automation campaigns | 10, 11, 12 |

## Layout conventions

- **Capability-driven navigation** (`/api/me/permissions`), never hard-coded role names.
- **A section a user cannot read is not rendered** — not greyed out, not hidden behind a click.
- **Single-page profiles** use anchor-nav semantics (a `nav` of links), not an ARIA `tablist`, because the content does not swap panels; the active tab carries `aria-current`, focus moves to the section heading on jump, and the strip never traps keyboard focus.
- **Sticky strips work on mobile too:** on narrow screens the tab strip becomes a horizontally scrollable row that stays pinned; sections stack in one column.
- Restricted/pending content is visually marked (amber); blocked/no-consent states are marked distinctly (rose) so a missing message never reads as a bug.
- Clickable analytics counts (teal, underlined) drill into the underlying data.
- Mobile-first for attendance capture, newcomer intake, invitation submission and class marking.
- Every screen respects the Area → Zone → Branch scope model and the field-level restrictions in [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4).

## What is deliberately not designed yet

Visual design, the component library, iconography, dark mode, motion, and the WCAG 2.1 AA contrast/assistive-technology pass are **deferred** to UXDesigner, gated on the design system and skills readiness on [AFC-152](/AFC/issues/AFC-152), per the board's instruction not to design high-fidelity yet. This set fixes **structure and behaviour** — which is what the board's feedback was actually about.

---

*Supersedes nothing; extends [wireframes](/AFC/issues/AFC-147#document-wireframes) and [wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion). Planning only.*
