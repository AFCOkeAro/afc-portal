# PRD — Church Portal (Lagos North Area)

**Issue:** AFC-147 · **Parent:** AFC-146 (Church Portal) · **Project:** Church Portal
**Owner:** CTO (MediaTech) · **Status:** Draft for board review · **Version:** v1 (2026-10-05)
**Companion docs:** `data-model` (schema + permission matrix), `infra-spec`, `repo-plan`, `wireframes`

---

## 1. Overview

A single web portal for the main church office, the youth department, and individual branches to run church operations: events and registration, Sunday worship and rosters, attendance, visitor management and follow-up, welfare, and person profiles. Near-term, the portal must carry the **Youth Summit** and the **Teenage Camp Project** (registration, consent, attendance, camp operations).

**Strategy decision (from AFC-146 plan, retained):** Directus is the backend/data platform; a custom **Nuxt 3** frontend delivers the portal UI. Directus Studio is an internal admin tool, not a member/visitor-facing experience, so a separate frontend is required. Monospace is not adopted now (it costs ~$99/mo cloud-hosting for a qualifying org, and its Starter tier is 1 workspace / 3 users; it adds no value for a single app + single database). The schema is designed so a later Monospace move is configuration, not a rewrite.

### 1.1 Product goals

1. Give each branch self-service for its own events, attendance, visitors, and rosters, while the area office sees across all branches.
2. Give the youth department a dedicated, time-boxed path to run Youth Summit and Teenage Camp registration and on-site operations.
3. Replace ad-hoc spreadsheets/WhatsApp tracking with one auditable system of record for people, attendance, and care.
4. Protect minors' data and welfare information with explicit consent, scoped access, and an audit trail.

### 1.2 Non-goals (this phase)

- Online payment processing (fees are recorded and reconciled manually in MVP).
- Public social/community features, member login self-service, or a mobile native app.
- Accounting, payroll, or giving-platform integration (revisit with Monospace later).
- High-fidelity visual design system (lo-fi wireframes only; see open questions).

### 1.3 Success metrics (Phase 1–5)

| Metric | Target |
| --- | --- |
| Branches onboarded | 100% of Lagos North branches active |
| Attendance captured per service | ≥ 90% of Sunday services have a recorded session |
| Visitor follow-up timeliness | ≥ 80% of new visitors contacted within 7 days |
| Youth Summit registrations | 100% of registrations captured in-portal (no spreadsheets) |
| Staff login adoption | ≥ 90% of branch admins weekly active |
| Median page load (3G, SSR) | < 2.5s LCP; API p95 < 500ms |

---

## 2. Users and roles

| Role | Description | Primary devices |
| --- | --- | --- |
| Super admin (area/technical) | Full config, users, roles, schema. Small, trusted group (1–3). | Desktop |
| Area admin | All branches' operational data; area dashboards; approvals. | Desktop |
| Branch admin | Own branch's people, events, attendance, visitors, welfare. | Desktop + mobile |
| Department leader (youth) | Own department across assigned branches (youth/teens). | Desktop + mobile |
| Volunteer / attendance taker | Capture attendance and check-in for own branch/event. Narrow access. | Mobile first |
| Public registrant | No login. Public event/Youth Summit registration only. | Mobile first |

Role-to-permission mapping is explicit and testable in the `data-model` document (`## Permission matrix`).

---

## 3. Feature list by module

Legend: **M** = MVP (Phase 1–2), **N** = near-term (Phase 3–5), **L** = later.

### 3.1 Events (M)
- Create/edit/publish/cancel events; area-wide or branch-scoped; target departments; capacity and waitlist.
- Event types: service, summit, camp, training, outreach, social, other.
- Public visibility toggle, registration window (open/close datetime), fee amount + currency.
- Cover image and rich description.
- Event detail page with schedule, location, registration CTA.

