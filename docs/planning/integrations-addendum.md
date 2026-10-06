# Integrations Addendum v4 — Campaigns, Invitations & Newcomer Messaging

**Issue:** AFC-151 · **Parent:** AFC-146 · **Updates:** [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec) (AFC-150 v1)
**Owner:** CTO (MediaTech) · **Version:** v1 (2026-10-05)
**Planning only — no code, no deployments, no secrets, no live calls.**

This addendum covers the **deltas** the round-4 scope creates in the channel flows. Everything not listed here (Gravatar, Telegram, Backup, Users Management, import/export) is **unchanged** and remains as specified in [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec). The transport stack itself (Symfony Notifier worker, Symfony Mailer + SMTP, Termii for SMS, BSP for WhatsApp) is **unchanged** per [comms-adr](/AFC/issues/AFC-149#document-comms-adr).

---

## 0. Delta summary

| # | Delta | Why | Integration impact |
| --- | --- | --- | --- | --- |
| 1 | **WhatsApp activity signals** | The 4-hour SMS fallback needs delivery/read evidence | **New:** read/delivered webhook handling is now a hard requirement, and the "no read receipts" case must be handled explicitly |
| 2 | **WhatsApp template approval sync** | Campaign steps and invitations may only send approved templates | **New:** `approval_status` gating + a review step in the delivery pipeline |
| 3 | **Inbound replies and STOP** | Newcomer follow-up and invitations create reply traffic | **New:** inbound webhook normalisation → `delivery_status = read`, `consent_records` withdrawal |
| 4 | **Campaign scheduler (internal, no secret)** | Automations must fire | **New internal surface:** `campaign-tick` in the Notifier worker + a cron entry |
| 5 | **Birthday webhook becomes optional** | The in-app greetings campaign replaces it as the default path | **Changed:** default destination is the campaign engine; the outbound webhook stays supported |
| 6 | **Cost and cap observability** | Automations can spend money unattended | **New:** per-run cost rollup, daily-cap alerting, and a per-campaign budget signal |
| 7 | **Live-service link** | Service reminders must carry the join link | **Changed:** `events.live_join_url` becomes a template variable |

---

## 1. WhatsApp — activity signals (new, required)

**Why:** board item #1 is *"check WhatsApp activity; send SMS after 4 hours if the person is registered on WhatsApp but not active."* This is the only board requirement that depends on a **status signal we do not fully control**.

| Signal | Meaning | Source | Use in the fallback rule |
| --- | --- | --- | --- |
| `accepted` | provider accepted the message | send response | not activity |
| `delivered` | delivered to the handset | status webhook | **counts as activity proxy** |
| `read` | opened by the recipient | read-receipt webhook | **counts as activity** |
| `inbound_reply` | the recipient replied in the 24h window | inbound webhook | **counts as activity** (and is a follow-up opportunity) |

**Honest constraint:** whether `read` and `inbound` webhooks exist **depends on the BSP**. Some BSPs expose status webhooks only up to `delivered`; read receipts require the conversation to be inside the customer-service window and the recipient's client to report it.

**Recommended default (OQ-R5):** design the rule on **`delivered_at` as the activity proxy**, and treat `read`/`inbound` as *additional* signals that shorten the timer when available. The fallback therefore fires 4 hours after send when **no** signal has been recorded. Implement as a single predicate `has_activity(recipient)` in the worker so the rule can be tightened later **by configuration, not by a rewrite**.

```
has_activity(r) = r.delivered_at != null
               or r.read_at      != null
               or inbound_reply_at(r) != null
```

**Rules**

- Timer starts at `sent_at`, not at `queued_at`.
- One fallback per person per 24 hours per campaign family (`campaigns.fallback_sms_after_hours` = 4; the cap is separate).
- If the person has no **SMS** consent, no fallback is sent; the recipient row is written as `excluded` with `no_consent` so the branch can see the gap and follow up by phone.
- If the fallback send fails, the run records `failed`; the system never retries the fallback beyond provider policy.
- The run's `notes` field states which signals were available for that run, so a "we sent SMS too eagerly" report can be diagnosed rather than guessed.

**Webhook surface (unchanged in shape, extended in events):**

| Event | Handler | Effect |
| --- | --- | --- |
| `status` = delivered | `comms.delivery_webhook` | set `delivered_at`; cancel any pending fallback check |
| `status` = read | `comms.delivery_webhook` | set `read_at`; cancel pending fallback; record `last_contact_channel = whatsapp` |
| `status` = failed/undelivered | `comms.delivery_webhook` | set status + redacted error; **fallback may fire immediately** (a failed delivery is already "no activity") |
| inbound text | `comms.inbound` | store the inbound time (no free-form reply storage in v1 beyond the timestamp and STOP detection); set `read_at`; record `last_contact_channel` |
| inbound `STOP`/`UNSUBSCRIBE`/`END`/`CANCEL` | `comms.inbound` → `consent.withdraw` | write `consent_records.granted = false` for that channel; **exit all active campaign enrollments**; block future sends and invitations |
| inbound anything else (newcomer only) | `comms.inbound` | flag the visitor record `reply_received` for the officer's follow-up list |

*Privacy lens:* v1 stores **no inbound message bodies** — only timestamps and the STOP classification. Storing congregants' message content is a data-minimisation decision we are not making yet; it can be revisited with the DPCO.

---

## 2. WhatsApp — template approval (new, gating)

- Every WhatsApp send (campaign step or invitation) requires `message_templates.approval_status = approved` and a non-empty `provider_template_id`. A Directus Flow gate (`campaign.template_gate`, `invite.template_gate`) **blocks activation/enqueue** otherwise, and the UI states which template is not approved.
- **New enum value** `approval_status = pending_provider` for templates submitted to Meta and awaiting review.
- **Template review is a lead-time task, not an engineering task.** Procurement must start in MVP: submit the ~8 campaign templates plus `event_invitation` and `visitor_welcome_wa` for approval **before** the P3 build. Templates cannot be built in one sitting and go live immediately.
- **Naming/versioning:** template keys are stable (`visitor_welcome_wa`, `visitor_welcome_sms`, `visitor_weekly_checkin`, `visitor_service_reminder`, `dropoff_appointment`, `event_invitation`, `birthday_greeting`, `memory_verse`, `service_reminder`, `meeting_reminder`, `whatsapp_fallback_sms`). Changing approved template **variables** requires a new provider template version and a new `provider_template_id`; changing **wording** only requires a new internal `message_templates` revision plus a re-approval if Meta treats it as a material change.
- **Rotation:** `message_templates.rotation_key = memory_verse` lets the weekly verse campaign select deterministically by ISO week, so a re-run of the same week sends the same verse (idempotency is a content property, not just a data one).

## 3. SMS — unchanged transport, new volume profile

Transport, secret ref, sender ID and cost model are **unchanged** (`env.TERMII_API_KEY`, registered sender ID, NGN billing, DND/NCC compliance). What changes is volume and guardrails:

| Guardrail | Value | Where enforced |
| --- | --- | --- |
| Daily per-channel cap | `communication_channels.daily_cap` (NGN) | `comms.cost_guard` + the tick |
| Bulk approval threshold | >200 recipients or the agreed naira amount | `campaigns` activation requires approval |
| Per-person frequency cap | marketing ≤3/week; SMS fallback ≤1/24h | audience resolution |
| Quiet hours | 20:00–07:00 `Africa/Lagos` | tick (steps shift to 08:00 unless `operational_essential`) |
| Nigerian numbering | E.164 normalised; invalid/short codes excluded as `invalid_contact` | audience resolution |

*Cost lens:* SMS is the only per-message cost in the daily plan. The estimate is **NGN 4–8/message** depending on the provider and segment; at the 20–35k/month ceiling that is a **NGN 80,000–280,000/month** worst case *if every message went by SMS*, which it will not (WhatsApp is preferred where consented). Set `daily_cap` per channel from the real rate card at procurement time — do not guess it into the config now. *Every dollar has an owner: the area admin is the owner, the cap is the control.*

## 4. Email — unchanged, plus one template variable

SMTP via Symfony Mailer remains the default and the only transport change is additive:

- `service_reminder` and `event_invitation` templates gain `{{live_join_url}}` (from `events.live_join_url`) so online attendees get the link.
- Meeting reminders continue to use email as the fallback channel for people without a consented messaging channel (`operational_essential` basis).
- `meeting_reminder` uses `tasks`/`office_minutes`/`leadership_appointments` as its trigger source — **no new integration**, just a new audience/trigger over existing collections.

## 5. Campaign scheduler — internal integration surface (new, no new secret)

| Item | Detail |
| --- | --- |
| What | A `campaign-tick` command in the **existing** Symfony Notifier worker (Docker Compose service already planned) |
| Cadence | Every minute, single-instance lock, chunk size 500 |
| Inputs | `campaign_enrollments` (indexed `(state, next_step_at)`), `campaign_steps`, `campaign_audiences` |
| Outputs | `communications` + `communication_recipients` rows; then the existing `POST /internal/send` |
| Auth | Internal Docker network only; same signed-request convention as `/internal/send` |
| Secrets | **None new.** Reuses the worker's existing env/secret bindings |
| Observability | Tick duration, enrollments processed, exclusions by reason, chunk failures → structured log + a metric; failure raises a staff alert via the existing Telegram channel |
| Failure | Idempotent per `(step, person, window)` key; a failed chunk leaves the remainder for the next tick; **no** send is lost because nothing is deleted — it stays `queued` |
| Kill switch | `campaigns.status = paused` (holds pending enrollments) and `communication_channels.enabled = false` (holds a whole channel); both take effect within one tick |

*Deployment lens:* the tick is a new entry point in an existing container — a one-line Compose command change, redeployable independently of Directus, with a rollback of "remove the cron line." No data migration is involved in either direction.

## 6. Weekly birthday-reminder webhook — now optional (changed)

- **Before:** a scheduled Directus Flow POSTed a signed JSON payload to a configurable external URL so an outside system could send greetings.
- **After:** the **default destination is the in-app campaign engine** — a daily scheduled Flow builds the birthday/anniversary audience and hands it to `birthday_anniversary_greeting`. The external webhook **remains supported** and configurable, for any branch that genuinely wants to push greetings into another system.
- **Unchanged:** HMAC-SHA256 signature header, `env.BIRTHDAY_WEBHOOK_SECRET` referenced by name, payload carries **IDs and names only — no phone or email**, `Idempotency-Key: birthday:{week_start}`, retry with backoff.
- **Reason for the change:** the [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr) decision. Routing greetings through an external system would re-create the second-source-of-truth problem we just rejected. Keeping the webhook is cheap and reversible; defaulting to it would be inconsistent with our own decision.
- **Cadence change:** the in-app path runs **daily** (so a birthday is never missed because the week was short) with a 7-day lookahead visible for preparation; the external webhook keeps its weekly cadence.

## 7. Telegram — unchanged, one new staff alert

Telegram remains **staff-only, outbound-first, personal data excluded from message text**. New alert added to the existing `notify.telegram` set:

- **Campaign anomaly:** a run that fails, exceeds its daily cap, or sends >X recipients in one window posts a short alert with ids and counts (no message content).

## 8. Cost, caps and observability (new)

| Signal | Where | Alert when |
| --- | --- | --- |
| Per-run estimated + actual cost | `campaign_runs.estimated_cost` / `actual_cost` | run cost > campaign budget |
| Daily channel spend | `communication_channels.daily_cap` vs `communications.estimated_cost` (summed today) | ≥ 80% of cap → warn; 100% → channel auto-pauses, staff alerted |
| Delivery health | `campaign_runs` counts | failure rate >5% in a window |
| Consent withdrawals | `consent_records.granted = false` count/day | a spike (>3× the 30-day median) → review templates |
| Tick health | worker log/metric | tick duration > 60s or a chunk failure |

*SLOs over SLAs:* the internal target is **"a due campaign step begins within 5 minutes of its window 99% of the time"** — that is the number to alert on, not "the campaign ran."

## 9. Integration summary — deltas only

| Integration | Change | Secret ref | Phase |
| --- | --- | --- | --- |
| WhatsApp (BSP) | **read/delivered/inbound webhooks required**; template approval gating | `env.WHATSAPP_TOKEN` (unchanged) | procurement in MVP, live in P3 |
| SMS (Termii) | volume + caps; transport unchanged | `env.TERMII_API_KEY` (unchanged) | P3 |
| Email (SMTP) | `{{live_join_url}}` variable added | `env.SMTP_DSN` (unchanged) | MVP |
| Telegram | one new campaign-anomaly alert | `env.TELEGRAM_BOT_TOKEN` (unchanged) | P3 |
| Birthday webhook | **optional**; default destination is the campaign engine | `env.BIRTHDAY_WEBHOOK_SECRET` (unchanged) | P3 |
| Campaign tick | **new internal surface** in the Notifier worker | **none** | P3 |
| Gravatar / Backup / Users / Import-export | unchanged | unchanged | as before |

**Provider abstraction is preserved.** Every channel still resolves through `communication_channels → notifier_transport → worker → provider`. A campaign step does not know which provider it is talking to, and swapping providers remains a DSN/config change. *Build-vs-integrate lens: we own the integration surface in both cases; the difference is that we now own one more small internal loop, not another external system.*

---

## 10. Procurement and lead-time actions (no code)

| # | Action | Owner | Needed by |
| --- | --- | --- | --- |
| I1 | Choose the WhatsApp BSP; confirm whether it exposes **read** and **inbound** webhooks (settles OQ-R5) | CTO + CEO | before template submission |
| I2 | Register the WABA and submit the ~8 campaign/invitation templates for approval | CEO + branch leads | MVP (long lead time) |
| I3 | Register the SMS sender ID with Termii; confirm DND handling and the real rate card | CEO | P3 |
| I4 | Set `daily_cap` per channel from the real rate card; approve the bulk-send threshold (decision C7) | Board + CTO | P3 |
| I5 | SMTP domain hygiene (SPF/DKIM/DMARC) before the first campaign | CTO | MVP |
| I6 | Security review of the tick, the audience resolver and the inbound handler | SecurityEngineer | before P3 go-live |

**No credentials appear in this document, in the database, or in the UI. Every value is referenced by name through the Paperclip secret flow.**

---

*Companion: [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4), [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4), [wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3), [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr), [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec), [comms-adr](/AFC/issues/AFC-149#document-comms-adr).*
