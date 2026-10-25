-- tests/db/43_department_guides.sql
--
-- AFC-800 (parent AFC-759). THE DEPARTMENT-GUIDES CONTRACT.
--
-- Migration 20261025_0043 adds department_guides: one instructional row per
-- department, ordered by (sort_order, id), rendered through the shared
-- XSS-safe Markdown renderer. The app reads guides, inserts the four
-- route-written columns and edits title/body/sort_order; it deletes
-- nothing (retention posture: no DELETE route, no DELETE grant).
--
--   43.1  shape         -- the table, column nullability/defaults, the
--                           fixed-name FK (RESTRICT) + title CHECK, the
--                           fixed-name (department, sort_order, id) index.
--   43.2  guards        -- parent delete RESTRICTs (23503); blank titles
--                           fail (23514).
--   43.3  ceiling       -- the app identity SELECTs/INSERTs/UPDATEs the
--                           scoped columns and deletes nothing (42501);
--                           created_by and department-placement writes are
--                           outside the grant (42501).
--   43.4  rerun         -- re-applying 20261025_0043 changes nothing:
--                           exactly one FK, one CHECK, one index.
--   43.5  empty rollback -- with no rows the down script drops the table;
--                           the forward file is re-applied after.
--   43.6  acceptance    -- a department with three guides reads back in
--                           (sort_order, id) order; probes cleaned up.
--   43.7  ordering      -- the table is dropped again at the end: suite
--                           85 cycles departments through the 0020 down
--                           script (DROP TABLE departments, no CASCADE),
--                           and this table's RESTRICT FK would fail that
--                           drop. 85 owns departments, so 43 leaves no
--                           dependent behind. The forward migration stays
--                           the source of truth (the runner applies it
--                           before every suite).
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- scoped reads, writer gating (departments update OR active leader link),
-- safe-render and the no-DELETE pin -- lives in the route layer and is
-- covered by tests/web/department-guides.contract.mjs. No retention
-- probe: guides are department facts, not retention clocks; erasure runs
-- as retention_worker.

