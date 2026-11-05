-- services/directus/seeds/demo/001_demo_seed.sql
--
-- AFC-1086 demo seed (parent AFC-1084, ancestor AFC-1083).
--
-- Linked, recognizable demo data for every in-scope module. The same people
-- appear across 6+ modules: the Adeyemi family (Emmanuel, Sarah, Tunde,
-- Grace), the Okafor family (Chidi, Ngozi) and Emeka Eze preach, usher,
-- register, invite, give, and meet across gatherings, care, and finance.
-- Anchor events: Youth Celebration Night, Lagos North Revival.
--
-- HOW TO RUN (staging only, never production):
--   psql "$STAGING_PG_URL" -v ON_ERROR_STOP=1 \
--     -c "SET ROLE directus_migrator;" \
--     -f services/directus/seeds/demo/001_demo_seed.sql
-- The connecting identity must hold the migrator role (staging owner does).
-- Never run as directus_app: the app role cannot write several of these
-- columns and must never own seed data.
--
-- IDEMPOTENCY: every INSERT is ON CONFLICT DO NOTHING on a stable natural
-- key (DEMO- codes, ticket codes, case refs, idempotency keys, or fixed
-- demo UUIDs for tables without one). Registry rows are written only from
-- the RETURNING set, so a re-run plants zero duplicate rows AND zero
-- duplicate registry rows. Re-running on a database that already holds
-- production data is safe: conflicts are skipped, never overwritten, and
-- skipped rows are never registered (so the clear script cannot touch them).
--
-- NEVER SEEDED HERE (evidence + retention seals, per the task spec):
--   incidents, legal_holds, retention_runs, retention_run_items,
--   retention_clocks, retention_policies, member_otp_codes, member_sessions.
-- The clear script raises if a registry row ever names one of these.
--
-- NEVER UPDATED HERE: welfare_case_events is append-only (INSERT only, no
-- UPDATE of existing rows). This script INSERTs created/note events and
-- updates nothing.
--
-- ANCHORS REUSED, NOT PLANTED: area LAG-NORTH, zone LAG-NORTH-Z1, branch
-- OKE-ARO, area groups LAG-NORTH-GROUP-1, journey stages
-- (identify/welcome/pack/dropoff/follow_up), communication channels
-- (whatsapp/sms/email), UNILAG, the weca-2026-01 formula. The seed links
-- demo people to the real Lagos North hierarchy; it does not fork it.
-- Campus scope is one campus_students row (Tunde at UNILAG); the coaching /
-- NYSC programme tables are board-owned and stay empty.

-- ---------------------------------------------------------------------------
-- 0. Preconditions: the registry migration must be applied first.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.demo_seed_registry') IS NULL THEN
    RAISE EXCEPTION
      'demo_seed_registry is missing: apply migration '
      '20261105_0068_demo_seed_registry.sql before seeding. Seed data '
      'without the address book cannot be cleared.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. People: the Adeyemi, Okafor and Eze families (+ Grace, the visitor who
