# ADR — Marketing Automation: Build In-App, Not Mautic

**ADR id:** ADR-COMM-002 · **Issue:** AFC-151 · **Parent:** AFC-146 (Church Portal)
**Owner/Author:** CTO (MediaTech) · **Status:** Proposed → **Recommendation for board decision**
**Date:** 2026-10-05 · **Planning only — no code, no deployments, no secrets.**
**Deciders:** CEO (recommended), CTO (author), Board (approve/reject), SecurityEngineer (review before implementation)
**Supersedes:** nothing. **Companion:** [comms-adr](/AFC/issues/AFC-149#document-comms-adr) (Symfony Notifier worker + SMTP), [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4) §4, [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4) §4, [integrations-addendum](/AFC/issues/AFC-151#document-integrations-addendum)

---

## 1. Decision (read this first)

**Build the automation in-app. Do not add Mautic.**

- The capability is: campaigns, steps/sequences, audiences, schedules, channels, consent, and a delivery log.
- It is built on what we already decided and already operate: **Directus Flows** (triggers and simple logic) + the **Symfony Notifier worker** (rendering and sending) + **five new tables** (`campaigns`, `campaign_steps`, `campaign_audiences`, `campaign_enrollments`, `campaign_runs`).
- The delivery log is not new: it is the existing `communications` + `communication_recipients` pair, the same log used for hand-sent messages. One log, one source of truth.
- **No second contact store. No second database. No second service to operate. No new secret.**

This confirms the CEO's recommendation and answers the board's question: *"Do we handle everything within the app, or connect with Mautic? Something simple is all we need, with no complexity."* — The answer is **in-app**, and it stays simple because the eight things the board asked for are **not** marketing-automation features; they are eight scheduled/triggered message jobs we have already modelled.

---

## 2. Context and drivers

**What the board asked for (round 4):** WhatsApp-activity check with an SMS fallback after 4 hours · birthday/anniversary greetings · new-visitor welcome drip · new-convert drip · weekly memory verses · service reminders with a live-service link · meeting reminders · event invitations.

**Constraints:**

| Constraint | Source |
| --- | --- |
| Postgres 16 is the system of record | [AFC-147](/AFC/issues/AFC-147), plan §6/§7 |
| `people` + `consent_records` are the contact and consent truth | [data-model-addendum](/AFC/issues/AFC-148#document-data-model-addendum) §3 |
| Outbound goes through the Symfony Notifier worker, Directus stays the record | [comms-adr](/AFC/issues/AFC-149#document-comms-adr) |
| NDPA 2023 + NDPC obligations (DSAR, erasure, consent, breach runbook) | [ndpa-compliance-checklist](/AFC/issues/AFC-149#document-ndpa-compliance-checklist) |
| Self-hosted production on our own VPS, ~$14–32/month baseline | plan §6/§7 |
| 6 zones, >15 branches, 80+ BSCs, ~10–20k people, >60 staff users | [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) §0 |
| "Something simple, with no complexity" | board, round 4 |

**Volume reality check (the number that decides this).** There are ~10–20k people and ~2–5k weekly service attenders. Our monthly outbound ceiling across all eight families is:

| Family | Recipients/month (estimate) |
| --- | --- |
| Weekly memory verses | 8,000 – 12,000 |
| Service reminders (2/Sunday) | 10,000 – 20,000 |
| Birthday & anniversary greetings | 200 – 500 |
| Newcomer weekly check-ins + service reminders | 500 – 1,500 |
| New-visitor / new-convert drips | 300 – 1,000 |
| Meeting reminders | 300 – 800 |
| Event invitations | 100 – 400 |
| **Total ceiling** | **≈ 20,000 – 35,000 messages/month** |

*These are planning estimates, to be replaced with measured numbers once campaigns run (observability lens: instrument before optimising).* Marketing suites earn their keep at hundreds of thousands of messages per month and tens of thousands of contacts with complex segmentation. We are an order of magnitude below that, and our *interesting* problem is not campaign throughput — it is **consent, guardianship for minors, and branch-level scoping**, none of which a marketing suite answers for us.

---

## 3. Options considered

### Option A — In-app campaigns on Directus Flows + the Notifier worker (RECOMMENDED)

| | |
| --- | --- |
| What | 5 tables + 1 idempotent scheduler tick inside the worker we already run. Flows for triggers; the tick for "which steps are due". |
| Contacts | One store: `people` / `visitors`. One consent store: `consent_records`. |
| Delivery log | `communications` + `communication_recipients` — already designed, already permission-scoped, already immutable. |
| Database | Postgres only. |
| New services | **None.** |
| New secrets | **None.** |
| Cost | Inside the existing VPS. Engineering: ~2 weeks for the engine + ~1 week per campaign family. |
| Risk | We own the engine; it is ours to maintain. Mitigated: ~5 tables, one tick, one pure "what's due" function that is unit-testable. |

### Option B — Add Mautic (self-hosted)

| | |
| --- | --- |
| What | A second application (PHP/Symfony) with its own admin UI, campaign builder, segments, contact timeline, and **its own contacts database**. |
| Contacts | **A second source of truth.** Mautic stores contacts, companies, points, segments of its own. Our `people` and Mautic's contacts must be kept in sync forever. |
| Database | **A second database engine.** Mautic supports **MySQL/MariaDB only — no PostgreSQL** (verified 2026-10-05). We would run a MySQL instance beside Postgres 16, with its own backups, upgrades, credentials and monitoring. |
| Runtime | Mautic needs its own web process, queue worker and cron runner; Mautic 5+ also requires **Node/npm for the build**, and Mautic 7.x requires PHP ≥ 8.2 with MySQL ≥ 8.4 / MariaDB ≥ 10.11 (verified 2026-10-05). |
| Resources | Documented guidance: 2 GB RAM minimum, 4 GB recommended, PHP `memory_limit` 512 MB. Our 4 vCPU / 8 GB VPS already hosts Directus, Postgres, Nuxt and the Notifier worker. Adding Mautic means an **upsize or a second server**. |
| WhatsApp | **Not in core.** WhatsApp requires a third-party plugin — e.g. a GPL Zender-transport plugin (requires Mautic ≥ 6.0.5) or a commercial plugin. We would therefore still own a WhatsApp transport; Mautic would only wrap it. |
| Licence | GPL-3.0 (`LICENSE.txt`, 7.x — verified 2026-10-05). Running it internally is fine; it is not AGPL, so there is no network-copyleft obligation on our app. But it is a large copyleft codebase whose plugins we would have to track and patch. |
| Cost | Extra VPS capacity, a second DB, plugin licences if any, plus integration engineering and permanent sync work. |
| What we gain | A visual campaign builder, lead scoring ("points"), landing pages and forms, A/B testing, dynamic content, a rich contact timeline, and a polished segment UI. |
| Verdict | **Rejected.** We would take on a second database, a second contact truth, and a second operational surface to obtain a UI for campaigns whose real difficulty is consent and scoping — problems Mautic does not solve. |

### Option C — Hybrid (Mautic for campaigns, the app for transactional)

| | |
| --- | --- |
| What | Mautic owns broadcasts/drips; Directus Flows + Notifier keep transactional messages (welcome, service reminders, invitations). |
| Cost of the hybrid | **The worst of both.** Two campaign engines, two delivery logs, two "what did we send" answers, two consent states to reconcile, and a sync job between a MySQL contact store and Postgres. Duplicate sends are the default failure mode. |
| Verdict | **Rejected.** Hybrid is justified only when neither half can do the job alone. Here the in-app half can do all eight, so the hybrid pays complexity for nothing. |

### Option D — Defer automation; keep manual sends

Rejected: WhatsApp/SMS onboarding has provider lead time and the manual path is exactly what the board is trying to get away from. Deferring is not cheaper, it is just later.

---

## 4. Trade-off summary

| Dimension | A — In-app (chosen) | B — Mautic | C — Hybrid |
| --- | --- | --- | --- |
| Contact source of truth | **One** (`people`/`visitors`) | **Two** (ours + Mautic contacts) | Two |
| Consent source of truth | **One** (`consent_records`) | **Two** (Mautic DNC + ours) | Two |
| Delivery log | **One** (`communications`) | Two (Mautic + ours) | Two |
| Database engines | **1** (Postgres) | 2 (Postgres + **MySQL required**) | 2 |
| Services to operate | Directus, Postgres, Nuxt, Notifier worker | **+ Mautic web, worker, cron, MySQL** | + Mautic and its glue |
| New secrets | **0** | Provider tokens, DB creds, plugin creds | same as B |
| Campaign UI | Ours (basic: list, steps, preview, counts) | **Mature visual builder** | Mature |
| Lead scoring / landing pages / A-B | No | **Yes** | Yes |
| Channel fit for WhatsApp-first outreach | **Direct** (our Notifier transport) | Needs a **third-party plugin** | Needs a plugin |
| DSAR / erasure under NDPA | **One system to purge** | **Two systems to purge + reconcile** | Two |
| Fit with "simple, no complexity" | **Yes** | No | No |
| Effort to first campaign | ~2 weeks | ~2 weeks integration + ongoing sync | ~3 weeks + glue |
| Ongoing maintenance | 5 tables, 1 tick | Mautic + MySQL + plugins + sync | worst of both |
| Reversibility | Data in our DB, CSV export | Contacts stranded in Mautic | stranded |

**Build-vs-buy lens (the rule we use):** the cheapest *total-cost* answer wins. "Buy" here would mean paying with a second contact store, a second database engine, a second backup/monitoring lane, and permanent two-way sync — in exchange for a nicer campaign UI we do not need at 20–35k messages/month. Total cost says build. The [comms ADR](/AFC/issues/AFC-149#document-comms-adr) already applied the same rule in the opposite direction (buy Symfony Notifier's provider breadth rather than write every provider integration); here there is **no breadth to buy**, because every capability we lack is a UI nicety, not an integration.

---

## 5. What we deliberately give up, and how we compensate

| We give up | Why it is acceptable now | Compensation |
| --- | --- | --- |
| Visual drag-and-drop campaign canvas | Our campaigns are 9 named, repeatable shapes, not ad-hoc marketing | A step-list editor with preview, eligible/excluded counts, and one-click activate |
| Lead scoring / points | The church's "lead" is "a person who attended and came back"; we already measure that | Newcomer funnel + time-to-convert reporting is a better signal for us than a score |
| Landing pages and form builder | Registration already exists in the portal; public pages are the Nuxt app | Keep the portal's public registration; add no new landing-page builder |
| A/B subject-line testing | Message volume per campaign is hundreds, not hundreds of thousands; significance would never arrive | Versioned templates + a 7-day lookahead so content is ready before it is needed |
| Dynamic content blocks | We have 8 fixed templates with named variables | Template variables already modelled (`message_templates.variables`) |
| Mautic's contact timeline UI | Our `communications` + `communication_recipients` + `visitor_follow_ups` are the timeline, and they are permission-scoped | A person-profile communications section (single-page profile, PRD §1) |
| Non-technical campaign authoring by branch staff | Branch staff send from templates; area admin configures campaigns | Templates are branch-editable; campaign structure is admin-only by design (least privilege) |

**Honest statement of the main risk:** if the church later wants branch staff to build their own multi-step campaigns with their own audiences without an admin, our step-list editor will feel slower than Mautic's canvas. We accept that for now and name it as a revisit trigger in §8.

---

## 6. Consequences

**Positive**

- One contact store, one consent store, one delivery log. **A DSAR or an erasure is one operation in one database** — this is a direct NDPA/GAID win, and it is the single strongest argument.
- Channel coverage matches our actual need: WhatsApp and SMS, through transports we already specified, with provider-approved templates enforced.
- Branch scoping and field-level restrictions work unchanged, because campaigns live inside the same permission model as everything else.
- Cost stays inside the existing VPS; no new line item, no new secret.
- Every campaign run is auditable: audience, eligible, excluded-by-reason, sent/delivered/failed, cost, campaign version.

**Negative / accepted**

- We own the engine (~5 tables + a tick loop). Accepted: it is small, ordinary, and testable.
- No marketing-grade UI. Accepted with the revisit trigger.
- Branch staff cannot author campaigns. Accepted in exchange for a small permission surface.

**Reversibility (two-way door).** If we later adopt a marketing suite, the data is already ours in ordinary relational tables with CSV export, and the audience definitions are stored as **allowlisted predicates** (not SQL strings) in `campaign_audiences.filter`. Migrating means exporting an audience and replaying it into the new tool. Nothing in this decision is a one-way door.

---

## 7. Implementation shape (summary; detail in the data model and integrations addenda)

```
Directus Flows  ── triggers only ──▶  enroll / schedule
   visitor entered Welcome            birthday/anniversary today
   person converted                   service/meeting reminder due
   event_invites created              WhatsApp send recorded

Symfony Notifier worker: campaign-tick (every minute, lock, chunk 500)
   1. find campaign_enrollments WHERE state='active' AND next_step_at <= now  (indexed)
   2. resolve the step's audience (allowlisted predicates only)
   3. consent gate + quiet hours + frequency caps + guardian substitution → excluded rows carry a reason
   4. create communications + communication_recipients (frozen rendered text, consent basis)
   5. POST /internal/send (existing contract, idempotent on communication_recipients.id)
   6. write campaign_runs counts; set enrollments.next_step_at or exit
   7. cancelled by consent withdrawal or campaign pause — never silently dropped
```

- **Why the tick lives in the worker, not in nested Flows:** Directus Flows are not a general workflow engine (a named weak spot in the [licence/fit memo](/AFC/issues/AFC-149#document-licence-fit-memo)). A scheduled tick in the service we already operate is cheaper, easier to observe, and testable as a pure function.
- **Kill switches:** `campaigns.status = paused`, `communication_channels.enabled = false`. Both take effect within one tick; neither needs a deploy.
- **Capacity:** the hot path is a single indexed range scan over `campaign_enrollments (state, next_step_at)`. At 20k people this is a small table; if it ever grows past ~1M active enrollments we add partitioning — not before. *Scalability lens: measure the tick duration first; there is no evidence we need more.*

---

## 8. Revisit triggers (what would change this decision)

Re-open this ADR if **any** of the following becomes true:

1. Sustained outbound volume exceeds **~100,000 messages/month**, or contacts exceed ~100k with complex segmentation.
2. Non-technical branch staff must author their own multi-step campaigns with custom audiences **without** an area admin (the §5 risk materialising).
3. We need lead scoring, landing pages, or statistically meaningful A/B testing as a business requirement.
4. The board mandates an off-the-shelf marketing suite as policy (then we compare **Brevo/Twilio Campaigns** — a hosted API, not a second on-premise system — before Mautic).

Until then, the default is: **no external marketing suite.**

---

## 9. Open questions and recommended defaults

| # | Question | Recommended default | Owner |
| --- | --- | --- | --- |
| M1 | Confirm the no-Mautic decision | **Approve Option A (in-app)** | Board |
| M2 | Campaign authoring rights | Area admins configure campaigns; branches send from approved templates | CTO + CEO |
| M3 | Recheck monthly volume estimate with measured data | Instrument per-campaign counts in `campaign_runs`; revisit at 100k/month | CTO |
| M4 | Would a hosted suite be acceptable later if triggered | Prefer a **hosted API** suite over another on-premise system (no second DB, no sync) | CTO |
| M5 | Campaign rollback story | Pause the campaign; queued messages are held, never deleted; re-run is idempotent | CTO |
| M6 | Security review of the tick + audience resolver | Required before go-live (audience predicates are a data-access boundary) | SecurityEngineer |

---

## 10. Sources (verified 2026-10-05)

- Mautic requirements (MySQL/MariaDB only; PHP extensions; npm required from Mautic 5) — https://mautic.org/mautic-requirements/
- Mautic 7.x platform requirements (PHP ≥ 8.2, MySQL ≥ 8.4, MariaDB ≥ 10.11) — https://github.com/mautic/mautic/blob/7.x/UPGRADE-7.0.md
- Mautic licence (GPL v3) — https://github.com/mautic/mautic/blob/7.x/LICENSE.txt
- Mautic install docs (PHP `memory_limit` 512 MB suggested; `--db_driver=pdo_mysql` default) — https://docs.mautic.org/en/7.2/getting_started/how_to_install.html
- WhatsApp requires a third-party Mautic plugin, not core — https://github.com/rcarabelli/Mautic-Zender-Plugin (GPLv3, requires Mautic ≥ 6.0.5), https://plugins.topchunks.com/mautic-plugins/docs/whatsapp-plugin/ (commercial)
- Internal: [licence-fit-memo](/AFC/issues/AFC-149#document-licence-fit-memo), [comms-adr](/AFC/issues/AFC-149#document-comms-adr), [ndpa-compliance-checklist](/AFC/issues/AFC-149#document-ndpa-compliance-checklist), plan §6/§7 (self-hosted stack, cost baseline)

*Note on sources: vendor documentation and third-party plugin pages were checked on 2026-10-05. Mautic's requirements and plugin ecosystem change between major versions; re-verify before any future evaluation. This ADR is a technical recommendation, not legal advice.*
