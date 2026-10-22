-- tests/db/85_households_departments.sql
--
-- AFC-566 (parent AFC-460). THE HOUSEHOLDS/DEPARTMENTS REGISTER CONTRACT.
--
-- Staging 500s on GET /api/departments and /api/households traced to a
-- schema-history gap: the routes read households, departments and the
-- people_departments junction, but no versioned migration created them
-- (0006 mentions departments only in a "deliberately does not create"
-- comment; 0002 touches households only conditionally). 0020 closes the
-- gap. This suite pins what the portal routes need from those tables.
--
--   85.1  shape         -- the three tables exist with the columns the
--                           routes select (HOUSEHOLD_FIELDS /
--                           DEPARTMENT_FIELDS), the documented types,
--                           nullability and active defaults.
--   85.2  enums         -- department_type / role / status outside the
--                           documented sets are rejected at write (23514);
--                           NULL types accepted; code unique enforced.
--   85.3  links         -- junction FKs to a missing person/department fail
--                           (23503); junction pair UNIQUE; household bad
--                           branch fails; household delete SET NULLs the
--                           people link (never the person); department delete
--                           CASCADES the junction (stated choice 2).
--   85.4  overlap       -- re-applying 0002 hierarchy changes nothing: its
--                           households zone/household_head blocks are
--                           IF NOT EXISTS no-ops over 0020's tables, and
--                           its seeds stay conflict-free.
--   85.5  guards        -- the app identity reads/inserts/updates
--                           operational columns and deletes nothing (42501
--                           on DELETE); a bad junction role is rejected for
--                           the app too (23514); the app may move the
--                           people.household link but deletes no person.
--   85.6  rerun         -- re-applying 20261020_0020 changes nothing.
--   85.7  empty rollback -- with no rows and no live links the down script
--                           drops the junction, the link column and both
--                           registers; the forward file is re-applied after.
--   85.8  acceptance    -- zero orphan junctions, zero orphan household
--                           links.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch scoping, capability gates, member counts, head-name resolution --
-- lives in the route layer and is covered by
-- tests/web/households-departments.contract.mjs. No retention probe: these
-- registers carry no retention clock; erasure runs as retention_worker.

-- ---------------------------------------------------------------------------
-- 85.1  SHAPE. Tables, columns, types, nullability, defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_default text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NOT NULL
    AND to_regclass('public.departments') IS NOT NULL
    AND to_regclass('public.people_departments') IS NOT NULL, 'households',
    'households, departments and people_departments all exist');

  -- Route-selected household columns (HOUSEHOLD_FIELDS in both routes).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'households'
        AND column_name IN ('id', 'name', 'branch', 'address', 'phone',
          'wedding_date', 'household_head', 'primary_contact', 'notes',
          'status')) = 10, 'households',
    'households carries every column the routes select (incl. wedding_date, household_head)');

  -- Expansion §4.1 extras live on the table (zone is Flow-maintained).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'households'
               AND column_name = 'zone'), 'households',
    'households.zone exists (hierarchy-flows §3 denorm, Flow-maintained)');

  -- Route-selected department columns (DEPARTMENT_FIELDS in both routes).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'departments'
        AND column_name IN ('id', 'name', 'code', 'department_type',
          'branch', 'leader_person', 'description', 'status')) = 8, 'households',
    'departments carries every column the routes select');

  -- Junction columns (§2.4).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'people_departments'
        AND column_name IN ('id', 'people', 'departments', 'role',
          'joined_at', 'status')) = 6, 'households',
    'people_departments carries the §2.4 junction columns');

  -- people.household is the §2.3 link, nullable (unlinked people exist).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'household'), 'households',
    'people.household exists (ALTER, never a forked people table)');
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'people'
     AND column_name = 'household';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'households',
    'people.household is nullable');

  -- Active/member defaults on both registers and the junction.
  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'households'
     AND column_name = 'status';
  PERFORM test_support.assert_true(v_default LIKE '%active%', 'households',
    'households.status defaults active (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'departments'
     AND column_name = 'status';
  PERFORM test_support.assert_true(v_default LIKE '%active%', 'households',
    'departments.status defaults active (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'people_departments'
     AND column_name = 'role';
  PERFORM test_support.assert_true(v_default LIKE '%member%', 'households',
    'people_departments.role defaults member (' || v_default || ')');

  SELECT column_default INTO v_default FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'people_departments'
     AND column_name = 'status';
  PERFORM test_support.assert_true(v_default LIKE '%active%', 'households',
    'people_departments.status defaults active (' || v_default || ')');
END $$;

-- ---------------------------------------------------------------------------
-- 85.2  ENUMS. Documented sets enforced at write; NULL types pass.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO departments (name, department_type) VALUES ('Rogue Dept', 'esports')$q$,
    '23514', 'households', 'an undocumented department_type is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO departments (name, status) VALUES ('Rogue Dept', 'archived')$q$,
    '23514', 'households', 'a non active/inactive department status is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO households (name, status) VALUES ('Rogue House', 'dissolved')$q$,
    '23514', 'households', 'a non active/inactive household status is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO people_departments (people, departments, role) VALUES (gen_random_uuid(), gen_random_uuid(), 'founder')$q$,
    '23514', 'households', 'an undocumented junction role is rejected (no silent privilege invention)');

  PERFORM test_support.assert_not_raises(NULL,
    $q$INSERT INTO departments (name, department_type) VALUES ('Typeless Dept', NULL)$q$,
    'households', 'a NULL department_type is accepted (probe, rolled back)');
END $$;

DO $$
DECLARE
  v_code text := 'dept-85-' || substr(gen_random_uuid()::text, 1, 8);
BEGIN
  INSERT INTO departments (name, code) VALUES ('Code Probe', v_code);
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO departments (name, code) VALUES (''Code Probe 2'', ''' || v_code || ''')',
    '23505', 'households', 'department code unique is enforced (no forked board rows)');
  DELETE FROM departments WHERE code = v_code;
  DELETE FROM departments WHERE name = 'Typeless Dept';
