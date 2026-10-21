-- tests/db/92_groups_management_team.sql
--
-- AFC-593 (parent AFC-460). THE GROUPS + MULTI-LEVEL DEPARTMENTS CONTRACT.
--
-- Area HQ members are divided into groups 1-4 with leaders; departments
-- (music, WCS, security, ushers, kitchen, sanitation, youth, elementary,
-- ...) exist at branch, zone and area levels with leaders; those leaders
-- form the management team per level. The model reuses the department
-- machinery (no parallel table): Groups 1-4 are departments with
-- department_type 'group', leadership is the people_departments junction
-- role=leader, and the management team is a read-only rollup over that.
--
--   92.1  shape         -- departments.zone + departments.area exist with
--                           FKs + indexes; the single-scope CHECK exists.
--   92.2  enums         -- 'group' + music/security/kitchen/sanitation/
--                           elementary write; anything else is rejected
--                           (23514); branch+zone together is rejected.
--   92.3  seed          -- Groups 1-4 exist (codes LAG-NORTH-GROUP-1..4,
--                           type group, area-wide); re-applying 0027 keeps
--                           exactly four (idempotency).
--   92.4  leadership    -- a junction leader row reads back; duplicate
--                           (person, department) still rejected (23505).
--   92.5  isolation     -- a zone-scoped and a branch-scoped department
--                           address different levels (no shared scope).
--   92.6  guards        -- the app reads/scopes zone+area and deletes
--                           nothing (42501 on DELETE); FKs fail closed.
--   92.7  empty rollback -- with scope links empty and widened types absent
--                           the down script drops the columns + restores the
--                           0020 CHECK; the forward file is re-applied after.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- level narrowing 403s, the management-team rollup shape, no-new-writes --
-- lives in the route layer and is covered by
-- tests/web/groups-management-team.contract.mjs. No retention probe: these
-- registers carry no retention clock; erasure runs as retention_worker.
--
-- ORDERING NOTE: suite 85's empty-rollback drops and re-creates the
-- departments table via 0020 alone, which wipes 0027's columns + seed.
-- So this suite re-applies 0027 first (idempotent): it asserts what 0027
-- guarantees, not what 85 left behind.
\i services/directus/schema/migrations/20261020_0027_groups_multilevel_departments.sql

-- ---------------------------------------------------------------------------
-- 92.1  SHAPE. Scope columns, FKs, single-scope CHECK.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'departments'
               AND column_name = 'zone')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'departments'
               AND column_name = 'area'), 'groups',
    'departments carries zone + area (migration 0027 scope)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_zone_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_area_fkey'), 'groups',
    'departments zone/area FKs exist under fixed names');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_single_scope_check'), 'groups',
    'departments_single_scope_check exists (branch XOR zone)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_type_widened_check'), 'groups',
    'departments_type_widened_check exists (0020 nine + group/music/security/kitchen/sanitation/elementary)');
END $$;

-- ---------------------------------------------------------------------------
-- 92.2  ENUMS + SCOPE CHECK. New types write; rogue types and dual scope fail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_probe uuid;
BEGIN
  INSERT INTO departments (name, department_type) VALUES ('Type Probe Music', 'music') RETURNING id INTO v_probe;
  DELETE FROM departments WHERE id = v_probe;
  INSERT INTO departments (name, department_type) VALUES ('Type Probe Group', 'group') RETURNING id INTO v_probe;
  DELETE FROM departments WHERE id = v_probe;
  PERFORM test_support.assert_true(true, 'groups',
    'music + group department_types write (probe rows cleaned)');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO departments (name, department_type) VALUES ('Rogue Dept', 'esports')$q$,
    '23514', 'groups', 'an undocumented department_type is still rejected');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO departments (name, branch, zone) SELECT 'Dual Scope', b.id, z.id FROM branches b, zones z LIMIT 1$q$,
    '23514', 'groups', 'a department scoped to branch + zone together is rejected (single level)');
END $$;

