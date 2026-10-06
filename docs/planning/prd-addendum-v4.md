# PRD Addendum v4 — Newcomer Care, Invitations, Campaigns & Single-Page UI

**Issue:** AFC-151 · **Parent:** AFC-146 (Church Portal) · **Updates:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147), [prd-addendum](/AFC/issues/AFC-148#document-prd-addendum) (AFC-148), [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) (AFC-150)
**Owner:** CTO (MediaTech) · **Status:** Draft for board review · **Version:** v4 (2026-10-05)
**Planning only — no production code, no deployments, no secrets.**

**Companion docs (this issue):** [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4), [wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3), [integrations-addendum](/AFC/issues/AFC-151#document-integrations-addendum), [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr)

> **Read order.** This addendum extends the AFC-147 base PRD, the AFC-148 addendum (communications, groups, consent) and the AFC-150 v3 addendum (hierarchy, attendance, youth, campus, leadership). Where it conflicts, **this addendum wins** for the domains it covers (single-page UI, newcomer care, member event invitations, campaigns/automation). Everything else is unchanged and not repeated here.

---

## 0. Change summary — what this v4 adds

The board's round-4 feedback ([plan §0.7](/AFC/issues/AFC-146)) is mostly **depth on two things the last package treated thinly** (newcomer care, automation) plus **one structural UI decision** and **one build-vs-buy question**.

| # | Domain | New / changed | Where modelled |
| --- | --- | --- | --- |
| 1 | Single-page profile & dashboards | Profiles/dashboards render **all** data on one page with a sticky anchor-tab nav; sections deep-link, scroll-spy | §1 |
| 2 | Newcomer (visitor) care | First-class: input, SMS + WhatsApp, weekly check-in & service reminder, follow-up log, welfare-officer assignment, funnel reporting, 5-stage onboarding journey | §2 |
| 3 | Member event invitations | Members submit invitees; invitee receives a WhatsApp template or SMS; consent, rate limit, send/status record | §3 |
| 4 | Mautic vs in-app | **Decision: in-app.** Directus Flows + Symfony Notifier worker + a small campaigns model. No Mautic. | [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr) |
| 5 | Welfare automation campaigns | 8 campaign families with consent, frequency caps, quiet hours, and an auditable delivery log | §4 |

**Three CTO decisions that shape everything below (rationale in each section):**

1. **"One page" is a scoped rule, not a global one.** It applies to the 7 *profile/dashboard* surfaces (person, household, branch, zone, area, BSC, dashboards). Record/detail pages (one welfare case, one campaign run, one event) stay separate pages. *Architecture lens:* a global single-page rule creates an unbounded aggregate and destroys deep-linking to a specific record.
2. **The campaigns engine is ours, and it is small.** No external marketing suite (see the ADR). The engine is ~5 collections plus a scheduler tick in the worker we already operate.
3. **Consent is a hard gate before every send, not a flag.** Any channel send resolves consent at audience-resolution time and records the basis on the recipient row, exactly as the AFC-148 communications design already does. *Security/least-privilege lens + NDPA:* a consent failure is a data-protection incident, not a UI annoyance.

---

## 1. Single-page profile and dashboards

### 1.1 Requirement

Profile and dashboard pages must show **all** of their data on **one page**. Tabs stay **visible while scrolling** and **link to sections (anchors)** — never to separate pages.

### 1.2 In scope / out of scope

| In scope (one page, anchor tabs) | Out of scope (own route, as today) |
| --- | --- |
| Person profile · Household profile · Branch profile · Zone profile · Area profile · BSC profile · Area/zone/branch dashboards | Welfare case detail · Event detail · Campaign detail · Person *form* / create · Reports with filters · Admin screens |

**Why the boundary:** the board's pain is losing context by hopping between tabs to build one mental picture of a person or a branch. A single welfare case has no "other tabs" problem, and forcing it inline would add weight with no benefit.

### 1.3 Behaviour

- **Sticky section nav** at the top of the page: a horizontal tab strip that stays pinned while the page scrolls, `position: sticky`.
- **Anchor links, not routes.** Each tab is `<a href="#profile-milestones">`. The tab set is derived from the user's permissions — a branch admin does not see a Finance tab they cannot read.
- **Scroll-spy** highlights the tab for the section in view; clicking scrolls smoothly and moves focus to that section's heading for screen-reader users.
- **Deep-linkable and shareable:** `portal.<church>/people/123#follow-ups` opens the page and scrolls to the section. This is what makes the single page usable — nobody has to re-click to reach a colleague.
- **Per-section loading.** Sections fetch independently (lazy, on first intersection). The shell and the first two sections render server-side so the page is not blank.
- **Collapsed detail by default** for long tables (attendance, blessings, recipients) with an explicit "show all" + CSV export; the summary numbers are always visible.
- **Print / export:** a print stylesheet prints one section per page with the tab strip omitted, so a profile can be filed or pasted into a report.

### 1.4 Non-functional requirements (single-page specific)

| Requirement | Target |
| --- | --- |
| LCP (profile/dashboard, warm cache, staff desktop) | < 2.0 s p75 |
| Time to interactive shell + first section | < 2.5 s p75 |
| Anchor jump after section load | < 150 ms perceived; instant if the section is already fetched |
| Per-section API p95 | < 300 ms |
| Total page weight, shell + 3 sections | < 400 KB gzipped |
| Off-screen sections | `content-visibility: auto` with a fixed intrinsic size to keep scrollbar honest |
| Accessibility | `nav` + anchor semantics (not an ARIA `tablist`, which implies panel swap), `aria-current="true"` on the active tab, a skip link to main content, focus moves to the section heading on jump, full keyboard operation |

*Performance lens: the single-page rule is a payload risk. The mitigation is per-section fetching + a section list driven by permissions — we never ship a section the user cannot read, and we never ship all sections' data in one fat query.*

### 1.5 User stories

**US-S1 — Read a whole person in one page.** As a welfare officer, I want one person profile page with all sections so that I do not lose context chasing tabs.
- AC1: The page shows sections: summary, contact & consent, household, church history & milestones, attendance summary, newcomer journey (if applicable), welfare cases, communications summary, celebrations, documents.
- AC2: The tab strip stays visible while scrolling and the current section is highlighted.
- AC3: Clicking a tab scrolls to that section; the URL updates so I can share/bookmark the section.
- AC4: Sections I am not permitted to see are absent (not merely disabled).
- AC5: Long tables start collapsed with a count and expand on demand; CSV export respects the same filters and permissions.
- AC6: Reloading a deep link (`/people/123#welfare`) lands on that section with it focused.

**US-S2 — One branch dashboard, all blocks.** As a branch admin, I want every dashboard block on one page so that I can run the branch from a single screen.
- AC1: Blocks: today's services, attendance by category/sex, newcomer funnel, follow-ups due, welfare open cases, birthdays/anniversaries this week, upcoming events, comms delivery summary, tasks.
- AC2: Every number is clickable and drills into the filtered list (unchanged from AFC-150 §9.5).
- AC3: The block set respects scope (a zone admin sees zones; a branch admin sees the branch).
- AC4: Blocks with no data show an explicit empty state with the action that fills them ("record attendance"), never a blank.

**US-S3 — Print/export a section.** As an area admin, I want to print or export one section so that I can file it.
- AC1: A print action prints only the selected section(s), omitting the tab strip and nav.
- AC2: CSV export streams the section's rows with the current scope.

---

## 2. Newcomer (visitor) care — first-class

### 2.1 Requirement (board list, verbatim coverage)

Each branch must be able to: **input** newcomer data · **send an SMS and a WhatsApp template message** · **send a weekly check-in and service reminder** · **follow up** (log outcomes) · **assign to a welfare officer** · **report** (newcomer funnel and follow-up status).

### 2.2 The onboarding journey (5 states)

```
Identify ──► Welcome ──► Pack ──► Drop-off ──► Follow-up ──► (Integrated | Dormant)
(announcement) (data      (literature,  (visit to     (memory verses,
 + how found)  collection) sermon notes, confirm        weekly check-in,
               + consent)  gift bag,                   conversion to
                            malt, biscuits,             member record)
                            contact card)
```

| State | What happens | Exit condition | Owner (default) |
| --- | --- | --- | --- |
| **Identify** | Newcomer announced/captured at the door; source (`how_found`) recorded: announcement, member invitation, walk-in, camp/Summit, online, other | Name + phone captured | Usher / volunteer |
| **Welcome** | Data collection: full name, phone, email, address, age band, marital status, who invited them, **channel consent (WhatsApp/SMS)** captured, service attended | Required fields + consent captured (consent may be `none`, which restricts later sends) | Branch admin / volunteer |
| **Pack** | Issue the welcome pack: literature, sermon notes, gift bag, malt, biscuits, contact card. Each item is checked off; stock decremented | All required pack items issued | Usher / volunteer |
| **Drop-off** | Home visit to confirm the address and make contact; log outcome (`address_confirmed`, `moved`, `not_home`, `declined`, `wrong_number`) | Outcome logged | Welfare officer |
| **Follow-up** | Memory verses, weekly check-in, service reminders; follow-up log; invitation to integrate as a member | Converted (`Integrated`) or `Dormant` after the configured window | Welfare officer |

**States are configurable, seeded with these five.** Each stage carries a default owner, a target number of days, a required task set, and the pack-item checklist. Branches may add stages but may not skip the journey order — the funnel report depends on a consistent stage sequence. *Data-model lens: the funnel is the product; the stage set must stay ordered and uniform or reporting breaks.*

### 2.3 Communications in the journey

| Moment | Channel | Template | Consent required |
| --- | --- | --- | --- |
| Welcome (same day) | **WhatsApp** (template) | `visitor_welcome_wa` — greeting, next Sunday's service time, live-service link | `whatsapp` consent |
| Welcome (same day) | **SMS** | `visitor_welcome_sms` — short form of the same; also the fallback if WhatsApp fails | `sms` consent |
| Weekly check-in | WhatsApp → SMS after 4h (campaign `newcomer_weekly_checkin`) | `visitor_weekly_checkin` — "How are you doing? Do you need anything?" | `whatsapp` or `sms` |
| Weekly service reminder | WhatsApp → SMS after 4h (campaign `service_reminder_weekly`) | `visitor_service_reminder` — service time + live link | as above |
| Follow-up memory verses | WhatsApp/SMS (campaign `weekly_memory_verse`) | rotating verse | as above |
| Drop-off scheduling | SMS (staff-triggered) | `dropoff_appointment` — visit window + address confirmation request | `sms` consent |

**No WhatsApp to minors.** A newcomer under 18 is messaged **via their guardian**; the guardian is the consent holder and the recipient. Adult-to-minor private messaging stays prohibited (safeguarding policy §14). *Security lens: this is a hard rule, enforced in the consent resolver, not in the UI.*

### 2.4 Reporting (the "report" requirement)

- **Newcomer funnel** — count per stage, with stage-to-stage conversion and average days in stage, scoped branch → zone → area, for a chosen period (weekly/monthly/quarterly/custom).
- **Follow-up status** — due today / overdue / completed this week / no contact in 14+ days, per officer.
- **Officer workload** — open newcomers per welfare officer, overdue follow-ups per officer.
- **Conversion** — newcomers that became `people` records (and, where recorded, their first milestone), with time-to-convert.
- **Communication outcome** — delivered/failed/opted-out per campaign for the newcomer audience, so a branch can see whether the messages are landing.
- Export: CSV for every report; permission-scoped (a branch admin sees their branch only).
- Read model: a `visitor_funnel` view (SQL view or a `profile.analytics` Flow output) so the dashboard block and the report agree.

### 2.5 Assignment to a welfare officer

- `visitors.welfare_officer` → a Directus user holding the **Welfare** leadership position in the branch.
- Assignment is one click from the newcomer record, from the branch's newcomer list ("assign all unassigned"), or automatically by round-robin when the branch has ≥2 officers (recommended default: **manual assignment**, round-robin later).
- Officer workload is capped by a visible workload count, not a hard limit; overflow stays unassigned and is visible to the branch admin.
- Unassigned newcomers older than 3 days appear on the branch dashboard as an action item.

### 2.6 User stories

**US-N1 — Input a newcomer.** As an usher, I want to capture a newcomer's details at the door so that follow-up can start.
- AC1: Capture name, phone, email, address, age band, who invited them, service, source.
- AC2: The record starts at stage **Identify** and the journey tracker shows which step is next.
- AC3: Channel consent questions are asked at capture; the record states which channels may be used.
- AC4: Duplicate detection warns when a phone number already exists (person or visitor in another branch); the branch admin decides to merge or keep separate.

**US-N2 — Send the welcome message.** As a branch admin, I want the welcome WhatsApp template and SMS available from the record so that the newcomer hears from us the same day.
- AC1: The record offers "Send welcome (WhatsApp)" and "Send welcome (SMS)"; both render from approved templates.
- AC2: A WhatsApp send is blocked with a clear reason if the template is not provider-approved or consent is missing; SMS remains available if SMS consent exists.
- AC3: The rendered text is visible before sending (no blind sends), and the exact text sent is stored on the recipient row.
- AC4: Send status is visible (queued/sent/delivered/read/failed) with the provider reference.

**US-N3 — Send the weekly check-in and service reminder.** As a welfare officer, I want the weekly check-in and service reminder to go out automatically so that no newcomer is forgotten.
- AC1: The `newcomer_weekly_checkin` campaign targets all consented newcomers in **Follow-up** at the branch.
- AC2: If WhatsApp is registered but shows no activity, an SMS fallback is sent after **4 hours** — at most one fallback per person per 24 hours.
- AC3: Opt-out (STOP) immediately removes the person from every campaign audience and records the withdrawal.
- AC4: The branch can pause, preview, and see counts per send before and after.

**US-N4 — Log follow-up outcomes.** As a welfare officer, I want to log what happened on each contact so that the next person picks up where I left off.
- AC1: Each contact logs date, channel, outcome (`reached`, `no_answer`, `requested_visit`, `needs_support`, `declined`, `moved`, `wrong_number`), notes, and the next step with a due date.
- AC2: The full log is a timeline on the newcomer record; the summary line shows the last contact.
- AC3: Anything logged as `needs_support` offers to open a **welfare case**, pre-filled, linked to the newcomer.
- AC4: Overdue next steps surface on the officer's task list and the branch dashboard.

**US-N5 — Assign to a welfare officer.** As a branch admin, I want to assign newcomers to officers and see their workload so that nobody is overloaded or missed.
- AC1: One newcomer, or all unassigned newcomers in a branch, can be assigned in one action.
- AC2: Only users holding the Welfare position in that branch are selectable.
- AC3: The branch dashboard shows per-officer open and overdue counts; newcomers unassigned for >3 days are flagged.
- AC4: Reassignment is allowed and is recorded in the timeline with actor and reason.

**US-N6 — Issue the pack and complete the drop-off.** As an usher/officer, I want a checklist for the pack and the drop-off visit so that the journey is complete and auditable.
- AC1: The Pack stage lists the six items; each is checked off, and the record shows who prepared/issued it.
- AC2: Stock decrement per item, with a reorder threshold warning for the branch.
- AC3: The Drop-off stage schedules a visit and records the outcome from a fixed list.
- AC4: The stage cannot be completed until its required items are done; the UI states exactly what is missing.

**US-N7 — Report on newcomers.** As an area admin, I want the funnel and follow-up status so that I can see where newcomers are being lost.
- AC1: Funnel by stage with conversion and average days in stage, filterable by period and branch/zone.
- AC2: Follow-up status (due/overdue/completed/no contact 14+ days) per officer.
- AC3: Conversion to member records with time-to-convert.
- AC4: CSV export, permission-scoped.

---

## 3. Member event invitations

### 3.1 Requirement

Members can submit details of people they want to invite. Each invitee receives a **WhatsApp template or SMS** with a message like:

> Dear [name], [member_name] is inviting you to [event_name] [time_and_date] … plus other details.

### 3.2 Flow

1. **Member** (authenticated, phone-identity) opens *Invite someone to an event* → picks a public or member-visible event → enters invitee name + phone → chooses preferred channel (WhatsApp / SMS / let us choose) → adds a short personal note.
2. The system shows the **rendered message** before it is queued. The member confirms.
3. An `event_invites` row is created: inviter (person + user), invitee name/phone, event, channel, message snapshot, consent basis, status.
4. The send reuses the existing communications path: a `communications` row + `communication_recipients` row per invitee, so **delivery status lives in one place**.
5. Status is visible to the member (sent/failed, not the technical detail) and fully visible to branch/area staff.
6. The invitee can reply or send STOP. STOP writes a `consent_records` denial and suppresses **all** further sends to that number, including other campaigns. A positive reply creates an `event_registration` draft for staff to confirm (no self-registration by reply in v1 — moderation and safeguarding).

### 3.3 Consent model for invitations (the honest part)

An invitee has not consented to anything. We send **one** message, because the inviter vouches for the relationship.

- `consent_basis = inviter_vouched` on the recipient row, with the inviter's user id and a timestamp. This is a **recorded, auditable basis**, not a claim of marketing consent.
- Consequence: **no drip, no follow-up series, no marketing campaigns to that number** unless the invitee registers or explicitly opts in. Any later message requires a real `consent_records` grant.
- Guardian consent for minors: an invitee who is a minor must be invited via their guardian's number, never the minor's.
- Rate limits per member (anti-abuse/spam): **10 invites/day and 50/week** by default; above that, branch-admin approval. Sends over the communications bulk threshold (200 recipients or the naira cap) require area approval, as already agreed.
- Opt-out is permanent for that channel and is visible to staff.

### 3.4 Template

`message_templates`, category `event_invitation`, one per channel per language. Variables:

| Variable | Example |
| --- | --- |
| `invitee_name` | Ada |
| `inviter_name` | Bro. Chidi O. |
| `event_name` | Youth Summit 2026 |
| `event_datetime` | Saturday 14 November 2026, 10:00 |
| `event_location` | Ikeja Worship Centre (or "online — join link below") |
| `branch_name` | Ikeja Branch |
| `inviter_note` | optional personal sentence |
| `rsvp_link` | portal link (short, tracked, no personal data) |

**WhatsApp** requires a Meta-approved template; `provider_template_id` + `approval_status = approved` are mandatory before a campaign/invite step using it can run. **SMS** is free-form. The board's sentence is the base copy; the branch can edit wording, but variables stay fixed.

### 3.5 User stories

**US-E1 — Submit an invite.** As a member, I want to invite someone to an event so that they can attend.
- AC1: I choose an event I am allowed to see, enter the invitee's name and phone, pick a channel, and optionally add a note.
- AC2: I see the exact rendered message before confirming.
- AC3: Only one message is sent; the app states that the invitee must register or opt in before any further messages.
- AC4: My daily/weekly invite limit is visible before I hit it; above the limit, the request goes to my branch admin for approval.

**US-E2 — Track my invitations.** As a member, I want to see whether my invites were delivered so that I can follow up personally.
- AC1: My invite list shows sent / delivered / failed with the date.
- AC2: Technical error detail and the invitee's contact value are **not** shown to me; staff can see them.
- AC3: I can ask staff to stop an invite; the number is then blocked.

**US-E3 — Manage invitations as staff.** As a branch admin, I want to see and manage invitations for my branch so that abuse and failures are handled.
- AC1: Filter by event, inviter, status, date; export CSV.
- AC2: A failed send shows the provider error and can be retried once (idempotent).
- AC3: Opt-outs are visible and permanent; staff cannot re-override an opt-out.
- AC4: Limit breaches are visible for approval.

**US-E4 — Remind registrants.** As an event owner, I want registered invitees reminded before the event so that attendance is higher.
- AC1: A `event_reminder` campaign sends T-24h and T-2h reminders with the live/location details to registrants who consented.
- AC2: Invitees who have not consented get no reminder; their RSVP is handled by staff.

---

## 4. Welfare automation campaigns

### 4.1 Requirement — the eight families

| # | Campaign | Trigger | Shape |
| --- | --- | --- | --- |
| 1 | **WhatsApp activity check → SMS after 4h** | A WhatsApp message was sent | Wait 4h; if no delivery/read/inbound reply → send SMS fallback (≤1 per person per 24h) |
| 2 | **Birthday & anniversary greetings** | Scheduled daily 08:00 Africa/Lagos | Birthdays today (+7-day lookahead for planning); wedding anniversaries from `households.wedding_date` |
| 3 | **New-visitor welcome drip** | `visitors.journey_stage = welcome` | D0 WhatsApp welcome → D0 SMS welcome → D2 service reminder → D7 check-in → D14 memory verse → exit |
| 4 | **New-convert drip** | A `person` link is created from a visitor, or a salvation/baptism milestone is recorded | D0 congratulations → D1 what next (classes, groups) → D3 service reminder → D7 memory verse → D14 welfare check-in → exit |
| 5 | **Weekly memory verses** | Scheduled weekly (Mon 08:00) | Rotating verse, consent-gated audience, branch/zone scope |
| 6 | **Service reminders** | Schedule from `service_type_definitions` | T-24h and morning-of, with the **live-service join link** |
| 7 | **Meeting reminders** | `meeting_at` on tasks/minutes/appointments | T-24h and T-1h to attendees (email; WhatsApp only for staff/small groups) |
| 8 | **Event invitations** | `event_invites` created; `event_registrations` confirmed | One invite message (§3) + T-24h / T-2h reminders to consenting registrants |

### 4.2 Campaign model (keep it simple, keep it auditable)

- **Campaign** — purpose, type (`drip` | `scheduled` | `triggered`), status (`draft`/`active`/`paused`/`archived`), owner, scope, consent policy, quiet-hours override.
- **Step** — sequence number, delay (`immediate` / `N hours` / `N days` / `weekly:Mon 08:00` / `wait_for_event`), channel, template, audience source, optional condition, **max sends per person**, active flag.
- **Audience source** — reuses the AFC-148 targeting model: branch, group, department, event registrants, person list, or a saved filter (e.g. `visitors where journey_stage = follow_up and consent_sms = true`).
- **Enrollment** — one row per person per campaign: state, current step, next step time, exit reason, idempotency key. Re-enrollment is allowed only with an explicit cooldown.
- **Run** — one row per step execution window: audience size, eligible/excluded counts, sent/delivered/failed, cost. This is the auditable batch record.
- **Delivery log** — unchanged: `communications` + `communication_recipients` (frozen snapshot of the exact rendered text, consent basis, status, provider id). One log for every message, whether sent by hand or by a campaign.

### 4.3 Consent, guardrails and kill switch

- **Consent policy per campaign** — `marketing_only` (default; require channel consent) or `operational_essential` (documented legitimate interest: service reminders, meeting reminders) or `mixed` (split the audience by a filter).
- The consent resolver runs at **audience resolution**, not at send time; excluded recipients are recorded with a reason (`no_consent`, `minor_no_guardian_consent`, `opted_out`, `invalid_contact`, `dnc`, `over_cap`).
- **Quiet hours** 20:00–07:00 Africa/Lagos; a step scheduled inside quiet hours moves to 08:00 unless the campaign is explicitly `operational_essential`.
- **Frequency caps:** marketing ≤3 messages per person per week per campaign family; the 4-hour SMS fallback ≤1 per person per 24h; a per-channel daily cap per person is enforced before enqueue.
- **Kill switch:** `campaigns.status = paused` stops new enrollments and pending steps; `communication_channels.enabled = false` stops a whole channel. Neither requires a deploy.
- **Cost guard:** `communication_channels.daily_cap` plus a per-campaign estimate; approval required above 200 recipients or the agreed naira threshold (unchanged decision C7).
- **Minors:** excluded from adult-sender WhatsApp/SMS; guardian is recipient and consent holder.
- **Audit:** campaigns and steps are archived, never deleted; rendered text and consent basis are immutable on the recipient row; every run keeps its counts.

### 4.4 How it runs (architecture lens)

- **Directus Flows** own triggers and simple logic: "a visitor entered Welcome → enroll", "a milestone was recorded → enroll", "a WhatsApp recipient was sent → schedule the 4-hour check".
- **A scheduler tick in the Symfony Notifier worker** (`campaign-tick`) finds due steps, resolves the audience, applies consent/caps, creates `communications` + `communication_recipients` in chunks, and hands them to the existing `POST /internal/send`. One idempotent tick, chunked, with a lock.
- **Why not build the state machine inside Flows:** Directus Flows are not a general workflow engine (already a named weak spot in the licence/fit memo). A scheduled tick in the service we already operate is simpler to test, cheaper to run, and easier to reason about than deeply nested Flows. *Testing lens: one pure function — "which steps are due at time T for person P" — is unit-testable; a nested Flow is not.*
- **No new secret, no new service, no new dependency.** The tick uses the worker's existing configuration.

### 4.5 User stories

**US-C1 — Configure a campaign without engineering help.** As an area admin, I want to build a simple campaign (audience, steps, templates, schedule) so that routine messages are not hand-sent.
- AC1: I pick a template, an audience, a schedule/sequence, and preview the rendered message with real (permission-scoped) sample data.
- AC2: I see the eligible and excluded counts with exclusion reasons before activating.
- AC3: Activation requires approval above the bulk threshold; below it I can activate directly.
- AC4: A campaign cannot reference a WhatsApp template that is not provider-approved; the UI says why.

**US-C2 — Run a campaign and see the result.** As a branch admin, I want to see what a campaign did so that I can follow up with the people who did not get it.
- AC1: The run shows audience, eligible, excluded (by reason), queued, sent, delivered, read, failed, opted out, and estimated cost.
- AC2: Failed recipients show a redacted error and can be retried once, idempotently.
- AC3: Opt-outs are listed so I can update my records.
- AC4: Runs are permission-scoped and exportable to CSV.

**US-C3 — WhatsApp-to-SMS fallback after 4 hours.** As a welfare officer, I want an SMS fallback when WhatsApp shows no activity so that newcomers are not silently missed.
- AC1: The fallback fires **4 hours** after the WhatsApp send, not before.
- AC2: "Activity" = delivered, read, or an inbound reply. If the provider does not supply read receipts, `delivered` is the proxy and this is stated in the run notes (integration dependency).
- AC3: At most one fallback per person per 24 hours per campaign family.
- AC4: The fallback respects SMS consent; if there is no SMS consent, the person is recorded as excluded with the reason and no message is sent.

**US-C4 — Greetings on time.** As a branch admin, I want birthday and anniversary greetings to go out automatically so that nobody's day is missed.
- AC1: A daily scheduled run picks birthdays today and wedding anniversaries; a 7-day lookahead is visible for preparation.
- AC2: Channel preference is honoured (WhatsApp if consented and active, otherwise SMS).
- AC3: No consent → excluded with reason; no manual override to send anyway.
- AC4: Duplicate greetings are prevented by an idempotency key per person per occasion per year.

**US-C5 — Pause everything quickly.** As an area admin, I want a single pause that stops all automation so that a bad message cannot reach the congregation.
- AC1: Pausing all campaigns takes effect within one scheduler tick and is visible on every campaign screen.
- AC2: Messages already queued are held, not deleted.
- AC3: The action is audited with actor, reason, and scope.

**US-C6 — Remind the congregation about services.** As a branch admin, I want service reminders with the live-service link so that people join online.
- AC1: Reminders follow the schedule configured for each service type; the message carries the live join link.
- AC2: Scope is branch/group; the branch admin sees only their own sends.
- AC3: Under-18s are excluded; guardians receive the family message instead.

**US-C7 — Remind meeting attendees.** As a department head, I want meeting reminders so that people turn up.
- AC1: A task/minutes/appointment with `meeting_at` schedules T-24h and T-1h reminders to attendees.
- AC2: Attendees without a consented channel are reminded by email only.
- AC3: Cancelling the meeting cancels the pending reminders.

---

## 5. UI surface — delta to PRD v3 §9

- **Person, household, branch, zone, area, BSC profiles and the dashboards are single-page with sticky anchor tabs** (§1). This is a change to the AFC-147/150 screen list and it must be applied **before** those screens are built, because retrofitting it after implementation touches every screen. *Deployment lens: this is the cheapest possible time to decide it.*
- Sections shown are derived from `/api/me/permissions`; a section the user cannot read is not rendered.
- **New sections/pages added by this addendum:** newcomer journey (on person/branch profiles), welfare-officer workload (branch dashboard), invitations (member area + branch admin), campaigns (area/branch admin).
- Mobile: the tab strip becomes a horizontally scrollable strip that stays pinned; sections stack in one column. Attendance capture, registration and class marking remain mobile-first as before.
- Accessibility: anchor-nav semantics (see §1.4); every section has a real heading; the tab strip is keyboard-operable and never traps focus.

## 6. Roles delta

- **`welfare_officer`** — a branch-scoped position in the existing `leadership_positions` registry. Reads the branch's newcomers/people, updates only their assigned follow-ups and stages, may open welfare cases. **No** access to `communications` send, **no** deletes, **no** other branches.
- **`member`** — a new lightweight **authenticated member** role (not public). Scoped to their own `person` record: read own profile, manage own channel consent, submit event invitations, see their own invitation status. **No** people search, no attendance, no welfare, no financials, no other members' data.
- Identity for members: **phone-number OTP over WhatsApp/SMS** (no password). This is an authentication change on a new role → **SecurityEngineer review required before implementation**, including OTP rate limiting, lockout, and session scope. *Security lens: least privilege is the design; the review is the gate.*
- Staff roles are unchanged.

## 7. Updated phasing

| Phase | Scope | Rationale |
| --- | --- | --- |
| **MVP (P1–P2)** | Foundation; hierarchy; people/households; attendance split; events + registration + group registration; **visitors + onboarding journey stages**; **single-page profile/dashboard shell**; RBAC. | Single-page UI is cheap now and expensive later. The newcomer journey's *data* model is needed early even if messaging waits for providers. |
| **P3 — Care, invitations, campaigns** | **Welcome pack + drop-off**, follow-up log, welfare-officer assignment, newcomer reports; **member role + OTP + event invitations**; **campaign engine + the eight campaign families**; celebrations → in-app greetings. | Comms providers have lead time (Termii/BSP onboarding, WhatsApp template approval), so start procurement in MVP even if the engine ships in P3. |
| **P4 — Finance & remaining integrations** | Financial records; WECA returns (formula pending); Telegram; birthday webhook (now optional); import/export. | Unchanged from v3, minus the campaign dependency. |
| **P5 — Campus care** | Unchanged from v3. | |
| **P6 — Hardening & data** | Retention/consent automation, cost reporting per campaign, dedupe, monitoring, runbooks. | |

**Gate:** the campaigns engine and invitations both need **provider approval** (WhatsApp templates) and **channel consent records** populated. Both are procurement tasks, not engineering tasks — start them in MVP.

## 8. Open questions (recommended defaults)

| # | Question | Recommended default | Owner | Blocks |
| --- | --- | --- | --- | --- |
| OQ-R1 | Does "one page" include every profile, or also record/detail pages? | The 7 profile/dashboard surfaces only; record/detail pages stay separate | CTO + UXDesigner | Nothing (proceed on default) |
| OQ-R2 | How is newcomer channel consent captured, and is it signed? | Digital consent at the Welcome form plus recorded verbal consent; guardian for minors; board ratifies with the safeguarding policy | Board + CTO | Newcomer messaging go-live |
| OQ-R3 | Who owns welcome-pack stock, and does issuing decrement it? | Branch owns stock; `visitor_pack_items` reference with per-branch stock and a reorder threshold | Welfare lead + CTO | Pack stage completeness |
| OQ-R4 | When is the "weekly check-in" sent? | Sunday 09:00 Africa/Lagos, one message per newcomer, WhatsApp then SMS fallback | Welfare lead + CTO | Campaign config |
| OQ-R5 | Does our WhatsApp BSP deliver read receipts? | Assume **no**; use `delivered_at` + no inbound reply as the activity proxy; re-check when the BSP is chosen | CTO | 4-hour fallback precision |
| OQ-R6 | Frequency caps and quiet hours | Quiet 20:00–07:00; marketing ≤3/person/week; SMS fallback ≤1/person/24h | Board + CTO | Campaign go-live |
| OQ-R7 | Member identity without passwords | Phone OTP over WhatsApp/SMS; MFA stays required for staff; SecurityEngineer reviews before build | CTO + SecurityEngineer | Member role build |
| OQ-R8 | Who approves bulk campaign sends? | Branch admin approves own-branch; area admin approves area-wide; >200 recipients or the naira threshold needs area approval (decision C7 unchanged) | Board | Campaign activation |
| OQ-R9 | When do we revisit the no-Mautic decision? | Revisit above ~100k messages/month, or if non-technical staff must author campaigns themselves | CTO | Nothing (trigger only) |
| OQ-R10 | Member invite rate limit | 10/day, 50/week per member; above needs branch-admin approval | Board + CTO | Invitation build |
| OQ-R11 | Which event types may be invited to? | Public and member-visible events; branch-private events excluded unless the inviter is a member of that branch | CTO | Invitation build |
| OQ-R12 | Does the visitor journey need dormancy auto-exit? | Yes: 60 days with no contact and no stage change → `Dormant`, with one re-engagement attempt first | Welfare lead + CTO | Funnel accuracy |

---

*Companion: [data-model-v4](/AFC/issues/AFC-151#document-data-model-v4), [wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3), [integrations-addendum](/AFC/issues/AFC-151#document-integrations-addendum), [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr). Planning only — no code, no deployments, no secrets.*