### 3.2 Event registration (M)
- Public registration form per event (no login): registrant details, age group, branch, guardian consent for minors, optional medical/emergency contact for camps.
- Staff-side manual registration (walk-in/phone).
- Capacity + waitlist handling; confirmation ticket code.
- Registration statuses: pending, confirmed, waitlisted, cancelled, attended, no-show.
- Manual payment capture/reconciliation (amount expected/paid, reference) — no online payment in MVP.
- Export registration list (CSV) for branch staff.

### 3.3 Attendance (M)
- Attendance sessions (Sunday service, midweek, event, camp, department) with aggregated headcounts by category.
- Optional individual check-in records for events/camps where names matter.
- Volunteer quick-capture UI: pick session → tap-to-count or search person → save.
- Attendance history and simple per-branch trend.

### 3.4 Sunday worship / rosters (N)
- Record a Sunday service (date, time, theme, preacher).
- Build a service roster: assign people to roles (worship, preaching, ushering, media, sound, children, welcome, prayer, offering).
- Roster status: invited / confirmed / declined.
- Link service to its attendance session.

### 3.5 Visitor management (M)
- Visitor intake form (person or anonymous, first-visit date, service, invited-by, age group).
- Follow-up queue with statuses (new → contacted → in follow-up → connected → integrated / dormant).
- Assign a follow-up owner and next-follow-up date; follow-up notes.
- Convert a visitor to a person profile.

### 3.6 Welfare (N)
- Welfare case records (category, priority, confidentiality, assigned owner, status).
- Case notes and a case event trail (audit).
- Welfare contributions/support records (cash/goods/service, approved/disbursed).
- Restricted access: branch-level by default, area-level only when confidentiality allows.

### 3.7 Person profiles (M)
- Single profile per person: names, contact, address, DOB/age, household, home branch, departments, membership status.
- Link a person to a login account (staff) — see `data-model`.
- Guardian link for minors; consent flags (data + media) and consent signed date.
- Person timeline (attendance, registrations, follow-up, welfare — subject to permissions).
- Search and dedupe-friendly lookup (name, phone, email).

### 3.8 Branch portals (N/L)
- Branch-scoped landing/dashboard: my branch at a glance (attendance last service, upcoming events, open follow-ups, service roster).
- Branch admins only see their branch; the frontend renders only permitted navigation.

### 3.9 Admin dashboards (N)
- Area dashboard across all branches: attendance trends, event/registration counts, visitor follow-up SLA, welfare case load, branch comparison.
- Branch dashboard: same, scoped to one branch.

### 3.10 Youth Summit & Teenage Camp (N, fast-trackable)
- Public registration page per programme with consent and capacity control.
- Camp-specific: medical/emergency fields, guardian consent, age eligibility, attendance/check-in at camp.
- Short path: public form → Directus `event_registrations` → branch staff export. Can ship ahead of the full portal.

### 3.11 Notifications & communications (L)
- Automated emails via Directus Flows: registration confirmation, event reminder, follow-up reminders.
- Basic communication log against people/branches.

---

## 4. User stories with acceptance criteria

Format: **US-x**. Each story is independently testable.

### Authentication and role landing

**US-1 — Staff sign-in.** As a staff member, I want to sign in and land on the home screen for my role, so that I see only what I am allowed to do.
- AC1: Valid credentials land the user on a dashboard appropriate to their role (area admin, branch admin, or department leader).
- AC2: A branch admin sees only their own branch's data and no cross-branch controls.
- AC3: Unauthenticated access to any internal route redirects to login.
- AC4: Failed login shows a generic error; no account enumeration.
- AC5: Sessions expire per policy; sign-out clears the session.

**US-2 — Public registration without an account.** As a member of the public, I want to register for an event without creating an account, so that I can sign up quickly.
- AC1: A public event URL renders the registration form with no login.
- AC2: Submitting valid details creates an `event_registrations` row and shows a confirmation with a ticket code.
- AC3: For a minor, guardian name + phone + consent are required before submit.
- AC4: The form respects capacity; once full, it offers waitlist if enabled, otherwise blocks.
- AC5: No public read access to other people, registrations, or internal collections.

### Events

