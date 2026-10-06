# Data Model & Permission Matrix — Church Portal

**Issue:** AFC-147 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech)
**Platform:** Directus (self-hosted) + PostgreSQL 16 · **Version:** v1 (2026-10-05)

This document defines the Directus collections, fields, relations, indexes, the multi-branch scoping strategy, how users link to branches/departments, the explicit permission matrix, and the migration path to Monospace.

Conventions: collections and fields are `snake_case`. `M2O` = many-to-one, `O2M` = one-to-many, `M2M` = many-to-many via a junction collection. Directus system fields (`id`, `user_created`, `user_updated`, `date_created`, `date_updated`, `status`) exist where noted.

---

## 1. Collection map

```
branches ──┬─< departments ──< people_departments >── people ──< attendance_records
           │                                                                  │
           ├─< people ──< event_registrations          attendance_sessions ──┘
           │      │                                            │
           │      ├── household                                ├── sunday_services ──< service_assignments
           │      └── guardian (self M2O)                      └── events
           ├─< visitors ── person
           ├─< events ──< event_registrations
           ├─< sunday_services
           ├─< attendance_sessions
           ├─< welfare_cases ──< welfare_contributions
           │                     └─< welfare_case_events
           └─< users (directus_users.branch / branch_ids / departments)
```

---

## 2. Core collections

### 2.1 `branches`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string, required | e.g. "Ikeja Branch" |
| code | string, required, unique | e.g. "LAG-IKJ" |
| slug | string, unique | URL-safe |
| branch_type | enum | `area`, `main`, `branch`, `satellite` |
| parent_branch | M2O `branches` | nullable; for satellites under a branch |
| address | text | |
| city / state | string | |
| phone / email | string | |
| status | enum | `active`, `inactive` |
| sort | integer | display order |

**Indexes:** `code` (unique), `slug` (unique), `branch_type`.

### 2.2 `departments`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string, required | |
| code | string, unique | |
| department_type | enum | `youth`, `teens`, `worship`, `welfare`, `outreach`, `children`, `media`, `ushering`, `admin` |
| branch | M2O `branches` | nullable → null = area-wide department |
| leader_person | M2O `people` | nullable |
| description | text | |
| status | enum | `active`, `inactive` |

**Indexes:** `code` (unique), `branch`, `department_type`.

### 2.3 `people`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| first_name / last_name | string, required | |
| preferred_name | string | |
| other_names | string | |
| gender | enum | `male`, `female`, `unspecified` |
| date_of_birth | date | nullable |
| is_minor | boolean | **derived** from DOB, maintained by Flow; never hand-edited |
| phone / email | string | |
| address | text | |
| photo | file (uuid) | |
| household | M2O `households` | |
| branch | M2O `branches` | home branch |
| membership_status | enum | `member`, `regular_attendee`, `visitor`, `youth`, `child`, `staff`, `inactive` |
| member_since | date | |
| departments | M2M `people_departments` | |
| guardian | M2O `people` (self) | nullable; for minors |
| consent_data | boolean | consent to store personal data |
| consent_media | boolean | consent to publish photos |
| consent_signed_at | datetime | |
| notes | text | restricted |
| safeguarding_flag | boolean | restricted; visible to permitted roles only |
| status | enum | `active`, `archived` |
| user | O2M `directus_users` | one login account may link to a person |

**Indexes:** `branch`, `membership_status`, `(last_name, first_name)`, `phone`, `email`, `household`, `date_of_birth`, `guardian`.

### 2.4 `people_departments` (junction)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| people | M2O `people`, required | |
| departments | M2O `departments`, required | |
| role | enum | `member`, `leader`, `assistant` |
| joined_at | date | |
| status | enum | `active`, `inactive` |

**Indexes:** `(people, departments)` unique.

### 2.5 `households`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| name | string | |
| branch | M2O `branches` | |
| address | text | |
| phone | string | |
| primary_contact | M2O `people` | |
| notes | text | |

**Indexes:** `branch`, `primary_contact`.

---

## 3. Events & registration

