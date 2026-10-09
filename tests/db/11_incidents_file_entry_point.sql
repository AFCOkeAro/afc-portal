-- tests/db/11_incidents_file_entry_point.sql
--
-- AFC-255 Finding 1: the SECURITY DEFINER entry point incidents_file().
--
-- A BEFORE INSERT trigger cannot see the caller's column list, so an explicit
-- `awareness_at = now()` is accepted by the guard and stamped
-- `insert_default` -- indistinguishable from a defaulted row (falsified by
-- execution on AFC-255). This file pins the layer the trigger cannot be:
--
--   * incidents_file() exists, is SECURITY DEFINER, and its argument list
--     contains no clock column;
--   * directus_app holds EXECUTE on it and can file through it;
--   * a row filed through it is stamped insert_default at the database time;
--   * directus_app holds no INSERT/UPDATE on either clock column
--     (has_column_privilege, not just "the insert failed");
--   * the column COMMENT states the honest meaning of insert_default.
--
-- It does NOT re-assert the guard itself: 10_insert_contract.sql owns that,
-- and this file must not become a second definition of it.

-- The entry point exists with exactly the caller-writable parameters.
DO $$
DECLARE
  v_args text;
  v_secdef boolean;
BEGIN
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'incidents_file';

  PERFORM test_support.assert_true(v_secdef IS TRUE, 'entry',
    'incidents_file() exists and is SECURITY DEFINER',
    'secdef=' || COALESCE(v_secdef::text, 'NULL'));

  SELECT array_to_string(p.proargnames, ',') INTO v_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'incidents_file';

  PERFORM test_support.assert_true(
    v_args IS NOT NULL
    AND v_args NOT LIKE '%awareness%',
    'entry', 'the entry point takes no clock-column argument',
    'args=' || COALESCE(v_args, 'NULL'));

  PERFORM test_support.assert_true(
    has_function_privilege('directus_app', 'public.incidents_file(text,text,text,text,uuid,timestamptz,timestamptz,text,timestamptz,timestamptz,timestamptz)', 'EXECUTE'),
    'entry', 'directus_app can execute the entry point',
    'without EXECUTE the runtime identity cannot file through it');
END
$$;

-- Filing through the entry point as the runtime identity.
DO $$
DECLARE
  v_awareness timestamptz;
  v_source text;
  v_tx timestamptz;
BEGIN
  v_tx := now();

  PERFORM test_support.as_role('directus_app',
    $q$SELECT incidents_file('ENTRY-RUNTIME', 'Filed through the entry point', 'major', 'open', NULL, now(), NULL, 'staff', NULL, NULL, NULL)$q$);
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT awareness_at, awareness_at_source INTO v_awareness, v_source
    FROM incidents WHERE ref = 'ENTRY-RUNTIME';

  PERFORM test_support.assert_true(v_awareness IS NOT NULL, 'entry',
    'a row filed through the entry point has a clock origin',
    'awareness_at=' || COALESCE(v_awareness::text, 'NULL'));

  PERFORM test_support.assert_equals(v_source, 'insert_default', 'entry',
    'a row filed through the entry point is stamped insert_default');

  PERFORM test_support.assert_true(v_awareness <= clock_timestamp(), 'entry',
    'the entry-point clock origin is not in the future',
    'awareness_at=' || COALESCE(v_awareness::text, 'NULL'));

  PERFORM test_support.assert_true(
    abs(EXTRACT(EPOCH FROM (v_awareness - v_tx))) < 60, 'entry',
    'the entry-point clock origin is the database time at insert',
    'awareness_at=' || COALESCE(v_awareness::text, 'NULL'));
END
$$;

-- The grant layer, asserted as privileges rather than inferred from failures.
DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT has_column_privilege('directus_app', 'incidents', 'awareness_at', 'INSERT'),
    'entry', 'directus_app holds no INSERT on awareness_at',
    'the entry point is the only insert path that names no clock column');

  PERFORM test_support.assert_true(
    NOT has_column_privilege('directus_app', 'incidents', 'awareness_at_source', 'INSERT'),
    'entry', 'directus_app holds no INSERT on awareness_at_source',
    'provenance is never caller-supplied on this identity');

  PERFORM test_support.assert_true(
    NOT has_column_privilege('directus_app', 'incidents', 'awareness_at', 'UPDATE'),
    'entry', 'directus_app holds no UPDATE on awareness_at',
    'the clock never moves through the runtime identity');

  PERFORM test_support.assert_true(
    NOT has_column_privilege('directus_app', 'incidents', 'awareness_at_source', 'UPDATE'),
    'entry', 'directus_app holds no UPDATE on awareness_at_source',
    'provenance never moves through the runtime identity');
END
$$;

-- The honest COMMENT: insert_default means "equalled now() at insert".
DO $$
DECLARE
  v_comment text;
BEGIN
  SELECT col_description('incidents'::regclass,
           (SELECT attnum FROM pg_attribute
             WHERE attrelid = 'incidents'::regclass AND attname = 'awareness_at_source'))
    INTO v_comment;

  PERFORM test_support.assert_true(
    v_comment LIKE '%equalled now()%'
    AND v_comment LIKE '%incidents_file()%'
    AND v_comment LIKE '%AFC-255%',
    'entry', 'the provenance COMMENT states insert_default honestly',
    substr(COALESCE(v_comment, 'NULL'), 1, 200));
END
$$;