**US-3 — Create and publish an event.** As a branch admin, I want to create an event for my branch and publish it, so that my branch can be informed and register.
- AC1: Required fields enforced: title, type, start/end, location, visibility.
- AC2: Branch admin can only set `branch` to their own branch.
- AC3: Publishing makes the event visible on the branch portal and (if `visibility = public`) on the public site.
- AC4: Cancel/close changes status and stops new registrations.
- AC5: Event list supports filter by type, branch (area admin), status, and date.

**US-4 — Area admin oversees events.** As an area admin, I want to see and manage events across all branches, so that I can coordinate the area calendar.
- AC1: Area admin list shows events from every branch.
- AC2: Area admin can create an area-wide event (`branch = null`).
- AC3: Branch admins cannot edit area-wide events they do not own.

### Registration

**US-5 — Staff register a walk-in.** As a branch admin, I want to add a registration on behalf of a walk-in, so that attendance data stays complete.
- AC1: Staff can create a registration with `source = staff`.
- AC2: Staff can mark a registration confirmed, waitlisted, cancelled, attended, or no-show.
- AC3: Amount expected/paid and reference can be recorded; payment status updates accordingly.

**US-6 — Export registrations.** As a branch admin, I want to export the registration list for an event, so that I can run check-in on site.
- AC1: Export returns all registrations for that event the user can see, as CSV.
- AC2: Sensitive fields (medical notes) are only included for roles permitted to see them.

### Attendance

**US-7 — Capture attendance quickly.** As a volunteer, I want to capture attendance for a service on my phone in under two minutes, so that it is not a burden.
- AC1: The capture screen opens to the current/next session for the volunteer's branch.
- AC2: Headcounts by category can be entered and saved in one action.
- AC3: A volunteer cannot see or edit other branches' sessions.
- AC4: Saving records `recorded_by` and `recorded_at`.
- AC5: The API is tolerant of a slow connection (submit retry; no partial duplicate on retry).

**US-8 — Event check-in.** As a volunteer, I want to check in registrants by name or ticket code, so that I can track who attended.
- AC1: Search by name or scan/enter ticket code.
- AC2: Checking in sets `registration_status = attended` and creates/updates an attendance record.
- AC3: Duplicate check-in is idempotent (no duplicate records).

### Sunday worship / roster

**US-9 — Record a Sunday service.** As a branch admin, I want to record a service with theme and preacher, so that we have a service history.
- AC1: Service saves with branch, date, time, type, theme, preacher.
- AC2: A service can be marked completed.
- AC3: Changing branch is blocked for branch admin.

**US-10 — Build a roster.** As a branch admin, I want to assign people to service roles, so that everyone knows their responsibility.
- AC1: Roster entries save role + person + status.
- AC2: The same person can hold different roles on different services.
- AC3: Roster for a service is viewable by the branch team.

### Visitors

**US-11 — Intake a visitor.** As a branch admin, I want to record a first-time visitor, so that we can follow up.
- AC1: Intake captures name (or single/anonymous), contact, first-visit date, service, invited-by, age group.
- AC2: A visitor can be linked to an existing person or created anonymously.
- AC3: A new visitor is created with status `new` and appears in the follow-up queue.

**US-12 — Work the follow-up queue.** As a branch admin, I want a prioritized queue of visitors to contact, so that no one is missed.
- AC1: Queue shows visitors by status, age, and next follow-up date, scoped to the user's branch.
- AC2: Assigning a follow-up owner and next date updates the queue order.
- AC3: Marking `connected`/`integrated` removes the visitor from the active queue.

### Welfare

**US-13 — Open a welfare case.** As a branch admin, I want to open a confidential case, so that support is tracked and auditable.
- AC1: Case requires category, person, priority, confidentiality, and a description.
- AC2: Case reference (e.g. `WEL-2026-0001`) is auto-generated.
- AC3: Only the assigned owner, branch admin, and area admin (when confidentiality allows) can read the case.
- AC4: Every status/assignment change writes a case event.