### 3.1 `events`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| title | string, required | |
| slug | string, unique | public URL |
| summary | string | short list text |
| description | text (markdown/WYSIWYG) | |
| event_type | enum | `service`, `summit`, `camp`, `training`, `outreach`, `social`, `other` |
| branch | M2O `branches` | **nullable → null = area-wide event** |
| departments | M2M `events_departments` | target departments |
| start_at / end_at | datetime, required | |
| location / address | string / text | |
| capacity | integer | nullable = unlimited |
| waitlist_enabled | boolean | default false |
| registration_open | boolean | derived from window, but overridable |
| registration_opens_at / registration_closes_at | datetime | |
| fee_amount | decimal(12,2) | |
| currency | enum | `NGN`, `USD`, `GBP` |
| requires_guardian_consent | boolean | |
| collect_medical | boolean | show medical/emergency fields on the form |
| age_min / age_max | integer | nullable; eligibility |
| visibility | enum | `public`, `branch`, `internal` |
| cover_image | file (uuid) | |
| status | enum | `draft`, `published`, `closed`, `cancelled` |
| created_by | M2O `directus_users` | |

**Indexes:** `slug` (unique), `start_at`, `branch`, `status`, `event_type`.

### 3.2 `event_registrations`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| event | M2O `events`, required | |
| person | M2O `people` | nullable (anonymous public registrant) |
| registrant_first_name / registrant_last_name | string, required | |
| email / phone | string | |
| date_of_birth | date | nullable; used for age/consent |
| age_group | enum | `adult`, `youth`, `teen`, `child`, `unknown` |
| branch | M2O `branches` | registrant's branch |
| guardian_name / guardian_phone / guardian_email | string | required when minor |
| guardian_consent | boolean | required true when minor |
| consent_signed_at | datetime | |
| medical_notes / allergies | text | **restricted fields** |
| emergency_contact_name / emergency_contact_phone | string | |
| amount_expected / amount_paid | decimal(12,2) | |
| payment_status | enum | `not_required`, `pending`, `paid`, `refunded` |
| payment_reference | string | manual bank transfer reference |
| ticket_code | string, unique | generated by Flow on create |
| registration_status | enum | `pending`, `confirmed`, `waitlisted`, `cancelled`, `attended`, `no_show` |
| source | enum | `public_form`, `staff` |
| created_at | datetime | |

**Indexes:** `ticket_code` (unique), `(event, registration_status)`, `email`, `person`, `branch`.

### 3.3 `events_departments` (junction)
`id`, `events` (M2O), `departments` (M2O). **Index:** `(events, departments)` unique.

---

## 4. Attendance & worship

### 4.1 `attendance_sessions`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| session_type | enum | `sunday_service`, `midweek`, `event`, `camp`, `department` |
| branch | M2O `branches`, required | |
| service | M2O `sunday_services` | nullable |
| event | M2O `events` | nullable |
| session_date | date, required | |
| title | string | |
| headcount_adults / headcount_youth / headcount_teens / headcount_children / headcount_visitors | integer | default 0 |
| total_headcount | integer | derived = sum of categories |
| recorded_by | M2O `directus_users` | |
| notes | text | |
| status | enum | `draft`, `submitted` |

**Indexes:** `(branch, session_date)`, `service`, `event`, `session_type`.

### 4.2 `attendance_records` (optional, name-level)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| session | M2O `attendance_sessions`, required | |
| person | M2O `people` | nullable for unnamed visitor |
| name_if_unnamed | string | for visitors without a profile |
| category | enum | `adult`, `youth`, `teen`, `child`, `visitor` |
| present | boolean | default true |
| check_in_at | datetime | |

**Indexes:** `session`, `person`, `(session, person)` unique where person not null.

### 4.3 `sunday_services`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| branch | M2O `branches`, required | |
| service_date | date, required | |
| service_time | time | |
| service_type | enum | `sunday`, `midweek`, `special`, `camp` |
| theme | string | |
| preacher | M2O `people` | nullable |
| expected_attendance | integer | |
| total_attendance | integer | copied from the linked session |
| status | enum | `planned`, `completed` |
| notes | text | |

**Indexes:** `(branch, service_date, service_time)`, `status`.

### 4.4 `service_assignments` (roster)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| service | M2O `sunday_services`, required | |
| role | enum | `worship_leader`, `preacher`, `usher`, `media`, `sound`, `children`, `welcome`, `prayer`, `offering`, `communion` |
| person | M2O `people`, required | |
| branch | M2O `branches` | denormalised for scoping |
| status | enum | `invited`, `confirmed`, `declined` |
| notes | text | |

**Indexes:** `service`, `person`, `(service, role)`, `branch`.

---

## 5. Visitors

