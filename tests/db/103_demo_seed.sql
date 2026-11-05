-- tests/db/103_demo_seed.sql
--
-- AFC-1086 (parent AFC-1084, ancestor AFC-1083). THE DEMO SEED CONTRACT.
--
-- The linked demo seed (services/directus/seeds/demo/001_demo_seed.sql) and
-- the safe clear-all (002_demo_clear.sql) run through the registry created
-- by migration 20261105_0068. This suite executes the real scripts via \i
-- (so the files stay runnable with psql unchanged) and pins the contract:
--
--   103.1  registry     -- demo_seed_registry + demo_admin_actions exist;
--                           the app role reads/appends both and rewrites
--                           neither (SELECT+INSERT only, no UPDATE/DELETE).
--   103.2  seed         -- first run plants 74 registry rows across 36
--                           tables; Emmanuel Adeyemi is linked across 6+
--                           modules; Grace converts visitor -> person.
--   103.3  idempotent   -- second run plants zero new rows (registry count
--                           and demo people count unchanged).
--   103.4  clear        -- clear-all removes only demo rows: registry
--                           empties, demo people gone, real Lagos North
--                           rows (OKE-ARO, GROUP-1, channels, stages)
--                           intact, audit history surviving.
--   103.5  no-op        -- second clear removes zero rows, still refuses
--                           nothing, real rows still intact.
--   103.6  excluded     -- sealed/retention/OTP tables never named by the
--                           registry and hold no DEMO- rows; the clear
--                           script refuses a tampered registry (live 22023/
--                           restrict_violation probe on a scratch entry).
--   103.7  rerun        -- re-applying the 0068 migration changes nothing;
--                           re-seeding after a full clear re-plants cleanly.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- super-admin gating, the DELETE DEMO DATA confirmation phrase, per-table
-- API counts -- lives in the route layer beside the super-admin impersonate
-- paths. No retention probe: demo rows carry no retention clock; erasure of
-- real data runs as retention_worker.

-- ---------------------------------------------------------------------------
-- 103.1  REGISTRY SHAPE + APPEND-ONLY GRANTS.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(test_support.table_exists('demo_seed_registry'),
    'seed', 'demo_seed_registry exists', 'migration 0068 must be applied first');
  PERFORM test_support.assert_true(test_support.table_exists('demo_admin_actions'),
    'seed', 'demo_admin_actions exists', 'migration 0068 must be applied first');

  PERFORM test_support.assert_true(test_support.can_select('directus_app', 'demo_seed_registry'),
    'seed', 'app role reads the registry', 'portal UI shows what was seeded');
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'demo_seed_registry',
      ARRAY['table_name', 'demo_key', 'row_id', 'seed_version']),
    'seed', 'app role appends registry rows', 'column ceiling, never table-wide');
  PERFORM test_support.assert_true(NOT test_support.can_update('directus_app', 'demo_seed_registry'),
    'seed', 'app role cannot UPDATE the registry', 'address book is never rewritten');
  PERFORM test_support.assert_true(NOT test_support.can_delete('directus_app', 'demo_seed_registry'),
    'seed', 'app role cannot DELETE the registry', 'clearing runs as migrator, never the API role');

  PERFORM test_support.assert_true(test_support.can_select('directus_app', 'demo_admin_actions'),
    'seed', 'app role reads the audit log', NULL);
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'demo_admin_actions',
      ARRAY['action', 'actor_user', 'detail']),
    'seed', 'app role appends audit rows', 'API writes action + actor + counts');
  PERFORM test_support.assert_true(NOT test_support.can_update('directus_app', 'demo_admin_actions'),
    'seed', 'app role cannot UPDATE audit rows', 'history is never rewritten');
  PERFORM test_support.assert_true(NOT test_support.can_delete('directus_app', 'demo_admin_actions'),
    'seed', 'app role cannot DELETE audit rows', 'clearing never wipes the audit trail');

  PERFORM test_support.assert_true(NOT test_support.can_delete('directus_app', 'people'),
    'seed', 'app role cannot DELETE people', 'clearing demo people needs the migrator');
  PERFORM test_support.assert_true(NOT test_support.can_delete('directus_app', 'welfare_cases'),
    'seed', 'app role cannot DELETE welfare cases', 'clearing needs the migrator');
  PERFORM test_support.assert_true(NOT test_support.can_update('directus_app', 'welfare_case_events'),
    'seed', 'welfare events stay append-only for the app', 'corrections are new rows, even in demo');