-- ---------------------------------------------------------------------------
-- 43.1  SHAPE. Table, nullability, defaults, fixed names.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.department_guides') IS NOT NULL, 'department-guides',
    'department_guides exists (CREATE TABLE IF NOT EXISTS, no fork of departments)');

  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'department_guides'
     AND column_name = 'department';
  PERFORM test_support.assert_equals(v_nullable, 'NO', 'department-guides',
    'department_guides.department is NOT NULL (every guide belongs to a department)');

  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'department_guides'
     AND column_name = 'title';
  PERFORM test_support.assert_equals(v_nullable, 'NO', 'department-guides',
    'department_guides.title is NOT NULL (blank titles are refused, not stored)');

  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'department_guides'
     AND column_name = 'created_by';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'department-guides',
    'department_guides.created_by is nullable (system-written rows name no user)');

  PERFORM test_support.assert_true(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'department_guides'
        AND column_name = 'body') = '''''::text', 'department-guides',
    'department_guides.body defaults to empty (no NULL bodies to render)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'department_guides_department_fkey'
               AND confdeltype = 'r'), 'department-guides',
    'department_guides_department_fkey exists under its fixed name with ON DELETE RESTRICT');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'department_guides_title_check'), 'department-guides',
    'department_guides_title_check exists under its fixed name (blank titles refused)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'department_guides_department_sort_idx'
             AND relkind = 'i'), 'department-guides',
    'department_guides_department_sort_idx exists (guides list in (sort_order, id) order)');
END $$;

-- ---------------------------------------------------------------------------
-- 43.2  GUARDS. RESTRICT on the parent; blank titles fail loudly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dept uuid;
  v_guide uuid;
BEGIN
  INSERT INTO departments (name, code) VALUES ('Suite Dept 43', 'SUITE43-DEPT')
    RETURNING id INTO v_dept;
  INSERT INTO department_guides (department, title) VALUES (v_dept, 'Guide probe 43')
    RETURNING id INTO v_guide;

  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM departments WHERE id = $q$ || '''' || v_dept::text || '''',
    '23503', 'department-guides', 'a department with guides is not deleted by accident (RESTRICT)');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO department_guides (department, title) VALUES ($q$ ||
      '''' || v_dept::text || '''' || $q$, '   ')$q$,
    '23514', 'department-guides', 'a whitespace-only title is refused (btrim CHECK)');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO department_guides (department, title) VALUES ('00000000-0000-0000-0000-000000000000', 'Orphan probe')$q$,
    '23503', 'department-guides', 'a guide on a missing department is rejected (no silent orphan)');

  DELETE FROM department_guides WHERE id = v_guide;
  DELETE FROM departments WHERE id = v_dept;
END $$;

-- ---------------------------------------------------------------------------
-- 43.3  CEILING. The app reads/writes the scoped columns; nothing else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dept uuid;
BEGIN
  INSERT INTO departments (name, code) VALUES ('Suite Dept 43 ceiling', 'SUITE43-CEIL')
    RETURNING id INTO v_dept;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT id, department, title, body, sort_order, created_at, updated_at FROM department_guides WHERE false$q$,
    'department-guides', 'app SELECTs guides (list/detail reads)');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO department_guides (department, title, body, sort_order) VALUES ($q$ ||
      '''' || v_dept::text || '''' || $q$, 'Ceil probe', 'body', 0)$q$,
    'department-guides', 'app INSERTs the four route-written columns (probe discarded by the harness)');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE department_guides SET title = NULL WHERE id IS NULL$q$,
    'department-guides', 'app UPDATEs guide text (editor writes)');

  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO department_guides (department, title, created_by) VALUES ($q$ ||
      '''' || v_dept::text || '''' || $q$, 'Ceil probe', '00000000-0000-0000-0000-000000000000')$q$,
    '42501', 'department-guides', 'app cannot INSERT created_by (outside the column grant)');

  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE department_guides SET department = NULL WHERE id IS NULL$q$,
    '42501', 'department-guides', 'app cannot move a guide between departments (placement is not granted)');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM department_guides WHERE false$q$,
    '42501', 'department-guides', 'app cannot DELETE guides (retention posture: no DELETE anywhere)');

  DELETE FROM departments WHERE id = v_dept;
END $$;

-- ---------------------------------------------------------------------------
-- 43.4  RERUN. Re-applying 20261025_0043 changes nothing: exactly one FK,
--        one CHECK, one index.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261025_0043_department_guides.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'department_guides_department_fkey') = 1, 'department-guides',
    'rerun: exactly one department_guides_department_fkey (fixed name, no dup)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_constraint
      WHERE conname = 'department_guides_title_check') = 1, 'department-guides',
    'rerun: exactly one department_guides_title_check (fixed name, no dup)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_class WHERE relname = 'department_guides_department_sort_idx'
       AND relkind = 'i') = 1, 'department-guides',
    'rerun: exactly one department_guides_department_sort_idx (no dup)');
END $$;

-- ---------------------------------------------------------------------------
-- 43.5  EMPTY ROLLBACK. With no rows the down script drops the table; the
--        forward file is re-applied after.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261025_0043_department_guides.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.department_guides') IS NULL, 'department-guides',
    'empty rollback: department_guides dropped with no rows assigned');
END $$;

\i services/directus/schema/migrations/20261025_0043_department_guides.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.department_guides') IS NOT NULL, 'department-guides',
    'forward re-applied after rollback: department_guides back');
END $$;

-- ---------------------------------------------------------------------------
-- 43.6  ACCEPTANCE. One department, three guides, (sort_order, id) order.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dept uuid;
  v_first text;
BEGIN
  INSERT INTO departments (name, code) VALUES ('Suite Dept 43 order', 'SUITE43-ORDER')
    RETURNING id INTO v_dept;
  INSERT INTO department_guides (department, title, body, sort_order) VALUES
    (v_dept, 'Third guide', 'c', 20),
    (v_dept, 'First guide', 'a', 0),
    (v_dept, 'Second guide', 'b', 10);

  SELECT title INTO v_first FROM department_guides
   WHERE department = v_dept ORDER BY sort_order, id LIMIT 1;
  PERFORM test_support.assert_equals(v_first, 'First guide', 'department-guides',
    'acceptance: guides read back in (sort_order, id) order');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM department_guides WHERE department = v_dept) = 3, 'department-guides',
    'acceptance: all three guides persist on the department');

  DELETE FROM department_guides WHERE department = v_dept;
  DELETE FROM departments WHERE id = v_dept;
END $$;

-- ---------------------------------------------------------------------------
-- 43.7  ORDERING. Drop the table so suite 85 can cycle departments (0020
--        down drops departments with no CASCADE; the RESTRICT FK would fail
--        that drop). Probes above are cleaned; the table is empty, so the
--        down script applies and the absence is asserted.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261025_0043_department_guides.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.department_guides') IS NULL, 'department-guides',
    'ordering: department_guides dropped (no dependent left for the 85 departments cycle)');
END $$;
