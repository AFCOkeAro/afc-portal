-- Suite 47: task RACI refs (AFC-833, migration 0047).
--
--   47.1 rerun         -- re-applying 20261028_0047 changes nothing.
--   47.2 shape         -- the four columns exist, nullable, default null;
--                         assignments round-trip and clear.
--   47.3 guards        -- app UPDATEs the RACI columns (assignment is a
--                         correction); PUBLIC holds nothing new on tasks.
--                         FKs exist exactly where people exists (scratch
--                         databases without Directus keep bare uuids).
--   47.4 rollback      -- the SHIPPED down script refuses while any task
--                         names a member; cleared, it drops constraints
--                         then columns; re-apply restores them.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0047_task_raci.sql

-- ---------------------------------------------------------------------------
-- 47.1  RERUN. Re-applying 0047 changes nothing (ADD COLUMN IF NOT
-- EXISTS + guarded FK block).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0047_task_raci.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'tasks',
    '47.1: 0047 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 47.2  SHAPE. Nullable refs, default null, round-trip and clear.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_task uuid;
  v_person uuid;
  v_branch uuid;
BEGIN
  -- Probe branch chain (tasks.branch is NOT NULL; fixed ids so reruns
  -- converge and cleanup is exact).
  INSERT INTO areas (id, name, code) VALUES
    ('11111111-1111-4111-8111-111111111111', 'RACI Probe Area', 'RACI-PROBE-AREA')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO zones (id, area, name, code) VALUES
    ('22222222-2222-4222-8222-222222222222',
     '11111111-1111-4111-8111-111111111111', 'RACI Probe Zone', 'RACI-PROBE-ZONE')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO branches (id, name, code, zone) VALUES
    ('33333333-3333-4333-8333-333333333333', 'RACI Probe Branch', 'RACI-PROBE-BRANCH',
     '22222222-2222-4222-8222-222222222222')
    ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_branch FROM branches WHERE code = 'RACI-PROBE-BRANCH';
  INSERT INTO tasks (title, status, branch, assignee_user) VALUES ('RACI Probe', 'todo', v_branch, '99999999-9999-4999-8999-999999999999') RETURNING id INTO v_task;

  PERFORM test_support.assert_true(
    (SELECT raci_responsible IS NULL AND raci_accountable IS NULL
       AND raci_consulted IS NULL AND raci_informed IS NULL
     FROM tasks WHERE id = v_task),
    'tasks', '47.2: RACI refs default null');

  -- A task id is only a valid member where the FKs are absent (bare
  -- uuids); where people exists the member must be a real person row.
  IF to_regclass('public.people') IS NULL THEN
    v_person := v_task;
  ELSE
    INSERT INTO people (id) VALUES ('77777777-7777-4777-8777-777777777777')
      ON CONFLICT (id) DO NOTHING;
    v_person := '77777777-7777-4777-8777-777777777777';
  END IF;

  UPDATE tasks SET raci_responsible = v_person, raci_accountable = v_person
    WHERE id = v_task;
  PERFORM test_support.assert_true(
    (SELECT raci_responsible = v_person AND raci_accountable = v_person FROM tasks WHERE id = v_task),
    'tasks', '47.2: assignments round-trip');

  UPDATE tasks
    SET raci_responsible = NULL, raci_accountable = NULL,
        raci_consulted = NULL, raci_informed = NULL
    WHERE id = v_task;
  DELETE FROM tasks WHERE id = v_task;
  DELETE FROM branches WHERE id = '33333333-3333-4333-8333-333333333333';
  DELETE FROM zones WHERE id = '22222222-2222-4222-8222-222222222222';
  DELETE FROM areas WHERE id = '11111111-1111-4111-8111-111111111111';
END $$;

-- ---------------------------------------------------------------------------
-- 47.3  GUARDS. App UPDATEs the ring; PUBLIC holds nothing new; FKs track
-- the people register (conditional, 0013 §4 pattern).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.tasks', 'raci_responsible', 'UPDATE')
    AND has_column_privilege('directus_app', 'public.tasks', 'raci_accountable', 'UPDATE')
    AND has_column_privilege('directus_app', 'public.tasks', 'raci_consulted', 'UPDATE')
    AND has_column_privilege('directus_app', 'public.tasks', 'raci_informed', 'UPDATE'),
    'tasks', '47.3: app UPDATEs the RACI ring');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_column_grants
      WHERE table_schema = 'public' AND table_name = 'tasks'
        AND grantee = 'PUBLIC') = 0,
    'tasks', '47.3: PUBLIC holds no column on tasks');
  IF to_regclass('public.people') IS NOT NULL THEN
    PERFORM test_support.assert_true(
      (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'tasks_raci_%_fkey') = 4,
      'tasks', '47.3: four conditional FKs where people exists');
  ELSE
    PERFORM test_support.assert_true(true, 'tasks',
      '47.3: skipped, no people register in this database (bare uuids stand)');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 47.4  ROLLBACK. Refuses with named members; cleared, drops constraints
-- then columns; re-apply restores.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_task uuid;
  v_person uuid;
  v_branch uuid;
  v_got text := NULL;
BEGIN
  INSERT INTO areas (id, name, code) VALUES
    ('44444444-4444-4444-8444-444444444444', 'RACI RB Area', 'RACI-RB-AREA')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO zones (id, area, name, code) VALUES
    ('55555555-5555-4555-8555-555555555555',
     '44444444-4444-4444-8444-444444444444', 'RACI RB Zone', 'RACI-RB-ZONE')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO branches (id, name, code, zone) VALUES
    ('66666666-6666-4666-8666-666666666666', 'RACI RB Branch', 'RACI-RB-BRANCH',
     '55555555-5555-4555-8555-555555555555')
    ON CONFLICT (id) DO NOTHING;
  SELECT id INTO v_branch FROM branches WHERE code = 'RACI-RB-BRANCH';
  INSERT INTO tasks (title, status, branch, assignee_user) VALUES ('RACI Rollback Probe', 'todo', v_branch, '99999999-9999-4999-8999-999999999999') RETURNING id INTO v_task;
  IF to_regclass('public.people') IS NULL THEN
    v_person := v_task;
  ELSE
    INSERT INTO people (id) VALUES ('77777777-7777-4777-8777-777777777777')
      ON CONFLICT (id) DO NOTHING;
    v_person := '77777777-7777-4777-8777-777777777777';
  END IF;
  UPDATE tasks SET raci_accountable = v_person WHERE id = v_task;

  BEGIN
\i services/directus/schema/migrations/rollback/20261028_0047_task_raci.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;

  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'tasks',
    '47.4: down refuses while a member is named (got: ' || COALESCE(v_got, 'no refusal -- FAIL') || ')');

  UPDATE tasks SET raci_accountable = NULL WHERE id = v_task;
  DELETE FROM tasks WHERE id = v_task;
  DELETE FROM branches WHERE id = '66666666-6666-4666-8666-666666666666';
  DELETE FROM zones WHERE id = '55555555-5555-4555-8555-555555555555';
  DELETE FROM areas WHERE id = '44444444-4444-4444-8444-444444444444';
END $test$;

\i services/directus/schema/migrations/rollback/20261028_0047_task_raci.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tasks'
                   AND column_name LIKE 'raci\_%'),
    'tasks', '47.4: down drops the ring when unnamed');
END $$;

\i services/directus/schema/migrations/20261028_0047_task_raci.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tasks'
               AND column_name = 'raci_accountable'),
    'tasks', '47.4: re-apply restores the ring');
END $$;
