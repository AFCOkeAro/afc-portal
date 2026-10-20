# Data Model & Permission Addendum v4 — Newcomer Care, Invitations, Campaigns

**Issue:** AFC-151 · **Parent:** AFC-146 · **Updates:** [data-model](/AFC/issues/AFC-147#document-data-model) (AFC-147), [data-model-addendum](/AFC/issues/AFC-148#document-data-model-addendum) (AFC-148), [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion) (AFC-150)
**Platform:** Directus (self-hosted) + PostgreSQL 16 · **Owner:** CTO (MediaTech) · **Version:** v4 (2026-10-05)
**Planning only — no code, no secrets.**

Conventions unchanged: `snake_case`, `M2O`/`O2M`/`M2M`, Directus system fields where noted, scope by policy filter on `branch`/`zone`/`department`. Where this document conflicts with the earlier model documents, **this one wins** for newcomer care, member invitations and campaigns.

**Reuse rule (the point of this addendum).** We **extend** rather than duplicate:

| Existing collection | How it is reused |
| --- | --- |
| `visitors` | gains the journey, officer, pack and check-in fields; **no** parallel newcomer table |
| `people` | a converted newcomer links here (`visitors.person`); nothing new |
| `welfare_cases` | a `needs_support` follow-up opens a case here; nothing new |
| `communications` + `communication_recipients` | **the single delivery log for every message**, including campaign and invite sends |
| `message_templates` | gains `category = marketing | event_invitation | operational` templates; no template table |
| `consent_records` | the consent history for every channel, including invitations (`inviter_vouched`) |
| `communication_channels` | unchanged; a campaign resolves a channel the same way a manual send does |
| `celebrations`, `households`, `person_milestones`, `events`, `tasks`, `service_type_definitions` | are the **audience sources** for campaigns; not duplicated |

**The 5 new collections** for newcomer care (`visitor_journey_stages`, `visitor_tasks`, `visitor_packs`, `visitor_pack_items`, `visitor_follow_ups`) plus **1 reference** (`visitor_pack_item_types`), **2 for invitations** (`event_invites`, `event_invite_limits` folded in as fields) and **4 for campaigns** (`campaigns`, `campaign_steps`, `campaign_enrollments`, `campaign_runs`) plus **1 audience** collection (`campaign_audiences`).

---

## 1. Change map

| Area | New collections | Changed |
| --- | --- | --- |
| Newcomer care | `visitor_journey_stages`, `visitor_tasks`, `visitor_packs`, `visitor_pack_items`, `visitor_pack_item_types`, `visitor_follow_ups` | `visitors` (journey stage, officer, pack, check-in, dormancy), `people` (no change) |
| Invitations | `event_invites` | `events` (invite eligibility), `communications` (source invite), `message_templates` (new category) |
| Campaigns | `campaigns`, `campaign_steps`, `campaign_audiences`, `campaign_enrollments`, `campaign_runs` | `communications` (`campaign`, `campaign_step`, `source_kind`), `message_templates` (`rotation_key`) |
| Roles | — | `leadership_positions` (`welfare_officer`), `directus_users` (member role + `member_person`) |
| Consent | — | `consent_records` (`consent_type = marketing_invite`, basis `inviter_vouched` in recipients) |
| UI | — | read-only `visitor_funnel` view; per-section read endpoints for the single-page profile/dashboard |

---

## 2. Newcomer care

### 2.1 `visitors` (changed)

Existing AFC-147 fields are unchanged. Added:

| Field | Type | Notes |
| --- | --- | --- |
| journey_stage | M2O `visitor_journey_stages` | the current state; seeded `identify` |
| journey_stage_entered_at | datetime | when the current stage was entered; drives "days in stage" and overdue flags |
| journey_started_at | date | first capture date (set when stage becomes `identify`) |
| welfare_officer | M2O `directus_users` | must hold the Welfare position in the same branch (Flow validation) |
| welfare_officer_assigned_at | datetime | |
| pack_id | M2O `visitor_packs` | the pack issued to this newcomer |
| dropoff_outcome | enum | `pending`, `address_confirmed`, `moved`, `not_home`, `declined`, `wrong_number` |
| dropoff_visited_at | datetime | |
| last_contact_at | datetime | updated by `visitor_follow_ups` (Flow `visitor.touch_contact`) |
| last_contact_channel | enum | `whatsapp`, `sms`, `phone`, `visit`, `in_person`, `none` |
| next_check_in_at | datetime | next weekly check-in due (campaign audience source + officer task list) |
| dormancy_due_at | date | `last_contact_at + 60 days`; re-engagement, then `dormant` |
| consent_whatsapp / consent_sms / consent_email | boolean | denormalised fast flags (history in `consent_records`, written by `consent.apply`) |
| consent_captured_at | datetime | |
| consent_method | enum | `paper`, `digital`, `verbal_recorded` |
| source_detail | enum | `announcement`, `member_invitation`, `walk_in`, `camp_summit`, `online`, `other` |
| converted_person | M2O `people` | set when the newcomer becomes a member record; already existed as `person` — **`person` is the canonical link**; `converted_person` is **not** added (avoid two links). Use `person`. |
| status | enum (existing) | extended with `dormant_exhausted`; existing values `new`, `contacted`, `in_follow_up`, `connected`, `integrated`, `dormant` are kept |

**Design note.** `follow_up_owner` already exists (AFC-147) and means the same thing as `welfare_officer`. **We keep the existing name** and do not add a second column; `welfare_officer` in the PRD maps to `visitors.follow_up_owner`. This is deliberate — duplicate ownership columns would drift. *Architecture lens: one owner field, one meaning.*

### 2.2 `visitor_journey_stages` (reference/config)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| key | string, unique | `identify`, `welcome`, `pack`, `dropoff`, `follow_up` (seeded) |
| name | string | display label |
| sequence | integer | ordering; **unique per scope**, enforced by a Flow (`journey.sequence_guard`) |
| description | text | what happens in this stage |
| entry_criteria | json | optional machine-readable condition (documented for portability, not executed in v1) |
| exit_criteria | json | as above |
| target_days | integer | SLA hint for "stuck in stage" reporting |
| default_owner_role | string | `usher`, `volunteer`, `branch_admin`, `welfare_officer` |
| requires_pack | boolean | the Pack stage requires all pack items issued |
| requires_visit_outcome | boolean | the Drop-off stage requires an outcome |
| is_terminal | boolean | |
| branch | M2O `branches` | nullable → null = the area-wide default set |
| active | boolean | |
| created_by / created_at / updated_by / updated_at | system | |

**Seed data** (branch defaults):

| key | name | target_days | default owner | flags |
| --- | --- | --- | --- | --- |
| `identify` | Identify (announcement) | 1 | usher | – |
| `welcome` | Welcome (data collection) | 1 | volunteer | – |
| `pack` | Pack (literature, sermon notes, gift bag, malt, biscuits, contact card) | 2 | usher | `requires_pack` |
| `dropoff` | Drop-off (visit to confirm address) | 7 | welfare_officer | `requires_visit_outcome` |
| `follow_up` | Follow-up (memory verses) | 60 | welfare_officer | – |

### 2.3 `visitor_pack_item_types` (reference)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| key | string, unique | `literature`, `sermon_notes`, `gift_bag`, `malt`, `biscuits`, `contact_card` (seeded from the board list) |
| name | string | |
| category | enum | `printed`, `food`, `gift`, `contact` |
| required | boolean | default true |
| stock_tracked | boolean | food/gift items are stock-tracked |
| default_stock_qty | integer | seed quantity per branch when stocked |
| reorder_threshold | integer | |
| active | boolean | |

### 2.4 `visitor_packs` (one per newcomer issuance)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| visitor | M2O `visitors`, required | |
| branch | M2O `branches`, required | denormalised for filters |
| zone | M2O `zones` | denorm |
| prepared_by | M2O `directus_users` | |
| prepared_at | datetime | |
| issued_at | datetime | nullable until handed over |
| issued_by | M2O `directus_users` | |
| status | enum | `draft`, `prepared`, `issued`, `returned` |
| notes | text | |

### 2.5 `visitor_pack_items` (child — one row per item in the pack)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| pack | M2O `visitor_packs`, required | |
| item_type | M2O `visitor_pack_item_types`, required | |
| quantity | integer | default 1 |
| checked | boolean | staff tick |
| checked_by / checked_at | | |
| branch | M2O `branches` | for stock filters |
| created_at | datetime | |

**Unique index:** `(pack, item_type)`.

### 2.6 `visitor_tasks` (generated work items for the journey)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| visitor | M2O `visitors`, required | |
| stage | M2O `visitor_journey_stages` | |
| title | string | from the stage's task template |
| description | text | |
| assigned_to | M2O `directus_users` | the officer/usher |
| assigned_by | M2O `directus_users` | nullable (system) |
| due_at | datetime | from `target_days` |
| status | enum | `open`, `in_progress`, `done`, `skipped`, `overdue` (derived: `open` + `due_at < now`) |
| completed_at / completed_by | | |
| source | enum | `stage_entry`, `manual`, `campaign` |
| branch / zone | M2O | denormalised |
| created_at | datetime | |

**Indexes:** `(status, due_at)`, `visitor`, `assigned_to`, `branch`.

### 2.7 `visitor_follow_ups` (the outcome log)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| visitor | M2O `visitors`, required | |
| branch | M2O `branches`, required | |
| contact_at | datetime | when contact happened |
| contact_channel | enum | `whatsapp`, `sms`, `phone`, `visit`, `in_person` |
| outcome | enum | `reached`, `no_answer`, `requested_visit`, `needs_support`, `declined`, `moved`, `wrong_number`, `integrated` |
| notes | text | **restricted** (branch admin + assigned officer + area) |
| welfare_case | M2O `welfare_cases` | set when the outcome opened a case |
| next_step | string | short free text |
| next_follow_up_at | date | creates/updates `visitor_tasks` and `visitors.next_check_in_at` |
| logged_by | M2O `directus_users`, required | |
| communication | M2O `communications` | optional link when the contact was a message |
| created_at | datetime | |

**Indexes:** `(visitor, contact_at desc)`, `(branch, contact_at desc)`, `outcome`, `logged_by`.

`visitors.follow_up_notes` (existing) stays as a **latest-summary** denormalised field, written by the Flow `visitor.touch_contact`.

### 2.8 Read model — the funnel

- **SQL view `visitor_funnel`** (read-only): `branch`, `zone`, `stage_key`, `visitors`, `new_this_week`, `avg_days_in_stage`, `overdue_count`, `converted_count`, `conversion_rate`. Backed by a group-by over `visitors` joined to `visitor_journey_stages`.
- **Second view `visitor_follow_up_status`**: `branch`, `officer`, `due_today`, `overdue`, `completed_this_week`, `no_contact_14_plus`, `unassigned_over_3d`.
- Views are read-only and permission-filtered by `branch` at the API layer. *Data-model lens: reporting is a query, not a table — no rollup table to migrate or repair.*

---

## 3. Member event invitations

### 3.1 `event_invites` (new)

One row = one invite request from one member to one person.

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event | M2O `events`, required | must be invite-eligible (§3.3) |
| branch | M2O `branches`, required | the branch that owns the event |
| zone | M2O `zones` | denorm |
| inviter_person | M2O `people`, required | the member who invited |
| inviter_user | M2O `directus_users`, required | who clicked send; a member may invite on behalf of their record only |
| invitee_name | string, required | |
| invitee_phone | string, required | normalised E.164 |
| invitee_contact_hash | string | sha256 of the normalised phone — used for dedupe/opt-out checks without storing a lookup table of numbers we cannot read back |
| invitee_relationship | enum | `friend`, `family`, `coworker`, `neighbour`, `invited_by_guest`, `other` |
| invitee_age_band | enum | `adult`, `youth`, `teen`, `child`, `unknown` — `child`/`teen` **requires** the number to be a guardian's (Flow gate) |
| channel_choice | enum | `whatsapp`, `sms`, `auto` (`auto` = WhatsApp if consented pattern unknown → prefer WhatsApp, fall back to SMS after 4h) |
| consent_basis | enum | `inviter_vouched` (only value in v1) |
| message_template | M2O `message_templates` | the `event_invitation` template used |
| message_rendered | text | **snapshot of the exact text** |
| variables_snapshot | json | `invitee_name`, `inviter_name`, `event_name`, `event_datetime`, `event_location`, `branch_name`, `inviter_note`, `rsvp_link` |
| communication | M2O `communications` | the send created for this invite (delivery status lives there) |
| recipient | M2O `communication_recipients` | the per-recipient row |
| status | enum | `pending_approval`, `queued`, `sent`, `delivered`, `failed`, `blocked_optout`, `blocked_rate_limit`, `withdrawn`, `registered` |
| approval_required | boolean | computed from member limits + bulk threshold |
| approved_by / approved_at | M2O `directus_users` / datetime | |
| blocked_reason | string | why it was not sent |
| retry_of | M2O `event_invites` | self-reference for a single retry |
| created_at / updated_at | | |

**Indexes:** `event`, `branch`, `inviter_person`, `inviter_user`, `status`, `(invitee_contact_hash, created_at)`, `(inviter_user, created_at)` for rate limiting.

**Why one collection, not a header + lines:** an invitation is a single recipient. A header/line pair would add a table and a join for no modelling gain. *Cost/complexity lens: the board asked for simple; the only reason we keep both `communication` and `recipient` FKs is that delivery status must not be duplicated.*

### 3.2 Rate limits — fields on `directus_users`, not a new table

| Field on `directus_users` (member) | Type | Notes |
| --- | --- | --- |
| member_person | M2O `people` | links the login to the member's record; **field-restricted** |
| invite_daily_limit | integer | default **10** |
| invite_weekly_limit | integer | default **50** |
| member_access_expires_at | datetime | nullable; time-boxed access supported (mirrors the guest pattern) |

The limit check is a Flow/query over `event_invites` in the rolling day/week. Above the limit → `status = blocked_rate_limit`, `approval_required = true`, visible to the branch admin. *Least privilege: the limit lives in the user row so it is configurable per member without a code change.* The authoritative enforcement is the `invite_quota_slots` ledger-slot claim (ADR-0011, AFC-516): the single `claimInviteQuota` protocol claims one day slot and one week slot by INSERT against the ledger UNIQUE, so the route and the Flow `invite.create` share one atomic rule; windows are Africa/Lagos calendar day (resets 00:00 Lagos) and calendar week (Monday-to-Sunday Lagos).

### 3.3 Changes to `events`

| Field | Type | Notes |
| --- | --- | --- |
| invite_eligible | boolean | default true for public/member-visible events; false for branch-private ones unless the inviter belongs to that branch |
| invite_requires_approval | boolean | event-level override |
| live_join_url | string | reused by service and event reminders (the "link to join live services") |
| reminders_enabled | boolean | default true |
| reminder_offsets | json | default `["24h","2h"]` |

---

## 4. Campaigns / welfare automation

### 4.1 `campaigns`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| key | string, unique | `whatsapp_sms_fallback`, `newcomer_weekly_checkin`, `birthday_anniversary_greeting`, `new_visitor_welcome_drip`, `new_convert_drip`, `weekly_memory_verse`, `service_reminder`, `meeting_reminder`, `event_invitation` (nine seeded keys; #1 is a policy shared by steps, so the eight board items map to nine keys) |
| name | string, required | |
| purpose | enum | `fallback`, `greeting`, `drip`, `scheduled`, `reminder`, `invitation` |
| campaign_type | enum | `drip` (enrolment-driven), `scheduled` (cron/step schedule), `triggered` (event-driven) |
| consent_policy | enum | `marketing_only` (default), `operational_essential` (documented legitimate interest), `mixed` |
| audience_default | M2O `campaign_audiences` | nullable; a step may override |
| status | enum | `draft`, `active`, `paused`, `archived` — **paused is the kill switch** |
| max_sends_per_person_per_week | integer | default 3 for marketing campaigns |
| fallback_sms_after_hours | integer | default 4; used by the fallback campaign |
| quiet_hours_override | boolean | only for `operational_essential` |
| timezone | string | default `Africa/Lagos` |
| owner | M2O `directus_users` | accountable person |
| branch | M2O `branches` | nullable → area-wide |
| zone | M2O `zones` | denorm |
| version | integer | bump on any step change; runs record the version |
| activated_at / paused_at | datetime | |
| created_by / created_at / updated_by / updated_at | system | |

**Constraint:** `status` moves `draft → active → paused ⇄ active → archived`. No hard delete (audit). A Flow guards every transition and writes `campaign_events` via the Directus activity log plus the run rows.

### 4.2 `campaign_steps`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| campaign | M2O `campaigns`, required | |
| sequence | integer | 1-based; unique per campaign |
| name | string | |
| delay_type | enum | `immediate`, `delay_hours`, `delay_days`, `weekly_cron`, `wait_for_event` |
| delay_value | string | e.g. `4`, `2`, `Mon 08:00`; for `wait_for_event` the event name |
| timezone | string | default from campaign |
| channel | M2O `communication_channels` | required (resolve the transport, same as a manual send) |
| template | M2O `message_templates` | required unless `template_id = null` and a free-form email body is set on the step |
| body_override | text | nullable free-form body (email only) |
| audience | M2O `campaign_audiences` | nullable → campaign default |
| condition | json | simple documented predicates: `whatsapp_registered_no_activity`, `consent_sms`, `stage_equals`, `has_milestone`, `not_opted_out`. **Evaluated in the worker, not in nested Flows** |
| min_delay_hours | integer | guards "too soon" after a previous send to the same person |
| max_sends_per_person | integer | per-step cap |
| is_entry_step | boolean | the step that enrols |
| is_fallback_step | boolean | marks the 4-hour SMS fallback step |
| is_terminal | boolean | completes the enrollment |
| active | boolean | |
| created_at / updated_at | | |

**Indexes:** `campaign`, `(campaign, sequence)` unique, `active`.

**Idempotency key** used by both the worker and the Notifier worker:
`campaign:{campaign_id}:step:{step_id}:person:{person_id}:{window_iso}` where `window_iso` is the scheduled slot (hour bucket). Retries reuse the key, so nothing double-sends. *Deployment/release lens: idempotency is the release safety net — a replayed tick must be a no-op.*

### 4.3 `campaign_audiences` (mirrors `communication_audiences`)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string | saved, reusable segment |
| audience_type | enum | `branch`, `group`, `department`, `event_registrants`, `person_list`, `query`, `visitors_by_stage`, `celebrations_window` |
| branch | M2O `branches` | nullable |
| group | M2O `groups` | nullable |
| department | M2O `departments` | nullable |
| event | M2O `events` | nullable |
| visitor_stage | M2O `visitor_journey_stages` | for `visitors_by_stage` |
| person_ids | json (array uuid) | for `person_list` |
| filter | json | predicate object for `query` (allowlisted keys only: `consent_sms`, `consent_whatsapp`, `status`, `is_minor`, `date_of_birth_range`, `wedding_date_range`, `last_contact_at_before`, `days_in_stage`) |
| include | boolean | default true |
| created_by / created_at | | |

**Allowlist on `filter` keys** is a security decision: no arbitrary query language reaches the resolver, so a campaign author cannot exfiltrate people outside their scope. *Security lens: the audience resolver is a data-access boundary; it accepts a predicate vocabulary, not SQL.*

### 4.4 `campaign_enrollments`

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| campaign | M2O `campaigns`, required | |
| person | M2O `people` | nullable when the recipient is an external contact with no person record (visitor-only) |
| visitor | M2O `visitors` | for newcomer campaigns before conversion |
| contact_key | string | the contact identity used when `person` is null (hashed phone/email) |
| enrolled_at | datetime | |
| source_event | string | what enrolled them, e.g. `visitor.stage.welcome`, `person_milestones.saved` |
| state | enum | `active`, `paused`, `completed`, `exited`, `failed` |
| current_step | M2O `campaign_steps` | |
| next_step_at | datetime | **the scheduler's index** |
| sends_count | integer | |
| last_sent_at | datetime | |
| exit_reason | enum | `completed`, `opted_out`, `no_consent`, `minor_guardian`, `over_cap`, `cancelled`, `branch_mismatch` |
| cooldown_until | datetime | blocks re-enrolment |
| idempotency_key | string, unique | `enroll:{campaign_id}:{person|contact_key}:{source_event}:{window}` |
| created_at / updated_at | | |

**Indexes:** `(state, next_step_at)` — the hot path for the tick; `campaign`, `person`, `visitor`, unique `idempotency_key`.

### 4.5 `campaign_runs` (the auditable batch record)

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| campaign | M2O `campaigns`, required | |
| campaign_version | integer | |
| step | M2O `campaign_steps` | nullable for campaign-level runs |
| window_start / window_end | datetime | the scheduled slot |
| trigger | enum | `scheduler`, `event`, `manual`, `fallback_timer` |
| status | enum | `running`, `completed`, `partial`, `failed`, `cancelled` |
| audience_size | integer | |
| eligible_count / excluded_count | integer | |
| excluded_reasons | json | counts by exclusion reason |
| queued_count / sent_count / delivered_count / read_count / failed_count / opted_out_count | integer | |
| estimated_cost / actual_cost | decimal(12,2) | |
| currency | enum | `NGN`, `USD`, `GBP` |
| communication | M2O `communications` | the batch header created for this run |
| worker_run_id | string | the scheduler tick that executed it, for tracing |
| started_at / completed_at | datetime | |
| notes | text | e.g. "provider supplied no read receipts; used delivered_at as the activity proxy" |
| created_at | datetime | |

**Indexes:** `(campaign, window_start desc)`, `status`, `window_start`.

### 4.6 Changes to `communications` and `message_templates`

| Collection | Field | Type | Notes |
| --- | --- | --- | --- |
| communications | `source_kind` | enum | `manual`, `campaign`, `invite`, `welcome_form`, `birthday_webhook` |
| communications | `campaign` | M2O `campaigns` | nullable |
| communications | `campaign_step` | M2O `campaign_steps` | nullable |
| communications | `campaign_run` | M2O `campaign_runs` | nullable |
| communications | `event_invite` | M2O `event_invites` | nullable |
| communications | `consent_policy` | enum | snapshot of the campaign policy at send time |
| message_templates | `category` | enum (extended) | adds `event_invitation`, `greeting`, `memory_verse`, `service_reminder`, `fallback` |
| message_templates | `rotation_key` | string | e.g. `memory_verse` — the weekly rotation picks deterministically by ISO week |
| message_templates | `variables` | json | unchanged; the v4 variables are listed in PRD §3.4 |
| message_templates | `approval_status` | enum (extended) | adds `pending_provider`; a step using a non-`approved` WhatsApp template **cannot run** (Flow gate `campaign.template_gate`) |

### 4.7 Changes to `consent_records`

| Field | Type | Notes |
| --- | --- | --- |
| consent_type | enum (extended) | adds `marketing_invite` |
| basis | enum | **new** column: `explicit_opt_in`, `guardian`, `legitimate_interest`, `inviter_vouched`, `not_applicable` |
| related_invite | M2O `event_invites` | nullable; ties a vouched consent to its auditable record |
| expires_at | datetime | existing; used for re-consent intervals |

### 4.8 The eight board items → concrete model

| # | Campaign key | Type | Entry step | Steps | Audience source |
| --- | --- | --- | --- | --- | --- |
| 1 | `whatsapp_sms_fallback` | triggered | — | 4h wait → SMS fallback | `communication_recipients` on a WhatsApp send with no activity |
| 2 | `birthday_anniversary_greeting` | scheduled | daily 08:00 | greeting (WhatsApp → SMS fallback) | `celebrations_window` audience (birthdays today, anniversaries today) |
| 3 | `new_visitor_welcome_drip` | drip | visitor enters `welcome` | D0 WA welcome · D0 SMS welcome · D2 service reminder · D7 check-in · D14 memory verse | `visitors_by_stage` (`follow_up` for the weekly part) |
| 4 | `new_convert_drip` | drip | `visitors.person` set / milestone recorded | D0 congratulations · D1 next steps · D3 service reminder · D7 memory verse · D14 welfare check-in | person linked to a visitor |
| 5 | `weekly_memory_verse` | scheduled | Mon 08:00 | one rotating verse | consented active members + follow-up visitors in scope |
| 6 | `service_reminder` | scheduled | from `service_type_definitions` | T-24h + morning-of with `events.live_join_url` | branch / group |
| 7 | `meeting_reminder` | triggered | `meeting_at` set | T-24h + T-1h | `tasks`/`office_minutes`/`leadership_appointments` attendees |
| 8 | `event_invitation` | triggered | `event_invites` created | invite send + T-24h + T-2h reminders | invitee; reminders only for consenting registrants |

---

## 5. Permission matrix (v4 additions)

Actions: **C** create, **R** read, **U** update, **D** delete. `own` = branch ∈ `user.branch_ids`; `dept` = assigned departments; `assigned` = only rows where the user is the owner/officer; `self` = only the user's own `person` record.

| Collection | Super admin | Area admin | Branch admin | **Welfare officer** | Staff/volunteer | **Member** | Public |
| --- | --- | --- | --- | --- | --- | --- | --- |
| visitor_journey_stages | CRUD | CRUD | CRU (own branch) | R | R | – | – |
| visitor_pack_item_types | CRUD | CRUD | CRU | R | R | – | – |
| visitor_packs | CRUD | CRUD | CRUD (own) | CRU (own branch) | C/U (own) | – | – |
| visitor_pack_items | CRUD | CRUD | CRUD (own) | CRU (own branch) | C/U (own) | – | – |
| visitors | CRUD | CRUD | CRUD (own) | **R (own branch), U (assigned only)** | C/R (own) | – | – |
| visitor_tasks | CRUD | CRUD | CRUD (own) | CRU (assigned/own branch) | CRU (own) | – | – |
| visitor_follow_ups | CRUD | CRUD | CRUD (own) | **C/R/U (own branch), no D** | C/R (own) | – | – |
| event_invites | CRUD | CRUD | CRU (own branch) + **approve over-limit** | R (own branch) | R (own branch) | **C/R/U (own), no D** | – |
| campaigns | CRUD | CRUD | CRU (own branch) | R | – | – | – |
| campaign_steps | CRUD | CRUD | CRU (own branch) | R | – | – | – |
| campaign_audiences | CRUD | CRUD | CRU (own branch) | R | – | – | – |
| campaign_enrollments | CRUD | CRUD | R (own branch) | R (assigned) | – | – | – |
| campaign_runs | CRUD | CRUD | R (own branch) | R (assigned) | – | – | – |
| communications | CRUD | CRUD + approve | CRU (own) | R (own branch, redacted) | – | – | – |
| communication_recipients | CRUD | R | R (own communications) | **R (assigned only, redacted)** | – | R (own invites, status only) | – |
| message_templates | CRUD | CRUD | CRU (own branch) | R | R | – | – |
| consent_records | CRUD | CRUD | CRU (own people) | C/R (own branch) | – | **C/R (self only)** | – |
| directus_users | CRUD | R | – | – | – | R (self, minimal) | – |

**Explicit denials (least privilege):**

| Role | Denied |
| --- | --- |
| Welfare officer | `DELETE` on any visitor record; any `communications` create/send; any other branch; `campaigns` write; `event_invites` create; finance; `directus_users` |
| Member | Reading/writing any other person's record; attendance; welfare; finance; staff directories; campaigns; `communication_recipients` fields other than their own invite status; `contact_value`, `error_detail`, `provider_message_id` |
| Volunteer | `visitor_follow_ups.notes` for newcomers not assigned to them; any consent write; any campaign write |
| Public (unauthenticated) | Nothing new. Public registration is unchanged (create-only on `event_registrations`, allowlisted fields). |

### 5.1 Field-level restrictions (v4 additions)

| Collection | Field | Restrict reads to |
| --- | --- | --- |
| visitors | `consent_*`, `address`, `phone`, `email` | branch admin+, assigned welfare officer; volunteers see only what the intake form needs |
| visitor_follow_ups | `notes` | branch admin, assigned officer, area+ |
| event_invites | `invitee_phone`, `invitee_contact_hash`, `message_rendered` | branch admin+, area/super; **the inviting member sees only their own record and a redacted phone (`0801 ••• •234`)** |
| communication_recipients | `contact_value`, `error_detail` | existing rule + welfare officer only for assigned rows, redacted |
| campaign_audiences | `filter`, `person_ids` | sender/approver, area/super |
| campaign_enrollments | `contact_key` | area/super only (it is a hash of contact data) |
| directus_users | `member_person`, `invite_*_limit` | self; branch admin for members of their branch; area/super |

### 5.2 Role definitions (v4 additions)

- **`welfare_officer`** — a `leadership_positions` entry (`key = welfare_officer`, `scope_type = branch`) plus a Directus policy matching the matrix above. `visitors.follow_up_owner` validation requires the Welfare position in the same branch (Flow `visitor.validate_officer`).
- **`member`** — a Directus role for authenticated members. `directus_users.member_person` links to their `people` row. Identity is **phone OTP** (WhatsApp/SMS); no password. Fields: own profile, own consent, `event_invites` (own), own invite status. No people search, no attendance, no welfare, no finance, no staff data. Time-boxed access supported via `member_access_expires_at`.
  - **Security gate before implementation:** SecurityEngineer review of the OTP flow (rate limit, attempt lockout, enumeration resistance, session scope, device binding). *Security lens: a new authentication path for thousands of members is the single highest-risk item in this addendum.*

---

## 6. Required indexes (v4 additions)

| Collection | Index |
| --- | --- |
| visitor_journey_stages | `key` (unique), `branch`, `(branch, sequence)` unique, `active` |
| visitor_pack_item_types | `key` (unique), `active` |
| visitor_packs | `visitor`, `branch`, `status` |
| visitor_pack_items | `(pack, item_type)` unique, `branch`, `item_type` |
| visitors (add) | `journey_stage`, `(branch, journey_stage)`, `follow_up_owner`, `next_check_in_at`, `last_contact_at`, `dormancy_due_at`, `(consent_sms, journey_stage)`, `(consent_whatsapp, journey_stage)`, `person` |
| visitor_tasks | `(status, due_at)`, `visitor`, `assigned_to`, `branch` |
| visitor_follow_ups | `(visitor, contact_at desc)`, `(branch, contact_at desc)`, `outcome`, `logged_by` |
| event_invites | `event`, `branch`, `inviter_person`, `inviter_user`, `status`, `(invitee_contact_hash, created_at)`, `(inviter_user, created_at)` |
| campaigns | `key` (unique), `status`, `branch`, `owner` |
| campaign_steps | `campaign`, `(campaign, sequence)` unique, `active` |
| campaign_audiences | `name`, `audience_type` |
| campaign_enrollments | `(state, next_step_at)`, `campaign`, `person`, `visitor`, `idempotency_key` (unique) |
| campaign_runs | `(campaign, window_start desc)`, `status`, `window_start` |
| communications (add) | `source_kind`, `campaign`, `campaign_step`, `event_invite` |
| consent_records (add) | `basis`, `related_invite` |
| people (add) | `date_of_birth` partial (for the birthday audience) |

**Hot-path note.** The scheduler's only index that matters is `campaign_enrollments (state, next_step_at)`. Everything else is reporting. *Scalability lens: with ~20k people the enrollment table stays in the tens of thousands of rows; a partial index on `(state, next_step_at) WHERE state = 'active'` keeps each tick a cheap range scan.*

## 7. Automation — Directus Flows (v4 additions)

| Flow | Trigger | Effect |
| --- | --- | --- |
| `visitor.stage_enter` | `visitors.journey_stage` changed | stamp `journey_stage_entered_at`; create the stage's `visitor_tasks`; on `welcome` **enroll the new-visitor welcome drip**; on `follow_up` set `next_check_in_at`; on a terminal stage exit the drip |
| `visitor.touch_contact` | `visitor_follow_ups` created | update `visitors.last_contact_at`, `last_contact_channel`, `follow_up_notes`, `next_check_in_at`, `dormancy_due_at` |
| `visitor.validate_officer` | `visitors.follow_up_owner` changed | reject an officer without the Welfare position in that branch; write an audit note |
| `journey.sequence_guard` | `visitor_journey_stages` created/updated | reject a duplicate `sequence` in the same scope; reject skipping forward more than one stage |
| `visitor.pack_issue` | `visitor_packs.status → issued` | mark all required `visitor_pack_items.checked`; decrement stock; auto-close the Pack task |
| `visitor.dormancy` | daily schedule | `dormancy_due_at` passed → one re-engagement send → 14 days later `status = dormant` |
| `visitor.convert` | `visitors.person` set | set `status = integrated`; enroll the **new-convert drip**; stop newcomer campaigns |
| `invite.create` | `event_invites` created | validate invite eligibility + rate limits; resolve channel; render template; create `communications` + `communication_recipients`; enqueue send |
| `invite.fallback` | WhatsApp recipient sent, no activity | schedule the 4-hour fallback check |
| `consent.withdraw` | `consent_records.granted = false` | set the denormalised flag false; **exit all active enrollments** for that person; block future audience resolution |
| `campaign.template_gate` | campaign/step activated | reject activation if any step's WhatsApp template `approval_status != approved` |
| `campaign.pause_guard` | `campaigns.status → paused` | hold pending enrollments (`state = paused`); do not delete queued sends |
| `campaign.fallback_timer` | `communication_recipients` updated on a WhatsApp send | after `fallback_sms_after_hours`, if no `delivered_at`/`read_at`/inbound reply → create the fallback SMS step (≤1/24h per person per campaign family) |
| `celebrations.daily` | daily 08:00 | build today's birthday/anniversary audience; hand to `birthday_anniversary_greeting` (replaces the external webhook as the default path) |
| `service.reminders` | `service_type_definitions` schedule | enqueue T-24h / morning-of service reminders with `events.live_join_url` |
| `meeting.reminders` | `meeting_at` set/changed | enqueue T-24h / T-1h attendee reminders; on cancellation, void pending reminders |
| `event.reminders` | `event_registrations` confirmed | enqueue T-24h / T-2h reminders for consenting registrants |

## 8. Enforcement & test strategy (v4 additions)

- **Journey:** stage order cannot be skipped; each stage's `target_days` produces an overdue flag; `visitor_packs` cannot be `issued` with unchecked required items; a `welfare_officer` without the Welfare position cannot be assigned.
- **Consent (hard gate):** an attempt to resolve an audience containing a person with no consent for that channel **excludes** them with a reason; a unit test asserts zero recipients with `consent_basis = none` are ever queued. Minors are excluded from adult-sender channels and the guardian is substituted.
- **Campaign idempotency:** replaying a scheduler tick for the same window creates **no** new recipients and **no** second send. Two tests: same `idempotency_key` → no duplicate enrollment; same recipient key → no duplicate send.
- **Fallback:** no SMS fallback before `fallback_sms_after_hours`; at most one per person per 24h per campaign family; cancelled when activity is recorded.
- **Invitations:** over-limit invites go to `blocked_rate_limit` + approval; `opted_out` recipients are never queued again; a minor invite without a guardian number is rejected at creation.
- **Scope:** welfare officer cross-branch = `403`; member reading another person = `403`; member reading `contact_value` = `403`; branch admin reading another branch's campaign run = `403`.
- **Reporting:** the funnel view totals equal the `visitors` table per stage; CSV matches the view query.
- **Performance:** the scheduler tick holds a lock, processes in chunks of 500, and completes a 10k-recipient step inside the run window (measure before optimising; log the tick duration as a metric).
- **Schema drift:** `schema/snapshot.yaml` includes every v4 collection; CI diff.

## 9. Portability

1. Postgres stays the system of record; all v4 tables are ordinary relational tables.
2. No opaque database triggers — denormalisation and counters are maintained by the documented Flows above.
3. The campaigns engine is ordinary data plus one tick loop; nothing in it depends on Directus-specific magic, so it can be reimplemented if the platform changes (Monospace) — this is the portability argument behind the [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr) recommendation.
4. Secrets remain `secret_ref` references only. The scheduler needs **no** new secret.
5. The permission matrix rows are platform-neutral: they map 1:1 to Directus policies today and to any future policy engine.

---

*Companion: [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4), [wireframes-v3](/AFC/issues/AFC-151#document-wireframes-v3), [integrations-addendum](/AFC/issues/AFC-151#document-integrations-addendum), [mautic-adr](/AFC/issues/AFC-151#document-mautic-adr). Planning only — no code, no secrets.*
