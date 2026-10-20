# PRD Addendum v3 — Expanded Operations (Church, Youth & Campus)

**Issue:** AFC-150 · **Parent:** AFC-146 (Church Portal) · **Updates:** [PRD](/AFC/issues/AFC-147#document-prd) (AFC-147), [PRD Addendum](/AFC/issues/AFC-148#document-prd-addendum) (AFC-148)
**Owner:** CTO (MediaTech) · **Status:** Draft for board review · **Version:** v3 (2026-10-05)
**Planning only — no production code, no deployments, no secrets.**
**Companion docs (this issue):** [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion), [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec), [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation), [wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion)

> **Read order.** This addendum extends the AFC-147 PRD and the AFC-148 addendum. Where it conflicts, **this addendum wins** (for the expanded domains), then the AFC-148 addendum, then the AFC-147 base PRD. Everything about communications, group registration, safeguarding, licence, NDPA, and the NestJS/Directus/Symfony Notifier stack is unchanged and is **not** repeated in full here.

---

## 0. Change summary — what this v3 adds

The board's [feature expansion](/AFC/issues/AFC-146#comment-91f61f28) turns the portal from a branch + events tool into an **area-wide church operations system** spanning four levels (Area → Zone → Branch → Bible Study Centre), youth, and campus care. The eleven new/expanded domain groups:

| # | Domain | New / changed |
| --- | --- | --- |
| 1 | Organization hierarchy & profiles | Area, Zone, BSC, Conference Centre, Sunday School, AVS, Campus; photos; analytics with drill-down |
| 2 | Attendance | Male/female split per category, per service type; weekly/monthly/quarterly/yearly/custom sort; CSV |
| 3 | Blessings | Salvation, sanctification, Holy-Ghost baptism, reanointing, healing, other; same sort/export |
| 4 | Households & people | Unified household map pin + wedding date; expanded person status, milestones, previous branches |
| 5 | Financial records | Monthly per-branch records + WECA returns (formula v1, ADR-0007) |
| 6 | Youth Care & Empowerment | Shared youth DB; celebrations & shout-outs; education/professional status |
| 7 | Campus Care & WAEC/UTME | Coaching programmes, facilitators, progress, results, AFCF/AFCMF, NYSC |
| 8 | Leadership & RBAC | Position registry + appointments; Area→Zone→Branch scopes; department heads; household access |
| 9 | UI | Dashboard, Reports, Forms; Zone/Branch/Family/Person/Department/Search/Branch List; prior-year compare |
| 10 | Events & Office | Event blessings/attendance/invite-a-friend; transfers, marriage matters, minutes, tasks, calendar, announcements |
| 11 | Integrations | Gravatar, Email, Telegram, SMS, WhatsApp, Backup, Users Management, birthday webhook, import/export |
| 12 | Address/postcode | Provider evaluation with a recommendation (separate doc) |

**Scale correction (from the expansion):** the area has **6 zones**, **80+ Bible Study Centres**, and conference centres, Sunday School classes, AVS centres, and campus cohorts. The AFC-148 ">15 branches / >60 staff / ~10k people" estimate is a **floor, not a ceiling**. Plan for **6 zones, ≥ 80 BSCs, ~10–15k people growing to ~20k**, and size the VPS accordingly (see updated phasing and the infra-spec sizing trigger list).

---

## 1. Organization hierarchy

### 1.1 Model

```
Area (Lagos North)
└── Zone (×6)
    ├── Branch (FFC / AFWC / semi-formed / worship centre / main)
    │   ├── Bible Study Centre (BSC) (×80+ total)
    │   ├── Sunday School class
    │   ├── Conference Centre
    │   └── AVS centre
    └── Branch …
Campus (cohorts linked to Area/Youth, not a geographic branch)
```

- **Area** — top of the hierarchy: name, code, overseer, address/geo, outdoor photo, analytics (zone/branch/BSC counts, attendance), leadership list.
- **Zone** — six per area: name, code, parent area, zone pastor/leader, address/geo, outdoor photo, analytics, branch list.
- **Branch** — full field set per the board (see §1.2). A branch belongs to exactly one zone.
- **Bible Study Centre (BSC)** — a congregation that meets under a parent branch; 80+ across the area. Full field set in §1.3.
- **Conference Centre** — a large meeting venue (see §1.4).
- **Sunday School** — a class under a branch/zone (see §1.5).
- **AVS centre** — a weekday/school-based outreach centre (see §1.6).
- **Campus** — a student cohort (institution/course/level), linked to youth, not a branch (see §1.7).

**Analytics-with-drill-down (board requirement: "analytics counts and a link to the actual data").** Every profile (area, zone, branch, BSC, person, household) shows **counts that are links** to the filtered list that produced them. Example: a zone page shows "Branches: 4 · BSCs: 17 · Last-Sunday attendance: 812 · Active youth: 143"; clicking "BSCs: 17" opens the BSC list filtered to that zone. This is a UI contract over aggregate queries — no separate summary tables are required (see data-model-expansion §8).

### 1.2 Branch fields (board list, mapped)

| Field | Type | Notes |
| --- | --- | --- |
| name, code, slug | string | code unique; slug URL-safe |
| zone | M2O `zones` (required) | area derived from zone |
| branch_type | enum | `full_fledged` (FFC), `afwc`, `semi_formed`, `worship_centre`, `main`, `satellite`, `other` |
| type_label | enum | `FFC`, `AFWC` (board's explicit type pair; kept alongside `branch_type` for reporting) |
| pastor | M2O `people` | current pastor |
| management_team | M2M `branch_leadership` | departmental heads (clickable → department worker list) |
| address, geo (lat/lng), map_pin | text, decimal, json | geo-map requirement |
| outdoor_photo | file | zone/branch outdoor photo |
| year_founded | integer | |
| notable_history | text | foundation laying, first meeting, became BSC, church, dedicated |
| pastoral_history | O2M `pastoral_history` | pastor + role + start/end dates |
| leadership_timelines | O2M `leadership_appointments` | |
| milestones | O2M `branch_milestones` | |
| weekly_headcounts | derived | Sunday School, Elementary, Devotional, Youth Service, Revival Service (from attendance) |
| blessings_breakdown | derived | from `blessings` |
| visitors | derived | from `visitors` |
| worker_counts / dept_counts | derived | clickable to the department worker list |
| bsc_list | O2M `bible_study_centres` | with leader + average attendance |
| status | enum | `active`, `inactive` |

### 1.3 Bible Study Centre (BSC) fields

| Field | Type | Notes |
| --- | --- | --- |
| name, code | string | code unique |
| parent_branch | M2O `branches` (required) | |
| zone | M2O `zones` | denormalised for scoping/reporting |
| leader | M2O `people` | BSC leader |
| location / address | string / text | |
| geo (lat/lng), map_pin | decimal, json | |
| property_type | enum | `church`, `school`, `warehouse`, `other` |
| property_owner | string | |
| year_founded | integer | |
| history | text | |
| status | enum | `active`, `inactive` |
| weekly_headcounts | O2M `attendance_sessions` | per week |
| average_attendance | derived | |
| photo | file | |

### 1.4 Conference Centre fields
name, code, zone (M2O), location/address/geo, leader (person), avs_count, elementary_count, year_started, headcount, weekly_attendance (derived), photo, status.

### 1.5 Sunday School fields
class_name, branch (or zone), teacher (person), students_count, weekly_attendance (derived), status.

### 1.6 AVS centre fields
centre_name, branch (M2O), address/geo, secretaries (people, multiple), school_contact (person/external + phone), status (`regular`, `paused`), type (`primary`, `secondary`, `others`), assets (text/json), notes.

### 1.7 Campus fields
Campus uses a **student-centred** model (see §7). The "Campus" record itself is a lightweight `campus_institutions` reference (ID, institution name, town, state, coordinator); students link to it.

---

## 2. Attendance (by sex and category)

### 2.1 Requirements

- Headcounts split **male/female** by category — children, teens, adults, teachers, youth, ministers, altar workers, AVS, visitors, other — **and which categories apply depends on the service type**.
- **Weekly headcounts per service**: Sunday School, Elementary, Devotional, Youth Service, Revival Service (plus Sunday service, midweek, event, camp, department, special).
- **Sort** by branch / zone, and by period: weekly / monthly / quarterly / yearly / custom range.
- **CSV export** of every attendance view.

### 2.2 Approach

Replace the fixed `headcount_*` columns on `attendance_sessions` (AFC-147) with a **normalised `attendance_counts` child**: one row per `(session, category, sex)` with a count. This makes category sets **configurable per service type** (a `service_type_definitions` reference row lists which categories are expected) instead of hard-coded columns that multiply with every new category.

- Session header keeps: service_type, branch, zone (denorm), BSC (optional), date, title, recorded_by, status, notes, total (derived).
- Counts child keeps: category, sex (`male`, `female`), count. `total_headcount = Σ male+female`.
- **Back-compat:** the AFC-147 `attendance_sessions` still exists; a migration maps the old five columns into child rows (adults/youth/teens/children/visitors → category rows with `sex = null` until split data is entered). Historical rows without a sex split remain valid and are shown as "unsplit".
- **Reports** are aggregate queries grouped by `branch|zone`, `category`, `sex`, and a date bucket; CSV export is a server route that streams the same query.

### 2.3 User stories

**US-A1 — Capture sex/category attendance.** As a volunteer, I want to record male and female counts per category so that the branch/zone totals are accurate.
- AC1: The capture screen shows only the categories configured for the selected service type.
- AC2: Each category has male and female inputs; total is auto-summed and shown.
- AC3: Saving is retry-safe (idempotent on session) and records `recorded_by`/`recorded_at`.
- AC4: A volunteer sees only their branch/BSC scope.

**US-A2 — View weekly headcounts per service.** As a branch admin, I want the weekly headcounts for each service so I can report them.
- AC1: A week view lists Sunday School, Elementary, Devotional, Youth Service, Revival Service (and other configured services) with totals; missing services are clearly blank.
- AC2: Totals respect the sex/category split.

**US-A3 — Sort and export.** As an area admin, I want to sort attendance by branch/zone and period and export CSV so I can analyse it.
- AC1: Grouping by branch and by zone is available.
- AC2: Period selectors: weekly, monthly, quarterly, yearly, custom range.
- AC3: Export produces a CSV with the same rows and current filters, including category and sex columns.
- AC4: Export is permission-scoped (a branch admin's export contains only their branch).

**US-A4 — Compare years.** As an area admin, I want to compare a period with the previous year so I can see growth.
- AC1: A compare toggle shows current vs prior period side by side (or delta).
- AC2: Prior-year data can be uploaded (see US-X2) and is included when present.

---

## 3. Blessings records

### 3.1 Requirements
Record **salvation, sanctification, baptism of the Holy Ghost, reanointing, healing, and other blessings** per program/service, with the same sort (branch/zone; weekly/monthly/quarterly/yearly/custom) and CSV export as attendance.

### 3.2 Approach
New `blessings` collection: one row per `(service/program, blessing_type)` with **male/female counts**. Linked to an `attendance_session`, `event`, or `sunday_service` (whichever the program is). Category set is a fixed enum (the six above + `other`), and an `other_label` field names a custom blessing. Blessings roll up into branch/zone/BSC "blessings breakdown" on profiles.

### 3.3 User stories

**US-B1 — Record blessings.** As a branch admin, I want to record blessings per service so the branch's spiritual results are tracked.
- AC1: I can add one row per blessing type with male and female counts, or a total.
- AC2: A program/service can record multiple blessing types.
- AC3: `recorded_by`/`recorded_at` are stored; edits are audited.

**US-B2 — Sort and export blessings.** As an area admin, I want the same sorting and CSV export as attendance.
- AC1: Group by branch/zone; period selectors weekly/monthly/quarterly/yearly/custom.
- AC2: CSV includes branch, zone, service, date, blessing type, male, female, total.
- AC3: Permission-scoped.

---

## 4. Households & people

### 4.1 Household
A `households` record holds **shared** data: household name, home branch/zone, unified address, **map pin (lat/lng)**, **wedding date**, primary contact / household head, phone, photo, and sub-location. Members are `people` linked to the household.

### 4.2 Person (expanded)
The AFC-147 `people` record gains:
- **Demographics:** sex (existing `gender`), date_of_birth, marital status, marriage date.
- **Contact & identity:** email, phone, address, photo, external avatar (Gravatar — see integrations).
- **Church duties & dates:** duty/department + date (via `people_departments` + appointment dates).
- **Workers' spiritual milestones:** date saved, sanctified, baptised (Holy Ghost), water baptism — each with a **year fallback** when the date is unknown.
- **Previous branches & roles** with years (child collection `person_previous_branches`).
- **Family details:** spouse and children bio links (self-referential household relationships).
- **Status:** `active`, `transferred`, `retired`, `maternity`, `student`, `unidentified`, `discipline`, `deceased`.
- **Type:** `visitor`, `member`, plus youth flags.
- **History:** transfers, department changes (`person_history`).

### 4.3 User stories

**US-H1 — Manage a household with a map pin.** As a branch admin, I want one household record with a pinned address and wedding date so family data is unified.
- AC1: Address has lat/lng captured by map pin; the pin is editable and rendered on the household page.
- AC2: Wedding date and shared fields live on the household, not repeated per person.
- AC3: Members link to the household; the household shows its members.

**US-H2 — Maintain a person's milestones.** As a branch admin, I want to record spiritual milestones with a year fallback so incomplete history is still captured.
- AC1: Each milestone (saved, sanctified, Holy-Ghost baptism, water baptism) accepts a full date or a year only.
- AC2: The profile shows milestones and marks year-only entries as approximate.
- AC3: Previous branches/roles with year ranges are listed.

**US-H3 — Household-scoped access.** As a household head with access, I want to see only my household's data.
- AC1: A household-scoped user sees only their household and its members.
- AC2: No cross-household data is returned by the API.

---

## 5. Financial records & WECA returns

### 5.1 Requirements
**Monthly financial records per branch** and **returns to WECA Headquarters**. Fields: branch, month, income, intervention, Faith City. **Formula v1 implemented per ADR-0007** (`weca_contribution` / `savings_projects_5pct` are computed lines, not captured inputs).

### 5.2 Approach
- `branch_financial_records`: branch, month, income, weca_contribution, savings_projects_5pct, intervention, faith_city, other_income, other_expense, currency, status (`draft`, `submitted`, `confirmed`), submitted_by, notes.
- `weca_returns`: header per `(branch, period)` with **computed fields under formula v1 (ADR-0007)**, `formula_version`, status, generated_at, submitted_at. A return for a period with no effective formula version stays **modelled with null computed fields flagged `formula_pending`** — nothing is auto-derived from a guessed formula.
- Confirmation and submission are audited; the board formula is a **single versioned config** so recalculating history after the formula lands is a documented migration.

### 5.3 User stories

**US-F1 — Enter a monthly branch record.** As a branch admin, I want to enter the month's income and allocations so the record is complete.
- AC1: Required fields: branch (own), month, income; other fields optional until the formula is known.
- AC2: One record per branch per month (upsert); editing is audited.
- AC3: A branch admin cannot enter records for another branch.

**US-F2 — Generate a WECA return (formula v1 implemented, ADR-0007).** As an area admin, I want returns per branch so they can be submitted to WECA.
- AC1: The return is created per branch/period with the input fields captured.
- AC2: Formula-derived fields are computed under the effective versioned config; a period with no effective version shows **"pending board formula"** and is not auto-filled.
- AC3: When the board revises the formula, entering it as a new versioned config recalculates returns and records the formula version used.

**US-F3 — Export financial data.** As an area admin, I want a CSV of financial records and returns.
- AC1: Export includes branch, month, all input fields, and formula-derived fields (or `pending`).
- AC2: Permission-scoped.

---

## 6. Youth Care & Empowerment

### 6.1 Requirements
- Youth database **shared with the main church database** (single database; youth is a **segment/flag**, not a separate store — no sync required).
- **Birthdays and wedding anniversaries** celebrated; **special shout-outs** for academic success, admission, graduation, scholarships.
- People's church and professional status: marital status (marriage date), students (education level: primary, secondary, undergraduate, post-graduate), entrepreneurs, church department, employment, leadership in church and youth.

### 6.2 Approach
- Youth = `people` where `is_youth` (derived: age band or membership type) and/or a `youth_profile` child (education_level, institution, employment_status, professional_status, entrepreneur, youth_leadership_role).
- `celebrations` collection: person, type (`birthday`, `wedding_anniversary`, `academic_success`, `admission`, `graduation`, `scholarship`, `other`), date, title, message, visibility, publish_channels, status. Powers the birthday/anniversary greetings, the weekly reminder webhook, and the shout-out feed.
- Leadership via `leadership_appointments` with `stream = youth` and scope area/zone/branch (see §8).

### 6.3 User stories

**US-Y1 — Youth directory.** As a youth leader, I want a youth directory with education and professional status so we can care for youth.
- AC1: The directory filters by branch/zone, education level, employment, entrepreneur, department, and youth leadership.
- AC2: Youth records are the same `people` records used by the main church (edits are shared).
- AC3: Access is scoped to the youth leader's area/zone/branch.

**US-Y2 — Celebrate birthdays and anniversaries.** As a youth leader, I want to see and greet upcoming birthdays/anniversaries.
- AC1: An upcoming-list shows birthdays and wedding anniversaries by date range and scope.
- AC2: A greeting can be queued via the communications module (consent-gated).
- AC3: The weekly birthday-reminder webhook fires with the upcoming list (see integrations).

**US-Y3 — Shout-outs.** As a youth leader, I want to record academic shout-outs (admission, graduation, scholarship).
- AC1: A shout-out links to a person and a celebration type with a date and message.
- AC2: Shout-outs are publishable to allowed channels with consent checks.
- AC3: A shout-out feed is visible within scope.

---

## 7. Campus Care & WAEC/UTME

### 7.1 Requirements
Timetable and facilitator management for WAEC/UTME coaching; student management; facilitator registration and call; progress tracking and reporting; class attendance marking; resources folder; feedback system; admission/WAEC/UTME result tracking; **AFCF** Campus Fellowship handshake per student; financial-support tracking; undergraduate year progress (freshman/final year, graduation); regular check-ups; **NYSC** deployment tracking linked with **AFCMF**.

### 7.2 Domain model (summary)
- `campus_institutions` — institution reference (name, town/state, coordinator).
- `campus_students` — person, institution, course, level (`freshman`…`final_year`, `graduated`), admission_year, graduation_year, coordinator, `afcf_handshake_status`, `afcmf_linked`, `nysc_status` (`not_deployed`, `waiting_callup`, `deployed`, `serving`), `nysc_deployment`, next_checkup_date, financial_support_total (derived), status, notes.
- `coaching_programmes` — name, exam (`waec`, `utme`, `other`), year, scope (area/zone/branch), status.
- `coaching_timetable` — programme, subject, facilitator, day, start/end time, location, capacity.
- `coaching_facilitators` — person, programme, subject, registration_date, call_status, status.
- `coaching_students` — programme, student (`campus_students`/`people`), registration, status.
- `coaching_class_attendance` — timetable occurrence/class, student, present, date, marked_by.
- `coaching_progress` — student, programme, assessment, score, date, remarks.
- `exam_results` — student, exam (`waec`, `utme`, `admission`), year, scores (json), aggregate, status, institution (for admission), recorded_by.
- `coaching_resources` — programme/class, title, file, type, uploaded_by, visibility.
- `coaching_feedback` — student/guardian, programme, feedback, rating, date, status.
- `campus_financial_support` — student, programme, amount, term, source, status, approved_by.

### 7.3 User stories

**US-C1 — Coaching timetable & facilitators.** As a campus coordinator, I want to manage the WAEC/UTME timetable and facilitators.
- AC1: A programme has subjects, days, times, locations, and a facilitator each; clashes are flagged.
- AC2: Facilitators are registered and their call status tracked.
- AC3: The timetable is viewable by scope.

**US-C2 — Students, attendance, and progress.** As a facilitator, I want to mark class attendance and record progress.
- AC1: Attendance can be marked per class occurrence and is idempotent.
- AC2: Progress records assessments and scores per student.
- AC3: A progress report is exportable (CSV) for the coordinator.

**US-C3 — Results.** As a coordinator, I want to record WAEC/UTME and admission results.
- AC1: Results are recorded per student, per exam, per year, with scores and aggregate/status.
- AC2: Admission results store the institution and status.
- AC3: Results feed the student's campus-care record.

**US-C4 — AFCF handshake & financial support.** As a coordinator, I want to record the AFCF campus-fellowship handshake and financial support per student.
- AC1: Each student has an AFCF handshake status and an AFCMF link.
- AC2: Financial support records amount, term, source, and approval.
- AC3: A student's support total is derived and shown.

**US-C5 — Undergraduate progress & NYSC.** As a coordinator, I want to track year progress, check-ups, and NYSC deployment.
- AC1: A student's level updates (freshman → final year → graduated).
- AC2: Regular check-up dates and notes are recorded.
- AC3: NYSC status and deployment are tracked and linked with AFCMF.

---

## 8. Leadership, positions & role-based access

### 8.1 Position registry
A `leadership_positions` reference enumerates positions. **Church:** Area Overseer; at zonal and branch levels — Pastor, Music, Usher, WCS, Treasury, Sunday School Superintendent, Sanitation, Kitchen, Security, First Aid, Welfare, Infrastructure, AVS, Resources. **Youth:** Youth Head and Outreach (area only); Youth Leader, Secretariat, Care & Empowerment (area, zone, branch).

A `leadership_appointments` record links a person to a position at a scope:
`person`, `position` (M2O reference), `stream` (`church`/`youth`), `scope_type` (`area`/`zone`/`branch`/`department`), `area`/`zone`/`branch`/`department` (nullable per scope), `start_date`, `end_date`, `status` (`current`/`past`), `appointed_by`, `notes`.

This single collection powers **pastoral history**, **leadership timelines**, **management team**, and **department heads** everywhere — one model, many views.

### 8.2 Access scopes
- **Area admin / Area Overseer:** whole area.
- **Zone admin / zone pastor:** `zone = $CURRENT_USER.zone` (or `zone_ids`).
- **Branch admin / branch pastor:** `branch ∈ $CURRENT_USER.branch_ids`.
- **Department head:** `department ∈ $CURRENT_USER.department_ids` (within their branch/zone).
- **Household-scoped user:** their household only.
- **Volunteer/teacher:** narrow create/update (attendance, class attendance) in scope.
- **Guest (school contact):** an AVS/school contact with a very narrow, time-boxed grant (no people data).

### 8.3 User stories

**US-L1 — Appoint a leader.** As an area admin, I want to appoint people to positions at a scope.
- AC1: An appointment requires person, position, stream, scope, and start date.
- AC2: A person can hold multiple appointments over time; overlapping current appointments of the same position in the same branch are flagged.
- AC3: Ending an appointment sets `end_date` and `status = past` (audited), preserving history.

**US-L2 — Zone-scoped access.** As a zone admin, I want to see only my zone's branches and BSCs.
- AC1: Lists and detail endpoints return only records in the zone.
- AC2: A crafted cross-zone request is rejected/filtered.

**US-L3 — Department head access.** As a department head, I want my department's workers and attendance.
- AC1: I see only my department's members/workers and department attendance within my branch/zone.
- AC2: I cannot read welfare or other departments.

**US-L4 — Household access.** As a household head, I want to view my household.
- AC1: Only my household and its members are returned.
- AC2: No edit rights beyond permitted fields.

---

## 9. UI surface

### 9.1 Navigation
- **Dashboard**, **Reports**, **Forms** as primary sections.
- **Pages:** Zone, Branch, Family (household), Person, Department, Search, Attendance, Events, Calendar, Branch List; **Pastor** pages; **Branch/Zone data management**.
- Navigation is capability-driven (`/api/me/permissions`), never hard-coded role names (portability rule).

### 9.2 Reports & prior-year data
- Reports: attendance (by category/sex/period), blessings, financial/WECA, youth, campus, events.
- **Compare with previous years** and **upload previous-year data** (CSV import; see US-X2).

### 9.3 Forms
Reusable forms for attendance capture, blessings, visitors, events, coaching attendance, finance entry.

### 9.4 Photos
Zone outdoor, branch outdoor, pastor, conference centre, each person, BSC, household.

### 9.5 User stories

**US-U1 — Drill-down analytics.** As an area admin, I want every count to link to its data.
- AC1: Counts on area/zone/branch/BSC profiles link to the filtered list.
- AC2: The destination list uses the same filters and respects permissions.

**US-U2 — Upload prior-year data.** As an area admin, I want to import previous years' data.
- AC1: A CSV template per domain (attendance, blessings, people, finance) is provided.
- AC2: Import validates rows, reports errors, and is idempotent (no duplicates on re-import).
- AC3: Imported rows are marked with a source and can be compared year-on-year.

**US-U3 — Calendar.** As a staff user, I want a calendar of services, events, programmes, and birthdays.
- AC1: The calendar combines services, events, programmes, and celebrations, filterable by scope and type.
- AC2: Clicking an entry opens its detail page.

---

## 10. Events & Office

### 10.1 Events (extended)
Events gain: **overview**, location, **blessings** (link to `blessings`), **attendance** (link to `attendance_sessions`), and **invite-a-friend** (a referral flag/record that tracks who invited whom).

### 10.2 Office
- **Transfers:** person, from/to branch, reason, request/effective dates, status, approver.
- **Marriage matters:** person(s), type (banns, wedding, counselling), wedding date, status, notes.
- **Minutes:** meeting title, date, body, attendees, file, status.
- **Tasks:** title, description, assignee (user/person), due date, status, priority, related entity.
- **Calendar:** unified feed (shared with §9.3).
- **Announcement build-up:** draft → schedule → published, with channels and audience.
- **Search:** cross-entity search (people, households, branches, BSCs, events, tasks, minutes) within scope.

### 10.3 Communications
Birthday/anniversary greetings, meeting reminders, task reminders — **all via the existing communications module** (consent-gated). No new send stack.

### 10.4 User stories

**US-E1 — Event blessing & attendance roll-up.** As a branch admin, I want an event to show its blessings and attendance.
- AC1: Blessings and attendance recorded against an event appear on the event page.
- AC2: Counts link to the underlying records.

**US-E2 — Invite a friend.** As a member/admin, I want to record invite-a-friend referrals for an event.
- AC1: A referral links inviter → invitee and the event.
- AC2: Referral counts appear on the event; duplicate referrals are de-duplicated.

**US-E3 — Office tasks and minutes.** As an office user, I want tasks, minutes, and announcements in one place.
- AC1: Tasks have assignee, due date, status; overdue tasks are highlighted.
- AC2: Minutes attach a file and attendees.
- AC3: Announcements move draft → scheduled → published with an audit trail.

**US-E4 — Transfers and marriage matters.** As an office user, I want to record transfers and marriage matters.
- AC1: A transfer records from/to branch and status; approving it updates the person's home branch (audited).
- AC2: Marriage matters record type, date, and status.

---

## 11. Integrations (summary — full spec separate)

| Integration | Purpose | Auth |
| --- | --- | --- |
| Gravatar | External avatar by email hash; fallback to uploaded photo | none (public hash) |
| Email | Transactional + comms (SMTP default) | SMTP creds via secret ref |
| Telegram | Internal ops notifications/reminders (Bot API) | Bot token via secret ref |
| SMS | Comms (Termii/Twilio via Notifier) | provider key via secret ref |
| WhatsApp | Comms (Meta Cloud API via BSP) | provider token via secret ref |
| Backup | Nightly DB + media backup | backup creds via secret ref |
| Users Management | Directus users/roles/policies | internal |
| Birthday webhook | Weekly birthday/anniversary reminder POST | HMAC secret via secret ref |
| Data import/export | CSV import/export, prior-year upload | internal, scoped |

Full details, contracts, and failure handling: [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec).

---

## 12. Address/postcode

Evaluated in the separate [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation). Recommendation in brief: **own map pin (lat/lng) as the source of truth**, plus **LocCodes (Maiaddy)** street-level API for Nigeria street identity, with **NIPOST NDAPS** as an optional authoritative postcode field when its API/pricing is available; PlacePin is not required (coordinates only, no addresses).

---

## 13. Non-functional requirements (delta)

- **Scale:** 6 zones, ≥ 80 BSCs, ~10–15k people (plan to 20k), ~200k+ attendance rows/yr. Server sizing trigger list in infra-spec must be revisited; consider splitting Postgres to its own node before 20k people.
- **Performance:** attendance/blessings report queries must be paginated and index-backed; CSV export streams. p95 < 500ms for list/detail; reports may run as async exports for very large ranges (documented).
- **Safeguarding:** unchanged; minors' attendance, consent, and contact data stay field-restricted. Campus students who are minors inherit the same rules.
- **Audit:** appointments, finance entries, transfers, and results are audited (Directus activity + explicit case/office trails).
- **Accessibility/security/backup:** unchanged from AFC-147/148/149.

---

## 14. Updated phasing (MVP vs later)

This supersedes PRD §5 and PRD-addendum §D where they conflict, for the expanded scope.

| Phase | Scope | Rationale |
| --- | --- | --- |
| **MVP (P1–P2)** | Foundation (Directus+Postgres+auth+Nuxt); Area/Zone/Branch/BSC hierarchy + profiles; people & households (map pin, wedding date, milestones); attendance with **sex/category split** + CSV; events + registration + group registration; visitors; branch/area dashboards; RBAC Area→Zone→Branch + department heads; search. | Highest operational value; the hierarchy and attendance split are load-bearing for everything else. |
| **P3 — Care & records** | Blessings records; Sunday School / AVS / Conference Centre; welfare (existing); youth profile fields + celebrations; office (tasks, minutes, transfers, marriage matters); calendar. | Extends records once the core hierarchy/attendance exist. |
| **P4 — Finance & communications** | Financial records; **WECA returns (formula v1 implemented per ADR-0007)**; communications module (email → WhatsApp → SMS), integrations (Gravatar, Telegram, birthday webhook), reports. | Comms has provider lead time; finance computation landed with the board formula. |
| **P5 — Campus care** | Coaching programmes, facilitators, timetable, attendance, progress, results, AFCF/AFCMF, financial support, NYSC, undergraduate progress. | Largest standalone domain; depends on youth/people being solid first. |
| **P6 — Hardening & data** | Prior-year import/compare; retention/consent automation; cost reporting; dedupe; monitoring; training; runbooks. | Operational maturity. |

**Dependency flag (cleared by ADR-0007):** WECA returns compute under formula v1 (`weca-2026-01`). Only a period with no effective formula version stays **modelled but not auto-computed** (`formula_pending`).

---

## 15. New / updated open questions (recommended defaults)

| # | Question | Recommended default | Blocks |
| --- | --- | --- | --- |
| OQ-E1 | WECA returns formula | Answered by ADR-0007 (board answer `cb89849b`): formula v1 `weca-2026-01` implemented; new versions supersede as rows | — (cleared) |
| OQ-E2 | Service types and their attendance categories | Provide a configurable `service_type_definitions` list; seed with Sunday School, Elementary, Devotional, Youth Service, Revival Service, Sunday service | Attendance capture/reporting |
| OQ-E3 | Is the area always "Lagos North", and is there one area only? | Single area; hierarchy supports more later | Hierarchy/reporting |
| OQ-E4 | Zone↔branch mapping source of truth (who maintains it) | Area admin maintains zones/branches; imported on onboarding | Onboarding |
| OQ-E5 | Address provider choice | Own pin + LocCodes primary; NIPOST optional postcode; PlacePin not required | Geo-map integration |
| OQ-E6 | Youth eligibility rule (age band vs membership type) | Derived: age 13–35 flag `is_youth`, plus manual override | Youth directory |
| OQ-E7 | Household-scoped login source | Household head gets a scoped account on request (not self-service) | Household access |
| OQ-E8 | Prior-year data format | Publish CSV templates; import both own and board templates | Prior-year import |
| OQ-E9 | Guest/school-contact access duration | Time-boxed grant (expiry), no people data | AVS guest access |
| OQ-E10 | Photos storage/size policy | Object storage, max 5MB/image, EXIF stripped | Media |

---

*Extends [PRD](/AFC/issues/AFC-147#document-prd) and [PRD Addendum](/AFC/issues/AFC-148#document-prd-addendum). Companion: [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion), [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec), [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation), [wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion). Planning only — no production code, deployments, or secrets.*