END
$$;

-- ---------------------------------------------------------------------------
-- Ownership restore (harness-only scaffolding, no production effect).
--
-- Down/up cycles in earlier suites (e.g. 85.7 on 0020) drop and re-apply
-- migrations as the harness session role, so shared tables arrive here
-- owned by postgres. On staging the migration sequence runs as
-- directus_migrator in one session and the migrator owns everything. The
-- seed and clear scripts are migrator-owned (the people delete guard,
-- AFC-295, refuses any other identity), so restore staging ownership
-- before running them. This suite is the last numeric suite, so the
-- restore affects nothing downstream.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'people', 'households', 'departments', 'people_departments',
    'visitors', 'visitor_follow_ups', 'visitor_journey_transitions',
    'sunday_services', 'service_assignments',
    'attendance_sessions', 'attendance_counts', 'attendance_records',
    'events', 'event_registrations', 'event_invites', 'invite_quota_slots',
    'campaigns', 'campaign_audiences', 'campaign_steps', 'campaign_enrollments',
    'youth_profiles', 'celebrations', 'person_milestones', 'campus_students',
    'blessings', 'blessing_recipients',
    'welfare_cases', 'welfare_case_events', 'welfare_contributions',
    'office_minutes', 'minutes_attendees',
    'branch_financial_records', 'weca_returns',
    'prior_year_imports', 'prior_year_import_items',
    'consent_records',
    'demo_seed_registry', 'demo_admin_actions']
  LOOP
    EXECUTE format('ALTER TABLE %I OWNER TO directus_migrator', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 103.2  SEED. First run plants the full linked graph.
--
-- The seed and clear scripts are migrator-owned: they run as
-- directus_migrator (the retention delete guard on people refuses any
-- other identity, AFC-295). Session-level SET ROLE / RESET ROLE follows
-- the suite-21 precedent; RESET ROLE closes this file.
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;

\i services/directus/seeds/demo/001_demo_seed.sql

DO $$
DECLARE
  v_reg bigint;
  v_tables bigint;
  v_emmanuel uuid := '11111111-1111-4111-8111-000000000101';
  v_modules bigint;
BEGIN
  SELECT count(*), count(DISTINCT table_name) INTO v_reg, v_tables
    FROM demo_seed_registry WHERE seed_version = 'demo-1';
  PERFORM test_support.assert_equals(v_reg::text, '74', 'seed',
    'first run plants 74 registry rows (got ' || v_reg::text || ')');
  PERFORM test_support.assert_equals(v_tables::text, '36', 'seed',
    'first run spans 36 tables (got ' || v_tables::text || ')');

  -- Emmanuel Adeyemi linked across 6+ modules.
  SELECT count(*) INTO v_modules FROM (
    SELECT 1 FROM people WHERE id = v_emmanuel AND household IS NOT NULL
    UNION ALL SELECT 1 FROM people_departments WHERE people = v_emmanuel
    UNION ALL SELECT 1 FROM sunday_services WHERE preacher = v_emmanuel
    UNION ALL SELECT 1 FROM event_invites WHERE inviter_person = v_emmanuel
    UNION ALL SELECT 1 FROM blessings WHERE recorded_by = v_emmanuel
    UNION ALL SELECT 1 FROM campaign_enrollments WHERE person = v_emmanuel
    UNION ALL SELECT 1 FROM branch_financial_records WHERE submitted_by = v_emmanuel
    UNION ALL SELECT 1 FROM office_minutes WHERE created_by = v_emmanuel
    UNION ALL SELECT 1 FROM welfare_case_events WHERE actor_user = v_emmanuel
  ) m;
  PERFORM test_support.assert_true(v_modules >= 6, 'seed',
    'Emmanuel linked across 6+ modules', 'got ' || v_modules::text);

  -- Grace converts: visitor row points at her person row.
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM visitors v JOIN people p ON p.id = v.person
    WHERE v.id = '11111111-1111-4111-8111-000000000401'
      AND p.first_name = 'Grace' AND p.last_name = 'Adeyemi'),
    'seed', 'Grace converts visitor -> person', NULL);

  -- Anchor events carry DEMO- slugs; revival has two group-coded registrants.
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM events WHERE slug = 'DEMO-lagos-north-revival' AND status = 'published'),
    'seed', 'Lagos North Revival planted', NULL);
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM events WHERE slug = 'DEMO-youth-celebration-night' AND status = 'published'),
    'seed', 'Youth Celebration Night planted', NULL);
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM event_registrations WHERE group_code = 'DEMO-GRP-REV-A'), '2', 'seed',
    'revival group code links two registrants [NULL]');

  -- Tunde: youth profile + birthday + youth-night registration + UNILAG row.
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM youth_profiles WHERE person = '11111111-1111-4111-8111-000000000103'),
    'seed', 'Tunde has a youth profile', NULL);
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM celebrations WHERE person = '11111111-1111-4111-8111-000000000103'
      AND type = 'birthday'),
    'seed', 'Tunde has a birthday celebration', NULL);
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM campus_students WHERE person = '11111111-1111-4111-8111-000000000103'),
    'seed', 'Tunde has a campus row', NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 103.3  IDEMPOTENCY. Second run plants nothing new.
