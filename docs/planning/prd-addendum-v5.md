# PRD Addendum v5 — Workflow and Form Builder (staff-facing)

**Issue:** AFC-586 · **Parent:** AFC-460 (PRD implementation, Church Portal) · **Ancestor:** AFC-146 (Church Portal)
**Updates:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147 base), [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion) (AFC-150 v3), [prd-addendum-v4](/AFC/issues/AFC-151#document-prd-addendum-v4) (AFC-151 v4)
**Owner:** UXDesigner (design only) · **Status:** Draft for user confirmation · **Version:** v5 (2026-10-21)
**Planning only — no production code, no deployments, no secrets. Design-then-estimate applies: no build commitment on this issue.**

**Companion docs (this issue):** `wireframes-v4` (builder canvas, field palette, submission review queue, workflow status view)

> **Read order.** This addendum extends the AFC-147 base PRD, the AFC-150 v3 expansion (hierarchy, attendance, youth, campus), and the AFC-151 v4 addendum (single-page UI, newcomer care, invitations, campaigns). Where it conflicts, **this addendum wins** for the domains it covers (custom forms, submissions, simple review/approval workflows). Everything else is unchanged and not repeated here.

---

## 0. Working hypothesis — confirm before estimate

The user ask (2026-10-21) is read as a **staff-facing builder for custom forms plus simple workflows on submissions**. This is a hypothesis, not a silent assumption. If it is wrong, §9 gives the corrected-scope alternative first.

**Hypothesis (H1):**

- Staff build **custom forms** for operational intake: event registration variants, visitor/welfare intake, volunteer sign-up.
- The builder offers **pick-or-drag field types** (text, number, phone, email, date, single/multi select, yes/no, file note, consent checkbox, guardian block for minors), each marked **required/optional** with **basic validation** (required, format, min/max, option list).
- Each form has **versions** (draft → published → archived); submissions always bind to one immutable version snapshot.
- **Simple workflows on submissions:** route a submission to a **role** (branch admin, welfare officer, youth lead) for **review/approval**, with **status transitions** (`new → in_review → approved | changes_requested | rejected → closed`), assignment, notes, and an audit trail.
- A **notifications hook** prepares the future center: workflow events emit to the existing `communications` log path, but no new notification center ships in v1.

**If H1 is wrong, propose this corrected scope first (do not build):**

| If the user meant | Corrected scope |
| --- | --- |
| Public/anonymous crowdsourced workflows | Out of v1 by non-goal; propose member-invite path (§3 of v4) instead |
| E-signatures or payments inside forms | Out of v1; propose manual reconcile + signed-document upload field instead |
| Full BPMN engine (parallel branches, SLAs, escalations) | Out of v1; propose the linear role-route + status model (§4) as the v1 ceiling |

*Design lenses: Progressive Disclosure (builder hides advanced validation until needed), Recognition over Recall (field palette shows purpose, not schema names), Tesler's Law (complexity lives in the builder so the respondent's form stays simple).*

---

## 1. Users

| User | What they do here | Devices |
| --- | --- | --- |
| **Form builder** (area admin, branch admin, youth/campus lead) | Creates, versions, publishes, archives forms; configures fields, validation, workflow route | Desktop |
| **Reviewer** (branch admin, welfare officer, youth lead, zone admin) | Triages the submission queue, assigns, approves/requests-changes/rejects, adds notes | Desktop + mobile |
| **Respondent** (staff-entered or authenticated member) | Fills a published form; staff may enter on behalf of a walk-in/visitor (mirrors US-5 staff registration pattern) | Mobile-first |
| **Auditor** (area admin) | Reads the immutable submission + transition log, exports CSV | Desktop |

**Explicitly not a user in v1:** the general public without a mediated path (no anonymous open workflows), minors acting alone (guardian block required, per safeguarding §7 of the base PRD), finance approvers for payments (no payments in v1).

*Accessibility lens (WCAG POUR): every respondent-facing field ships with a real label, visible focus, error text linked by `aria-describedby`, and no color-only meaning — the same contract as the base PRD §7.3.*

---

## 2. Capabilities (v1)

### 2.1 Form definitions

