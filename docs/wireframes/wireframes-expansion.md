# Wireframes — Church Portal (Expanded, v2)

**Issue:** AFC-150 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech) · **Version:** v2 (2026-10-05)
**Planning only — low-fidelity layout intent, not production UI.**

## How to view

The renderable file is an artifact work product on this issue: **Church Portal — Expanded Wireframes v2 (21 screens)**. It is a self-contained HTML file — open it in a browser. A workspace copy is at `docs/wireframes/church-portal-wireframes-v2.html`.

This set **extends** the AFC-147 14-screen set ([wireframes](/AFC/issues/AFC-147#document-wireframes)). The base screens (login/role landing, area/branch dashboards, person, events, public registration, attendance capture, Sunday roster, visitor intake/follow-up, welfare, Youth Summit) still apply; this v2 adds and refines the screens for the expanded scope.

## New / updated screens (21)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| 1 | Area dashboard — hierarchy | `/area/:slug` | counts link to filtered data (drill-down); attendance by zone male/female; leadership |
| 2 | Zone profile & branches | `/zones/:id` | branch list, type, pastor, BSCs, map, drill-down counts |
| 3 | Branch profile | `/branches/:slug` | full field set: management/workers (clickable), weekly headcounts, BSCs, blessings, history, photos |
| 4 | Bible Study Centre (BSC) | `/bscs/:id` | parent branch, leader, property, geo/pin, avg attendance, drill-down |
| 5 | Attendance capture (category & sex) | `/attendance/capture` | male/female per category; categories from service type; retry-safe |
| 6 | Attendance report | `/reports/attendance` | group by branch/zone; weekly/monthly/quarterly/yearly/custom; compare year; CSV |
| 7 | Blessings records | `/reports/blessings` | per type male/female; same sort + CSV |
| 8 | Household / family with map | `/families/:id` | unified address + wedding date; map pin; members |
| 9 | Person profile (expanded) | `/people/:id` | marital/education/occupation; milestones with year fallback; previous branches; status |
| 10 | Monthly financial record | `/finance/entry` | branch, month, income, WECA, 5%, intervention, Faith City |
| 11 | WECA return (pending formula) | `/finance/weca-returns` | flagged `formula_pending`; inputs captured; no guessed computation |
| 12 | Youth Care | `/youth` | shared DB directory; education/employment/entrepreneur; shout-outs |
| 13 | Celebrations & weekly reminder | `/celebrations` | birthdays/anniversaries; greeting via consent-gated comms; webhook |
| 14 | Campus Care dashboard | `/campus` | students, level, AFCF, NYSC (AFCMF), financial support |
| 15 | Coaching timetable & attendance | `/campus/coaching/:id` | subjects, facilitators, call status, class marking (mobile-first) |
| 16 | Campus student progress & results | `/campus/students/:id` | progress, results, support, NYSC, check-ups |
| 17 | Calendar | `/calendar` | unified services/events/programmes/coaching/celebrations, filter by scope |
| 18 | Reports hub | `/reports` | report types with CSV; prior-year upload/compare |
| 19 | Leadership & appointments | `/leadership` | positions across area/zone/branch; pastoral history; timelines; department heads |
| 20 | Office | `/office` | tasks, minutes, transfers, marriage matters, announcements, search |
| 21 | Integrations & users admin | `/admin/integrations` | Gravatar/Email/Telegram/SMS/WhatsApp/Backup/webhook status; users & scopes |

## Layout conventions (unchanged)
- Capability-driven navigation (`/api/me/permissions`), never hard-coded roles.
- Restricted/pending content is visually marked (amber).
- Clickable analytics counts (teal, underlined) drill into the underlying data.
- Mobile-first for attendance, public registration, and class marking.

## Notes
- These are **layout-intent** wireframes for the expanded scope; visual design, the component library, and an accessibility pass (WCAG 2.1 AA) follow in implementation.
- Every screen respects the Area → Zone → Branch scope model and the field-level restrictions in [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion).

---

*Companion: [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion), [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion), [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec), [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation).*