### 5.1 `visitors`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| person | M2O `people` | nullable |
| first_name / last_name | string, required | |
| phone / email | string | |
| address | text | |
| first_visit_date | date | |
| branch | M2O `branches`, required | |
| service | M2O `sunday_services` | nullable |
| invited_by | M2O `people` | nullable |
| age_group | enum | `adult`, `youth`, `teen`, `child` |
| status | enum | `new`, `contacted`, `in_follow_up`, `connected`, `integrated`, `dormant` |
| follow_up_owner | M2O `directus_users` | nullable |
| next_follow_up_date | date | |
| follow_up_notes | text | |
| created_at | datetime | |

**Indexes:** `branch`, `status`, `follow_up_owner`, `first_visit_date`, `next_follow_up_date`.

---

## 6. Welfare

### 6.1 `welfare_cases`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| case_ref | string, unique | Flow-generated, e.g. `WEL-2026-0001` |
| person | M2O `people`, required | |
| branch | M2O `branches`, required | |
| category | enum | `financial`, `medical`, `food`, `housing`, `bereavement`, `education`, `other` |
| title | string, required | |
| description | text | **restricted** |
| status | enum | `open`, `in_progress`, `pending_approval`, `resolved`, `closed` |
| priority | enum | `low`, `medium`, `high`, `urgent` |
| confidentiality | enum | `branch`, `area` |
| assigned_to | M2O `directus_users` | nullable |
| opened_at / target_date / closed_at | date/datetime | |
| amount_requested / amount_approved | decimal(12,2) | nullable |
| outcome_notes | text | **restricted** |

**Indexes:** `case_ref` (unique), `branch`, `status`, `person`, `assigned_to`, `priority`.

### 6.2 `welfare_contributions`
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| case | M2O `welfare_cases`, required | |
| contribution_type | enum | `cash`, `goods`, `service` |
| description | string | |
| amount | decimal(12,2) | nullable |
| currency | enum | `NGN`, `USD`, `GBP` |
| contributed_by_person | M2O `people` | nullable |
| contributed_by_name | string | |
| contribution_date | date | |
| approved_by | M2O `directus_users` | nullable |
| status | enum | `proposed`, `approved`, `disbursed` |

**Indexes:** `case`, `status`.

### 6.3 `welfare_case_events` (explicit case audit)
| Field | Type | Notes |
| --- | --- | --- |
| id | uuid (PK) | |
| case | M2O `welfare_cases`, required | |
| event_type | enum | `created`, `status_changed`, `assigned`, `note`, `contribution_added` |
| detail | text | |
| actor_user | M2O `directus_users` | |
| created_at | datetime | |

**Indexes:** `case`, `created_at`.

---

## 7. Users, branches, and departments

### 7.1 Extending `directus_users`
Directus allows custom fields on `directus_users`. Add:

| Field | Type | Purpose |
| --- | --- | --- |
| person | M2O `people` | link the login to the person profile |
| staff_role | enum | `super_admin`, `area_admin`, `branch_admin`, `department_leader`, `volunteer`, `none` |
| branch | M2O `branches` | primary branch (single-branch roles) |
| branch_ids | json (array of branch uuid) | **multi-branch scope**, kept in sync by a Flow; used in permission filters |
| departments | M2M `users_departments` | department scope for department leaders |
| department_ids | json (array of department uuid) | derived from `departments`, for filter use |
| title / phone | string | |

**Why `branch_ids`:** Directus item filters support `$CURRENT_USER.<field>`. A JSON array lets us express `{ "branch": { "_in": "$CURRENT_USER.branch_ids" } }` reliably for department leaders and area admins without fragile nested relational filter syntax. A Flow recalculates `branch_ids` and `department_ids` whenever the user's `branch` or `departments` change.

**Indexes:** `staff_role`, `branch`.

### 7.2 `users_departments` (junction)
`id`, `user` (M2O `directus_users`), `departments` (M2O `departments`). **Index:** `(user, departments)` unique.

---

## 8. Entity relationships (summary)

| Relationship | Cardinality | On delete |
| --- | --- | --- |
| branch → departments | 1:M | restrict |
| branch → people | 1:M | restrict |
| household → people | 1:M | set null |
| people ↔ departments | M:M | cascade junction |
| people → people (guardian) | 1:M | set null |
| branch → events | 1:M (nullable) | restrict |
| events ↔ departments | M:M | cascade junction |
| events → event_registrations | 1:M | cascade |
| branch → attendance_sessions | 1:M | restrict |
| attendance_sessions → attendance_records | 1:M | cascade |
| sunday_services → attendance_sessions | 1:1..M | set null |
| sunday_services → service_assignments | 1:M | cascade |
| branch → visitors | 1:M | restrict |
| people → welfare_cases | 1:M | restrict |
| welfare_cases → welfare_contributions | 1:M | cascade |
| welfare_cases → welfare_case_events | 1:M | cascade |
| directus_users → people | M:1 | set null |

