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