**US-14 — Record support given.** As a branch admin, I want to record a welfare contribution, so that the support is documented and approvable.
- AC1: Contribution captures type, amount/description, contributor, date, and status.
- AC2: Only an approver can move a contribution to approved/disbursed.
- AC3: Contributions are visible only within the case's confidentiality scope.

### People

**US-15 — View a person profile.** As a branch admin, I want a single profile with the person's history, so that I can serve them well.
- AC1: Profile shows contact, household, branch, departments, membership status, and age.
- AC2: Profile shows attendance, registrations, and follow-up history within permission scope.
- AC3: A branch admin cannot read people whose home branch is not theirs (unless also a visitor they manage).

**US-16 — Safeguard a minor.** As a branch admin, I want minors' records to require guardian consent, so that we protect youth data.
- AC1: A person with DOB under 18 is flagged as a minor automatically.
- AC2: Consent flags and signed date are recorded; missing consent is visible.
- AC3: Medical/safeguarding fields are visible only to permitted roles.

### Dashboards

**US-17 — Area oversight.** As an area admin, I want a dashboard across all branches, so that I can see health at a glance.
- AC1: Dashboard shows attendance (current vs prior service), upcoming events, registrations, open follow-ups, open welfare cases.
- AC2: Every widget can be filtered by branch and date range.
- AC3: Data respects permissions (nothing shown the user cannot access via the API).

**US-18 — Branch oversight.** As a branch admin, I want my branch's dashboard, so that I can run the branch.
- AC1: Same widget set, scoped to the branch.
- AC2: No total or link exposes another branch's data.

---

## 5. MVP vs later phases

### MVP (Phase 1–2)
- Directus + Postgres + auth; branch scoping; roles/policies.
- Person profiles; households; departments.
- Events + public registration + staff registration; manual payment reconciliation.
- Attendance sessions + quick capture.
- Visitor intake + follow-up queue.
- Base Nuxt shell: login, role landing, branch dashboard, area dashboard.

### Phase 3 — Care
- Sunday services + rosters.
- Welfare cases + contributions + case audit trail.
- Notifications (registration/follow-up) via Flows.

### Phase 4 — Branch portals & dashboards
- Full branch self-service portal and richer area analytics.
- Small groups; communications log.

### Phase 5 — Youth Summit & Teenage Camp
- Dedicated programme pages, camp-specific fields (medical, emergency, consent), camp check-in.
- Can be fast-tracked as an early vertical slice if dates are close.

### Phase 6 — Hardening
- Backups/restore drills, monitoring/Sentry, accessibility audit, training, runbooks, handover.

---

## 6. Permission matrix (summary)

Full, testable matrix lives in the `data-model` document. Summary:

| Collection | Super admin | Area admin | Branch admin | Dept leader (youth) | Volunteer | Public |
| --- | --- | --- | --- | --- | --- | --- |
| branches | CRUD | R | R (own) | R (assigned) | R (own) | – |
| people | CRUD | CRUD (all) | CRUD (own branch) | R/U (youth scope) | R (minimal) | – |
| households | CRUD | CRUD | CRUD (own branch) | R | – | – |
| departments | CRUD | CRUD | R (own branch) | R/U (own) | R | – |
| events | CRUD | CRUD | CRUD (own branch; not area events) | R + reg view (dept) | R | R (public only) |
| event_registrations | CRUD | CRUD | CRUD (own branch events) | R (dept events) | U (check-in only) | C (public form only) |
| attendance_sessions | CRUD | CRUD | CRUD (own branch) | CRUD (dept scope) | C/U (own branch) | – |
| attendance_records | CRUD | CRUD | CRUD (own branch) | CRUD (dept) | C/U (own branch) | – |
| sunday_services | CRUD | CRUD | CRUD (own branch) | R | R | – |
| service_assignments | CRUD | CRUD | CRUD (own branch) | CRUD (dept roles) | R (own assignments) | – |
| visitors | CRUD | CRUD | CRUD (own branch) | CRUD (youth visitors) | C (intake) | – |
| welfare_cases | CRUD | CRUD (all) | CRUD (own branch) | R (youth cases) | – | – |
| welfare_contributions | CRUD | CRUD | CRUD (own branch) | – | – | – |
| welfare_case_events | CRUD | R (all) | R (own branch) | R (youth) | – | – |