END $$;

-- ---------------------------------------------------------------------------
-- 85.3  LINKS. FKs fail closed; pair unique; delete semantics per header.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_house uuid;
  v_dept uuid;
  v_person uuid;
  v_orphan uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;

  INSERT INTO households (name, branch) VALUES ('Link House', v_branch)
  RETURNING id INTO v_house;
  INSERT INTO departments (name, branch) VALUES ('Link Dept', v_branch)
  RETURNING id INTO v_dept;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person;

  -- Junction to a missing department / person fails (23503), not silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO people_departments (people, departments) VALUES (''' || v_person::text || ''', ''' || v_orphan::text || ''')',
    '23503', 'households', 'a junction row to a missing department is rejected');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO people_departments (people, departments) VALUES (''' || v_orphan::text || ''', ''' || v_dept::text || ''')',
    '23503', 'households', 'a junction row to a missing person is rejected');

  -- Household with a missing branch fails (stated choice 1: RESTRICT parent).
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO households (name, branch) VALUES (''Nowhere House'', ''' || v_orphan::text || ''')',
    '23503', 'households', 'a household on a missing branch is rejected');

  -- The pair is unique: re-link reactivates, never duplicates (route does
  -- status flip; the UNIQUE below is the backstop it relies on).
  INSERT INTO people_departments (people, departments) VALUES (v_person, v_dept);
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO people_departments (people, departments) VALUES (''' || v_person::text || ''', ''' || v_dept::text || ''')',
    '23505', 'households', 'a duplicate (person, department) pair is rejected');

  -- Unlink deactivates instead of deleting (AFC-469 precedent).
  UPDATE people_departments SET status = 'inactive'
   WHERE people = v_person AND departments = v_dept;
  PERFORM test_support.assert_true(
    (SELECT status FROM people_departments
      WHERE people = v_person AND departments = v_dept) = 'inactive', 'households',
    'unlink deactivates the junction row so history survives');

  -- Household delete clears the people link, never the person (§7 SET NULL).
  UPDATE people SET household = v_house WHERE id = v_person;
  DELETE FROM households WHERE id = v_house;
  PERFORM test_support.assert_true(
    (SELECT household FROM people WHERE id = v_person) IS NULL, 'households',
    'deleting a household clears people.household (SET NULL, person survives)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM people WHERE id = v_person), 'households',
    'the person row itself survives the household delete');

  -- Department delete cascades the junction (stated choice 2).
  DELETE FROM departments WHERE id = v_dept;
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM people_departments WHERE departments = v_dept), 'households',
    'deleting a department cascades its junction rows (they are meaningless without it)');

  -- No people cleanup: people is retention-managed (AFC-295) and DELETE is
  -- refused outside the retention engine owner, even for the migrator. The
  -- probe row stays with household NULL -- an anchor row with no PII.
END $$;

-- ---------------------------------------------------------------------------
--   85.4  OVERLAP. 0002's conditional households blocks are no-ops over 0020.
--        CTO verdict on AFC-578 review: 0002 alone resurrects ABULE-EGBA
--        (ON CONFLICT DO NOTHING skips present codes only), so the landed
--        narrow 0024 is re-applied after it. AFC-698: 0029 is re-applied
--        after 0024 for the same reason -- 0002 also resurrects SANGO-OTA
--        and OKE-ARO-SAT-1, which 0029 removed; without it the branch count
--        reads 32 and suite 87 fails downstream.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0002_hierarchy.sql
\i services/directus/schema/migrations/20261020_0024_remove_abule_egba.sql
\i services/directus/schema/migrations/20261020_0029_remove_sango_ota_and_satellite.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'households'
               AND column_name = 'zone')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'households'
               AND column_name = 'household_head'), 'households',
    'overlap: households still carries zone + household_head after re-applying 0002');
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NOT NULL
    AND to_regclass('public.departments') IS NOT NULL
    AND to_regclass('public.people_departments') IS NOT NULL, 'households',
    'overlap: all three 0020 tables survive the 0002 re-apply');