---

## 9. Multi-branch scoping strategy

**Principle:** one database, one Directus project. Branch isolation is enforced by Directus **policy filters** on every branch-bearing collection. The `branch` M2O is mandatory on operational records; area-wide records (e.g. an area event) use `branch = null` and are only manageable by area admins.

**Scope value on the user:** `directus_users.branch` (single) and `directus_users.branch_ids` (JSON array, maintained by Flow). Area admins are identified by `staff_role = area_admin` and use an **unfiltered** policy; super admins use the built-in Directus Admin role.

**Filter building blocks (Directus JSON filters):**

- Branch admin / volunteer — own branch only:
  ```json
  { "branch": { "_eq": "$CURRENT_USER.branch" } }
  ```
- Department leader (youth) — assigned branches:
  ```json
  { "_and": [
      { "branch": { "_in": "$CURRENT_USER.branch_ids" } },
      { "department": { "_in": "$CURRENT_USER.department_ids" } }
  ] }
  ```
  For collections without a `department` field (e.g. `attendance_sessions`), scope by branch only, or add a denormalised `department` field where department-level isolation is required.
- Area admin — no item filter; create/update allowed across branches, but **no** `settings`/schema access.
- Public role — create-only on `event_registrations` via an allowlisted field set; **no read** permission on any collection. Writes go through a Directus Flow (or a rate-limited public endpoint) that validates fields, checks capacity, and generates `ticket_code`.

**Area admin sees all branches:** because its policy has no branch item filter. It is a distinct Directus policy/role from branch admin, not a filter value.

**Defence in depth:** branch scoping is also validated in the frontend (navigation and query params), but the **server-side Directus policy is the only authoritative control**. Cross-branch access tests run in CI (see `repo-plan`).

**Indexes that make scoping fast:** every `branch` FK, plus composite `(branch, date)` indexes on the high-volume collections (`attendance_sessions`, `visitors`, `welfare_cases`, `event_registrations`).

**Enforcement rules (must hold in tests):**
1. A branch admin requesting a record from another branch receives `403`/empty set, on both list and detail.
2. A department leader sees only records for assigned branches and departments.
3. A volunteer can create/update attendance for their branch and cannot read welfare or other branches.
4. The public role cannot read any collection and can create only valid registrations.
5. A user with `branch = null` and `staff_role != area_admin` sees nothing (fail-closed).

---

## 10. Permission matrix (explicit and testable)

Actions: **C** create, **R** read (list/detail), **U** update, **D** delete. Scope noted in parentheses. `own` = records with `branch = $CURRENT_USER.branch`; `assigned` = `branch ∈ $CURRENT_USER.branch_ids`; `all` = unfiltered.

| Collection | Super admin (Admin) | Area admin | Branch admin | Dept leader (youth) | Volunteer | Public |
| --- | --- | --- | --- | --- | --- | --- |
| branches | CRUD (all) | R (all) | R (own) | R (assigned) | R (own, minimal) | – |
| departments | CRUD (all) | CRUD (all) | R (own) | R/U (own dept) | R (own) | – |
| people | CRUD (all) | CRUD (all) | CRUD (own) | R/U (assigned dept members) | R (name/branch only, own) | – |
| people_departments | CRUD (all) | CRUD (all) | CRU (own) | CRU (own dept) | R (own) | – |
| households | CRUD (all) | CRUD (all) | CRUD (own) | R (assigned) | – | – |
| events | CRUD (all) | CRUD (all) | CRU (own; not area events) | R (assigned) | R (own) | R (public only) |
| event_registrations | CRUD (all) | CRUD (all) | CRUD (own branch events) | R (assigned dept events) | U (check-in fields only, own) | C (allowlisted fields) |
| attendance_sessions | CRUD (all) | CRUD (all) | CRUD (own) | CRU (assigned) | C/U (own) | – |
| attendance_records | CRUD (all) | CRUD (all) | CRUD (own) | CRU (assigned) | C/U (own) | – |
| sunday_services | CRUD (all) | CRUD (all) | CRUD (own) | R (assigned) | R (own) | – |
| service_assignments | CRUD (all) | CRUD (all) | CRUD (own) | CRU (assigned dept roles) | R (own) | – |
| visitors | CRUD (all) | CRUD (all) | CRUD (own) | CRU (assigned, youth) | C (own branch intake) | – |
| welfare_cases | CRUD (all) | CRUD (all) | CRUD (own) | R (assigned, youth cases only) | – | – |
| welfare_contributions | CRUD (all) | CRUD (all) | CRUD (own) | – | – | – |
| welfare_case_events | CRUD (all) | R (all) | R (own) | R (assigned youth) | – | – |

