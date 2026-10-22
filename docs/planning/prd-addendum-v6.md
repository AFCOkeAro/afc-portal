# PRD Addendum v6 — Comms Expansion (email, conversations, pipeline, push, flows, analytics)

**Issue:** AFC-592 · **Parent:** AFC-460 (PRD implementation) · **Ancestor:** AFC-146 (Church Portal)
**Updates:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147 base), [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) (AFC-150 v3), [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4) (AFC-151 v4), [prd-addendum-v5](/AFC/issues/AFC-586#document-prd-addendum-v5) (AFC-586 v5)
**Owner:** UXDesigner (design only) · **Status:** Draft for estimation · **Version:** v6 (2026-10-21)
**Planning only — no production code, no deployments, no secrets, no build commitment. Design-then-estimate applies.**

**Companion docs (this issue):** `wireframes-v5` (comms hub, conversation thread, pipeline board, flow canvas, analytics view)

> **Read order.** This addendum extends the AFC-147 base PRD, the AFC-150 v3 expansion, the AFC-151 v4 addendum (single-page UI, newcomer care, invitations, campaigns), and the AFC-586 v5 addendum (forms/workflows). Where it conflicts, **this addendum wins** for the domains it covers (the 7 comms-expansion items). Everything else is unchanged and not repeated here.
>
> **Phase-gate note (hire gate, AGENTS.md).** The board approved this role for high-fidelity design once the design system and skills are ready. This addendum + wireframes-v5 are **low-fidelity layout intent only** (same HTML grey-box style as v2/v3/v4) plus IA/interaction spec. No high-fidelity visual design, no component-library change, no implementation PR is produced on this issue.

---

## 0. Change summary — what this v6 adds

CTO grounding: Slice 4 shipped **one-way** sends (templates + consent resolver, single delivery log `communications` + `communication_recipients`, campaign families + scheduler tick, invitations, member OTP). The board now asks for 7 items that are **new scope, not extensions of Slice 4**: two-way conversations, a visual flow builder over today's scheduler, a new push channel, and comms analytics.

| # | Item | One-line definition | New vs Slice 4 |
| --- | --- | --- | --- |
| 1 | **Email (first-class)** | A real send surface for Email, not template-admin only | New send path on existing SMTP transport |
| 2 | **SMS/WhatsApp unified send** | One compose + one queue for both messaging channels | Unifies two existing transports under one IA |
| 3 | **Conversations (two-way inbox)** | Per-contact thread for replies, assignment, follow-up | New — inbound storage + inbox UI do not exist |
| 4 | **Pipeline (lifecycle board)** | draft → queued → sent → delivered → failed as a board | New view over the existing delivery log |
| 5 | **Push (new channel)** | Opt-in device notifications via a push provider | New channel, new consent + token model |
| 6 | **Communication Flows (visual builder)** | Drag/arrange steps, branches, quiet hours over the campaign engine | New authoring UI; runtime stays the tick |
| 7 | **Communication Analytics** | Delivery, funnel, and engagement beyond per-run reports | New read model over existing log tables |

*Design lenses: Mental Models (one inbox, one pipeline, one analytics — the staff mental model is "post office", not "seven tools"); Progressive Disclosure (hub exposes 7 sections but each screen shows one job); Recognition over Recall (channel + consent state is shown where the send happens, never from memory); Doherty Threshold (compose/send feedback <400ms perceived via optimistic queue state).*

---

## 1. The 7 items — defined (question answered, for which role)

### 1. Email — first-class sends vs today template-only?

**Question it answers:** "As branch/area staff, how do I send a proper email (subject, rich body, attachments-link, test send) without asking an admin to edit a template row?"
**For:** branch admin, area admin, department lead (own scope); welfare officer reads assigned threads only.
**Today:** Email rides the comms stack as a template render (`message_templates` subject + `{{variables}}`, SMTP via Symfony Mailer). There is no staff compose surface; every send is a campaign step, invite, or Flow trigger.
**v6 scope:** a **compose + preview + test-send + queue** surface for one-off and bulk email (announcements, meeting reminders, celebration greetings). Templates remain the source of controlled copy; free-form body is allowed **for Email only** (WhatsApp/SMS stay template-bound by provider policy). Every send still creates `communications` + `communication_recipients` rows with frozen rendered text and consent basis — the single-log rule (ADR-0009 D2) is unchanged.
**Out of v6:** rich drag-drop email builder, tracked open-pixel personalization beyond delivered/read, mailbox-style reply handling for Email (Email replies are out of the conversations inbox in v1 — see §7).

### 2. SMS/WhatsApp — unified send view?

**Question it answers:** "As staff, how do I reach one person or one audience once, and let the portal pick WhatsApp-first with SMS fallback — instead of sending twice?"
**For:** branch admin, welfare officer (assigned newcomers), youth/campus leads (own scope).
**Today:** SMS and WhatsApp are two transports behind one resolver, but the staff UI treats them as separate sends (v3 newcomer record: "Send welcome (WhatsApp)" + "Send welcome (SMS)").
**v6 scope:** a **unified compose**: pick audience → write once → portal resolves per-recipient channel (WhatsApp if `consent_whatsapp` + active, else SMS if `consent_sms`; else excluded with reason). The 4-hour WhatsApp→SMS fallback (v4 §4.3, integrations-addendum §1) becomes a visible per-recipient state (`fallback_pending` → `fallback_sent`), not a hidden timer. Guardian rule and quiet hours apply before any send.
**Out of v6:** free-form WhatsApp body (business-initiated WhatsApp stays provider-template-only; the template gate `campaign.template_gate` / `invite.template_gate` blocks unapproved sends).

### 3. Conversations — two-way inbox per contact

**Question it answers:** "When Ada replies STOP, asks a question, or says 'I moved house', who sees it, who owns it, and what happens next?"
**For:** welfare officer (assigned newcomers), branch admin (triage + assignment), area admin (cross-branch view).
**Today:** inbound handling exists only as timestamps + STOP classification (integrations-addendum §1: no inbound body storage in v1, a deliberate data-minimisation decision).
**v6 scope:** a **per-contact thread**: inbound WhatsApp/SMS replies appear against the contact (person/visitor + channel), with reply-handling actions — assign to officer, log follow-up outcome, open welfare case, capture/change consent, mark STOP (writes `consent_records` denial + exits enrollments). Assignment mirrors newcomer assignment (Welfare-position holders, own branch; unassigned >3 days surfaces on the branch dashboard, same 3-day rule as v4 US-N5).
**Safeguarding + privacy constraint:** inbound **body storage is new scope** and needs an explicit board/DPCO decision (see OQ-M1). Default v6 position: store inbound bodies **only for consented adult threads linked to an open follow-up**, redacted to assigned roles; STOP/keyword classification without body retention stays the fallback if the board declines. Minors: guardian is the thread holder; no adult-to-minor private thread.
*Design lenses: Forgiveness (STOP is one tap and reversible only by fresh opt-in); Peak-End Rule (the thread ends with a clear resolution state, not silence); Shneiderman's 8 Golden Rules (informative feedback on every inbound: received → assigned → resolved).*

### 4. Pipeline — message lifecycle board

**Question it answers:** "Where is my message right now, and what is stuck?"
**For:** branch admin (own sends), area admin (all sends, cost/cap view).
**Today:** lifecycle states exist on `communication_recipients` (queued/sent/delivered/read/failed + `fallback_*`) but are visible only inside per-run reports (v3 screen 12) or per-record timelines.
**v6 scope:** a **kanban board over the delivery log**: columns draft → queued → sent → delivered → failed (+ read as a sub-state of delivered, fallback_pending as a badge). Cards are recipient rows; counts are clickable into the filtered recipient list (*analytics-with-drill-down contract*, v3 §1.1). Filters: channel, campaign/flow, branch, date window, failure reason. Retry is single + idempotent (same rule as v3 US-E3 AC2 / v4 US-C2 AC2).
**Out of v6:** editing a message mid-pipeline (queued rows are held/cancelled, never edited — the frozen-snapshot invariant); cross-channel re-routing from the board.

### 5. Push — new channel (provider, opt-in model, device tokens)

**Question it answers:** "How do we reach a member's phone without paying per SMS and without needing their number — for reminders they explicitly asked for?"
**For:** authenticated members (recipients), branch/area staff (senders, scoped).
**Today:** no push channel exists.
**v6 scope:** **opt-in app/web push** for lightweight operational nudges (service reminder T-24h, meeting reminder, "your invitation was accepted", workflow assignment). Provider: Firebase Cloud Messaging (FCM) for Android/Web + APNs via FCM for iOS — one provider integration behind the existing Notifier transport abstraction, so swap stays a DSN/config change. Opt-in model: **explicit per-device opt-in** (member toggles "reminders on this device" → device token registered → `consent_records` grant for `push`; turning it off or token invalidation withdraws it). No silent background collection; no push to staff devices without the same toggle.
**Out of v6:** marketing push, push without a device-token grant ("push needs explicit device opt-in" — board non-goal), rich media/deep-link campaigns, iOS/Android native apps (push ships on **web push + installed PWA first**; native wrappers are not in scope).

### 6. Communication Flows — visual builder over today scheduler

**Question it answers:** "How do I build 'welcome drip with a branch on reply, quiet hours, and an SMS fallback' without filing an engineering ticket?"
**For:** area admin (cross-branch flows), branch admin (own-branch flows).
**Today:** campaigns are step lists edited as rows (v3 screen 10) executed by the `campaign-tick` (ADR-0009 D3). Branches, conditions, and quiet-hours exist as data (`campaign_steps.condition`, `quiet_hours_override`) but have no visual authoring.
**v6 scope:** a **node canvas** over the same runtime: trigger node → message nodes (channel + template + approval state) → branch nodes (condition vocabulary from data-model-v4 §4.2: `whatsapp_registered_no_activity`, `consent_sms`, `stage_equals`, `has_milestone`, `not_opted_out` — allowlist only, never raw SQL) → wait nodes (delay_hours/days, weekly_cron, wait_for_event) → exit nodes. Quiet-hours banner (20:00–07:00 Africa/Lagos, steps shift to 08:00 unless `operational_essential`). Eligible/excluded preview + test-send before activation, same as v4 US-C1. **Runtime is unchanged**: the canvas compiles to `campaigns` + `campaign_steps` rows consumed by the existing tick — no new scheduler, no nested-Flow state machine (ADR-0009 D3 rationale stands).
**Out of v6:** full BPMN (parallel joins, SLA timers, escalation chains — v5 §3 non-goal 4 applies here too); version-diff/merge; non-technical free-canvas editing above ~100k msgs/month before revisiting Mautic (v4 OQ-R9 trigger unchanged).

### 7. Communication Analytics — beyond run reports

**Question it answers:** "Are our messages landing, being read, and converting — by channel, branch, and campaign family — and what should we fix?"
**For:** area admin (trends, cost), branch admin (own delivery health), welfare lead (follow-up effectiveness).
**Today:** per-run counters (audience/eligible/excluded/delivered/read/failed/cost, exclusions by reason) on v3 screen 12. No cross-run, cross-channel, or funnel view.
**v6 scope:** four views over the **existing log tables** (read model, no new rollup tables — same "reporting is a query" rule as data-model-v4 §2.8): (a) **delivery health** (delivered/read/failed/opt-out rates by channel × branch × week, failure-reason breakdown, >5% failure alert per integrations-addendum §8); (b) **funnel** (sent → delivered → read → replied → converted for newcomer/invite drips, with stage-to-stage conversion); (c) **engagement** (reply rate, STOP rate with >3×-median spike alert, quiet-hours shift counts); (d) **cost** (per-channel spend vs `daily_cap`, per-family cost, 80%/100% cap warnings). Every count drills into the filtered recipient/run list; CSV export is permission-scoped.
**Out of v6:** marketing-suite parity (cohort/LTV/attribution modelling, A/B testing engine, deliverability warm-up tooling — board non-goal); per-recipient open tracking beyond provider `read` signals; any metric that requires storing data we do not collect (no new PII for analytics).

---

## 2. Users

| User | What they do in this addendum | Devices |
| --- | --- | --- |
| **Branch admin** | Composes unified sends + Email; triages conversations; watches pipeline; builds own-branch flows; reads own delivery analytics | Desktop + mobile |
| **Area admin** | Builds cross-branch flows; approves bulk sends; owns caps/cost; reads cross-branch analytics | Desktop |
| **Welfare officer** (assigned only) | Works the conversations inbox for assigned newcomers; logs outcomes; no bulk send, no flow publish | Desktop + mobile |
| **Youth / campus lead** | Unified sends + flows within own scope; reads own analytics | Desktop + mobile |
| **Member (authenticated, OTP)** | Manages own channel consent + push device toggle; reads own invite/message status; replies by WhatsApp/SMS | Mobile-first |
| **Auditor (area)** | Reads immutable log + analytics, exports CSV | Desktop |

Explicitly not a user: the general public without a mediated path (no anonymous flows — v5 §3 non-goal 1 stands); minors acting alone (guardian holds the thread + consent, base PRD §7.1).

*Accessibility lens (WCAG POUR, same contract as base PRD §7.3): every new surface ships with real labels, visible focus, no color-only meaning (pipeline columns carry text counts + icons, not color alone), keyboard-operable board + canvas (list-view fallback for the kanban and the flow canvas), `aria-live` for send-state changes, reduced-motion respect on the canvas.*

---

## 3. Capability list (v1 of this expansion)

- **C1 — Comms hub.** One `/comms` surface with 7 sections (Email, SMS/WhatsApp, Conversations, Pipeline, Push, Flows, Analytics); capability-driven nav; per-section counts drill into data; empty states name the action that fills them ("connect a channel", "capture consent", "publish a flow").
- **C2 — First-class Email compose.** Subject + body (template or Email-only free-form) + variables + test send + audience preview (eligible/excluded with reasons) + queue; approval above bulk threshold (decision C7 unchanged: >200 recipients or naira cap needs area approval).
- **C3 — Unified SMS/WhatsApp compose.** One audience, per-recipient channel resolution, rendered preview per channel, fallback state visible, guardian + quiet-hours + caps enforced at audience-resolution time.
- **C4 — Conversations inbox.** Thread per contact (adult consented threads + guardian-held minor threads), assign/queue, outcome logging (mirrors `visitor_follow_ups` outcomes), STOP handling (denial + exit enrollments), "open welfare case" offer on `needs_support`.
- **C5 — Pipeline board.** draft/queued/sent/delivered/failed (+ read sub-state, fallback badge), filterable, clickable counts, single idempotent retry, hold/cancel queued (never edit).
- **C6 — Push channel.** Per-device opt-in toggle, token registry, operational-only sends in v1, delivery + disable states visible; channel kill switch `communication_channels.enabled = false` covers push from day one.
- **C7 — Flows visual builder.** Trigger/message/branch/wait/exit nodes compiling to `campaigns` + `campaign_steps`; allowlisted conditions only; quiet-hours banner; eligible/excluded preview; publish/unpublish with audit (archive, never delete).
- **C8 — Analytics.** Delivery/funnel/engagement/cost views as read queries over existing tables; threshold alerts (failure >5%, STOP spike >3× median, cap 80%/100%); CSV export scoped.

*IA lens (Information Scent, F-pattern): the hub keeps the 7 section labels verbatim from the board ask so the scent from this issue to the UI is exact; each section page repeats its one-line job ("Pipeline — where is my message right now?") so a stranger knows in two seconds what is primary.*

---

## 4. Non-goals (v1 of this expansion)

| # | Non-goal | Instead |
| --- | --- | --- |
| 1 | **No marketing-automation suite parity** — no A/B testing engine, no lead scoring, no attribution modelling, no drag-drop email builder | Analytics answers "did it land / was it read / did it convert"; deeper marketing tooling revisits only at the v4 OQ-R9 trigger (~100k msgs/month or non-technical authorship need) |
| 2 | **No voice calls** — no IVR, no call logging, no click-to-call | Phone contact stays a logged `visitor_follow_ups` outcome (`phone` channel), not a channel send |
| 3 | **Push needs explicit device opt-in** — no silent registration, no marketing push, no push without a stored device-token grant | Per-device toggle + `consent_records` grant; off/invalidated token = no send, recorded as excluded |
| 4 | No Email reply inbox in v1 (conversations cover WhatsApp/SMS only) | Email replies route to the existing staff mailbox; a "reply arrived" note may link from the thread without body import |
| 5 | No mid-pipeline message editing; no cross-channel re-routing from the board | Hold/cancel + resend as a new row (frozen-snapshot invariant) |
| 6 | No full BPMN (parallel joins, SLA engine, escalation chains) | Linear + branch nodes only (§1.6); anything fancier is a v2 proposal |
| 7 | No new notification-center UI (v5 §3 non-goal 7 stands) | `workflow_events` hook consumption via the existing comms log continues |

*Ethics lens: no dark patterns by construction — consent is never pre-ticked (push toggle defaults off, channel checkboxes default off), withdrawing (STOP / toggle off / "ask staff to stop") is as easy as subscribing, and confirmshaming copy ("No, I don't care about my branch") is prohibited in templates. Engagement metrics that would reward spam (e.g. "maximise sends") are explicitly excluded from Analytics; the headline metrics are delivery health and STOP rate.*

---

## 5. Consent / permission model per channel (`explicit_opt_in` stays mandatory)

Unchanged principles (ADR-0009 D1, v4 §4.3): consent resolves at **audience time**, the basis is stored on the recipient row, a send with no resolvable basis is **excluded with a reason — never queued**, and there is **no manual override path**. `explicit_opt_in` stays the mandatory basis for every proactive channel send; the only recorded alternatives are the existing narrow ones (`guardian` for minors, `legitimate_interest` for documented operational-essential reminders, `inviter_vouched` for the single invite message — v4 §3.3).

| Channel | Basis required | Holder | Withdrawal | Notes |
| --- | --- | --- | --- | --- |
| Email | `explicit_opt_in` (or `legitimate_interest` for documented operational-essential: service/meeting reminders) | Person / guardian for minors | Unsubscribe link + "ask staff to stop" + `consent_records` denial; hard bounce → contact invalid | SPF/DKIM/DMARC before first campaign (integrations-addendum I5) |
| SMS | `explicit_opt_in`, `sms` channel | Person / guardian for minors | STOP keyword → denial + exit all enrollments (existing `consent.withdraw`); honour DND/NCC | Sender ID registered (I3); fallback SMS still needs SMS consent |
| WhatsApp | `explicit_opt_in`, `whatsapp` channel + provider-approved template | Person / guardian for minors; **no WhatsApp to minors directly** (v4 §2.3 hard rule, enforced in resolver) | STOP → same as SMS; template gate blocks unapproved sends | `approval_status = approved` + `provider_template_id` mandatory |
| Push | **`explicit_opt_in` per device** (new): member toggle + registered device token | Member (own devices only); guardians toggle for a minor's supervised device | Toggle off, token invalidation, or denial → excluded; no re-registration without a fresh toggle | Operational-only in v1; marketing push is a non-goal |
| Conversations (inbound) | Reply does **not** create marketing consent | Thread participant | A reply containing STOP withdraws; any other reply flags for officer follow-up, never auto-enrols | Inbound body storage gated on OQ-M1 |

**Permission deltas** (extend data-model-v4 §5, same enforcement: server-side Directus policies, UI only hides):

| Action | Area admin | Branch admin | Welfare officer | Member |
| --- | --- | --- | --- | --- |
| Compose Email / unified send (own scope) | Yes | Own branch | — (assigned threads only, no bulk send) | — |
| Triage + assign conversations | Yes | Own branch | Assigned threads (R + outcome log, no bulk) | Own threads (status + reply + STOP) |
| Publish flows | Yes (cross-scope) | Own branch | — (read) | — |
| Push operational send | Yes | Own branch | — | Manage own devices + toggle |
| Read analytics | All | Own branch | Assigned slice (redacted) | Own message status only |
| Retry failed (idempotent, once) | Yes | Own sends | — | — |

Field-level: `contact_value`, `error_detail`, `provider_message_id` stay restricted (member sees status only — v4 §5.1 stands); inbound bodies (if approved) are restricted to assigned officer + branch/area admins; device tokens are restricted to self + area/super admins.

---

## 6. Provider / integration implications

Reuse first: every channel still resolves through `communication_channels → notifier_transport → worker → provider` (integrations-addendum §9). No new service, no new secret store, no credential in docs/DB/UI (`secret_ref` only).

| Channel | Provider | Integration delta | Secret ref | Lead time |
| --- | --- | --- | --- | --- |
| Email | SMTP (existing, Symfony Mailer) | None new; add unsubscribe-tag + bounce → invalid-contact handling stays | `env.SMTP_DSN` (unchanged) | Domain hygiene in MVP (I5) |
| SMS | Termii (existing), Twilio/Infobip fallback | None new; unified compose is IA-only | `env.TERMII_API_KEY` (unchanged) | Sender ID + rate card (I3) |
| WhatsApp | Meta Cloud API via BSP (existing) | **Inbound + status webhooks become load-bearing** (delivery/read/inbound for pipeline + conversations, not just fallback timing); template-approval gating extends to flow nodes | `env.WHATSAPP_TOKEN` (unchanged) | WABA + template approval (I1–I2); confirm read/inbound webhook availability (OQ-R5) |
| Push | **New: FCM (Android/Web) + APNs-via-FCM (iOS)** | New transport in the Notifier worker; token register/invalidate endpoints; `delivery_status` events (`accepted/delivered/disabled_token`); channel kill switch from day one | `env.FCM_SERVER_KEY` (or service-account ref), referenced by name only | Procurement: create FCM project, name the key holder (owner: CEO, same pattern as I1–I4) |
| Telegram | Unchanged (staff alerts only) | One new alert: pipeline stall / analytics threshold breach via existing `notify.telegram` | `env.TELEGRAM_BOT_TOKEN` (unchanged) | — |

Failure handling follows the existing contract: queue + idempotent retry with keys, redacted errors, provider incident → `communication_channels.enabled = false` for that channel (runbook `pause-all` pattern).

---

## 7. Data-model implications (new collections)

Reuse first (v4 §1 reuse rule applies): `people`, `visitors`, `households`, `events`/`event_registrations`, `communications` + `communication_recipients` (the single delivery log — extended, not forked), `message_templates`, `consent_records`, `communication_channels`, `campaigns`/`campaign_steps`/`campaign_audiences`/`campaign_enrollments`/`campaign_runs`, `visitor_follow_ups`, `leadership_positions`, Area → Zone → Branch scope.

**4 new collections + extensions:**

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `conversation_threads` | One thread per (contact × channel-group): the inbox unit | `contact_person` (nullable) / `contact_visitor`, `contact_key` (hashed phone/token), `channel_group` (`sms_whatsapp` / `push_thread` note), `assignee`, `status` (`open/assigned/resolved/stop`), `guardian_held` (bool), `last_inbound_at`, `branch/zone` denorm |
| `conversation_messages` | Append-only message rows in a thread (outbound refs + inbound, gated) | `thread`, `direction` (`out/in`), `communication` + `recipient` (outbound link — status lives there), `inbound_body` (nullable, gated on OQ-M1), `inbound_class` (`question/stop/other`), `actor`, `created_at` |
| `push_device_tokens` | Registered opt-in devices | `member_person`, `directus_user`, `platform` (`android/ios/web`), `token_hash` (sha256; no plaintext token at rest), `opted_in_at/by`, `invalidated_at`, `last_delivered_at`, `scope_branch` |
| `flow_definitions` | Visual-flow source compiled to campaigns (v1: 1 flow = 1 campaign) | `campaign` (M2O, nullable until publish), `canvas_json` (nodes/edges snapshot), `version`, `status` (`draft/published/archived`), `published_by/at` |

**Extensions (no new log tables):**

| Collection | Field(s) | Notes |
| --- | --- | --- |
| `communications` | `flow_definition`, `thread` (nullable M2O) | Flow-sourced sends trace to the canvas version; thread-linked sends trace to the inbox |
| `communication_recipients` | `channel_resolved` (`whatsapp/sms/push/email`), `fallback_state` (`none/pending/sent`), `push_token` (M2O nullable) | Unified-send resolution + fallback + push target recorded per recipient |
| `consent_records` | `consent_channel += push`, `device_token` (M2O nullable) | Push grants are per-device rows; withdrawal invalidates the token |
| `message_templates` | `category += push_notification` (title + body ≤ 240 chars), `email_subject/body` use stays | Push templates are short operational copy only |
| `campaign_runs` | `flow_node` (nullable), analytics rollups stay query-side | Node attribution without a new table |

**Invariants:** one delivery log (no parallel tables); recipient rows freeze rendered text + consent basis (push included); inbound bodies exist only under the OQ-M1 decision; device tokens stored as hashes; flow publish freezes a canvas snapshot + campaign version; deletes prohibited (archive/close/withdraw instead); consent withdrawal exits enrollments and invalidates push tokens.

---

## 8. User stories (acceptance hooks for estimation, not build)

**US-M1 — Send Email properly.** As a branch admin, I want to compose, preview, test-send, and queue an Email announcement so that I stop routing copy through an admin.
- AC1: Subject + body (template or Email-only free-form) with `{{variables}}`; rendered preview with scoped sample data.
- AC2: Eligible/excluded counts with reasons before queue; approval gate above bulk threshold.
- AC3: Test send to self; queued send creates one log batch; bounce marks contact invalid.
- AC4: No send without a resolvable basis; minors' addresses never directly targeted (guardian instead).

**US-M2 — Send once, reach them.** As a welfare officer, I want one compose for WhatsApp-first with SMS fallback so that I do not double-send.
- AC1: Per-recipient channel resolution shown before send; fallback state visible after send.
- AC2: Unapproved WhatsApp template blocks with the reason named; SMS path stays available where consented.
- AC3: Quiet-hours shift and caps applied and stated.

**US-M3 — Work the inbox.** As a welfare officer, I want assigned threads with actions so that no reply waits silently.
- AC1: Threads queue by oldest-unresolved first (*Goal-Gradient*); assignment limited to Welfare-position holders in-branch.
- AC2: Actions: reply (consented channel, template-bound for WhatsApp), log outcome, open welfare case on `needs_support`, capture consent, mark STOP.
- AC3: STOP writes denial + exits enrollments; the thread shows `stop` terminally.

**US-M4 — See where messages are.** As a branch admin, I want the pipeline board so that stuck sends are obvious.
- AC1: Columns draft/queued/sent/delivered/failed with counts; read sub-state + fallback badge; filters by channel/campaign/branch/date/reason.
- AC2: Every count drills into the filtered recipient list; single idempotent retry; hold/cancel queued (never edit).

**US-M5 — Toggle push.** As a member, I want a per-device reminders toggle so that I control push.
- AC1: Toggle registers the device; off/invalidated token stops sends with an excluded reason.
- AC2: Only operational reminders arrive in v1; no marketing push exists to receive.
- AC3: Member sees own devices and can remove one.

**US-M6 — Build a flow visually.** As an area admin, I want trigger/message/branch/wait/exit nodes so that a welcome drip with a reply branch is self-service.
- AC1: Allowlisted branch conditions only; canvas compiles to campaign rows; eligible/excluded preview + test before publish.
- AC2: Quiet-hours banner with shift-to-08:00 behaviour stated; unapproved-template node blocks publish with the reason.
- AC3: Publish freezes version; runtime stays the existing tick (no new scheduler to monitor).

**US-M7 — Prove it landed.** As an area admin, I want delivery/funnel/engagement/cost views so that I can fix what is broken.
- AC1: Delivery by channel × branch × week; funnel sent→delivered→read→replied→converted; STOP-spike and failure-rate alerts; spend vs cap.
- AC2: All counts drill into data; CSV export scoped; no metric requires uncollected PII.

---

## 9. Open questions (recommended defaults; estimate proceeds on defaults)

| # | Question | Recommended default | Owner |
| --- | --- | --- | --- |
| OQ-M1 | May v1 store inbound WhatsApp/SMS bodies, or timestamps + STOP classification only (existing minimisation)? | Timestamps + classification only until board + DPCO approve body storage; inbox ships with metadata + reply-compose, bodies gated | Board + DPCO + CTO |
| OQ-M2 | Push provider + key holder? | FCM (+ APNs-via-FCM); key holder CEO, same pattern as I1–I4; web-push/PWA first, no native wrappers in v1 | CEO + CTO |
| OQ-M3 | Unified-send channel preference when both consents exist? | WhatsApp-first, SMS fallback after 4h (existing rule); per-recipient override only by explicit staff choice | CTO |
| OQ-M4 | Do flow branches need new condition types beyond the v4 allowlist? | No — allowlist only; new predicates need SecurityEngineer review (audience resolver is a data-access boundary) | SecurityEngineer + CTO |
| OQ-M5 | Email free-form body — who may author? | Branch admin+ within scope; templates stay the default; all free-form sends keep frozen snapshots + audit | Board + CTO |
| OQ-M6 | Conversations SLA (first-response target)? | 24h branch triage; unassigned >3 days surfaces (same rule as newcomers); no auto-escalation in v1 | Welfare lead + CTO |
| OQ-M7 | Analytics retention for recipient-level rows? | Follow the existing retention policy (base PRD §7.5); aggregates keep no PII beyond the log tables | Board |

---

*Companion: `wireframes-v5` (this issue). Planning only — visual design, component library, and the WCAG 2.1 AA pass stay gated on the design system (AFC-152), per board instruction; this set fixes structure and behaviour.*