END $$;

-- ---------------------------------------------------------------------------
-- 85.5  GUARDS. The app reads/inserts/updates operational columns and
--        deletes nothing; the household link moves but the person is safe.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_house uuid;
  v_dept uuid;
  v_person uuid;
BEGIN
  INSERT INTO households (name) VALUES ('Guard House') RETURNING id INTO v_house;
  INSERT INTO departments (name) VALUES ('Guard Dept') RETURNING id INTO v_dept;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_person;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM households$q$,
    'households', 'app reads households');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM departments$q$,
    'households', 'app reads departments');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM people_departments$q$,
    'households', 'app reads the junction');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO people_departments (people, departments, role) VALUES ($q$ ||
      '''' || v_person::text || ''', ''' || v_dept::text || ''', ''member'')',
    'households', 'app links a member (probe row cleaned below)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE people_departments SET status = 'inactive' WHERE people IS NULL$q$,
    'households', 'app deactivates junction rows (unlink path)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE people SET household = NULL WHERE id IS NULL$q$,
    'households', 'app moves the people.household link');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE households SET status = status WHERE id IS NULL$q$,
    'households', 'app flips household status');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM households WHERE false$q$,
    '42501', 'households', 'app cannot DELETE households (family data)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM departments WHERE false$q$,
    '42501', 'households', 'app cannot DELETE departments (board facts)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM people_departments WHERE false$q$,
    '42501', 'households', 'app cannot DELETE junction rows (history survives)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM people WHERE false$q$,
    '42501', 'households', 'app cannot DELETE people (0004 ceiling holds)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO people_departments (people, departments, role) VALUES (gen_random_uuid(), gen_random_uuid(), 'founder')$q$,
    '23514', 'households', 'a bad junction role is rejected for the app too');

  DELETE FROM people_departments WHERE people = v_person AND departments = v_dept;
  DELETE FROM departments WHERE id = v_dept;
  DELETE FROM households WHERE id = v_house;
  -- No people cleanup (retention-managed per 85.3: DELETE refused for any
  -- credential outside the retention engine owner; the anchor row stays).
END $$;

-- ---------------------------------------------------------------------------
-- 85.6  RERUN. Re-applying 20261020_0020 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0020_households_departments.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NOT NULL
    AND to_regclass('public.departments') IS NOT NULL
    AND to_regclass('public.people_departments') IS NOT NULL, 'households',
    'rerun: all three tables present (IF NOT EXISTS, grants intact, seeds absent by design)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM departments WHERE code LIKE 'dept-85-%') = 0, 'households',
    'rerun: probe rows stayed cleaned (no invented board data)');
END $$;

-- ---------------------------------------------------------------------------
-- 85.7  EMPTY ROLLBACK. No rows, no live links: the down script drops the
--        junction, the link column and both registers; forward re-applied.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM households) = 0
    AND (SELECT count(*) FROM people_departments) = 0, 'households',
    'pre-rollback: empty registers (probes above cleaned up)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM people WHERE household IS NOT NULL) = 0, 'households',
    'pre-rollback: no live people.household links');
END $$;

\i services/directus/schema/migrations/rollback/20261020_0020_households_departments.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NULL
    AND to_regclass('public.departments') IS NULL
    AND to_regclass('public.people_departments') IS NULL, 'households',
    'empty-table rollback: all three tables are gone');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'people'
                   AND column_name = 'household'), 'households',
    'empty-table rollback: people.household is gone (anchor untouched)');
END $$;

-- Leave the registers present, as the forward migration leaves them.
\i services/directus/schema/migrations/20261020_0020_households_departments.sql

-- The 0020 down/up cycle above recreates departments without the zone
-- column 0027 added; re-apply 0027 (idempotent) so later suites see the
-- enforced tree.
\i services/directus/schema/migrations/20261020_0027_groups_multilevel_departments.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.households') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'people'
                   AND column_name = 'household'), 'households',
    're-apply: households and the people link are back (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 85.8  ACCEPTANCE, as queries over the registers themselves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_links integer;
  v_orphan_people integer;
BEGIN
  SELECT count(*) INTO v_orphan_links FROM people_departments pd
   WHERE NOT EXISTS (SELECT 1 FROM people p WHERE p.id = pd.people)
      OR NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = pd.departments);
  PERFORM test_support.assert_true(v_orphan_links = 0, 'households',
    'ACCEPTANCE: zero orphan junction rows (both FKs hold)');

  SELECT count(*) INTO v_orphan_people FROM people p
   WHERE p.household IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM households h WHERE h.id = p.household);
  PERFORM test_support.assert_true(v_orphan_people = 0, 'households',
    'ACCEPTANCE: zero orphan household links on people');
END $$;
