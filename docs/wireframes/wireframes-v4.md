# Wireframes v4 — Workflow and Form Builder (AFC-586)

**Issue:** AFC-586 · **Parent:** AFC-460 · **Ancestor:** AFC-146 · **Version:** v4 (2026-10-21)
**Planning only — low-fidelity layout intent, not production UI.**
**Companion doc:** [prd-addendum-v5](../planning/prd-addendum-v5.md) (users, capabilities, non-goals, permissions, collections)

## How to view

The renderable file is the workspace copy: `docs/wireframes/church-portal-wireframes-v4.html` — a self-contained HTML file, open it in a browser. It follows the v3 file's visual language (same tokens, legend, card/table/badge/note primitives) so the overall design stays one body of work.

## Relationship to the earlier sets

| Set | Screens | Status after this addendum |
| --- | --- | --- |
| [AFC-147 wireframes](church-portal-wireframes.html) | 14 (login/role landing, dashboards, person, events, registration, attendance, roster, visitor, welfare, Youth Summit) | Stands |
| [AFC-150 wireframes-expansion](church-portal-wireframes-v2.html) | 21 (hierarchy, attendance by sex, blessings, household+map, finance, WECA, youth, campus, calendar, reports, leadership, office, admin) | Stands |
| [AFC-151 wireframes-v3](church-portal-wireframes-v3.html) | 12 (single-page profiles, newcomer board/record/pack/follow-ups/reports, invitations, campaigns) | Stands |
| **This set (v4)** | 5 | Adds the builder + workflow screens; **replaces nothing** |

## Screens (5)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| 1 | **Form builder — canvas** | `/forms/:id/build` | Sections (chunked ≤~7), ordered fields, required/optional + validation summary, route-to-role + lifecycle panel, publish-freezes-version note |
| 2 | **Field palette + configure** | `/forms/:id/build?field=phone` | 12-type palette (pick or drag, keyboard-first), per-field config (label, help, required, format, sensitivity), respondent preview at 390px with inline error |
| 3 | **Submission review queue** | `/forms/:id/submissions` | Oldest-first, filter by form/status/assignee/date, masked contacts, dedupe hint (warn-not-block), >3-day unassigned rule, scoped CSV |
| 4 | **Submission detail + workflow actions** | `/forms/:id/submissions/:sid` | Answers vs frozen version snapshot, ≤4 actions (approve / request-changes / reject / close), append-only transition timeline, hook note |
| 5 | **Workflow status view** | `/forms/workflows` | Per-form status funnel (new / in review / approved / changes / rejected / closed), clickable counts into the queue, per-form lanes, stall signals |

## v5 requirements → where they are visible

| Requirement (prd-addendum-v5) | Screens |
| --- | --- |
| Custom forms (event/visitor/welfare/volunteer) | 1, 2 |
| Pick/drag field types, required/optional, basic validation | 1, 2 |
| Route to a role for review/approval | 1 (route panel), 3, 4 |
| Status transitions + audit trail | 4 (timeline), 5 (funnel) |
| Notifications hook for the future center | 4 (hook note; no inbox UI by non-goal) |
| Non-goals (no anonymous/public, e-signatures, payments) | 2 (consent never pre-ticked, file-note not upload), 4 (staff/member-only fills) |
| Permission model (build/publish/review/export) | 3, 5 (scoped queue + export) |

## Layout conventions (unchanged from v3)

- **Capability-driven navigation** (`/api/me/permissions`), never hard-coded role names.
- **A row a reviewer cannot read is not rendered** — not greyed out, not hidden behind a click.
- Clickable status counts (teal, underlined) drill into the filtered queue.
- Builder is desktop-first; respondent forms and the review queue are mobile-first (390px preview on screen 2).
- Restricted/pending content amber; blocked/no-consent rose; immutable history explicit.
- Every screen respects the Area → Zone → Branch scope model and the field-level restrictions in prd-addendum-v5 §4–§5.

## What is deliberately not designed yet

Visual design, the component library (Nuxt UI + custom), iconography, dark mode, motion, and the WCAG 2.1 AA contrast/assistive-technology pass are **deferred**, gated on the design system and skills readiness, per the board's instruction not to design high-fidelity yet. This set fixes **structure and behaviour** — which is what the user ask needs before estimation.

---

*Supersedes nothing; extends the AFC-147, AFC-150, and AFC-151 wireframe sets. Planning only.*