Permission rules are enforced **server-side by Directus policies**; the frontend only hides UI. Field-level restrictions apply to sensitive fields (medical notes, welfare description/outcome, DOB, consent) — see `data-model`.

---

## 7. Non-functional requirements

### 7.1 Safeguarding and consent (minors)
- **Data minimisation:** collect only what operations require. No DOB for public registrants unless age eligibility/consent requires it.
- **Guardian consent:** required for any under-18 registration or camp participation; store `guardian_consent` boolean + timestamp + signed document where applicable.
- **Age derivation:** `is_minor` is derived from DOB and maintained automatically; never entered manually.
- **Access restriction:** medical/safeguarding fields restricted by field-level permission to branch admin + designated welfare/safeguarding leads only.
- **No public exposure:** minors' personal data never appears on public endpoints; public registration is write-only.
- **Media consent:** separate `consent_media` flag; photos of minors without consent are not publishable.
- **Policy gate:** no youth/camp personal data is stored until the board approves a safeguarding & consent policy (open question OQ-1). Until then, the schema is ready but production data entry is gated.

### 7.2 Audit trail
- Directus `directus_activity` + `directus_revisions` capture create/update/delete with actor and diff (available in the open-source/self-hosted platform).
- Welfare additionally writes explicit `welfare_case_events` (status/assignment/notes/contributions) so case history is readable without reconstructing revisions.
- Audit records are append-only from the application's perspective; retention ≥ 24 months (policy-configurable).
- Sensitive-record reads by privileged roles are logged (see infra monitoring; directus activity on read is limited, so welfare access via API can be logged at the Flow/proxy layer if required).

### 7.3 Accessibility
- Target **WCAG 2.1 AA**: semantic HTML, keyboard operability, visible focus, labels on all inputs, ≥ 4.5:1 text contrast, alt text on images, no color-only meaning.
- Mobile-first for attendance and registration (majority mobile users).
- Works on low bandwidth: SSR/streamed pages, compressed assets, minimal JS; degrade gracefully on 3G.

### 7.4 Performance
- API p95 < 500ms for list/detail endpoints at expected scale (≤ 12 branches, ≤ 5k people, ≤ 100k attendance rows/yr).
- Page LCP < 2.5s on a throttled 3G profile; TTFB < 1s.
- Pagination on all list endpoints; server-side filtering.
- Attendance submit retry-safe (idempotent).