-- ---------------------------------------------------------------------------
\i services/directus/seeds/demo/001_demo_seed.sql

DO $$
DECLARE
  v_reg bigint;
  v_people bigint;
BEGIN
  SELECT count(*) INTO v_reg FROM demo_seed_registry WHERE seed_version = 'demo-1';
  PERFORM test_support.assert_equals(v_reg::text, '74', 'seed',
    'second run plants zero new registry rows (got ' || v_reg::text || ')');

  SELECT count(*) INTO v_people FROM people
    WHERE id IN ('11111111-1111-4111-8111-000000000101',
                 '11111111-1111-4111-8111-000000000102',
                 '11111111-1111-4111-8111-000000000103',
                 '11111111-1111-4111-8111-000000000104',
                 '11111111-1111-4111-8111-000000000105',
                 '11111111-1111-4111-8111-000000000106',
                 '11111111-1111-4111-8111-000000000107');
  PERFORM test_support.assert_equals(v_people::text, '7', 'seed',
    'second run plants zero duplicate people (got ' || v_people::text || ')');
END
$$;

DO $$
BEGIN
  PERFORM test_support.assert_true(current_user = 'directus_migrator', 'seed',
    'clear runs as the migrator (AFC-295), got ' || current_user, NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 103.4  CLEAR. Only demo rows go; real Lagos North rows stay.
-- ---------------------------------------------------------------------------
\i services/directus/seeds/demo/002_demo_clear.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM demo_seed_registry), '0', 'seed',
    'clear empties the registry [NULL]');

  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM people WHERE id BETWEEN
      '11111111-1111-4111-8111-000000000101' AND '11111111-1111-4111-8111-000000000F01'),
    'seed', 'demo people are gone', NULL);
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM events WHERE slug LIKE 'DEMO-%'),
    'seed', 'demo events are gone', NULL);
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM welfare_cases WHERE case_ref LIKE 'DEMO-%'),
    'seed', 'demo welfare cases are gone', NULL);
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM campaigns WHERE key LIKE 'DEMO-%'),
    'seed', 'demo campaigns are gone', NULL);
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM departments WHERE code LIKE 'DEMO-%'),
    'seed', 'demo departments are gone', NULL);
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM visitors WHERE id IN
      ('11111111-1111-4111-8111-000000000401', '11111111-1111-4111-8111-000000000402')),
    'seed', 'demo visitors are gone', NULL);

  -- Real registers untouched.
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM branches WHERE code = 'OKE-ARO'),
    'seed', 'Oke-Aro branch survives the clear', 'clear must not touch real geo');
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM departments WHERE code = 'LAG-NORTH-GROUP-1'),
    'seed', 'area Group 1 survives the clear', 'only the junction row goes, never the group');
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM communication_channels WHERE key = 'whatsapp'),
    'seed', 'channels survive the clear', NULL);
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM visitor_journey_stages WHERE key = 'welcome'),
    'seed', 'journey stages survive the clear', NULL);
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM weca_return_formulas WHERE version = 'weca-2026-01'),
    'seed', 'weca formula survives the clear', NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 103.5  NO-OP. Second clear removes nothing and refuses nothing.
