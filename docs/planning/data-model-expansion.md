# Data Model & Permission Addendum v3 — Expanded Operations

**Issue:** AFC-150 · **Parent:** AFC-146 · **Updates:** [data-model](/AFC/issues/AFC-147#document-data-model) (AFC-147), [data-model-addendum](/AFC/issues/AFC-148#document-data-model-addendum) (AFC-148)
**Platform:** Directus (self-hosted) + PostgreSQL 16 · **Owner:** CTO (MediaTech) · **Version:** v3 (2026-10-05)
**Planning only — no code, no secrets.**

Conventions unchanged: `snake_case`, `M2O`/`O2M`/`M2M` (junction), Directus system fields where noted, branch/zone-scoped by policy filters. This document **extends** the AFC-147 model and the AFC-148 addendum. Where they conflict, this document wins for the expanded domains.

> **Scope note.** Communications, `groups`/`group_members`, `consent_records`, and group registration are **unchanged** and live in the AFC-148 addendum. This addendum adds the organization hierarchy, expanded attendance/blessings, households/people expansion, finance/WECA, youth, campus, leadership/appointments, office, and the scope model.

---

## 1. Change map

| Area | New collections | Changed |
| --- | --- | --- |
| Hierarchy | `areas`, `zones`, `bible_study_centres`, `conference_centres`, `sunday_school_classes`, `avs_centres` | `branches` (zone, type, geo, history, photos) |
| Attendance | `attendance_counts`, `service_type_definitions` | `attendance_sessions` (service_type expanded, BSC, zone denorm) |
| Blessings | `blessings` | — |
| People/Households | `person_previous_branches`, `person_milestones` | `people` (status, marital, education, employment), `households` (geo, wedding_date) |
| Finance | `branch_financial_records`, `weca_returns` | — |
| Youth | `youth_profiles`, `celebrations` | — |
| Campus | `campus_institutions`, `campus_students`, `coaching_programmes`, `coaching_timetable`, `coaching_facilitators`, `coaching_students`, `coaching_class_attendance`, `coaching_progress`, `exam_results`, `coaching_resources`, `coaching_feedback`, `campus_financial_support` | — |
| Leadership/RBAC | `leadership_positions`, `leadership_appointments`, `branch_milestones`, `pastoral_history`, `person_history` | `directus_users` (area/zone scopes, expanded roles) |
| Office | `transfers`, `marriage_matters`, `office_minutes`, `tasks`, `announcements` | `events` (overview, invite-a-friend) |
| Events | `event_referrals`, `event_sessions` (optional agenda) | `events` |

---

## 2. Organization hierarchy

### 2.1 `areas`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string, required | e.g. "Lagos North Area" |
| code | string, unique | |
| overseer | M2O `people` | Area Overseer |
| address / geo (lat,lng) / map_pin | text / decimal / json | |
| outdoor_photo | file | |
| status | enum | `active`, `inactive` |
| sort | integer | |

**Indexes:** `code` (unique).

### 2.2 `zones`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| area | M2O `areas`, required | |
| name | string, required | |
| code | string, unique | |
| leader | M2O `people` | zone pastor/leader |
| address / geo / map_pin | text / decimal / json | |
| outdoor_photo | file | |
| year_started | integer | |
| status | enum | `active`, `inactive` |
| sort | integer | |

**Indexes:** `code` (unique), `area`, `status`.

### 2.3 `branches` (changed)
Add to the AFC-147 `branches`:

| Field | Type | Notes |
| --- | --- | --- |
| zone | M2O `zones`, required | hierarchy parent |
| area | M2O `areas` | denormalised via zone (Flow-maintained) |
| branch_type | enum | `full_fledged`, `afwc`, `semi_formed`, `worship_centre`, `main`, `satellite`, `other` |
| type_label | enum | `FFC`, `AFWC` |
| pastor | M2O `people` | current pastor |
| geo (lat/lng) | decimal | |
| map_pin | json | pin metadata |
| outdoor_photo / pastor_photo | file | |
| year_founded | integer | |
| notable_history | text | |
| status | enum | `active`, `inactive` |

`parent_branch` (AFC-147) is retained for satellites/outstations under a branch (distinct from `zone`).

**Indexes (add):** `zone`, `area`, `branch_type`, `status`.

### 2.4 `bible_study_centres` (BSC)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string, required | |
| code | string, unique | |
| parent_branch | M2O `branches`, required | |
| zone | M2O `zones` | denorm (Flow) |
| leader | M2O `people` | |
| location | string | |
| address | text | |
| geo (lat/lng) / map_pin | decimal / json | |
| property_type | enum | `church`, `school`, `warehouse`, `other` |
| property_owner | string | |
| year_founded | integer | |
| history | text | |
| average_attendance | integer | derived/Flow |
| photo | file | |
| status | enum | `active`, `inactive` |

**Indexes:** `code` (unique), `parent_branch`, `zone`, `status`, `(zone, status)`.

### 2.5 `conference_centres`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string, required | |
| code | string, unique | |
| zone | M2O `zones` | |
| branch | M2O `branches` | optional |
| location / address / geo / map_pin | | |
| leader | M2O `people` | |
| avs_count / elementary_count | integer | |
| year_started | integer | |
| headcount | integer | |
| photo | file | |
| status | enum | `active`, `inactive` |

**Indexes:** `code` (unique), `zone`, `status`.

### 2.6 `sunday_school_classes`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| class_name | string, required | |
| branch | M2O `branches` | nullable → zonal/area class |
| zone | M2O `zones` | denorm |
| teacher | M2O `people` | |
| students_count | integer | |
| status | enum | `active`, `inactive` |

**Indexes:** `branch`, `zone`, `teacher`.

### 2.7 `avs_centres`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| centre_name | string, required | |
| branch | M2O `branches`, required | |
| address / geo / map_pin | | |
| secretaries | M2M `avs_secretaries` | people |
| school_contact_name / school_contact_phone | string | |
| contact_person | M2O `people` | optional internal link |
| status | enum | `regular`, `paused` |
| type | enum | `primary`, `secondary`, `others` |
| assets | text | or json |
| notes | text | |
| photo | file | |

**Indexes:** `branch`, `status`, `type`.

---

## 3. Attendance (sex/category) & blessings

### 3.1 `service_type_definitions`
Configures which categories apply per service type (board: categories depend on service type).

| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| key | string, unique | `sunday_school`, `elementary`, `devotional`, `youth_service`, `revival_service`, `sunday_service`, `midweek`, `event`, `camp`, `department`, `special` |
| label | string | |
| categories | json (array) | ordered category keys expected (e.g. `["children","teens","adults","teachers"]`) |
| supports_sex_split | boolean | |
| requires_bsc | boolean | true for BSC-level services |
| status | enum | `active`, `inactive` |

**Indexes:** `key` (unique).

### 3.2 `attendance_sessions` (changed)
Add:
| Field | Type | Notes |
| --- | --- | --- |
| zone | M2O `zones` | denorm |
| bsc | M2O `bible_study_centres` | nullable |
| service_type | enum **expanded** | add `sunday_school`, `elementary`, `devotional`, `youth_service`, `revival_service` (existing: `sunday_service`, `midweek`, `event`, `camp`, `department`, `special`) |
| service_type_def | M2O `service_type_definitions` | resolves allowed categories |

The AFC-147 fixed `headcount_*` columns are **deprecated** (kept for back-compat until migrated).

### 3.3 `attendance_counts` (new — the sex/category split)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| session | M2O `attendance_sessions`, required | |
| category | enum | `children`, `teens`, `adults`, `youth`, `teachers`, `ministers`, `altar_workers`, `avs`, `visitors`, `other` |
| category_other_label | string | when `category = other` |
| sex | enum | `male`, `female`, `unspecified` |
| count | integer, required | ≥ 0 |
| created_by | M2O `directus_users` | |

**Total** `attendance_sessions.total_headcount` = `Σ count` (Flow-maintained).
**Indexes:** `(session, category, sex)` unique; `session`; `category`.

> **Why normalised:** adding a category no longer requires a schema change, and "which categories apply" lives in `service_type_definitions`. Historical unsplit data uses `sex = unspecified`.

### 3.4 `blessings` (new)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| blessing_type | enum | `salvation`, `sanctification`, `baptism_holy_ghost`, `reanointing`, `healing`, `other` |
| other_label | string | when `blessing_type = other` |
| male_count / female_count | integer | default 0 |
| total_count | integer | derived = male + female |
| branch | M2O `branches`, required | |
| zone | M2O `zones` | denorm |
| bsc | M2O `bible_study_centres` | nullable |
| session | M2O `attendance_sessions` | nullable; program link |
| event | M2O `events` | nullable |
| sunday_service | M2O `sunday_services` | nullable |
| service_date | date, required | |
| recorded_by | M2O `directus_users` | |
| notes | text | |

**Indexes:** `branch`, `zone`, `service_date`, `(branch, service_date)`, `(zone, service_date)`, `blessing_type`, `session`.

### 3.5 Reporting views
Attendance and blessings reporting are **aggregate queries** grouped by `branch|zone`, `category`, `sex`, and a date bucket (week/month/quarter/year/custom). Implemented as Directus saved aggregate queries / a read-only reporting endpoint. CSV export streams the same query. For very large ranges, an async export job (Flow → file → notification) is the documented fallback.

---

## 4. Households & people (expanded)

### 4.1 `households` (changed)
Add:
| Field | Type | Notes |
| --- | --- | --- |
| household_head | M2O `people` | |
| zone | M2O `zones` | denorm |
| geo (lat/lng) / map_pin | decimal / json | unified address pin |
| wedding_date | date | unified household field |
| photo | file | |
| sub_location | string | |
| status | enum | `active`, `archived` |

### 4.2 `people` (changed)
Add:
| Field | Type | Notes |
| --- | --- | --- |
| marital_status | enum | `single`, `married`, `widowed`, `divorced`, `separated`, `unspecified` |
| marriage_date | date | couples' wedding date (also on household) |
| occupation / employment_status | string / enum | `employed`, `self_employed`, `unemployed`, `student`, `retired`, `other` |
| education_level | enum | `none`, `primary`, `secondary`, `undergraduate`, `postgraduate`, `other` |
| institution | string | |
| is_entrepreneur | boolean | |
| professional_status | string | free text |
| is_youth | boolean | derived (age band) / overridable |
| locality / sub_location | string | |
| previous_branch_note | text | summary; detail in child collection |
| gravatar_hash | string | derived from email (see integrations) |
| avatar_url | string | resolved external avatar |
| status | enum **expanded** | add `transferred`, `retired`, `maternity`, `student`, `unidentified`, `discipline`, `deceased` (existing: `active`, `archived`) |
| person_type | enum | `visitor`, `member` (alongside `membership_status`) |

**Indexes (add):** `status`, `is_youth`, `marital_status`, `education_level`, `occupation`.

### 4.3 `person_previous_branches` (new)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required | |
| branch_name | string | or M2O `branches` when known |
| branch | M2O `branches` | nullable |
| role | string | e.g. "Pastor", "Member" |
| from_year / to_year | integer | |

**Indexes:** `person`.

### 4.4 `person_milestones` (new — spiritual milestones with year fallback)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required | |
| milestone_type | enum | `saved`, `sanctified`, `baptism_holy_ghost`, `water_baptism`, `other` |
| milestone_date | date | nullable when only a year is known |
| milestone_year | integer | fallback when date unknown |
| church / branch | M2O `branches` | nullable; where it happened |
| notes | text | |
| recorded_by | M2O `directus_users` | |

**Indexes:** `person`, `(person, milestone_type)`.

### 4.5 `person_history` (new)
person, event_type (`transfer`, `department_change`, `status_change`, `appointment`, `other`), detail, from_value, to_value, effective_date, actor_user.

---

## 5. Financial records & WECA returns

### 5.1 `branch_financial_records`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| branch | M2O `branches`, required | |
| zone | M2O `zones` | denorm |
| month | date, required | first day of month |
| income | decimal(14,2) | |
| weca_contribution | decimal(14,2) | |
| savings_projects_5pct | decimal(14,2) | board "5% - savings and projects" |
| intervention | decimal(14,2) | |
| faith_city | decimal(14,2) | |
| other_income / other_expense | decimal(14,2) | |
| total_income / total_outflow | decimal(14,2) | derived |
| currency | enum | `NGN`, `USD`, `GBP` |
| status | enum | `draft`, `submitted`, `confirmed` |
| submitted_by / confirmed_by | M2O `directus_users` | |
| notes | text | |
| created_at / updated_at | datetime | |

**Indexes:** `(branch, month)` unique; `zone`; `status`.

### 5.2 `weca_returns` (formula v1 implemented per ADR-0008)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| branch | M2O `branches`, required | |
| financial_record | M2O `branch_financial_records` | source |
| period | string | e.g. `2026-10` |
| computation_status | enum | **`formula_pending`**, `calculated`, `submitted`, `confirmed` |
| formula_version | string | set when calculated |
| computed_* fields | decimal(14,2) | e.g. `computed_weca_due`, `computed_savings`, `computed_intervention`, `computed_faith_city` — **nullable until formula lands** |
| total_due | decimal(14,2) | nullable |
| submitted_at / confirmed_at | datetime | |
| generated_by | M2O `directus_users` | |

**Indexes:** `(branch, period)` unique; `computation_status`.
**Implemented:** formula v1 per ADR-0008 (`weca-2026-01`, board answer `cb89849b`).
`computation_status = formula_pending` with null computed fields remains the
correct state for a period with no effective formula version -- it is no longer
the state of every return. The board's formula is a versioned config
(`weca_return_formulas`: version, effective_from, expression/json rules, notes);
computing a return under a version records that version. Superseded input
columns: `weca_contribution` / `savings_projects_5pct` from §5.1 are NOT
captured -- MF and both 5% lines are computed, and the migration header records
this deviation rather than storing two competing sources of truth.

---

## 6. Youth Care & Empowerment

### 6.1 `youth_profiles` (child of `people`; the DB is shared)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required, unique | |
| education_level | enum | `primary`, `secondary`, `undergraduate`, `postgraduate`, `other` |
| institution / course | string | |
| study_level | enum | `freshman`, `sophomore`, `junior`, `senior`, `final_year`, `graduated`, `n/a` |
| employment_status | enum | `student`, `employed`, `self_employed`, `unemployed`, `entrepreneur`, `other` |
| professional_status | string | |
| is_entrepreneur | boolean | |
| youth_leadership_role | string | links to an appointment where applicable |
| branch / zone | M2O | denorm for scoping |
| status | enum | `active`, `inactive` |

**Indexes:** `person` (unique), `branch`, `zone`, `education_level`, `employment_status`.

### 6.2 `celebrations` (birthdays, anniversaries, shout-outs)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required | |
| type | enum | `birthday`, `wedding_anniversary`, `academic_success`, `admission`, `graduation`, `scholarship`, `other` |
| event_date | date | the date to celebrate (for recurring, month/day) |
| is_recurring | boolean | birthdays/anniversaries true |
| title | string | |
| message | text | |
| visibility | enum | `internal`, `branch`, `public` |
| publish_channels | json | channel keys for greeting |
| branch / zone | M2O | scope denorm |
| status | enum | `draft`, `approved`, `published`, `archived` |
| created_by | M2O `directus_users` | |

**Indexes:** `person`, `(type, event_date)`, `(branch, event_date)`, `status`.

---

## 7. Campus Care & WAEC/UTME

### 7.1 `campus_institutions`
id, name (required), town, state, coordinator (person), notes, status.

### 7.2 `campus_students`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required | shared church DB |
| institution | M2O `campus_institutions` | |
| course | string | |
| level | enum | `freshman`, `sophomore`, `junior`, `senior`, `final_year`, `graduated`, `other` |
| admission_year / graduation_year | integer | |
| coordinator | M2O `people` | |
| afcf_handshake_status | enum | `not_contacted`, `contacted`, `connected`, `active`, `declined` |
| afcmf_linked | boolean | |
| nysc_status | enum | `not_deployed`, `waiting_callup`, `deployed`, `serving`, `completed`, `exempt` |
| nysc_deployment | string | state/camp/PPM |
| next_checkup_date | date | |
| financial_support_total | decimal(14,2) | derived |
| status | enum | `active`, `inactive`, `graduated` |
| notes | text | |
| branch / zone | M2O | denorm scope |

**Indexes:** `person`, `institution`, `level`, `nysc_status`, `status`, `(branch, status)`.

### 7.3 Coaching (WAEC/UTME)
- `coaching_programmes`: name, exam (`waec`,`utme`,`other`), year, scope (area/zone/branch + reference), status.
- `coaching_timetable`: programme, subject, facilitator (person), day_of_week, start_time, end_time, location, capacity, status. Index `(programme, day_of_week)`.
- `coaching_facilitators`: person, programme, subject, registration_date, call_status (`registered`,`called`,`confirmed`,`declined`), status. Index `(programme, person)` unique.
- `coaching_students`: programme, student (campus_student or person), registration_date, status. Index `(programme, student)` unique.
- `coaching_class_attendance`: timetable (or programme+date), student, present, marked_by, date. Index `(timetable, student, date)` unique.
- `coaching_progress`: student, programme, assessment, score, max_score, date, remarks, recorded_by. Index `(student, programme, date)`.
- `exam_results`: student, exam (`waec`,`utme`,`admission`), year, scores (json), aggregate, status (`pending`,`passed`,`failed`,`admitted`,`not_admitted`), institution (admission), recorded_by. Index `(student, exam, year)`.
- `coaching_resources`: programme (or timetable), title, file, type, visibility, uploaded_by. Index `programme`.
- `coaching_feedback`: student or guardian, programme, feedback, rating, date, status, handled_by. Index `programme`.
- `campus_financial_support`: student, programme (nullable), amount, term, source, status (`proposed`,`approved`,`disbursed`), approved_by, date. Index `(student, status)`.

---

## 8. Leadership, positions & RBAC scopes

### 8.1 `leadership_positions` (reference)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| key | string, unique | e.g. `area_overseer`, `pastor`, `music`, `usher`, `wcs`, `treasury`, `sunday_school_superintendent`, `sanitation`, `kitchen`, `security`, `first_aid`, `welfare`, `infrastructure`, `avs`, `resources`, `youth_head`, `youth_outreach`, `youth_leader`, `youth_secretariat`, `youth_care_empowerment` |
| label | string | |
| stream | enum | `church`, `youth` |
| allowed_scopes | json | e.g. `["area"]` for Youth Head/Outreach; `["area","zone","branch"]` for Youth Leader |
| department_type | enum | nullable; links a position to a department |
| status | enum | `active`, `inactive` |

### 8.2 `leadership_appointments`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people`, required | |
| position | M2O `leadership_positions`, required | |
| stream | enum | `church`, `youth` (denorm from position) |
| scope_type | enum | `area`, `zone`, `branch`, `department` |
| area / zone / branch / department | M2O | exactly one set per `scope_type` |
| start_date / end_date | date | |
| status | enum | `current`, `past` |
| appointed_by | M2O `directus_users` | |
| notes | text | |

**Indexes:** `person`, `position`, `(scope_type, branch)`, `(scope_type, zone)`, `status`; partial-unique on `(person, position, branch)` where `status = current`.

> **One model, many views:** pastoral history, leadership timelines, management team, and department heads are all filtered views of `leadership_appointments`.

### 8.3 `branch_milestones`
branch (M2O), zone (denorm), date, title, description, type (`foundation_laying`, `first_meeting`, `became_bsc`, `became_church`, `dedicated`, `other`), photo, created_by.

### 8.4 `pastoral_history`
branch (M2O), pastor (person M2O), role/position, start_date, end_date, notes. (A view over appointments, materialised for the profile.)

### 8.5 `directus_users` (changed — scopes)
Add:
| Field | Type | Purpose |
| --- | --- | --- |
| area | M2O `areas` | area scope |
| zone | M2O `zones` | zone scope (single) |
| zone_ids | json (array uuid) | multi-zone scope (Flow-synced) |
| branch_ids | json (array uuid) | existing; multi-branch scope |
| department_ids | json (array uuid) | existing; department scope |
| household | M2O `households` | household-scoped access |
| staff_role | enum **expanded** | add `area_overseer`, `zone_admin`, `branch_pastor`, `department_head`, `teacher`, `guest_school_contact` (existing: `super_admin`, `area_admin`, `branch_admin`, `department_leader`, `volunteer`, `none`) |
| access_expires_at | datetime | time-boxed guest/school-contact grants |

**Indexes:** `staff_role`, `area`, `zone`, `branch`.

---

## 9. Office & events

### 9.1 `transfers`
person (M2O), from_branch, to_branch, reason, request_date, effective_date, status (`requested`,`approved`,`completed`,`rejected`), requested_by, approved_by, notes. Index `(person, status)`, `from_branch`, `to_branch`.

### 9.2 `marriage_matters`
person (M2O), partner_person (M2O nullable), type (`banns`,`wedding`,`counselling`,`other`), wedding_date, status, notes, created_by. Index `(person, status)`.

### 9.3 `office_minutes`
title, meeting_date, body (text), attendees (M2M `minutes_attendees` → people/users), file, status, created_by. Index `meeting_date`.

### 9.4 `tasks`
title, description, assignee_user (M2O `directus_users`), assignee_person (M2O `people` nullable), due_date, status (`todo`,`in_progress`,`blocked`,`done`,`cancelled`), priority, related_type/related_id (polymorphic light), branch (scope), created_by. Index `(assignee_user, status)`, `due_date`, `branch`.

### 9.5 `announcements`
title, body, publish_from, publish_to, channels (json), audience (json or M2O `communication_audiences`), status (`draft`,`scheduled`,`published`,`cancelled`), created_by, approved_by. Index `status`, `publish_from`.

### 9.6 `events` (changed)
Add: `overview` (text), `invite_a_friend_enabled` (boolean), `blessings_total` (derived), `attendance_session` (M2O nullable). Optional `event_sessions` (agenda: event, title, start/end, speaker) for the Summit.

### 9.7 `event_referrals`
event (M2O), inviter (person), invitee_name, invitee_person (nullable), invite_date, status. Index `(event, inviter)`, `event`.

---

## 10. Scope model — Area → Zone → Branch → Department

**Principle:** one database, one Directus project; isolation enforced by policy filters on every scope-bearing collection. Each operational record carries the deepest scope field it needs (`area`, `zone`, `branch`, and/or `department`, `bsc`, `household`). Denormalised parent fields (`zone`, `area`) are Flow-maintained and used for fast filters.

**User scope values:** `directus_users.area`, `.zone`/`.zone_ids`, `.branch_ids`, `.department_ids`, `.household`.

**Filter building blocks:**

- Area admin / overseer — no item filter (all records).
- Zone admin — `{ "zone": { "_eq": "$CURRENT_USER.zone" } }` or `_in $CURRENT_USER.zone_ids`.
- Branch admin / branch pastor — `{ "branch": { "_in": "$CURRENT_USER.branch_ids" } }`.
- Department head — `_and` of branch scope and `{ "department": { "_in": "$CURRENT_USER.department_ids" } }`.
- Household-scoped — `{ "household": { "_eq": "$CURRENT_USER.household" } }`.
- Guest school contact — a time-boxed, field-limited grant on AVS/school-contact records only; **no** people reads.
- Fail-closed — a user with no scope values sees nothing.

**Enforcement tests (must hold):**
1. Zone admin → cross-zone record = `403`/empty.
2. Branch admin → cross-branch = `403`/empty.
3. Department head → other departments and welfare = `403`.
4. Household head → other households = `403`.
5. Guest → people = `403`; only their centre's contact fields.
6. Missing scope → empty (fail-closed).

---

## 11. Permission matrix (expanded rows)

Actions: **C** create, **R** read, **U** update, **D** delete. Scope: `all` = area-wide; `zone` = `zone = user.zone`; `own` = `branch ∈ user.branch_ids`; `dept` = within assigned departments; `household` = user's household.

| Collection | Super admin | Area admin | Zone admin | Branch admin | Dept head | Volunteer/Teacher | Household | Public |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| areas | CRUD | R/U | R (zone's area) | R | R | – | – | – |
| zones | CRUD | CRUD | R/U (own zone) | R (own zone) | R | – | – | – |
| branches | CRUD | CRUD | R (zone) | R/U (own) | R | R (minimal) | – | – |
| bible_study_centres | CRUD | CRUD | CRUD (zone) | CRUD (own) | R | R (assigned BSC) | – | – |
| conference_centres | CRUD | CRUD | CRUD (zone) | R (own) | R | R | – | – |
| sunday_school_classes | CRUD | CRUD | CRUD (zone) | CRUD (own) | R/U (own dept) | R/U attendance | – | – |
| avs_centres | CRUD | CRUD | CRUD (zone) | CRUD (own) | R/U (AVS) | R | – | – |
| people | CRUD | CRUD | CRUD (zone) | CRUD (own) | R/U (dept members) | R (minimal) | R (household) | – |
| households | CRUD | CRUD | CRUD (zone) | CRUD (own) | R (dept) | – | R/U (own) | – |
| person_previous_branches / person_milestones / person_history | CRUD | CRUD | CRUD (zone) | CRUD (own) | R/U (dept) | – | R (own) | – |
| attendance_sessions | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (dept) | C/U (assigned) | – | – |
| attendance_counts | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (dept) | C/U (assigned) | – | – |
| blessings | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (dept) | C/U (assigned) | – | – |
| branch_financial_records | CRUD | CRUD | R (zone) | CRU (own) | – | – | – | – |
| weca_returns | CRUD | CRUD | R (zone) | R (own) | – | – | – | – |
| youth_profiles | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (youth dept) | R | R (own) | – |
| celebrations | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (dept) | R | R (own) | R (public ones) |
| campus_institutions | CRUD | CRUD | R | R | R | R | – | – |
| campus_students | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (campus) | R (assigned) | R (own) | – |
| coaching_* (programmes, timetable, facilitators, students, attendance, progress, resources, feedback) | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (campus) | CRU (assigned class) | – | – |
| exam_results | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (campus) | C/U (own class) | R (own) | – |
| campus_financial_support | CRUD | CRUD | R (zone) | CRU (own) | R (campus) | – | R (own) | – |
| leadership_positions | CRUD | R | R | R | R | – | – | – |
| leadership_appointments | CRUD | CRUD | R (zone)/CRU (zone) | R (own)/CRU (own) | R | – | – | – |
| pastoral_history / branch_milestones | CRUD | CRUD | CRU (zone) | CRU (own) | R | R | – | – |
| transfers | CRUD | CRUD | CRU (zone) | CRU (own) | – | – | – | – |
| marriage_matters | CRUD | CRUD | CRU (zone) | CRU (own) | R (welfare) | – | R (own) | – |
| office_minutes | CRUD | CRUD | R (zone) | R (own) | R (dept) | – | – | – |
| tasks | CRUD | CRUD | CRUD (zone) | CRUD (own) | CRU (dept) | R/C own | R own | – |
| announcements | CRUD | CRUD | CRU (zone) | CRU (own) | R (dept) | R | R | R (public ones) |
| events | CRUD | CRUD | CRU (zone) | CRU (own; not area) | R (dept) | R | R | R (public) |
| event_referrals | CRUD | CRUD | CRU (zone) | CRU (own) | CRU (dept) | C (own) | C | C (public reg) |
| campus/office as above | … | … | … | … | … | … | … | … |

*(Communications, groups, consent, registrations, welfare, visitors rows are unchanged — see the data-model addendum.)*

### 11.1 Field-level restrictions (additions)

| Collection | Field | Restrict reads to |
| --- | --- | --- |
| people | `date_of_birth`, `safeguarding_flag`, `notes`, `marriage_date` | branch admin+, designated safeguarding lead |
| households | `geo`, `map_pin`, `address` | branch admin+, household head (own) |
| branch_financial_records | all amounts | branch admin (own), area+, finance lead |
| weca_returns | computed fields | area+, finance lead |
| campus_students / exam_results | scores, financial support | campus coordinator, branch admin+, own student |
| leadership_appointments | notes, appointed_by | area/zone admin, HR/office |
| tasks | description | assignee, scoped admin |
| directus_users | scope JSON fields | system/Flow only |

---

## 12. Required indexes (consolidated additions)

| Collection | Index |
| --- | --- |
| zones | `code` (unique), `area`, `status` |
| branches | `zone`, `area`, `branch_type`, `status` |
| bible_study_centres | `code` (unique), `parent_branch`, `(zone, status)` |
| conference_centres | `code` (unique), `zone`, `status` |
| sunday_school_classes | `branch`, `zone`, `teacher` |
| avs_centres | `branch`, `status`, `type` |
| service_type_definitions | `key` (unique) |
| attendance_sessions | add `zone`, `bsc`; existing `(branch, session_date)` |
| attendance_counts | `(session, category, sex)` unique, `session`, `category` |
| blessings | `branch`, `zone`, `service_date`, `(branch, service_date)`, `(zone, service_date)`, `blessing_type` |
| households | add `zone`, `household_head`, `status` |
| people | add `status`, `is_youth`, `marital_status`, `education_level`, `occupation` |
| person_previous_branches | `person` |
| person_milestones | `person`, `(person, milestone_type)` |
| branch_financial_records | `(branch, month)` unique, `zone`, `status` |
| weca_returns | `(branch, period)` unique, `computation_status` |
| youth_profiles | `person` (unique), `branch`, `zone`, `education_level`, `employment_status` |
| celebrations | `person`, `(type, event_date)`, `(branch, event_date)`, `status` |
| campus_students | `person`, `institution`, `level`, `nysc_status`, `status` |
| coaching_timetable | `(programme, day_of_week)` |
| coaching_facilitators | `(programme, person)` unique |
| coaching_students | `(programme, student)` unique |
| coaching_class_attendance | `(timetable, student, date)` unique |
| coaching_progress | `(student, programme, date)` |
| exam_results | `(student, exam, year)` |
| leadership_positions | `key` (unique) |
| leadership_appointments | `person`, `position`, `(scope_type, branch)`, `(scope_type, zone)`, `status` |
| business objects (finance, campus, office) | `branch`/`zone` FK composite as shown above |

---

## 13. Automation (Directus Flows) — documented

| Flow | Trigger | Effect |
| --- | --- | --- |
| `hierarchy.denorm` | zone/branch/BSC created/updated | maintain `zone`/`area` denormalised fields |
| `attendance.total` | attendance_counts changed | recompute `attendance_sessions.total_headcount` |
| `blessings.total` | blessing created/updated | recompute `total_count` |
| `profile.analytics` | on demand / cached | compute counts for area/zone/branch/BSC/person profiles (with drill links) |
| `youth.derive` | person DOB changed | set `people.is_youth` (override preserved) |
| `gravatar.resolve` | person email changed | set `gravatar_hash`/`avatar_url` |
| `user.scope_sync` | user zone/branch/departments changed | recompute `zone_ids`/`branch_ids`/`department_ids` |
| `weca.calculate` | formula_version available / period locked | compute return fields; else `formula_pending` |
| `celebrations.remind` | weekly schedule | POST upcoming birthdays/anniversaries to the reminder webhook |
| `prior_year.import` | CSV upload | validate + insert with `source = import`, idempotent |

---

## 14. Enforcement & test strategy (additions)

- **Scope tests:** zone admin cross-zone `403`; branch admin cross-branch `403`; department head other-department `403`; household head other-household `403`; guest people access `403`; missing scope returns empty.
- **Attendance tests:** category set matches `service_type_definitions`; male+female totals reconcile; retry is idempotent.
- **Blessings tests:** per-type counts roll up to the branch breakdown; CSV matches the query.
- **Finance tests:** one record per branch/month; returns show `formula_pending` until a formula version exists; applying a formula version recalculates and records the version.
- **Campus tests:** class attendance idempotent; results and financial support are scope-safe; NYSC status transitions validated.
- **Schema drift:** committed `schema/snapshot.yaml` includes all new collections; CI diff.

---

## 15. Migration / portability
Unchanged AFC-147/148 rules hold: Postgres stays the system of record; no opaque DB triggers (denormalisation via documented Flows); reporting aggregates are read-only queries; the permission matrix is portable; `useApi` centralises the API base so a later platform swap is configuration.

---

*Extends [data-model](/AFC/issues/AFC-147#document-data-model) and [data-model-addendum](/AFC/issues/AFC-148#document-data-model-addendum). Companion: [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion), [integrations-spec](/AFC/issues/AFC-150#document-integrations-spec), [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation), [wireframes-expansion](/AFC/issues/AFC-150#document-wireframes-expansion).*