### 10.1 Field-level restrictions
| Collection | Field | Restrict reads to |
| --- | --- | --- |
| people | `safeguarding_flag`, `notes`, `date_of_birth` | branch admin, area/super admin, designated safeguarding lead |
| event_registrations | `medical_notes`, `allergies`, `emergency_contact_*` | branch admin, area/super admin, camp coordinator role |
| welfare_cases | `description`, `outcome_notes` | assigned owner, branch admin, area/super admin |
| directus_users | `branch_ids`, `department_ids` | system/Flow only (no UI edit) |

Field-level permission is enforced in Directus policy `fields`; the frontend hides fields it cannot read.

---

## 11. Required indexes (consolidated)

| Collection | Index |
| --- | --- |
| branches | `code` (unique), `slug` (unique) |
| departments | `code` (unique), `branch`, `department_type` |
| people | `branch`, `membership_status`, `(last_name, first_name)`, `phone`, `email`, `household`, `date_of_birth` |
| people_departments | `(people, departments)` unique |
| households | `branch` |
| events | `slug` (unique), `start_at`, `branch`, `status`, `event_type` |
| event_registrations | `ticket_code` (unique), `(event, registration_status)`, `email`, `person`, `branch` |
| attendance_sessions | `(branch, session_date)`, `service`, `event`, `session_type` |
| attendance_records | `session`, `(session, person)` unique (where person not null) |
| sunday_services | `(branch, service_date, service_time)`, `status` |
| service_assignments | `service`, `person`, `(service, role)`, `branch` |
| visitors | `branch`, `status`, `follow_up_owner`, `next_follow_up_date` |
| welfare_cases | `case_ref` (unique), `branch`, `status`, `person`, `assigned_to`, `priority` |
| welfare_contributions | `case`, `status` |
| welfare_case_events | `case`, `created_at` |
| directus_users | `staff_role`, `branch` |

Directus auto-creates primary-key and foreign-key indexes; the composite and lookup indexes above are added explicitly via a migration.

---

## 12. Enforcement & test strategy

- **Automated permission tests (CI):** a test suite obtains tokens for each role and asserts the matrix above, including negative cases (branch admin → cross-branch `403`; public → read `403`; volunteer → welfare `403`).
- **Capacity/consent tests:** public registration blocks when full; waitlist when enabled; minor without guardian consent is rejected.
- **Idempotency tests:** attendance submit retried does not duplicate; check-in retried is idempotent.
- **Schema drift:** a committed `schema/snapshot.yaml` is diffed against a fresh snapshot in CI.

---

## 13. Migration path to Monospace (config, not rewrite)

Design rules that keep a future Monospace move cheap:

1. **Postgres stays the system of record.** Monospace connects to the same relational database; no data migration is implied.
2. **No proprietary DB objects the app depends on.** Avoid Directus-specific views/functions the frontend calls directly. Keep derived fields (e.g. `total_headcount`, `is_minor`) maintained by Flows or application logic, not by opaque DB triggers.
3. **The permission matrix is documented portably.** `docs/permissions.md` (this matrix) is the source of truth; Directus policies are one implementation. Monospace policy mapping uses the same role/scope model.
4. **Automation is documented, not implicit.** Each Directus Flow (ticket code, consent validation, notifications, `branch_ids` sync) is documented with trigger, condition, and effect so it can be reimplemented.
5. **Stable API contract.** The Nuxt frontend calls a thin `useApi` composable that centralises base URL, auth, and error handling — swapping from Directus REST/GraphQL to a Monospace/Gateway endpoint is configuration there, not a UI rewrite.
6. **Schema as code.** `schema/snapshot.yaml` + migrations make the schema reproducible on any Postgres, so re-pointing a governance layer is a deployment step.
7. **Avoid role-locked client behaviour.** Do not hard-code Directus role names in the UI; drive navigation from a capabilities endpoint (`/api/me/permissions`) that both platforms can implement.

When Monospace becomes relevant (many apps/workspaces, many data sources, formal governance at scale), the migration is: point Monospace at the Postgres instance, map the documented roles/policies, and switch the frontend API base — no schema redesign.