-- ---------------------------------------------------------------------------
\i services/directus/seeds/demo/002_demo_clear.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM demo_seed_registry), '0', 'seed',
    'second clear is a no-op [NULL]');
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM branches WHERE code = 'OKE-ARO'),
    'seed', 'Oke-Aro still standing after second clear', NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 103.6  EXCLUDED REGISTERS. Sealed, retention and OTP tables are never
--         named by the seed, and the clear script refuses a tampered
--         registry instead of touching them.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM demo_seed_registry WHERE table_name IN
      ('incidents', 'legal_holds', 'retention_runs', 'retention_run_items',
       'retention_clocks', 'retention_policies',
       'member_otp_codes', 'member_sessions')),
    'seed', 'registry never names a sealed table', 'seed writes none of them');

  PERFORM test_support.assert_equals((SELECT count(*)::text FROM incidents WHERE ref LIKE 'DEMO-%'), '0', 'seed',
    'incidents hold no demo rows (evidence seal: never seeded)');
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM legal_holds WHERE reason LIKE 'DEMO-%'), '0', 'seed',
    'legal_holds hold no demo rows (sealed: never seeded)');

  -- Tamper probe: the clear script's section-0 guard fires exactly when
  -- the registry names a sealed table. A probe() statement must be a single
  -- SQL command (plpgsql EXECUTE cannot run a DO block, and a \i include is
  -- a psql command, not SQL), so the suite pins the guard's condition both
  -- ways around a tamper row; the RAISE itself lives in 002 section 0,
  -- executed for real in 103.4/103.5/103.7 above.
  INSERT INTO demo_seed_registry (table_name, demo_key, row_id)
    VALUES ('incidents', 'TAMPER-PROBE', gen_random_uuid());
  PERFORM test_support.assert_true(EXISTS (
    SELECT 1 FROM demo_seed_registry WHERE table_name IN
      ('incidents', 'legal_holds',
       'retention_runs', 'retention_run_items',
       'retention_clocks', 'retention_policies',
       'member_otp_codes', 'member_sessions')),
    'seed', 'sealed guard condition fires on a tampered registry',
    '002 section 0 raises restrict_violation on exactly this condition');
  DELETE FROM demo_seed_registry WHERE table_name = 'incidents';
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM demo_seed_registry WHERE table_name IN
      ('incidents', 'legal_holds',
       'retention_runs', 'retention_run_items',
       'retention_clocks', 'retention_policies',
       'member_otp_codes', 'member_sessions')),
    'seed', 'sealed guard condition clears after cleanup', NULL);
END
$$;

-- ---------------------------------------------------------------------------
-- 103.7  RERUN. The 0068 migration is a no-op on re-apply, and seeding
--         after a full clear re-plants cleanly (then clear again so the
--         suite leaves no demo rows behind).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261105_0068_demo_seed_registry.sql
\i services/directus/seeds/demo/001_demo_seed.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM demo_seed_registry WHERE seed_version = 'demo-1'), '74', 'seed',
    're-seed after clear re-plants fully [NULL]');
END
$$;

\i services/directus/seeds/demo/002_demo_clear.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals((SELECT count(*)::text FROM demo_seed_registry), '0', 'seed',
    'suite leaves no demo rows behind [NULL]');
END
$$;

RESET ROLE;
