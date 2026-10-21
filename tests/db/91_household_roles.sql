-- tests/db/91_household_roles.sql
--
-- AFC-590 (parent AFC-460). THE HOUSEHOLD-ROLE CONTRACT.
--
-- The New Family wizard stores each member's place in the family
-- (head_of_household / spouse / child / relative) on
-- people.household_role (20261020_0026). There is no parallel role
-- system: households.household_head still names the head row, and the
-- role names every row's place.
--
--   91.1  shape         -- people.household_role exists, nullable, no
--                           default; the fixed-name CHECK exists.
--   91.2  enums         -- the four wizard roles write; anything else is
--                           rejected (23514); NULL writes (pre-wizard rows).
--   91.3  guards        -- the app identity UPDATEs the role (wizard
--                           writes + corrections) and deletes nothing;
--                           the 0004 people ceiling still holds.
--   91.4  rerun         -- re-applying 20261020_0026 changes nothing.
--   91.5  empty rollback -- with all-NULL roles the down script drops the
--                           column + constraint; the forward file is
--                           re-applied after.
--   91.6  acceptance    -- a wizard-shaped household (head + spouse +
--                           child, head link set) reads back whole.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch scoping, capability gates, consent_records writes, named field
-- errors -- lives in the route layer and is covered by
-- tests/web/household-wizard.contract.mjs. No retention probe: the role
-- is family metadata, not a retention clock; erasure runs as
-- retention_worker.

-- ---------------------------------------------------------------------------
-- 91.1  SHAPE. The column, its nullability, its fixed-name CHECK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'household_role'), 'households',
    'people.household_role exists (ALTER, never a forked people table)');
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'people'
     AND column_name = 'household_role';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'households',
    'people.household_role is nullable (pre-wizard rows are unknown, not a default role)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'people_household_role_check'), 'households',
    'people_household_role_check exists under its fixed name');
END $$;

-- ---------------------------------------------------------------------------
-- 91.2  ENUMS. Four roles write; anything else fails; NULL writes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_probe uuid;
  v_role record;
BEGIN
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_probe;

  FOR v_role IN
    SELECT unnest(ARRAY['head_of_household', 'spouse', 'child', 'relative']) AS role
  LOOP
    UPDATE people SET household_role = v_role.role WHERE id = v_probe;
    PERFORM test_support.assert_true(
      (SELECT household_role FROM people WHERE id = v_probe) = v_role.role, 'households',
      'role writes: ' || v_role.role);
  END LOOP;

  UPDATE people SET household_role = NULL WHERE id = v_probe;
  PERFORM test_support.assert_true(
    (SELECT household_role FROM people WHERE id = v_probe) IS NULL, 'households',
    'NULL writes (pre-wizard history stays unknown)');

  -- probe() rolls its writes back, so the rejections below target the
  -- real probe row: an UPDATE CHECK only fires on a row it touches, and
  -- WHERE id IS NULL touches none (a vacuous pass, not a pin).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE people SET household_role = 'founder' WHERE id = $q$ ||
     '''' || v_probe::text || '''',
    '23514', 'households', 'an undocumented role is rejected (no silent role invention)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE people SET household_role = 'member' WHERE id = $q$ ||
     '''' || v_probe::text || '''',
    '23514', 'households', 'junction-style roles do not leak in (member is a department role)');

  -- No people cleanup: the anchor row stays (retention-managed, 85.5
  -- precedent). The NULL above keeps 91.5 honest.
END $$;

-- ---------------------------------------------------------------------------
-- 91.3  GUARDS. The app writes the role; the people ceiling holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_guard uuid;
BEGIN
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_guard;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE people SET household_role = NULL WHERE id IS NULL$q$,
    'households', 'app UPDATEs household_role (wizard + corrections)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM people WHERE false$q$,
    '42501', 'households', 'app cannot DELETE people (0004 ceiling holds)');
  -- probe() rolls its writes back, so this targets the real guard row:
  -- an UPDATE CHECK only fires on a row it touches.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE people SET household_role = 'founder' WHERE id = $q$ ||
     '''' || v_guard::text || '''',
    '23514', 'households', 'a bad role is rejected for the app too');

  -- The guard row stays NULL-roled (retention-managed anchor, 85.5 precedent).
END $$;

-- ---------------------------------------------------------------------------
-- 91.4  RERUN. Re-applying 20261020_0026 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0026_household_roles.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'household_role'), 'households',
    'rerun: household_role present (IF NOT EXISTS, grants intact)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'people_household_role_check') = 1, 'households',
    'rerun: exactly one household_role CHECK (fixed name, no dup)');
END $$;

-- ---------------------------------------------------------------------------
-- 91.5  EMPTY ROLLBACK. All-NULL roles: the down script drops the column;
--        the forward file is re-applied after.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261020_0026_household_roles.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'people'
                   AND column_name = 'household_role'), 'households',
    'empty rollback: household_role dropped with no roles assigned');
END $$;

\i services/directus/schema/migrations/20261020_0026_household_roles.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'household_role'), 'households',
    'forward re-applied after rollback: household_role back');
END $$;

-- ---------------------------------------------------------------------------
-- 91.6  ACCEPTANCE. A wizard-shaped household reads back whole: head +
--        spouse + child with roles, and household_head naming the head.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_house uuid;
  v_head uuid;
  v_spouse uuid;
  v_child uuid;
BEGIN
  INSERT INTO households (name) VALUES ('Wizard House') RETURNING id INTO v_house;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_head;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_spouse;
  INSERT INTO people DEFAULT VALUES RETURNING id INTO v_child;

  UPDATE people SET household = v_house, household_role = 'head_of_household' WHERE id = v_head;
  UPDATE people SET household = v_house, household_role = 'spouse' WHERE id = v_spouse;
  UPDATE people SET household = v_house, household_role = 'child' WHERE id = v_child;
  UPDATE households SET household_head = v_head WHERE id = v_house;

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM people WHERE household = v_house) = 3, 'households',
    'acceptance: three members linked to the wizard household');
  PERFORM test_support.assert_true(
    (SELECT household_role FROM people WHERE id = v_head) = 'head_of_household'
    AND (SELECT household_head FROM households WHERE id = v_house) = v_head, 'households',
    'acceptance: head row carries the head role and the household names it');
  PERFORM test_support.assert_true(
    (SELECT count(DISTINCT household_role) FROM people WHERE household = v_house) = 3, 'households',
    'acceptance: three distinct roles, no parallel system');

  -- Release the links; anchor rows stay (retention-managed). NULL the
  -- roles so a later 91.5-style rollback stays honest.
  UPDATE people SET household = NULL, household_role = NULL
   WHERE id IN (v_head, v_spouse, v_child);
  DELETE FROM households WHERE id = v_house;
END $$;