- **CRUD on form definitions:** title, description, owning scope (area / zone / branch / department), category (`event_registration`, `visitor_intake`, `welfare_intake`, `volunteer_signup`, `other`), status (`draft` / `published` / `archived`).
- **Field palette (pick or drag — builder offers both, keyboard-accessible pick list is canonical):** `short_text`, `long_text`, `number`, `phone`, `email`, `date`, `single_select`, `multi_select`, `yes_no`, `consent_checkbox`, `guardian_block`, `file_note` (a note that a paper/file was received; no binary upload in v1).
- **Per-field config:** label, help text, required/optional, default value, option list (for selects), basic validation rules (required, format for phone/email/date, min/max length or numeric range, max options for multi-select).
- **Ordering + grouping:** fields order vertically; one level of **section groups** (chunking — *Miller's Law / Chunking:* no section holds more than ~7 fields without a split prompt).
- **Preview as respondent** before publish, with a permission-scoped sample render (mirrors campaign preview, v4 §4.5 US-C1).
- **Versioning:** publishing freezes an immutable **version snapshot**; editing a published form creates a new draft version. Submissions bind to `form_version`, never to the live definition.

### 2.2 Publishing and lifecycle

- `draft → published → archived`. Archived forms accept no new submissions; existing submissions stay reviewable.
- Scope rule: a branch builder publishes for their branch only; area builders publish area-wide or per-zone/branch. The frontend renders only forms the viewer may use (*capability-driven navigation*, unchanged).
- Unpublishing is `archived`, never delete. Definitions and versions are retained for audit.

### 2.3 Submissions

- One row per fill, bound to `(form, version)`, with respondent link (`person` where known, else staff-entered name/phone), channel (`staff_entered`, `member_self`), answers as JSON validated against the version snapshot, status, assignee, timestamps.
- **Validation:** client-side inline validation (on blur + on submit, *Forgiveness + inline validation*) plus server-side re-validation against the snapshot. A version change never invalidates old submissions.
- **Dedupe hint:** phone/email match warns the reviewer (same pattern as newcomer duplicate detection, v4 US-N1 AC4) — warn, do not block.
- Export: CSV per form/version, permission-scoped.

### 2.4 Simple workflows on submissions

- **Route to a role:** each published version names a default review role + optional fallback assignee (e.g. welfare intake → `welfare_officer`; volunteer sign-up → `branch_admin`).
- **Status transitions (linear, v1 ceiling):** `new → in_review → approved | changes_requested | rejected → closed`. `changes_requested` returns to `in_review` on resubmit/correction. Every transition records actor, timestamp, note, and previous status (append-only log, mirrors `welfare_case_events`).
- **Queue:** filter by form, status, assignee, scope, date; sort by oldest-first default (*Goal-Gradient + Pareto:* the queue shows what is closest to done and what is overdue first).
- **Assignment:** one click assign/reassign within the permitted role set; unassigned >3 days surfaces on the branch dashboard (same 3-day rule as newcomers, v4 US-N5).
- **Notifications hook (future center, not a center):** each transition emits a `workflow_events` row that the existing `communications` path may consume (staff email/SMS/WhatsApp via consented channels). No new inbox UI ships in v1; the hook is the contract.

*Decision lens: Hick's Law — the reviewer gets at most four terminal actions (approve / request changes / reject / close); Fitts's Law — the primary action is the largest target in the review pane.*

---

## 3. Non-goals (v1)

| # | Non-goal | Instead |
| --- | --- | --- |
| 1 | **No public anonymous workflows** — no open URL that creates review work from strangers | Staff-entered or authenticated-member fills only; public intake stays on the existing event-registration path |
| 2 | **No e-signatures** | `consent_checkbox` + timestamp + actor; paper signatures recorded via `file_note` |
| 3 | **No payments** | Amount fields are plain numbers with "record + reconcile manually" (base PRD §3.2 pattern); no gateway, no ledger |
| 4 | No parallel-branch BPMN, no timers/SLA engine, no escalation chains | Linear status model (§2.4); anything fancier is a v2 proposal |
| 5 | No binary file uploads | `file_note` records receipt; storage/retention policy defers with NDPA review |
| 6 | No cross-branch review pooling | Reviewers see their scope only (Area → Zone → Branch) |
| 7 | No new notification center UI | `workflow_events` hook only; consumption via existing comms log |

*Ethics lens: no dark patterns. Required fields are marked before submit, consent is never pre-ticked, and withdrawing a submission is as easy as submitting it (refuse roach-motel and confirmshaming by construction).*

---

## 4. Permission model

| Action | Area admin | Zone admin | Branch admin / dept lead | Welfare officer / reviewer | Volunteer | Member (authenticated) | Public |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Build (create/edit fields, validation) | CRUD (all scopes) | CRUD (own zone) | CRUD (own branch/dept) | — | — | — | — |
| Publish / archive | Yes (own scope+) | Yes (own zone) | Yes (own branch/dept) | — | — | — | — |
| Submit / fill | Yes | Yes | Yes | Yes (assigned forms) | Staff-entered | Self (published, in scope) | — |
| Review queue (read) | All | Own zone | Own branch/dept | Assigned + own branch | — | Own submissions only | — |
| Assign / transition | Yes | Own zone | Own branch/dept | Assigned rows | — | — | — |
| Export CSV | Scoped | Scoped | Scoped | Assigned rows | — | — | — |
| Delete definitions/submissions | — (archive only) | — | — | — | — | — | — |

**Enforcement:** server-side Directus policies; the frontend only hides UI (base PRD §6 pattern). Sensitive answers (health, welfare detail, guardian data) carry field-level restrictions; minors' rows follow the base safeguarding rules (guardian link, no public exposure, media-consent separation).

---

## 5. Data-model implications (new collections)

Reuse first (v4 §1 reuse rule applies): `people`, `households`, `visitors`, `welfare_cases`, `events`/`event_registrations`, `communications` + `communication_recipients`, `consent_records`, `leadership_positions`, Area → Zone → Branch scope.

**4 new collections + 1 log:**

| Collection | Purpose | Key fields |
| --- | --- | --- |
| `custom_forms` | Definition + lifecycle | `title`, `description`, `scope_area/zone/branch/department`, `category`, `status` (`draft/published/archived`), `default_review_role`, `fallback_assignee`, `current_version` |
| `form_versions` | Immutable published snapshot | `form` (M2O), `version_no`, `schema_snapshot` (json: sections, fields, validation), `published_by/at`, `archived_at` |
| `form_fields` | Builder rows for the draft (compiled into the snapshot at publish) | `form`, `section`, `sort`, `field_type`, `label`, `help_text`, `required`, `options_json`, `validation_json`, `sensitivity` (`normal/restricted`) |
| `form_submissions` | One fill bound to a version | `form`, `form_version`, `respondent_person` (nullable), `entered_by`, `channel`, `answers_json`, `status` (`new/in_review/approved/changes_requested/rejected/closed`), `assignee`, `due_at` |
| `workflow_transitions` (append-only log) | Every status/assignment change | `submission`, `from_status`, `to_status`, `actor`, `note`, `created_at`; plus `workflow_events` hook rows (`event = submitted/assigned/transitioned`, `consumed_by_comms` nullable) consumed by the existing comms path |

**Invariants:** submissions bind to `form_version`, never to the live definition; versions are immutable once published; transitions are append-only; deletes are prohibited (archive/close instead). Consent for follow-up contact resolves through `consent_records` at review time, exactly as campaigns do (v4 §4.3).

---

## 6. User stories (acceptance hooks for estimation, not build)

**US-F1 — Build a volunteer sign-up form.** As a branch admin, I want to assemble a sign-up form from field types so that volunteers can register without a spreadsheet.
- AC1: I pick fields from the palette (or drag them); each shows its purpose, not a schema name.
- AC2: Required/optional and basic validation are set per field; the builder warns when a section exceeds ~7 fields.
- AC3: Preview renders exactly what a respondent sees, on desktop and a 390px viewport.
- AC4: Publish freezes version 1; further edits open version 2 as draft.

**US-F2 — Review a welfare intake submission.** As a welfare officer, I want a queue of submissions routed to my role so that nothing waits silently.
- AC1: The queue defaults to oldest-first, filterable by form/status/assignee/date, scoped to my branch.
- AC2: Opening a row shows answers against the frozen version, the transition history, and at most four actions.
- AC3: Approve / request-changes / reject / close each require or offer a note; every action is logged with actor + timestamp.
- AC4: Unassigned rows older than 3 days appear on the branch dashboard.

**US-F3 — Track workflow status.** As an area admin, I want per-form status counts (new / in review / approved / changes / rejected / closed) so that I can see where work stalls.
- AC1: Counts are clickable into the filtered queue (analytics-with-drill-down, v3 §1.1 contract).
- AC2: CSV export respects scope.
- AC3: No reviewer sees another scope's rows.

**US-F4 — Stay safe with minors and consent.** As a builder, I am offered the guardian block whenever my form could take a minor's data, and consent checkboxes are never pre-ticked.
- AC1: Any form in `visitor_intake`/`event_registration`/`volunteer_signup` categories prompts for the guardian block.
- AC2: Submissions from minors without guardian data are flagged `changes_requested` with a safeguarding note.

---

## 7. Open questions (recommended defaults; estimate proceeds on defaults)

| # | Question | Recommended default | Owner |
| --- | --- | --- | --- |
| OQ-W1 | Is H1 (staff-facing builder + role-route + linear statuses) the right reading? | Yes; if not, §0 corrected scope applies | User / board |
| OQ-W2 | Who may build at each scope? | §4 matrix (branch builds for own branch; area cross-scope) | Board + CTO |
| OQ-W3 | File uploads in v1? | No — `file_note` only; revisit with NDPA/storage review | CTO |
| OQ-W4 | Do workflow events send messages in v1, or only log the hook? | Log the hook; staff send manually via existing comms until the center exists | CTO |
| OQ-W5 | Dedupe strictness on submissions? | Warn on phone/email match; never block | Welfare lead + CTO |

---

*Companion: `wireframes-v4` (this issue). Planning only — visual design, component library, and the WCAG 2.1 AA pass stay gated on the design system (AFC-152), per board instruction; this set fixes structure and behaviour.*