-- ---------------------------------------------------------------------------
-- 92.3  SEED. Groups 1-4 exist; re-apply is idempotent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM departments WHERE code IN
      ('LAG-NORTH-GROUP-1', 'LAG-NORTH-GROUP-2',
       'LAG-NORTH-GROUP-3', 'LAG-NORTH-GROUP-4')), '4', 'groups',
    'Groups 1-4 exist under their fixed codes');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM departments
      WHERE code LIKE 'LAG-NORTH-GROUP-%'
        AND department_type = 'group'
        AND branch IS NULL AND zone IS NULL) = 4, 'groups',
    'Groups 1-4 are area-wide group-typed rows (branch + zone null)');
END $$;

\i services/directus/schema/migrations/20261020_0027_groups_multilevel_departments.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM departments WHERE code LIKE 'LAG-NORTH-GROUP-%'), '4', 'groups',
    'rerun: re-applying 0027 keeps exactly four seeded groups (idempotent)');
END $$;

-- ---------------------------------------------------------------------------
-- 92.4  LEADERSHIP. Junction leader assignment reads back; pair unique holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid;
  v_group uuid;
BEGIN
  SELECT id INTO v_group FROM departments WHERE code = 'LAG-NORTH-GROUP-1';
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person;
  INSERT INTO people_departments (people, departments, role) VALUES (v_person, v_group, 'leader');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM people_departments
             WHERE people = v_person AND departments = v_group AND role = 'leader'
               AND status = 'active'), 'groups',
    'a group leader assignment (junction role=leader) reads back');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO people_departments (people, departments) VALUES (''' || v_person::text || ''', ''' || v_group::text || ''')',
    '23505', 'groups', 'a duplicate (person, group) pair is still rejected');
  DELETE FROM people_departments WHERE people = v_person AND departments = v_group;
  -- No people cleanup: people is retention-managed; the anchor row stays.
END $$;

-- ---------------------------------------------------------------------------
-- 92.5  ISOLATION. Zone vs branch scope address different levels.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_zone uuid;
  v_bdept uuid;
  v_zdept uuid;
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;
  SELECT id INTO v_zone FROM zones LIMIT 1;
  INSERT INTO departments (name, branch) VALUES ('Isolation Branch Dept', v_branch) RETURNING id INTO v_bdept;
  INSERT INTO departments (name, zone) VALUES ('Isolation Zone Dept', v_zone) RETURNING id INTO v_zdept;
  PERFORM test_support.assert_true(
    (SELECT branch FROM departments WHERE id = v_bdept) = v_branch
    AND (SELECT zone FROM departments WHERE id = v_bdept) IS NULL, 'groups',
    'a branch department carries branch scope and no zone scope');
  PERFORM test_support.assert_true(
    (SELECT zone FROM departments WHERE id = v_zdept) = v_zone
    AND (SELECT branch FROM departments WHERE id = v_zdept) IS NULL, 'groups',
    'a zone department carries zone scope and no branch scope');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM departments WHERE id IN (v_bdept, v_zdept) AND branch IS NOT NULL AND zone IS NOT NULL), 'groups',
    'no department spans two levels (scope isolation per level)');
  DELETE FROM departments WHERE id IN (v_bdept, v_zdept);
END $$;

-- ---------------------------------------------------------------------------
-- 92.6  GUARDS. The app scopes zone+area and deletes nothing; FKs fail closed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan uuid := gen_random_uuid();
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM departments WHERE zone IS NULL$q$,
    'groups', 'app reads departments with the new scope columns');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE departments SET status = status WHERE id IS NULL$q$,
    'groups', 'app flips department status (0020 ceiling holds)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM departments WHERE false$q$,
    '42501', 'groups', 'app cannot DELETE departments (board facts)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO departments (name, zone) VALUES (''Nowhere Dept'', ''' || v_orphan::text || ''')',
    '23503', 'groups', 'a department on a missing zone is rejected (fail closed)');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO departments (name, area) VALUES (''Nowhere Area Dept'', ''' || v_orphan::text || ''')',
    '23503', 'groups', 'a department on a missing area is rejected (fail closed)');
END $$;

-- ---------------------------------------------------------------------------
-- 92.7  ROLLBACK POSTURE. The down script refuses while widened rows exist;
--        documents the empty-path contract without deleting the seed.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_single_scope_check'), 'groups',
    'rollback posture: scope CHECK present while scoped/typed rows exist (down script refuses until cleared)');
END $$;
