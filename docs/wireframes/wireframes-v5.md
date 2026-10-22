# Wireframes v5 — Comms expansion (AFC-592), hi-fi pass (AFC-596)

**Issue:** AFC-592 (lo-fi) · **Hi-fi:** AFC-596 · **Parent:** AFC-460 · **Ancestor:** AFC-146 · **Owner:** UXDesigner (design only) · **Version:** v5 hi-fi (2026-10-21)
**Hi-fi visual layer on the same set, same order — replaces nothing, reorders nothing.**
**Companion docs:** [prd-addendum-v6](/AFC/issues/AFC-592#document-prd-addendum-v6)

## How to view

The renderable file is the workspace copy: `docs/wireframes/church-portal-wireframes-v5.html` — self-contained, open in a browser. It links the AFC kit (`design-system/tokens/afc-tokens.css` + `design-system/components/afc-components.css`) with page-local layout CSS only; no one-off colour or spacing values.

## Phase-gate note

The hire phase gate held hi-fi until the design system was ready. AFC-596 is the explicit board authorisation for this hi-fi pass: the AFC design system is at v1.0.1 (approved, contrast 50/50, reflow 5/5), so this file moves v5 from grey-box to the AFC kit. No component-library change, no implementation PR.

## Rock RMS reconciliation — pattern borrowed, layout ours (not a clone)

| Rock reference screen | Pattern borrowed | Where it lands in v5 (same index) | Redrawn as |
| --- | --- | --- | --- |
| Email builder (canvas + block palette, columns, merge tags, test send, review-and-confirm) | block palette → canvas, column layouts, merge-tag insert, test send, review step | Screen 2 `/comms/send` (Email tab) | Palette (title/paragraph/image/button/video/divider/2-col/RSVP) + canvas + `{{variables}}` + test-send badge + eligible/excluded review before queue. Free-form stays Email-only; WhatsApp stays template-bound (v6 §1). |
| SMS Conversations (thread list + message pane + reply box) | two-pane inbox | Screen 3 `/comms/conversations` | Left thread list (search, unassigned/STOP flags) + right pane (consent header, bubbles, reply box, assign/log/welfare/STOP). Guardian-held minor threads flagged. |
| SMS Pipeline (inbound detail + automation actions + filter rules) | pipeline detail with actions, rules list | Screen 4 `/comms/pipeline` | Board (draft/queued/sent/delivered/failed) + inbound-detail card (assign-group/connect, launch-workflow→flow enroll, record-outcome) + automation/filter-rules card (STOP terminal, question→officer, 4h fallback, failure alert). |
| Communication Flows (stepped wizard: getting started → conversion goal → message flow, waits, add-message, exit rules) | stepped builder | Screen 5 `/comms/flows/:id` | 4-step wizard (1 getting started ✓ · 2 conversion goal ✓ · 3 message flow with +Email/SMS/Push/wait · 4 exit rules preview) over the same compile-to-campaigns runtime. |
| Analytics (conversion/open/click/unsubscribe, over-time, instance-vs-average, recipient log) | KPI cards + trend + comparison + log | Screen 6 `/comms/analytics` | KPI row (conversion/delivered/read/reply/STOP/spend-vs-cap) + over-time bars vs family average + instance-vs-average table + family table + permission-scoped recipient log. Our signals map: open→read, click→reply/converted (no pixel beyond provider `read`). |
| Profile + AI assistant views | AI surface | **Excluded — see below** | No AI block, button, or panel anywhere in the set. |

## Hard constraints carried into the hi-fi (visible on the screens)

- **Explicit opt-in per channel stays mandatory** — consent-gate alert on hub (1), eligible/excluded with reasons + no-override note on builder (2), basis frozen per recipient row (4, 6). `consent_records → communication_recipients.consent_basis`.
- **Quiet hours 20:00–07:00 Africa/Lagos + caps + kill switch stay visible** — quiet-hours banner (1, 5), quiet-hrs badge on queued lane (4); caps line (marketing ≤3/person/week/family, fallback ≤1/24h, daily_cap) on hub alert (1); kill-switch card (campaign paused / channel enabled, audit-logged) on hub (1). ADR-0009 D4/D5.
- **No AI assistant surface** — reason: no AI provider, cost, or data-governance decision exists (AFC-596 accept). Replies are staff-written from approved templates; analytics has no generated copy. If a provider/governance decision lands, AI returns as a new scoped proposal, not a silent addition.
- **Member data views stay permission-scoped** — scope + role pill per screen; capability-driven nav; contact values masked in recipient log; inbound bodies gated on OQ-M1; device tokens own-devices-only.

## Screen → collections map (no orphan UI)

| Screen | Reads | Writes |
| --- | --- | --- |
| 1 hub `/comms` | campaigns, communication_channels, communication_recipients (counts), consent_records (exclusions) | — (pause/disable actions route to existing runbook controls) |
| 2 builder `/comms/send` | message_templates, segments/audience, consent_records (eligibility) | communications + communication_recipients (frozen text + basis), event_registrations (RSVP block) |
| 3 inbox `/comms/conversations/:id` | conversation_threads, conversation_messages, consent_records, visitor_follow_ups | conversation_messages (out), thread assignee/status, consent denial on STOP, welfare case (offer) |
| 4 pipeline `/comms/pipeline` | communications + communication_recipients (single log), campaign_runs.notes (signal availability) | hold/cancel queued, single idempotent retry; enrollments via automation actions |
| 5 flows `/comms/flows/:id` | flow_definitions, campaigns + campaign_steps, allowlisted conditions | flow_definitions version + publish (compiles to campaign rows; no new scheduler) |
| 6 analytics `/comms/analytics` | communications + recipients + campaign_runs (read model; no rollup tables) | alert-rule config; scoped CSV export |
| 7 push `/me/notifications` | push_device_tokens (own), consent_records (push grants) | per-device toggle → token register/invalidate + consent grant/withdrawal |

## Screens (7 — unchanged set and order)

| # | Screen | Route (intent) | Covers |
| --- | --- | --- | --- |
| 1 | **Comms hub — 7 sections** | `/comms` | Email, SMS/WhatsApp, Conversations, Pipeline, Push, Flows, Analytics; quiet-hours/caps/kill-switch/consent alerts |
| 2 | **Compose — block email builder + unified send** | `/comms/send` | Block palette/canvas/columns/merge tags/test send/review-and-confirm (Email); per-recipient resolution + fallback (SMS/WhatsApp) |
| 3 | **Conversations inbox — two-pane** | `/comms/conversations/:id` | Thread list, message pane, reply box, assign/log/welfare/STOP |
| 4 | **Pipeline — board + automation detail** | `/comms/pipeline` | Lifecycle lanes, inbound detail actions, automation + filter rules, retry-once |
| 5 | **Flows — stepped wizard** | `/comms/flows/:id` | Getting started → conversion goal → message flow (+Email/SMS/Push/waits) → exit rules & publish |
| 6 | **Analytics — rates, trend, comparison, log** | `/comms/analytics` | Conversion/delivered/read/reply/STOP/spend, over-time vs average, instance-vs-average, recipient log |
| 7 | **Push opt-in (member)** | `/me/notifications` | Per-device toggle (default off), device list, separate channel consent link |

## Lenses cited (traceability)

Cognitive Load / Working Memory (wizard steps, one job per screen); Progressive Disclosure (hub → detail); Recognition over Recall (consent + basis shown where the send happens); Hick's/Fitts's laws (one Auto channel decision; large Queue/Publish targets); Doherty Threshold (optimistic queue state); Forgiveness (hold/cancel never edit; STOP reversible only by fresh opt-in); Peak-End + Goal-Gradient (analytics ends with what-to-fix; threads queue oldest-unresolved first); Von Restorff (breaching family amber); POUR + colour-independence (lanes carry counts + labels, never colour alone; keyboard-operable fallbacks); ethics (no pre-ticked consent, no confirmshaming, no engagement metrics that reward spam).

## UX summary — what changed, tradeoffs, residual risks

- **Changed:** v5 grey-box → AFC kit hi-fi; screen 2 gains the Rock-style block builder (Email) beside the unified tab; screen 3 becomes a true two-pane inbox; screen 4 gains inbound-detail + rules cards; screen 5 becomes a stepped wizard driving the same node canvas; screen 6 gains over-time, instance-vs-average, and recipient-log cards; guardrails (opt-in, quiet hours, caps, kill switch) are now visible components, not notes.
- **Tradeoffs:** Email builder is block-composition over frozen snapshots, not a free HTML editor (keeps the audit invariant); flow wizard is linear + branches (no BPMN); inbound bodies default to metadata-only pending OQ-M1; Email replies stay out of the inbox (v6 non-goal 4).
- **Residual risks:** OQ-M1 (inbound-body storage gated on board + DPCO); WhatsApp inbound/status webhook availability; FCM procurement lead time — estimators treat push + conversations as the long poles.
- **Acceptance (AFC-596):** builder ✓ · conversations ✓ · pipeline/automations ✓ · flows wizard ✓ · analytics ✓ · each screen maps to collections/consent (table above, no orphan UI) ✓ · AI excluded with reason recorded ✓.

---

*Extends wireframes, wireframes-expansion, wireframes-v3, wireframes-v4. Hi-fi visual layer; structure and behaviour unchanged from the AFC-592 lo-fi.*