--    converts below). Fixed UUIDs are the idempotency keys for this table.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO people (id, first_name, last_name, branch, date_of_birth, status)
  VALUES
    ('11111111-1111-4111-8111-000000000101', 'Emmanuel', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1980-05-14', 'active'),
    ('11111111-1111-4111-8111-000000000102', 'Sarah', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1985-11-02', 'active'),
    ('11111111-1111-4111-8111-000000000103', 'Tunde', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2007-03-08', 'active'),
    ('11111111-1111-4111-8111-000000000104', 'Chidi', 'Okafor',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1975-02-20', 'active'),
    ('11111111-1111-4111-8111-000000000105', 'Ngozi', 'Okafor',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1978-07-25', 'active'),
    ('11111111-1111-4111-8111-000000000106', 'Emeka', 'Eze',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1982-12-01', 'active'),
    ('11111111-1111-4111-8111-000000000107', 'Grace', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2001-04-19', 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, first_name, last_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'people', 'DEMO-PERSON-' || upper(last_name) || '-' || upper(first_name), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Households (Adeyemi, Okafor, Eze), then link members + roles.
--    people -> households -> UPDATE people: the FK is SET NULL both ways,
--    so insert people first, households second, link third.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO households (id, name, branch, zone, phone, household_head, primary_contact, status)
  VALUES
    ('11111111-1111-4111-8111-000000000201', 'Adeyemi Household',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '+2348030000101',
      '11111111-1111-4111-8111-000000000101', '11111111-1111-4111-8111-000000000101', 'active'),
    ('11111111-1111-4111-8111-000000000202', 'Okafor Household',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '+2348030000104',
      '11111111-1111-4111-8111-000000000104', '11111111-1111-4111-8111-000000000104', 'active'),
    ('11111111-1111-4111-8111-000000000203', 'Eze Household',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '+2348030000106',
      '11111111-1111-4111-8111-000000000106', '11111111-1111-4111-8111-000000000106', 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'households', 'DEMO-HOUSEHOLD-' || upper(split_part(name, ' ', 1)), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

UPDATE people SET
  household = '11111111-1111-4111-8111-000000000201', household_role = 'head_of_household'
  WHERE id = '11111111-1111-4111-8111-000000000101' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000201', household_role = 'spouse'
  WHERE id = '11111111-1111-4111-8111-000000000102' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000201', household_role = 'child'
  WHERE id = '11111111-1111-4111-8111-000000000103' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000201', household_role = 'relative'
  WHERE id = '11111111-1111-4111-8111-000000000107' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000202', household_role = 'head_of_household'
  WHERE id = '11111111-1111-4111-8111-000000000104' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000202', household_role = 'spouse'
  WHERE id = '11111111-1111-4111-8111-000000000105' AND household IS NULL;
UPDATE people SET
  household = '11111111-1111-4111-8111-000000000203', household_role = 'head_of_household'
  WHERE id = '11111111-1111-4111-8111-000000000106' AND household IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Departments: DEMO Choir, Ushery, Youth (branch-scoped to Oke-Aro).
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO departments (id, name, code, department_type, branch, leader_person, description, status)
  VALUES
    ('11111111-1111-4111-8111-000000000301', 'DEMO Choir', 'DEMO-CHOIR', 'worship',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101', 'Demo choir led by Emmanuel Adeyemi.', 'active'),
    ('11111111-1111-4111-8111-000000000302', 'DEMO Ushery Team', 'DEMO-USHERY', 'ushering',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000102', 'Demo ushery team led by Sarah Adeyemi.', 'active'),
    ('11111111-1111-4111-8111-000000000303', 'DEMO Youth Fellowship', 'DEMO-YOUTH', 'youth',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000106', 'Demo youth fellowship led by Emeka Eze.', 'active')
  ON CONFLICT (code) DO NOTHING
  RETURNING id, code
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'departments', code, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Membership junction: leaders + members; Chidi also joins the real
--    area Group 1 (no fork -- the group row itself is untouched).
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO people_departments (people, departments, role, joined_at, status)
  VALUES
    ('11111111-1111-4111-8111-000000000101', '11111111-1111-4111-8111-000000000301', 'leader', DATE '2026-01-11', 'active'),
    ('11111111-1111-4111-8111-000000000104', '11111111-1111-4111-8111-000000000301', 'member', DATE '2026-02-02', 'active'),
    ('11111111-1111-4111-8111-000000000102', '11111111-1111-4111-8111-000000000302', 'leader', DATE '2026-01-11', 'active'),
    ('11111111-1111-4111-8111-000000000105', '11111111-1111-4111-8111-000000000302', 'member', DATE '2026-02-09', 'active'),
    ('11111111-1111-4111-8111-000000000106', '11111111-1111-4111-8111-000000000303', 'leader', DATE '2026-01-18', 'active'),
    ('11111111-1111-4111-8111-000000000103', '11111111-1111-4111-8111-000000000303', 'member', DATE '2026-03-01', 'active'),
    ('11111111-1111-4111-8111-000000000107', '11111111-1111-4111-8111-000000000303', 'member', DATE '2026-08-24', 'active')
  ON CONFLICT (people, departments) DO NOTHING
  RETURNING id, people, departments
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'people_departments', 'DEMO-PD-' || people::text || '-' || departments::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH grp AS (
  SELECT id AS gid FROM departments WHERE code = 'LAG-NORTH-GROUP-1'
),
ins AS (
  INSERT INTO people_departments (people, departments, role, joined_at, status)
  SELECT '11111111-1111-4111-8111-000000000104', gid, 'member', DATE '2026-04-06', 'active'
    FROM grp
  ON CONFLICT (people, departments) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'people_departments', 'DEMO-PD-CHIDI-GROUP-1', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Visitors register + journey: Grace converts (visitor -> person link),
--    Femi stays in follow-up. One forward transition (identify -> welcome)
--    respects the journey guard; the stage rows are the real board stages.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO visitors (id, branch, visitor_first_name, visitor_last_name, phone,
    visit_date, age_group, person, status, journey_stage, journey_stage_entered_at,
    journey_started_at, follow_up_owner, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000401', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Grace', 'Adeyemi', '+2348030000107', DATE '2026-08-23', 'youth',
      '11111111-1111-4111-8111-000000000107', 'converted',
      (SELECT id FROM visitor_journey_stages WHERE key = 'welcome'),
      TIMESTAMPTZ '2026-08-24 10:00:00+01', DATE '2026-08-23',
      '11111111-1111-4111-8111-000000000102', 'Niece of Emmanuel; converted 2026-08-30.'),
    ('11111111-1111-4111-8111-000000000402', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Femi', 'Bakare', '+2348012345678', DATE '2026-08-30', 'adult',
      NULL, 'follow_up',
      (SELECT id FROM visitor_journey_stages WHERE key = 'identify'),
      TIMESTAMPTZ '2026-08-30 11:30:00+01', DATE '2026-08-30',
      '11111111-1111-4111-8111-000000000102', 'Invited by Emmanuel to the Revival.')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, visitor_first_name, visitor_last_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitors', 'DEMO-VISITOR-' || upper(visitor_last_name) || '-' || upper(visitor_first_name), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO visitor_follow_ups (id, visitor, branch, contact_channel, outcome, notes, next_follow_up_at, logged_by)
  VALUES
    ('11111111-1111-4111-8111-000000000403', '11111111-1111-4111-8111-000000000402',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'phone', 'no_answer',
      'Called once; no answer. SMS sent with Revival details.',
      TIMESTAMPTZ '2026-09-06 10:00:00+01',
      '11111111-1111-4111-8111-000000000102')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitor_follow_ups', 'DEMO-FOLLOWUP-FEMI-01', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO visitor_journey_transitions (id, visitor, from_stage, to_stage, logged_by, note)
  VALUES
    ('11111111-1111-4111-8111-000000000404', '11111111-1111-4111-8111-000000000401',
      (SELECT id FROM visitor_journey_stages WHERE key = 'identify'),
      (SELECT id FROM visitor_journey_stages WHERE key = 'welcome'),
      '11111111-1111-4111-8111-000000000102', 'Grace gave details at the welcome desk.')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitor_journey_transitions', 'DEMO-TRANSITION-GRACE-01', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Sunday service + assignments + attendance session/counts/records.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO sunday_services (id, branch, zone, service_date, service_time, service_type,
    theme, preacher, expected_attendance, total_attendance, status, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000501', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), DATE '2026-08-30', TIME '09:00:00',
      'sunday', 'Faith That Moves Mountains',
      '11111111-1111-4111-8111-000000000101', 200, 182, 'completed',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'sunday_services', 'DEMO-SERVICE-2026-08-30', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO service_assignments (id, service, person, role, branch, status)
  VALUES
    ('11111111-1111-4111-8111-000000000502', '11111111-1111-4111-8111-000000000501',
      '11111111-1111-4111-8111-000000000101', 'preacher',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'confirmed'),
    ('11111111-1111-4111-8111-000000000503', '11111111-1111-4111-8111-000000000501',
      '11111111-1111-4111-8111-000000000102', 'usher',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'confirmed')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, person
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'service_assignments', 'DEMO-ASSIGN-' || person::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO attendance_sessions (id, branch, zone, session_date, session_type, session_name,
    service, headcount_total, headcount_adults, headcount_youth, headcount_children,
    headcount_visitors, idempotency_key, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000504', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), DATE '2026-08-30', 'sunday_service',
      'DEMO Sunday Service 2026-08-30',
      '11111111-1111-4111-8111-000000000501', 182, 104, 32, 28, 12,
      'DEMO-SESS-2026-0830',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, idempotency_key
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_sessions', idempotency_key, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO attendance_counts (session, category, sex, count, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000504', 'adults', 'unspecified', 104,
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000504', 'youth', 'unspecified', 32,
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000504', 'children', 'unspecified', 28,
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000504', 'visitors', 'unspecified', 12,
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000504', 'teachers', 'unspecified', 6,
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (session, category, sex) DO NOTHING
  RETURNING id, category
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_counts', 'DEMO-COUNT-2026-0830-' || upper(category), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------


WITH ins AS (
  INSERT INTO attendance_records (id, session, person, attendee_name, attendance_category, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000505', '11111111-1111-4111-8111-000000000504', '11111111-1111-4111-8111-000000000101',
      'Emmanuel Adeyemi', 'member', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000506', '11111111-1111-4111-8111-000000000504', '11111111-1111-4111-8111-000000000102',
      'Sarah Adeyemi', 'member', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000507', '11111111-1111-4111-8111-000000000504', '11111111-1111-4111-8111-000000000103',
      'Tunde Adeyemi', 'member', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000508', '11111111-1111-4111-8111-000000000504', '11111111-1111-4111-8111-000000000107',
      'Grace Adeyemi', 'visitor', '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, attendee_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_records', 'DEMO-ATTEND-0830-' || upper(split_part(attendee_name, ' ', 1)), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6b. Year of Sunday attendance (AFC-1083 follow-up).
--
-- 52 consecutive Sundays, 2025-11-02 .. 2026-10-25, for four people, with
-- deterministic skip rules (no randomness, so re-runs are identical):
--   Emmanuel Adeyemi  (member)  attends all but every 13th week  -> 48/52
--   Sarah Adeyemi     (member)  misses every 4th week            -> 39/52
--   Tunde Adeyemi     (member)  misses every 3rd week            -> 34/52
--   Chidi Okafor      (member)  joined Feb 2026, misses every 5th -> 31/39
-- Per-session headcounts vary deterministically by week index. Every row
-- carries a DEMO- key and a registry entry, so the clear script and suite
-- 103 cover it with no changes. All inserts are idempotent
-- (ON CONFLICT on idempotency_key / (session, category, sex) / id).
-- ---------------------------------------------------------------------------
WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
sess AS (
  INSERT INTO attendance_sessions (id, branch, zone, session_date, session_type,
    session_name, headcount_total, headcount_adults, headcount_youth,
    headcount_children, headcount_visitors, idempotency_key, recorded_by)
  SELECT ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
    w.d, 'sunday_service', 'DEMO Sunday Service ' || w.d::text,
    95 + ((w.i * 7) % 23) + 28 + ((w.i * 5) % 11) + 24 + ((w.i * 3) % 9)
      + 8 + (w.i % 7) + 6,
    95 + ((w.i * 7) % 23), 28 + ((w.i * 5) % 11), 24 + ((w.i * 3) % 9),
    8 + (w.i % 7),
    'DEMO-SESS-' || to_char(w.d, 'YYYY-MM-DD'),
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, idempotency_key
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_sessions', idempotency_key, id FROM sess
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
cats (cat, base, mult, mod) AS (
  VALUES ('adults', 95, 7, 23), ('youth', 28, 5, 11), ('children', 24, 3, 9),
         ('visitors', 8, 1, 7), ('teachers', 6, 0, 1)
),
ins AS (
  INSERT INTO attendance_counts (session, category, sex, count, created_by)
  SELECT ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    c.cat, 'unspecified', c.base + ((w.i * c.mult) % c.mod),
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w CROSS JOIN cats c
  ON CONFLICT (session, category, sex) DO NOTHING
  RETURNING id, session, category
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_counts',
  'DEMO-COUNT-' || to_char(s.session_date, 'YYYYMMDD') || '-' || upper(ins.category),
  ins.id
  FROM ins JOIN attendance_sessions s ON s.id = ins.session
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- 6c. Year-attendance records, plain form (AFC-1083 follow-up fix).
--
-- The people4-CTE form of this insert selected zero rows in some
-- environments; four explicit per-person inserts are review-obvious and
-- behave identically. Same weeks, same skip rules, same UUID blocks
-- (8211-8214), same registry keys as the CTE form would have produced.
-- Emmanuel 48, Sarah 39, Tunde 34, Chidi 31 (joined Feb 2026).
-- ---------------------------------------------------------------------------
WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
ins AS (
  INSERT INTO attendance_records (id, session, person, attendee_name,
    attendance_category, recorded_by)
  SELECT ('11111111-1111-4111-8211-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    '11111111-1111-4111-8111-000000000101', 'Emmanuel Adeyemi', 'member',
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w WHERE (w.i % 13) <> 5
  ON CONFLICT (id) DO NOTHING
  RETURNING id, attendee_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_records',
  'DEMO-ATTEND-EMMANUEL-' || to_char(DATE '2025-11-02'
    + (((('x' || right(ins.id::text, 12))::bit(64)::bigint) * 7)::int), 'YYYYMMDD'),
  ins.id
  FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
ins AS (
  INSERT INTO attendance_records (id, session, person, attendee_name,
    attendance_category, recorded_by)
  SELECT ('11111111-1111-4111-8212-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    '11111111-1111-4111-8111-000000000102', 'Sarah Adeyemi', 'member',
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w WHERE (w.i % 4) <> 2
  ON CONFLICT (id) DO NOTHING
  RETURNING id, attendee_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_records',
  'DEMO-ATTEND-SARAH-' || to_char(DATE '2025-11-02'
    + (((('x' || right(ins.id::text, 12))::bit(64)::bigint) * 7)::int), 'YYYYMMDD'),
  ins.id
  FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
ins AS (
  INSERT INTO attendance_records (id, session, person, attendee_name,
    attendance_category, recorded_by)
  SELECT ('11111111-1111-4111-8213-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    '11111111-1111-4111-8111-000000000103', 'Tunde Adeyemi', 'member',
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w WHERE (w.i % 3) <> 0
  ON CONFLICT (id) DO NOTHING
  RETURNING id, attendee_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_records',
  'DEMO-ATTEND-TUNDE-' || to_char(DATE '2025-11-02'
    + (((('x' || right(ins.id::text, 12))::bit(64)::bigint) * 7)::int), 'YYYYMMDD'),
  ins.id
  FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH weeks AS (
  SELECT i, (DATE '2025-11-02' + (i * 7))::date AS d
    FROM generate_series(0, 51) AS i
),
ins AS (
  INSERT INTO attendance_records (id, session, person, attendee_name,
    attendance_category, recorded_by)
  SELECT ('11111111-1111-4111-8214-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    ('11111111-1111-4111-8201-' || lpad(to_hex(w.i), 12, '0'))::uuid,
    '11111111-1111-4111-8111-000000000104', 'Chidi Okafor', 'member',
    '11111111-1111-4111-8111-000000000101'
    FROM weeks w WHERE w.i >= 13 AND (w.i % 5) <> 3
  ON CONFLICT (id) DO NOTHING
  RETURNING id, attendee_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'attendance_records',
  'DEMO-ATTEND-CHIDI-' || to_char(DATE '2025-11-02'
    + (((('x' || right(ins.id::text, 12))::bit(64)::bigint) * 7)::int), 'YYYYMMDD'),
  ins.id
  FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;


-- 7. Events: Lagos North Revival + Youth Celebration Night. Slug is the
--    idempotency key; registrations carry ticket + group codes.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO events (id, title, slug, summary, event_type, branch, start_at, end_at,
    location, capacity, waitlist_enabled, registration_open, status, invite_eligible,
    created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000601', 'Lagos North Revival', 'DEMO-lagos-north-revival',
      'Three evenings of revival at Oke-Aro with the Adeyemi, Okafor and Eze families.',
      'service', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      TIMESTAMPTZ '2026-09-18 18:00:00+01', TIMESTAMPTZ '2026-09-20 21:00:00+01',
      'Oke-Aro Main Auditorium', 500, true, true, 'published', true,
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000602', 'Youth Celebration Night', 'DEMO-youth-celebration-night',
      'An evening for the youth fellowship led by Emeka Eze, with Tunde Adeyemi attending.',
      'social', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      TIMESTAMPTZ '2026-09-26 17:00:00+01', TIMESTAMPTZ '2026-09-26 20:00:00+01',
      'Oke-Aro Youth Hall', 150, false, true, 'published', true,
      '11111111-1111-4111-8111-000000000106')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'events', upper(slug), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_registrations (id, event, person, registrant_first_name, registrant_last_name,
    phone, age_group, branch, guardian_name, guardian_phone, guardian_consent,
    ticket_code, group_code, registration_status, source)
  VALUES
    ('11111111-1111-4111-8111-000000000603', '11111111-1111-4111-8111-000000000602',
      '11111111-1111-4111-8111-000000000103', 'Tunde', 'Adeyemi',
      '+2348030000103', 'youth', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Sarah Adeyemi', '+2348030000102', true,
      'DEMO-TIX-YCN-001', 'DEMO-GRP-YCN-A', 'confirmed', 'staff'),
    ('11111111-1111-4111-8111-000000000604', '11111111-1111-4111-8111-000000000601',
      '11111111-1111-4111-8111-000000000105', 'Ngozi', 'Okafor',
      '+2348030000105', 'adult', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      NULL, NULL, NULL,
      'DEMO-TIX-REV-001', 'DEMO-GRP-REV-A', 'confirmed', 'staff'),
    ('11111111-1111-4111-8111-000000000605', '11111111-1111-4111-8111-000000000601',
      '11111111-1111-4111-8111-000000000107', 'Grace', 'Adeyemi',
      '+2348030000107', 'youth', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      NULL, NULL, NULL,
      'DEMO-TIX-REV-002', 'DEMO-GRP-REV-A', 'attended', 'staff')
  ON CONFLICT (ticket_code) DO NOTHING
  RETURNING id, ticket_code
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_registrations', ticket_code, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_invites (id, event, branch, zone, inviter_person, inviter_user,
    invitee_name, invitee_phone, invitee_contact_hash, invitee_relationship,
    invitee_age_band, guardian_phone, channel_choice, status)
  VALUES
    ('11111111-1111-4111-8111-000000000606', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000101', '11111111-1111-4111-8111-000000000600',
      'Femi Bakare', '+2348012345678', 'DEMO-HASH-FEMI-01', 'friend', 'adult', NULL, 'auto', 'sent'),
    ('11111111-1111-4111-8111-000000000607', '11111111-1111-4111-8111-000000000602',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000106', '11111111-1111-4111-8111-000000000600',
      'Adaeze Eze', '+2348090000106', 'DEMO-HASH-ADAEZE-01', 'family', 'teen',
      '+2348030000106', 'sms', 'queued')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, invitee_contact_hash
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_invites', invitee_contact_hash, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no)
  VALUES
    ('11111111-1111-4111-8111-000000000600', 'week', DATE '2026-09-14', 0),
    ('11111111-1111-4111-8111-000000000600', 'week', DATE '2026-09-14', 1)
  ON CONFLICT (inviter_user, period, period_start, slot_no) DO NOTHING
  RETURNING id, slot_no
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'invite_quota_slots', 'DEMO-QUOTA-W38-' || slot_no::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Campaigns: Revival follow-up drip with audience, step, enrollments.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO campaigns (id, key, name, purpose, campaign_type, branch, zone, status)
  VALUES
    ('11111111-1111-4111-8111-000000000701', 'DEMO-revival-followup',
      'Lagos North Revival Follow-up', 'invitation', 'drip',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'active')
  ON CONFLICT (key) DO NOTHING
  RETURNING id, key
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campaigns', upper(key), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO campaign_audiences (id, name, audience_type, event, filter)
  VALUES
    ('11111111-1111-4111-8111-000000000702', 'DEMO Revival registrants', 'event_registrants',
      '11111111-1111-4111-8111-000000000601', '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campaign_audiences', 'DEMO-AUDIENCE-REVIVAL', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO campaign_steps (id, campaign, sequence, name, delay_type, channel, audience, is_entry_step, active)
  VALUES
    ('11111111-1111-4111-8111-000000000703', '11111111-1111-4111-8111-000000000701',
      1, 'Welcome message', 'immediate',
      (SELECT id FROM communication_channels WHERE key = 'whatsapp'),
      '11111111-1111-4111-8111-000000000702', true, true)
  ON CONFLICT (campaign, sequence) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campaign_steps', 'DEMO-STEP-REVIVAL-1', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO campaign_enrollments (id, campaign, person, current_step, idempotency_key)
  VALUES
    ('11111111-1111-4111-8111-000000000704', '11111111-1111-4111-8111-000000000701',
      '11111111-1111-4111-8111-000000000101', '11111111-1111-4111-8111-000000000703',
      'DEMO-ENR-EMMANUEL-01'),
    ('11111111-1111-4111-8111-000000000705', '11111111-1111-4111-8111-000000000701',
      '11111111-1111-4111-8111-000000000107', '11111111-1111-4111-8111-000000000703',
      'DEMO-ENR-GRACE-01')
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, idempotency_key
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campaign_enrollments', idempotency_key, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Youth + celebrations: Tunde's profile and birthday, the Adeyemi
--    anniversary; Emmanuel's salvation milestone.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO youth_profiles (id, person, education_level, institution, employment_status,
    branch, zone, status)
  VALUES
    ('11111111-1111-4111-8111-000000000801', '11111111-1111-4111-8111-000000000103',
      'undergraduate', 'University of Lagos', 'student',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'active')
  ON CONFLICT (person) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'youth_profiles', 'DEMO-YOUTH-TUNDE', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO celebrations (id, person, type, event_date, is_recurring, title, message,
    visibility, branch, zone, status, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000802', '11111111-1111-4111-8111-000000000103',
      'birthday', DATE '2026-09-12', true, 'Tunde at 19', 'Happy birthday Tunde!',
      'branch', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'approved',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000803', '11111111-1111-4111-8111-000000000102',
      'wedding_anniversary', DATE '2026-10-04', true, 'Adeyemi anniversary',
      'Emmanuel and Sarah mark another year.',
      'branch', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'approved',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, type, person
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'celebrations', 'DEMO-CELEB-' || upper(type) || '-' || person::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO person_milestones (id, person, milestone_type, milestone_year, branch, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000804', '11111111-1111-4111-8111-000000000101',
      'saved', 2005, (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'person_milestones', 'DEMO-MILESTONE-EMMANUEL-SAVED', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO campus_students (id, person, institution, course, level, admission_year,
    branch, zone, status)
  VALUES
    ('11111111-1111-4111-8111-000000000F01', '11111111-1111-4111-8111-000000000103',
      'c0a00001-0001-4001-8001-000000000001', 'Computer Science', 'freshman', 2025,
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'), 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campus_students', 'DEMO-CAMPUS-TUNDE-UNILAG', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 10. Blessings with actor stamps: salvation count at the 2026-08-30
--     service, recorded by Emmanuel; Tunde and Ngozi named as recipients.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO blessings (id, blessing_type, male_count, female_count, branch, zone,
    sunday_service, service_date, recorded_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000901', 'salvation', 3, 2,
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000501', DATE '2026-08-30',
      '11111111-1111-4111-8111-000000000101', 'DEMO salvations at the August service.')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'blessings', 'DEMO-BLESSING-2026-08-30', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO blessing_recipients (id, blessing, blessing_type, person, branch, zone,
    sunday_service, service_date, recorded_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000902', '11111111-1111-4111-8111-000000000901',
      'salvation', '11111111-1111-4111-8111-000000000103',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000501', DATE '2026-08-30',
      '11111111-1111-4111-8111-000000000101', 'DEMO recipient Tunde Adeyemi.'),
    ('11111111-1111-4111-8111-000000000903', '11111111-1111-4111-8111-000000000901',
      'salvation', '11111111-1111-4111-8111-000000000105',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000501', DATE '2026-08-30',
      '11111111-1111-4111-8111-000000000101', 'DEMO recipient Ngozi Okafor.')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, person
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'blessing_recipients', 'DEMO-BLESSREC-' || person::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Welfare: Chidi's medical case (INSERT only -- the case events below
--     are appended, never updated), with Sarah's contribution.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO welfare_cases (id, case_ref, person, branch, category, title, description,
    status, priority, confidentiality, amount_requested)
  VALUES
    ('11111111-1111-4111-8111-000000000A01', 'DEMO-WEL-001',
      '11111111-1111-4111-8111-000000000104',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'medical', 'Surgery support for Chidi Okafor',
      'DEMO medical case linking the Okafor household to welfare.', 'open', 'high',
      'branch', 150000)
  ON CONFLICT (case_ref) DO NOTHING
  RETURNING id, case_ref
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'welfare_cases', case_ref, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO welfare_case_events (id, "case", event_type, detail, body, actor_user)
  VALUES
    ('11111111-1111-4111-8111-000000000A02', '11111111-1111-4111-8111-000000000A01',
      'created', 'DEMO case opened by Emmanuel Adeyemi.',
      'Intake recorded at Oke-Aro; documents pending.',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000A03', '11111111-1111-4111-8111-000000000A01',
      'note', 'DEMO note: hospital estimate received.',
      'Estimate attached to the case file by Sarah Adeyemi.',
      '11111111-1111-4111-8111-000000000102')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, event_type
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'welfare_case_events', 'DEMO-WELEVENT-' || upper(event_type) || '-01', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO welfare_contributions (id, "case", contribution_type, description, amount,
    currency, contributed_by_person, contribution_date, status)
  VALUES
    ('11111111-1111-4111-8111-000000000A04', '11111111-1111-4111-8111-000000000A01',
      'cash', 'DEMO contribution from Sarah Adeyemi.', 50000, 'NGN',
      '11111111-1111-4111-8111-000000000102', DATE '2026-09-02', 'approved')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'welfare_contributions', 'DEMO-WELCONTRIB-001', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. Office: August workers meeting minutes with Emmanuel + Sarah present.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO office_minutes (id, title, meeting_date, body, status, branch, zone, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000B01', 'DEMO August Workers Meeting',
      DATE '2026-08-28', 'DEMO minutes: Revival planning, welfare update, youth night rota.',
      'final', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'office_minutes', 'DEMO-MINUTES-2026-08', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO minutes_attendees (id, minute, person)
  VALUES
    ('11111111-1111-4111-8111-000000000B02', '11111111-1111-4111-8111-000000000B01', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000B03', '11111111-1111-4111-8111-000000000B01', '11111111-1111-4111-8111-000000000102')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, person
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'minutes_attendees', 'DEMO-ATTENDEE-' || person::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 13. Finance: Oke-Aro September record (submitted by Emmanuel) + the WECA
--     return row pending computation. No hand-set computed lines.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO branch_financial_records (id, branch, month, income, intervention, faith_city,
    status, submitted_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000C01', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-09-01', 850000, 50000, 20000, 'submitted',
      '11111111-1111-4111-8111-000000000101', 'DEMO September record for Oke-Aro.')
  ON CONFLICT (branch, month) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'branch_financial_records', 'DEMO-FIN-2026-09', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO weca_returns (id, branch, financial_record, period, computation_status, generated_by)
  VALUES
    ('11111111-1111-4111-8111-000000000C02', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000C01', '2026-09', 'formula_pending',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (branch, period) DO NOTHING
  RETURNING id, period
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'weca_returns', 'DEMO-WECA-' || period, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 14. Prior year: a committed 2024 attendance import with two items.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO prior_year_imports (id, domain, data_year, filename, received_rows,
    imported_rows, skipped_rows, imported_by, status)
  VALUES
    ('11111111-1111-4111-8111-000000000D01', 'attendance', 2024,
      'DEMO-2024-attendance.csv', 120, 118, 2,
      '11111111-1111-4111-8111-000000000101', 'committed')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'prior_year_imports', 'DEMO-PY-2024-ATT', id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO prior_year_import_items (id, import, domain, data_year, row_number,
    natural_key, branch, zone, target_collection, status, error)
  VALUES
    ('11111111-1111-4111-8111-000000000D02', '11111111-1111-4111-8111-000000000D01',
      'attendance', 2024, 1, 'DEMO-PY-2024-ATT-001',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      'attendance_counts', 'imported', NULL),
    ('11111111-1111-4111-8111-000000000D03', '11111111-1111-4111-8111-000000000D01',
      'attendance', 2024, 2, 'DEMO-PY-2024-ATT-002',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      (SELECT id FROM zones WHERE code = 'LAG-NORTH-Z1'),
      'attendance_counts', 'skipped', 'DEMO duplicate of row 1.')
  ON CONFLICT (import, natural_key) DO NOTHING
  RETURNING id, natural_key
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'prior_year_import_items', natural_key, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 15. Consent: Emmanuel (WhatsApp invite consent) + Sarah (SMS channel).
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO consent_records (id, person, channel, granted, consent_type, basis, method)
  VALUES
    ('11111111-1111-4111-8111-000000000E01', '11111111-1111-4111-8111-000000000101',
      'whatsapp', true, 'marketing_invite', 'explicit_opt_in', 'digital'),
    ('11111111-1111-4111-8111-000000000E02', '11111111-1111-4111-8111-000000000102',
      'sms', true, 'channel', 'explicit_opt_in', 'digital')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, person, channel
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'consent_records', 'DEMO-CONSENT-' || person::text || '-' || channel, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;
-- 17. Person + family top-up (AFC-1083 follow-up): four more members in the
-- existing households, department links, milestones, one previous branch.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO people (id, first_name, last_name, branch, date_of_birth,
    marital_status, household_role, person_type, status)
  VALUES
    ('11111111-1111-4111-8111-000000000108', 'Folake', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2018-05-06',
      'single', 'child', 'member', 'active'),
    ('11111111-1111-4111-8111-000000000109', 'Segun', 'Adeyemi',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1995-09-19',
      'single', 'relative', 'member', 'active'),
    ('11111111-1111-4111-8111-000000000110', 'Dayo', 'Okafor',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2015-01-23',
      'single', 'child', 'member', 'active'),
    ('11111111-1111-4111-8111-000000000111', 'Adaeze', 'Eze',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '1984-06-30',
      'married', 'spouse', 'member', 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id, first_name, last_name
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'people', 'DEMO-PERSON-' || upper(last_name) || '-' || upper(first_name), id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO people_departments (id, people, departments, role, joined_at, status)
  VALUES
    ('11111111-1111-4111-8111-000000000371', '11111111-1111-4111-8111-000000000108',
      (SELECT id FROM departments WHERE code = 'DEMO-YOUTH'), 'member', DATE '2026-03-01', 'active'),
    ('11111111-1111-4111-8111-000000000372', '11111111-1111-4111-8111-000000000110',
      (SELECT id FROM departments WHERE code = 'DEMO-YOUTH'), 'member', DATE '2026-03-01', 'active'),
    ('11111111-1111-4111-8111-000000000373', '11111111-1111-4111-8111-000000000111',
      (SELECT id FROM departments WHERE code = 'DEMO-CHOIR'), 'member', DATE '2026-04-06', 'active'),
    ('11111111-1111-4111-8111-000000000374', '11111111-1111-4111-8111-000000000109',
      (SELECT id FROM departments WHERE code = 'DEMO-USHERY'), 'member', DATE '2026-04-06', 'active'),
    ('11111111-1111-4111-8111-000000000375', '11111111-1111-4111-8111-000000000102',
      (SELECT id FROM departments WHERE code = 'DEMO-CHOIR'), 'assistant', DATE '2026-01-11', 'active'),
    ('11111111-1111-4111-8111-000000000376', '11111111-1111-4111-8111-000000000103',
      (SELECT id FROM departments WHERE code = 'DEMO-YOUTH'), 'member', DATE '2026-02-02', 'active')
  ON CONFLICT (people, departments) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'people_departments', 'DEMO-PDEPT-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO person_milestones (id, person, milestone_type, milestone_date,
    branch, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000377', '11111111-1111-4111-8111-000000000101',
      'saved', DATE '2010-04-11', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000378', '11111111-1111-4111-8111-000000000101',
      'sanctified', DATE '2012-06-03', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000379', '11111111-1111-4111-8111-000000000101',
      'water_baptism', DATE '2011-02-20', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000380', '11111111-1111-4111-8111-000000000102',
      'saved', DATE '2012-09-15', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000381', '11111111-1111-4111-8111-000000000103',
      'saved', DATE '2020-12-25', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'person_milestones', 'DEMO-MILESTONE-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO person_previous_branches (id, person, branch_name, role, from_year, to_year)
  VALUES
    ('11111111-1111-4111-8111-000000000382', '11111111-1111-4111-8111-000000000101',
      'Agege', 'member', 2005, 2015)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'person_previous_branches', 'DEMO-PREVBRANCH-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 18. Marriage (AFC-1083 follow-up): two cases, two matters, audit events,
-- forms, matter events. All linked to demo people; no real couples touched.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO marriage_cases (id, brother_person, sister_person, branch,
    stage, wedding_date, rehearsal_date, engagement_date, vow_type,
    wedding_info_verified, terms_signed, officiating_minister,
    bible_passage, certificate_type, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000383', '11111111-1111-4111-8111-000000000106',
      '11111111-1111-4111-8111-000000000105',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'counselling_prayer', DATE '2027-03-20', DATE '2027-03-15', DATE '2026-12-20',
      'Holy matrimony (church + registry)', true, true,
      '11111111-1111-4111-8111-000000000101', 'Genesis 2:24', 'church',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000384', '11111111-1111-4111-8111-000000000104',
      '11111111-1111-4111-8111-000000000111',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'introduction', NULL, NULL, NULL,
      'To be agreed at counselling', false, false, NULL, NULL, NULL,
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'marriage_cases', 'DEMO-MCASE-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO marriage_matters (id, person, partner_person, branch,
    matter_type, wedding_date, status, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000385', '11111111-1111-4111-8111-000000000106',
      '11111111-1111-4111-8111-000000000105',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'wedding', DATE '2027-03-20', 'in_progress',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000386', '11111111-1111-4111-8111-000000000104',
      '11111111-1111-4111-8111-000000000111',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'counselling', NULL, 'open',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'marriage_matters', 'DEMO-MMATTER-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO marriage_case_events (id, marriage_case, from_stage, to_stage,
    event_type, detail, actor_user)
  VALUES
    ('11111111-1111-4111-8111-000000000387', '11111111-1111-4111-8111-000000000383',
      'introduction', 'counselling_prayer', 'note', 'DEMO: case opened at introduction',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000388', '11111111-1111-4111-8111-000000000383',
      'counselling_prayer', NULL, 'note', 'DEMO: counselling sessions booked for January',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000389', '11111111-1111-4111-8111-000000000384',
      NULL, 'introduction', 'created', 'DEMO: case opened at introduction',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000390', '11111111-1111-4111-8111-000000000384',
      'introduction', NULL, 'note', 'DEMO: families introduced, awaiting first sitting',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'marriage_case_events', 'DEMO-MCASEEVT-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO marriage_case_forms (id, marriage_case, form_key, stage, payload, submitted_by)
  VALUES
    ('11111111-1111-4111-8111-000000000391', '11111111-1111-4111-8111-000000000383',
      'premarital_q1', 'counselling_prayer',
      '{"version": 1, "counselling_round": 1}'::jsonb,
      '11111111-1111-4111-8111-000000000106'),
    ('11111111-1111-4111-8111-000000000392', '11111111-1111-4111-8111-000000000384',
      'proposal_male', 'introduction',
      '{"version": 1, "counselling_round": 0}'::jsonb,
      '11111111-1111-4111-8111-000000000104')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'marriage_case_forms', 'DEMO-MFORM-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO marriage_matter_events (id, marriage_matter, event_type, detail, actor_user)
  VALUES
    ('11111111-1111-4111-8111-000000000393', '11111111-1111-4111-8111-000000000385',
      'note', 'DEMO: wedding matter opened, date agreed',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000394', '11111111-1111-4111-8111-000000000386',
      'created', 'DEMO: counselling matter opened',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'marriage_matter_events', 'DEMO-MMEVT-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;
-- ---------------------------------------------------------------------------
-- 19. Funeral cases (AFC-1083 follow-up): one scheduled, one held.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO funeral_cases (id, branch, deceased_name, stage, songs,
    service_of_songs_date, funeral_date, funeral_attendance, notes, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000395',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Pa Josiah Okafor', 'scheduled',
      '["Amazing Grace", "It Is Well With My Soul"]'::jsonb,
      DATE '2026-12-18', DATE '2026-12-20', 150,
      'DEMO: service of songs Thursday, burial Saturday',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000396',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Mama Esther Eze', 'held',
      '["Blessed Assurance"]'::jsonb,
      DATE '2026-09-10', DATE '2026-09-12', 200,
      'DEMO: held service for register continuity',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'funeral_cases', 'DEMO-FUNERAL-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 20. Sunday School classes (AFC-1083 follow-up): children, teens, adults.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO sunday_school_classes (id, class_name, branch, teacher,
    students_count, status)
  VALUES
    ('11111111-1111-4111-8111-000000000397', 'DEMO Children Class',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000102', 18, 'active'),
    ('11111111-1111-4111-8111-000000000398', 'DEMO Teens Class',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000104', 14, 'active'),
    ('11111111-1111-4111-8111-000000000399', 'DEMO Adults Class',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101', 22, 'active')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'sunday_school_classes', 'DEMO-SSCLASS-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 21. Events tabs (AFC-1083 follow-up): resources, speakers, testimonies,
-- feedback, collaborators, budgets, expenses, tasks for the two demo events.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO event_resources (id, event, branch, title, source_type, kind,
    url, status, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000400', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'DEMO Revival programme', 'link', 'pdf',
      'https://example.com/demo-revival-programme.pdf', 'approved',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000401', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'DEMO Revival banner', 'link', 'image',
      'https://example.com/demo-revival-banner.png', 'approved',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000402', '11111111-1111-4111-8111-000000000602',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'DEMO Youth night flyer', 'link', 'document',
      'https://example.com/demo-youth-flyer.pdf', 'approved',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_resources', 'DEMO-EVTRES-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_speakers (id, event, branch, person, external_name,
    status, bio, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000403', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101', NULL, 'confirmed',
      'DEMO: host minister', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000404', '11111111-1111-4111-8111-000000000602',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      NULL, 'Pastor Mrs. Funke Alabi', 'booked',
      'DEMO: guest minister', '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_speakers', 'DEMO-EVTSPK-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_testimonies (id, event, branch, name, message)
  VALUES
    ('11111111-1111-4111-8111-000000000405', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Grace Adeyemi', 'DEMO: healed and restored at the revival night'),
    ('11111111-1111-4111-8111-000000000406', '11111111-1111-4111-8111-000000000602',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Tunde Adeyemi', 'DEMO: rededicated my life at the youth night')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_testimonies', 'DEMO-EVTTST-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_feedback (id, event, branch, name, message, rating)
  VALUES
    ('11111111-1111-4111-8111-000000000407', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Dayo Okafor', 'DEMO: sound was clear, ushering was warm', 5),
    ('11111111-1111-4111-8111-000000000408', '11111111-1111-4111-8111-000000000602',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Folake Adeyemi', 'DEMO: games ran long, word was timely', 4)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_feedback', 'DEMO-EVTFB-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_collaborators (id, event, person, branch, areas, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000409', '11111111-1111-4111-8111-000000000601',
      '11111111-1111-4111-8111-000000000102',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      ARRAY['details', 'schedule'],
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000410', '11111111-1111-4111-8111-000000000602',
      '11111111-1111-4111-8111-000000000103',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      ARRAY['registration'],
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_collaborators', 'DEMO-EVTCOL-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_budgets (id, event, category_key, amount, notes, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000411', '11111111-1111-4111-8111-000000000601',
      'venue', 250000, 'DEMO: main hall setup',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000412', '11111111-1111-4111-8111-000000000601',
      'equipment', 120000, 'DEMO: sound and media',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000413', '11111111-1111-4111-8111-000000000602',
      'publicity', 80000, 'DEMO: flyers and socials',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_budgets', 'DEMO-EVTBUD-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO event_expenses (id, event, branch, category, amount, currency,
    spent_on, notes, recorded_by)
  VALUES
    ('11111111-1111-4111-8111-000000000414', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'venue', 240000, 'NGN', DATE '2026-10-20', 'DEMO: hall balance paid',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000415', '11111111-1111-4111-8111-000000000601',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'equipment', 115000, 'NGN', DATE '2026-10-21', 'DEMO: sound balance paid',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'event_expenses', 'DEMO-EVTEXP-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO tasks (id, title, description, assignee_person, branch,
    status, priority, related_type, related_id, created_by)
  VALUES
    ('11111111-1111-4111-8111-000000000416', 'DEMO: confirm revival venue setup',
      'DEMO: chairs, sound check and usher positions before Friday',
      '11111111-1111-4111-8111-000000000101',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'todo', 'high', 'event', '11111111-1111-4111-8111-000000000601',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000417', 'DEMO: print youth night flyers',
      'DEMO: 200 copies, share across cells',
      '11111111-1111-4111-8111-000000000103',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'in_progress', 'normal', 'event', '11111111-1111-4111-8111-000000000602',
      '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000418', 'DEMO: reconcile revival offering',
      'DEMO: count with two ushers present',
      '11111111-1111-4111-8111-000000000102',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'todo', 'normal', 'event', '11111111-1111-4111-8111-000000000601',
      '11111111-1111-4111-8111-000000000101')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'tasks', 'DEMO-TASK-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 22. AVS centres + demo bible study centres (AFC-1083 follow-up).
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO avs_centres (id, centre_name, branch, address, status, type,
    school_contact_name, school_contact_phone, contact_person, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000419', 'DEMO Oke-Aro Primary Hall',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'DEMO: 12 Church Street, Oke-Aro', 'regular', 'primary',
      'Mrs. Adaeze Eze', '+2348000000001',
      '11111111-1111-4111-8111-000000000111',
      'DEMO: main AVS venue'),
    ('11111111-1111-4111-8111-000000000420', 'DEMO Agege Grammar Hall',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'DEMO: 45 Agege Motor Road', 'paused', 'secondary',
      'Mr. Dayo Okafor', '+2348000000002',
      '11111111-1111-4111-8111-000000000110',
      'DEMO: paused for term break')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'avs_centres', 'DEMO-AVS-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO bible_study_centres (id, name, code, parent_branch, leader,
    location, status, year_founded, average_attendance)
  VALUES
    ('11111111-1111-4111-8111-000000000421', 'DEMO Oke-Aro Evening Centre',
      'DEMO-BSC-01', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000101', 'DEMO: church hall, Wednesdays',
      'active', 2019, 45),
    ('11111111-1111-4111-8111-000000000422', 'DEMO Agege Axis Centre',
      'DEMO-BSC-02', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      '11111111-1111-4111-8111-000000000102', 'DEMO: classroom block, Thursdays',
      'active', 2021, 30)
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'bible_study_centres', 'DEMO-BSC-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 23. Finance top-up (AFC-1083 follow-up): monthly branch records,
-- blessings with recipients + events, welfare contributions, campus support.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO branch_financial_records (id, branch, month, income, intervention,
    faith_city, currency, status, submitted_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000423', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-03-01', 750000, 50000, 100000, 'NGN', 'confirmed',
      '11111111-1111-4111-8111-000000000101', 'DEMO: March returns'),
    ('11111111-1111-4111-8111-000000000424', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-04-01', 820000, 60000, 100000, 'NGN', 'confirmed',
      '11111111-1111-4111-8111-000000000101', 'DEMO: April returns'),
    ('11111111-1111-4111-8111-000000000425', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-05-01', 780000, 55000, 120000, 'NGN', 'submitted',
      '11111111-1111-4111-8111-000000000101', 'DEMO: May returns'),
    ('11111111-1111-4111-8111-000000000426', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-06-01', 900000, 70000, 120000, 'NGN', 'confirmed',
      '11111111-1111-4111-8111-000000000101', 'DEMO: June returns'),
    ('11111111-1111-4111-8111-000000000427', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-07-01', 880000, 65000, 150000, 'NGN', 'submitted',
      '11111111-1111-4111-8111-000000000101', 'DEMO: July returns'),
    ('11111111-1111-4111-8111-000000000428', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-08-01', 950000, 80000, 150000, 'NGN', 'confirmed',
      '11111111-1111-4111-8111-000000000101', 'DEMO: August returns')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'branch_financial_records', 'DEMO-FIN-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO blessings (id, blessing_type, male_count, female_count,
    count, branch, service_date, recorded_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000429', 'healing', 12, 18, 30,
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-10-18',
      '11111111-1111-4111-8111-000000000101', 'DEMO: healing service')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'blessings', 'DEMO-BLESS-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO blessing_recipients (id, blessing, blessing_type, person,
    branch, service_date, recorded_by, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000430', '11111111-1111-4111-8111-000000000429',
      'healing', '11111111-1111-4111-8111-000000000102',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-10-18',
      '11111111-1111-4111-8111-000000000101', 'DEMO: Sarah prayed for'),
    ('11111111-1111-4111-8111-000000000431', '11111111-1111-4111-8111-000000000429',
      'healing', '11111111-1111-4111-8111-000000000103',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      DATE '2026-10-18',
      '11111111-1111-4111-8111-000000000101', 'DEMO: Tunde prayed for')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'blessing_recipients', 'DEMO-BLESSR-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO blessing_events (id, blessing, event_type, detail, actor_user, branch)
  VALUES
    ('11111111-1111-4111-8111-000000000432', '11111111-1111-4111-8111-000000000429',
      'created', 'DEMO: healing service recorded',
      '11111111-1111-4111-8111-000000000101',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000433', '11111111-1111-4111-8111-000000000429',
      'note', 'DEMO: ushers counted 30 responses',
      '11111111-1111-4111-8111-000000000101',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'))
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'blessing_events', 'DEMO-BLESSEVT-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO welfare_contributions (id, "case", contribution_type, description,
    amount, currency, contributed_by_person, contribution_date, status, branch)
  VALUES
    ('11111111-1111-4111-8111-000000000434', '11111111-1111-4111-8111-000000000a01',
      'cash', 'DEMO: benevolence collection', 150000, 'NGN',
      '11111111-1111-4111-8111-000000000101', DATE '2026-10-11', 'approved',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000435', '11111111-1111-4111-8111-000000000a01',
      'goods', 'DEMO: food items drive', 85000, 'NGN',
      '11111111-1111-4111-8111-000000000102', DATE '2026-10-18', 'approved',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'))
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'welfare_contributions', 'DEMO-WELFCON-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO campus_financial_support (id, student, programme, amount, term,
    source, status, approved_by, support_date, branch)
  VALUES
    ('11111111-1111-4111-8111-000000000436', '11111111-1111-4111-8111-000000000f01',
      NULL, 200000, '2026/2027', 'Church welfare fund — Medicine (UNILAG)', 'approved',
      '11111111-1111-4111-8111-000000000101',
      DATE '2026-09-15',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000437', '11111111-1111-4111-8111-000000000f01',
      NULL, 200000, '2026/2027', 'Church welfare fund — Medicine (UNILAG)', 'disbursed',
      '11111111-1111-4111-8111-000000000101',
      DATE '2026-10-15',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'))
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'campus_financial_support', 'DEMO-CAMPSUP-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 24. Visitor funnel top-up (AFC-1083 follow-up): three more visitors at
-- different journey stages, follow-ups, and transitions.
-- ---------------------------------------------------------------------------
WITH ins AS (
  INSERT INTO visitors (id, branch, visitor_first_name, visitor_last_name,
    phone, visit_date, age_group, invited_by, status, journey_stage,
    journey_started_at, pack_checklist, dropoff_outcome, notes)
  VALUES
    ('11111111-1111-4111-8111-000000000440', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Kemi', 'Bakare', '+2348000000011', DATE '2026-10-26', 'adult',
      '11111111-1111-4111-8111-000000000101', 'follow_up',
      '05bdb064-299e-4091-9c28-8052cac494fd', DATE '2026-10-26', '["literature", "sermon_notes", "gift_bag", "malt", "biscuits", "contact_card"]', 'pending',
      'DEMO: Femi Bakare family member, first visit'),
    ('11111111-1111-4111-8111-000000000441', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Seun', 'Ajayi', '+2348000000012', DATE '2026-10-19', 'youth',
      '11111111-1111-4111-8111-000000000102', 'follow_up',
      '3e653a42-52d2-4f64-bdd4-7e50544e88d6', DATE '2026-10-19', '["literature", "sermon_notes", "gift_bag", "malt", "biscuits", "contact_card"]', 'pending',
      'DEMO: invited by Sarah, pack collected'),
    ('11111111-1111-4111-8111-000000000442', (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      'Funmi', 'Eze', '+2348000000013', DATE '2026-10-12', 'adult',
      '11111111-1111-4111-8111-000000000106', 'follow_up',
      '3c13fb38-48d1-495b-b9bf-b339251d1539', DATE '2026-10-12', '["literature", "sermon_notes", "gift_bag", "malt", "biscuits", "contact_card"]', 'pending',
      'DEMO: Emeka Eze family member, needs dropoff visit')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitors', 'DEMO-VISITOR-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO visitor_follow_ups (id, visitor, branch, contact_at,
    contact_channel, outcome, notes, next_follow_up_at, logged_by)
  VALUES
    ('11111111-1111-4111-8111-000000000443', '11111111-1111-4111-8111-000000000440',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      TIMESTAMPTZ '2026-10-27 10:00:00+00', 'phone', 'reached',
      'DEMO: Kemi welcomed the call, comes again Sunday',
      DATE '2026-11-02', '11111111-1111-4111-8111-000000000101'),
    ('11111111-1111-4111-8111-000000000444', '11111111-1111-4111-8111-000000000441',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      TIMESTAMPTZ '2026-10-20 10:00:00+00', 'phone', 'no_answer',
      'DEMO: Seun missed the call, retry Saturday',
      DATE '2026-10-25', '11111111-1111-4111-8111-000000000102'),
    ('11111111-1111-4111-8111-000000000445', '11111111-1111-4111-8111-000000000442',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'),
      TIMESTAMPTZ '2026-10-13 10:00:00+00', 'phone', 'requested_visit',
      'DEMO: Funmi booked a dropoff visit',
      DATE '2026-10-18', '11111111-1111-4111-8111-000000000106')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitor_follow_ups', 'DEMO-VISITFU-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

WITH ins AS (
  INSERT INTO visitor_journey_transitions (id, visitor, from_stage, to_stage,
    entered_at, logged_by, note, branch)
  VALUES
    ('11111111-1111-4111-8111-000000000446', '11111111-1111-4111-8111-000000000440',
      '3c13fb38-48d1-495b-b9bf-b339251d1539', '3e653a42-52d2-4f64-bdd4-7e50544e88d6',
      TIMESTAMPTZ '2026-10-26 12:00:00+00',
      '11111111-1111-4111-8111-000000000101', 'DEMO: Kemi gave details at the welcome desk',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000447', '11111111-1111-4111-8111-000000000440',
      '3e653a42-52d2-4f64-bdd4-7e50544e88d6', '05bdb064-299e-4091-9c28-8052cac494fd',
      TIMESTAMPTZ '2026-10-26 12:30:00+00',
      '11111111-1111-4111-8111-000000000101', 'DEMO: Kemi collected the welcome pack',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000448', '11111111-1111-4111-8111-000000000441',
      '3c13fb38-48d1-495b-b9bf-b339251d1539', '3e653a42-52d2-4f64-bdd4-7e50544e88d6',
      TIMESTAMPTZ '2026-10-19 12:00:00+00',
      '11111111-1111-4111-8111-000000000102', 'DEMO: Seun moved straight to pack',
      (SELECT id FROM branches WHERE code = 'OKE-ARO')),
    ('11111111-1111-4111-8111-000000000449', '11111111-1111-4111-8111-000000000442',
      NULL, '3c13fb38-48d1-495b-b9bf-b339251d1539',
      TIMESTAMPTZ '2026-10-12 12:00:00+00',
      '11111111-1111-4111-8111-000000000106', 'DEMO: Funmi first touch at identify',
      (SELECT id FROM branches WHERE code = 'OKE-ARO'))
  ON CONFLICT (id) DO NOTHING
  RETURNING id
)
INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
SELECT 'visitor_journey_transitions', 'DEMO-VISITJRNY-' || id::text, id FROM ins
ON CONFLICT (table_name, demo_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 16. Summary. Safe to re-run: conflicts are skipped before this point, so
--     the count below only grows with genuinely planted rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows bigint;
  v_tables bigint;
BEGIN
  SELECT count(*), count(DISTINCT table_name) INTO v_rows, v_tables
    FROM demo_seed_registry WHERE seed_version = 'demo-1';
  RAISE NOTICE 'DEMO_SEED done: % registry rows across % tables (seed_version demo-1).', v_rows, v_tables;
END
$$;