### 7.5 Backup and retention
- Nightly `pg_dump`; media synced to object storage. **Continuous WAL archiving is
  withdrawn** — it sets a hard floor under the backup-erasure lag that no dump-side
  decision can lower, and the stated RPO is 24h. Decision and arithmetic:
  [ADR-0005](/AFC/issues/AFC-169#document-adr-0005-erasure-lag-is-the-backup-window).
- Retention: 30 daily, 12 weekly, **3 monthly** backups; quarterly restore test through
  the gated restore pipeline. The monthly count was reduced from 12 by the CTO as an
  availability trade (deep recovery shortens to 3 months); erasure lag in media becomes
  ~90 days instead of 12. Same ADR.
- Targets: **RPO ≤ 24h**, **RTO ≤ 4h**.
- Person/attendance data retention policy defined with the board (default: retain while active + 7 years for financial welfare records; soft-archive people).

### 7.6 Security
- Least-privilege Directus roles/policies; public role is create-only on registration.
- TLS everywhere (Caddy automatic HTTPS); HSTS.
- Secrets only in environment/secret manager; never in the repo (see `repo-plan`).
- Rate limiting on public endpoints; bot protection on public forms.
- Admin/Studio access restricted to super/area admins; MFA where the platform allows.

---

## 8. Dependencies, assumptions, risks

**Assumptions**
- The church qualifies for the Directus Open Innovation Grant (< $5M revenue, < 50 employees) → free self-hosted license. CTO to confirm.
- ≤ ~12 branches, ≤ ~50 staff accounts, ≤ ~5,000 person records in the near term.
- English-only UI for now.

**Dependencies**
- Board answers to open questions (section 9) before data entry of youth/minors.
- Domain name + email/SMTP provider.
- Hosting account (VPS or Directus Cloud) and GitHub org.

**Risks**
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Multi-branch isolation bug leaks data | High | Directus policy filters + automated cross-branch permission tests in CI |
| Minors' data handled without policy | High | Hard gate: no youth data until policy approved (OQ-1) |
| Directus license eligibility wrong | Medium | Confirm OIG; fallback Team $499/mo annual |
| Single VPS downtime | Medium | Nightly backups, documented restore; add monitoring; scale vertically |
| No UX design capacity | Low | Ship lo-fi + component library (Nuxt UI) for v1; defer hi-fi |
| Vendor pricing change (Monospace) | Low | Schema portable; track pricing quarterly |

---

## 9. Open questions for the board

Each has a recommended default. These do not block this planning package; they block production data entry where noted.

| # | Question | Recommended default | Blocks |
| --- | --- | --- | --- |
| OQ-1 | Safeguarding & consent policy for minors (what we collect, who can see it, retention) | Approve a minimal policy: guardian consent + restricted fields + 7-year retention; no youth data before sign-off | Youth/camp data entry |
| OQ-2 | Hosting model: managed (Directus Cloud + Vercel) vs self-hosted VPS | Prototype on Directus Cloud (OIG $99/mo); production self-hosted VPS | Infra purchase |
| OQ-3 | Scale assumptions (branches, staff users, people) | 12 branches, 40 staff, 5,000 people | Sizing/license |
| OQ-4 | Design capacity for hi-fi UI | Use lo-fi wireframes + Nuxt UI component library for v1; defer a designer | Timeline polish |
| OQ-5 | Directus license eligibility (OIG) | Assume eligible; CTO confirms before production | License cost |
| OQ-6 | Domain and branding | `portal.<church-domain>` + church wordmark | DNS/launch |
| OQ-7 | Email/SMTP provider | Resend (free tier) or Postmark (~$15/mo) | Notifications |
| OQ-8 | Online payment for event/camp fees | No online payment in MVP; record + reconcile manually | Registration flow |

### Resolved

| # | Question | Resolution | Decided |
| --- | --- | --- | --- |
| OQ-9 | Data residency preference (EU vs other) | **The region is not a PRD default and no longer appears here as one.** It is a required provisioning parameter — `DEPLOY_REGION` in `services/directus/.env.example`, `<country>:<provider location code>`, no default. Chosen once by a human at the point the production VPS is bought; every document refers to that variable rather than naming a location. | AFC-171, ADR "Pin the production hosting region" |

**Why OQ-9 is no longer an open question with a recommended default.** This row used to read *"EU (Hetzner Falkenstein/Helsinki) unless policy says otherwise"* — which was **two** locations, presented as a recommended default inside an open question, and which downstream documents were quoting as though it were a decision. It was not. It was the provider named in an `infra-spec` sizing example, read back as a policy. A reader had no way to tell the difference, which is the same defect we walked back in a letter to a law firm.

The **residual** question is real and still open, and it is a different one: whether Nigerian children's and health data may lawfully sit in a platform hosted outside Nigeria, and on what transfer ground. That is Q21, with counsel, under procurement on [AFC-160](/AFC/issues/AFC-160). It is a legal question, and it is asked without naming a region for the same reason this row no longer does.

Full infrastructure and repository specifics are in `infra-spec` and `repo-plan`.

---

## 10. Appendices

- Wireframes: see the `wireframes` artifact attached to AFC-147 (low-fidelity HTML).
- Data model, indexes, and the explicit permission filters: `data-model`.
- Environment variables, Docker Compose outline, sizing, costs: `infra-spec`.
- Repo structure, CI, secrets, license notes: `repo-plan`.
