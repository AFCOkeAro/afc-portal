# Wireframes v6 — Member self-service portal (AFC-594)

**Issue:** AFC-594 · **Parent:** AFC-460 · **Ancestor:** AFC-146 · **Owner:** UXDesigner (design only) · **Version:** v6 (2026-10-21)
**Planning only — low-fidelity layout intent, not production UI.**
**Companion docs:** [prd-addendum-v7](/AFC/issues/AFC-594#document-prd-addendum-v7)

## How to view

The renderable file is an artifact work product on this issue: **Church Portal — Wireframes v6 (5 screens, member portal)**. It is a self-contained HTML file — open it in a browser. Workspace copy: `docs/wireframes/church-portal-wireframes-v6.html`.

## Relationship to the earlier sets

| Set | Screens | Status after this addendum |
| --- | --- | --- |
| [AFC-147 wireframes](/AFC/issues/AFC-147#document-wireframes) | 14 (login/role landing, area & branch dashboards, person, events, public registration, attendance capture, Sunday roster, visitor intake/follow-up, welfare, Youth Summit) | Stands |
| [AFC-150 wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion) | 21 (hierarchy, attendance, blessings, household, finance, youth, campus, calendar, reports, leadership, office, admin) | Stands |
| [AFC-151 wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3) | 12 (single-page profiles, newcomer board/record/pack/follow-ups/reports, invitations, campaigns) | Stands |
| [AFC-586 wireframes-v4](/AFC/issues/AFC-586#document-wireframes-v4) | 5 (form builder, submission review, workflow status) | Stands |
| [AFC-592 wireframes-v5](/AFC/issues/AFC-592#document-wireframes-v5) | 7 (comms hub, unified send, conversation thread, pipeline board, flow canvas, analytics, member push toggle) | Stands — v6 reuses the push-toggle pattern, does not replace it |
| **This set (v6)** | 5 | Adds the member-portal screens; **replaces nothing** |

## Screens (5)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| 1 | **Member home — 4 jobs** | `/me` | My record, Events, News, My requests; household switcher for guardians; drill-down counts |
| 2 | **My record — instant vs approval** | `/me/record` | Own record with per-field rule labels; direct save + propose sheet with reviewer + wait |
| 3 | **Family — guardian propose-only** | `/me/family` | Household roster; adult masking; minor propose-only cards; minor safeguard banner; withdraw |
| 4 | **Events + registration** | `/me/events`, `/me/events/:id` | Scoped published list; detail → register → ticket; family registration with guardian block; cancel-as-request |
| 5 | **News reader** | `/me/news`, `/me/news/:id` | Scoped published announcements newest-first; reader with publisher + date; local-only unread |

## Board ask → where it is visible

| Board item | Screens |
| --- | --- |
| Families/individuals update records | 1 (home), 2 (my record), 3 (family propose flow) |
| See upcoming events (RockRMS-style registration) | 1, 4 |
| Read church news | 1, 5 |

## Layout conventions (unchanged)

- Capability-driven navigation (`/api/me/permissions`), never hard-coded roles.
- A section a user cannot read is not rendered; fail-closed on missing scope.
- Instant-save fields teal; propose-for-approval amber; minor-safeguard/never rose; clickable counts teal + underlined drill into data.
- Mobile-first throughout (member portal is a phone-first surface); staff approval queue stays desktop.
- Every screen respects Area → Zone → Branch scope + field-level restrictions (data-model-v4 §5, extended by prd-addendum-v7 §5).
- Synthetic names/numbers only — no real personal data in any frame.

## What is deliberately not designed yet

Visual design, the component library, iconography, dark mode, motion, and the WCAG 2.1 AA contrast/assistive-technology pass are **deferred** to UXDesigner, gated on the design system and skills readiness on [AFC-152](/AFC/issues/AFC-152), per the hire phase gate. This set fixes **structure and behaviour**.

---

*Extends wireframes, wireframes-expansion, wireframes-v3, wireframes-v4, wireframes-v5. Planning only.*
