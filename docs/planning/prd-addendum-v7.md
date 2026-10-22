# PRD Addendum v7 — Member Self-Service Portal (records, events, news)

**Issue:** AFC-594 · **Parent:** AFC-460 (PRD implementation) · **Ancestor:** AFC-146 (Church Portal)
**Updates:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147 base), [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) (AFC-150 v3), [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4) (AFC-151 v4), [prd-addendum-v5](/AFC/issues/AFC-586#document-prd-addendum-v5) (AFC-586 v5), [prd-addendum-v6](/AFC/issues/AFC-592#document-prd-addendum-v6) (AFC-592 v6)
**Owner:** UXDesigner (design only) · **Status:** Draft for SecurityEngineer review, then estimation · **Version:** v7 (2026-10-21)
**Planning only — no production code, no deployments, no secrets, no build commitment. Design-then-security-review applies before any build.**

**Companion docs (this issue):** `wireframes-v6` (member home, my record, family edit/propose, events + registration, news reader)

> **Read order.** This addendum extends the base PRD and all prior addenda. Where it conflicts, **this addendum wins** for the member-portal domain only. Everything else is unchanged and not repeated here.
>
> **Phase-gate note (hire gate, AGENTS.md).** This addendum + wireframes-v6 are **low-fidelity layout intent only** (same HTML grey-box style as v2/v3/v4/v5) plus IA/interaction spec. No high-fidelity visual design, no component-library change, no implementation PR is produced on this issue.
>
> **CTO grounding.** Slice 4 built the member auth path (phone OTP, session scoped to exactly one `member_person`, OTP enablement gated on SecurityEngineer re-review — v4 §6.1 parameter block stands unchanged). This addendum builds the self-service surface on top of that path. Member-written data is new trust territory: every write below is either a narrow direct edit or a staff-approved proposal, and **nothing here builds until SecurityEngineer reviews the edit/propose rules (§4).**

---

## 0. Change summary — what this v7 adds

The board asks (2026-10-21, with a RockRMS event-registration reference): a member portal where families and individuals **update their records, see upcoming events, and read church news**.

| # | Item | One-line definition | New vs today |
| --- | --- | --- | --- |
| 1 | **My record + family** | Adult members view/correct own record; propose changes requiring review; guardians propose for minors | New write surface on `people`/`households` (staff-only today) |
| 2 | **Edit-vs-propose rules** | Per-field matrix: direct-edit vs propose-for-review vs never, with the minor safeguard | New policy; enforced server-side, UI only hides |
| 3 | **Events + registration** | Member view of published events + self/family registration reusing the existing flow | New read surface; write path reuses `event_registrations` + guardian block |
| 4 | **Church news** | Member-scoped announcements reader | New read surface over `announcements` (visibility model checked, §6) |
| 5 | **My requests** | Proposal + registration status tracking | New read surface over the new `record_change_proposals` |

*Design lenses: Mental Models (the member mental model is "my church profile", not "a CRM record" — the portal speaks in family/profile language); Progressive Disclosure (home shows 4 jobs; record editing reveals propose-vs-edit only where it matters); Recognition over Recall (every field states its rule inline — "saves instantly" vs "goes to the church office for approval"); Forgiveness (proposals are withdrawable before approval; nothing destructive exists in the portal).*

---

## 1. Users

| User | What they do in this addendum | Devices |
| --- | --- | --- |
| **Adult member (authenticated, phone OTP)** | Views own record; direct-edits safe fields; proposes the rest; manages own consent + push devices (v6 C6/C7 already); registers self for events; reads news | Mobile-first |
| **Guardian / household head (authenticated adult)** | Proposes changes for minors in own household; registers family members (incl. minors with guardian block); reads family registrations | Mobile-first |
| **Branch admin / area admin** | Reviews + approves/rejects record-change proposals; owns announcements + events publishing (unchanged duties, new queue item) | Desktop |
| **Auditor (area)** | Reads proposal audit trail | Desktop |

Explicitly not a user: **minors acting alone** (no login, no direct thread — guardian holds every action, base PRD §7.1 and v6 §2 stand); the general public without a mediated path (public event registration is unchanged, create-only); staff acting through the portal (staff keep staff surfaces — no dual path).

*Accessibility lens (WCAG POUR, same contract as base PRD §7.3): every portal surface ships with real labels, visible focus, no color-only meaning (proposal states carry text + icon), single-column form layout, `aria-live` for save/propose feedback, reduced-motion respect. Reading level: plain language — "propose" is shown as "send to the church office for approval".*

---

## 2. Capability list (v1 of this portal)

- **P1 — Member home.** One `/me` surface with 4 jobs (My record, Events, News, My requests) + household switcher for guardians; pending-proposal and upcoming-registration counts drill into data.
- **P2 — My record.** Own `people` row rendered in profile language; each field labelled with its rule (instant vs approval); direct edits save with inline confirmation; everything else opens a propose sheet stating reviewer + expected wait.
- **P3 — Family edit/propose flow.** Guardian view of own-household members; adult members' restricted fields masked; **every write against a minor creates a proposal — never a direct edit**; proposal states `submitted → approved/rejected → applied`, withdrawable while `submitted`.
- **P4 — Events + registration.** Published-event list scoped to the member (public + own-branch + area-wide); event detail reuses the registration form incl. guardian block for minors, age/capacity gates, ticket-code confirmation; "my registrations" with cancel-request (never silent delete).
- **P5 — News reader.** Published, in-window, scope-matched announcements in newest-first list + reader view; unread marker is per-device local state (no read-tracking PII server-side in v1).
- **P6 — My requests.** Proposal list with state + reviewer note; registration list with status + ticket code.

*IA lens (Information Scent, F-pattern): the 4 home labels match the board ask verbatim (records, events, news); each screen repeats its one-line job so a stranger knows in two seconds what is primary.*

---

## 3. Non-goals (v1 of this portal)

| # | Non-goal | Instead |
| --- | --- | --- |
| 1 | **No staff functions** — no people search, no attendance, no welfare/finance, no campaign/comms send, no approvals by members | Staff surfaces unchanged; proposals land in a staff review queue |
| 2 | **No other families' records** — no cross-household read or write | Household scope enforced server-side; fail-closed |
| 3 | **No youth direct messaging** — no adult-to-minor private channel, no minor login | Guardian-held everything (v4 §2.3 hard rule stands) |
| 4 | No member publishing (events, announcements) or member-to-member directory | Portal is read-self + propose-self only |
| 5 | No payments in v1 (paid-event fees stay staff-reconciled) | Registration records `amount_expected`; payment status read-only to members |
| 6 | No server-side read-receipts for news in v1 | Unread state is local-only; analytics collect nothing new |
| 7 | No OTP/auth changes in this addendum | v4 §6.1 parameter block stands; device/session handling unchanged (§7) |

*Ethics lens: no dark patterns — consent toggles default off and are never bundled ("update your record" never auto-opts into messaging); propose sheets state the reviewer and the wait honestly; withdrawing a proposal is as easy as submitting one.*

---

## 4. Edit-vs-propose rules per field (the SecurityEngineer review surface)

**Minor safeguard (hard rule, stated once, enforced everywhere): a minor's record is NEVER directly editable through the member portal — not by the minor (no login exists), not by the guardian, not by the household head. Every write against `people.is_minor = true` is a proposal requiring branch-staff approval, and sensitive minor fields (§4.3) are not proposable at all.**

### 4.1 Adult own record (`people`, self only)

| Field(s) | Rule | Rationale |
| --- | --- | --- |
| `preferred_name`, `other_names`, `photo` | **Direct edit** (audited) | Low-risk display data; reversible |
| `address` (own), `emergency_contact_*` (on registrations) | **Direct edit** (audited) | Operational correctness; member is the authority |
| `consent_data`, `consent_media` toggles | **Direct edit** (audited, withdrawal effective immediately) | Consent must be as easy to withdraw as to give; withdrawal exits enrollments per v4 |
| Own push devices (v6) | **Direct** (toggle + remove) | Already decided in v6 |
| `first_name`, `last_name`, `gender`, `date_of_birth` | **Propose-for-review** | Legal-identity fields; DOB drives `is_minor` derivation — never hand-editable |
| `phone`, `email` | **Propose-for-review + re-verification** | OTP identity is phone-bound; a new phone requires OTP verification to the new number before staff approval applies it |
| `household` linkage, `branch`, `membership_status`, `member_since`, `guardian` linkage, marriage fields | **Propose-for-review** | Scope/identity-affecting; staff validate |
| `is_minor`, `safeguarding_flag`, `notes`, `status`, `user` link | **Never (member)** | Derived / restricted / staff-only (§4.3) |

### 4.2 Household (`households`, own household, head/guardian role)

| Field(s) | Rule |
| --- | --- |
| `phone`, `address` (shared household contact) | **Direct edit** by household head (audited) |
| `name`, `primary_contact`, membership of household (add/remove person) | **Propose-for-review** (changes scope for others) |
| `geo`, `map_pin`, `notes` | **Never (member)** — restricted (expansion §11.1) |

### 4.3 Never member-writable or proposable (any record)

`safeguarding_flag`, `notes` (people + households), `is_minor` (derived), `membership_status`, `member_since`, `status`, `user`/`member_person` links, `medical_notes`/`allergies` outside the registration guardian block, any field on any person outside own household, anything on a staff/branch/area collection.

### 4.4 Guardian proposing for a minor (own household only)

- Guardian must be authenticated adult linked to the minor via `people.guardian` or household headship; otherwise the portal shows nothing to propose on.
- Proposable: `preferred_name`, `photo`, `address`, `phone`/`email` (guardian's own contact recorded as the minor's contact — **no direct minor contact channel**), `gender`, `date_of_birth` (correction with evidence note), `emergency_contact_*`.
- **Not proposable:** `consent_*` for the minor (guardian consent is captured at registration/interaction points, never as a standing toggle by portal), `safeguarding_flag`, `notes`, `membership_status`.
- Every minor proposal routes to branch staff; SLA mirrors newcomer triage (24h branch triage, surfaces if unreviewed >3 days — same 3-day rule as v4 US-N5).

*Safeguarding lens: data minimisation (portal collects nothing beyond what staff could already hold), guardian-as-holder (v4 §2.3), separation of media consent (photo upload by guardian still needs staff-published `consent_media` handling — upload is storage, not consent).*

---

## 5. Permission model (member role grants — extends v4 §6 / data-model-v4 §5)

Enforcement is server-side Directus policies; the portal UI only hides. Fail-closed: any missing scope → empty.

| Action | Grant |
| --- | --- |
| Read own `people` row | R, field-restricted (no `safeguarding_flag`, `notes`, others' restricted fields) |
| Direct-edit own safe fields (§4.1) | U on allowlisted fields only |
| Create proposals (own + own-household minors via guardian link) | C on `record_change_proposals`; R own proposals; withdraw own `submitted` |
| Read own household | R `households` (own only, restricted fields excluded) + R household roster (limited columns; adults' DOB/contact masked) |
| Events | R `events` where `status = published` AND (`visibility = public` OR (own-branch) OR area-wide `branch IS NULL`), registration window open; C `event_registrations` (self + own-household, guardian block enforced) |
| News | R `announcements` where `status = published` AND in `[publish_from, publish_to]` window AND scope-matched (§6); read-only |
| Consent + devices | Own `consent_records` R + toggle (direct); own `push_device_tokens` manage (v6) |
| Own registrations + invites | R own `event_registrations`, own `event_invites` status |

Denied (same as v4 §5 member row, extended): people search; any other person's record; attendance; welfare; finance; campaigns/comms; `communication_recipients` beyond own invite status; `contact_value`, `error_detail`, `provider_message_id`; proposal review/approve (staff only); announcement/event authoring.

---

## 6. Announcements visibility model (checked)

Base collections define `announcements` (expansion §9.5: `title, body, publish_from, publish_to, channels, audience, status ∈ draft/scheduled/published/cancelled, created_by, approved_by`) with matrix row `announcements: … R (dept) | R | R | R (public ones)` — i.e. household/member reads exist today only as "R / R (public ones)".

**v7 member-news rule (new, explicit):** a member sees an announcement iff `status = published` AND (`publish_from` is null or past) AND (`publish_to` is null or future) AND (`audience` is area-wide/null OR includes the member's branch) AND (`channels` includes a member channel — `in_app`/member — or is empty/unset, treated as all). Draft/scheduled/cancelled are never member-visible; branch-scoped items never leak cross-branch. No new visibility enum is introduced — the existing `audience` + window + status triple is the model; the portal only adds the scoped read policy. Open question OQ-N3 asks the board to confirm the `channels` convention.

---

## 7. Data-model implications

Reuse first: `people`, `households`, `events`/`event_registrations`, `announcements`, `event_invites`, `consent_records`, `push_device_tokens` (v6), Area → Zone → Branch scope. **OTP/device/session handling: unchanged** — v4 §6.1 block stands (sealed httpOnly session cookie bound to exactly one `member_person`, ≤8h lifetime, `member_access_expires_at` re-checked per request). This addendum adds no auth surface and no new token store.

**1 new collection:**

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `record_change_proposals` | Member-submitted change requests with review trail (append-only; never hard-deleted) | `subject_person` (M2O `people`), `household` (nullable), `proposed_by_person` + `proposed_by_user`, `field` (allowlisted per §4), `old_value`/`new_value` (json; restricted fields never stored here), `is_minor_subject` (bool, auto from subject), `guardian_link` (M2O nullable, required when minor), `status` (`submitted/withdrawn/approved/rejected/applied`), `reviewer`, `reviewed_at`, `review_note`, `applied_at`, `branch/zone` denorm |

**Extensions (no new log tables):** `event_registrations` — none (guardian block + ticket flow reused as-is); `announcements` — none (read policy only); `directus_users` — none (member fields already in v4 §3.2). Proposal review history rides the Directus activity log; `applied` writes go through the existing staff update path so the audit trail stays single.

**Invariants:** one proposal per (person × field) while `submitted` (dedupe key); minor-subject proposals require `guardian_link` + staff approval, no auto-apply; phone/email-apply requires completed re-verification evidence on the proposal; deletes prohibited (withdraw/close instead); consent withdrawal still exits enrollments and invalidates push tokens (v4/v6 unchanged).

---

## 8. User stories (acceptance hooks for estimation, not build)

**US-P1 — See my church home.** As a member, I want one home with my record, events, news, and requests so that I know where everything lives.
- AC1: Four sections with counts (pending proposals, upcoming registrations, unread-in-window news); guardian sees household switcher.
- AC2: No section renders data the member may not read (capability-driven, fail-closed).

**US-P2 — Fix my record safely.** As an adult member, I want safe fields to save instantly and the rest to go for approval so that I am never confused about what happened.
- AC1: Every field labelled instant vs approval; direct edit confirms inline <400ms perceived (Doherty Threshold, optimistic state).
- AC2: Propose sheet states reviewer (church office) + wait; proposal appears in My requests as `submitted`; withdrawable.

**US-P3 — Care for my family (minor safeguard).** As a guardian, I want to propose corrections for my child so that records stay right without exposing the child.
- AC1: Minor records NEVER directly editable — propose-only, always; AC2: non-guardian sees no minor actions; AC3: unreviewed >3 days surfaces to branch staff.

**US-P4 — Join events.** As a member, I want published events + registration for me and my family so that signup matches the RockRMS reference (event detail → register → confirmation).
- AC1: List scoped (public + own-branch + area-wide, published, window-open); AC2: registration reuses guardian/age/capacity gates + ticket-code confirmation; AC3: my registrations show status + ticket; cancel is a request, never a silent delete.

**US-P5 — Read church news.** As a member, I want scoped announcements newest-first so that I see what concerns my branch.
- AC1: Only published/in-window/scope-matched items; AC2: reader view with publisher + date; AC3: no server-side read tracking in v1.

---

## 9. Open questions (recommended defaults; SecurityEngineer review proceeds on defaults)

| # | Question | Recommended default | Owner |
| --- | --- | --- | --- |
| OQ-P1 | Phone/email change verification UX (OTP to new number before apply)? | Yes — re-verification evidence required on the proposal before staff apply | SecurityEngineer + CTO |
| OQ-P2 | Proposal SLA + surfacing? | 24h branch triage; unreviewed >3 days surfaces (same rule as newcomers) | Welfare lead + CTO |
| OQ-P3 | `announcements.channels` member convention? | Empty/unset = all incl. members; explicit member channel otherwise (§6 rule) | Board + CTO |
| OQ-P4 | Photo upload moderation? | Guardian/member upload stored pending; visible publicly only after staff `consent_media` handling | Board + DPCO |
| OQ-P5 | Paid-event fees in portal? | Read-only amount display in v1; no payment capture (non-goal 5) | Board + CTO |
| OQ-P6 | Minor correction evidence (e.g. DOB)? | Free-text reason required; documentary evidence optional note, no binary upload in v1 (same as v5 `file_note`) | Board + DPCO |

---

*Companion: `wireframes-v6` (this issue). Next step: SecurityEngineer review of §4–§5 + §7, then Coder estimation/build — neither starts here. Planning only — visual design, component library, and the WCAG 2.1 AA pass stay gated on the design system (AFC-152), per board instruction; this set fixes structure and behaviour.*
