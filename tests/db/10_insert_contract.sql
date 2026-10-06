-- tests/db/10_insert_contract.sql
--
-- AFC-166 acceptance criterion 1: insert an incident through every write path
-- and prove the database set awareness_at, not the caller.
--
-- The write paths available here:
--   1. directus_app  -- the single DB identity Directus uses for EVERY API role,
--                       including super admin. All seven v4 roles reach the
--                       table through this one connection, so one insert test
--                       covers the matrix. The per-role rejection proof is in
--                       20_immutability.sql, where the roles have to be
--                       distinct because the trigger is what must catch them.
--   2. directus_migrator -- the table owner, which a migration or an ops script
--                       could use.

DO $$
DECLARE
  v_id uuid;
  v_awareness timestamptz;
  v_source text;
  v_tx timestamptz;
BEGIN
  -- now() is the transaction timestamp and stable for the whole block, so this
  -- is the exact value the column default is expected to produce.
  v_tx := now();

  -- Path 1: the runtime identity files a breach. This is the row that starts
  -- the 72h clock, and it is written from a payload with no awareness field in
  -- it at all. as_role persists the row; the leak of SET LOCAL ROLE out of the
  -- helper is harmless because the next statement names its own role.
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO incidents (ref, summary, severity, status, detected_at)
      VALUES ('INSERT-RUNTIME', 'Inserted as the Directus runtime identity', 'major', 'open', now())$q$);

  SELECT id, awareness_at, awareness_at_source INTO v_id, v_awareness, v_source
    FROM incidents WHERE ref = 'INSERT-RUNTIME';

  PERFORM test_support.assert_true(v_id IS NOT NULL, 'insert',
    'runtime identity can file an incident', 'the runtime role must still do its job');

  -- Equal to the transaction timestamp, not merely close to it: the database
  -- supplied the value, so it can only have come from the default.
  PERFORM test_support.assert_equals(v_awareness::text, v_tx::text, 'insert',
    'awareness_at is exactly the database transaction timestamp at insert');

  PERFORM test_support.assert_equals(v_source, 'insert_default', 'insert',
    'provenance records that it was server-set, not inferred');

  PERFORM test_support.assert_true(v_awareness <= clock_timestamp(), 'insert',
    'awareness_at is not in the future', 'awareness_at=' || COALESCE(v_awareness::text, 'NULL'));
END
$$;

-- No caller may supply either column, on any write path. This is the reason the
-- grant list in 0001 names every writable column explicitly.
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO incidents (ref, summary, awareness_at)
      VALUES ('INSERT-SUPPLIED-RUNTIME', 'caller supplied awareness_at', '2000-01-01T00:00:00Z')$q$,
    '42501', 'insert', 'runtime identity cannot supply awareness_at');

  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO incidents (ref, summary, awareness_at_source)
      VALUES ('INSERT-SUPPLIED-SOURCE', 'caller supplied provenance', 'insert_default')$q$,
    '42501', 'insert', 'runtime identity cannot supply awareness_at_source');

  -- The owner holds every privilege on its own table and column-level grants do
  -- not restrict it, so this one is stopped by the BEFORE INSERT guard rather
  -- than by the grant list. Two mechanisms, two sqlstates, one outcome.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO incidents (ref, summary, awareness_at)
      VALUES ('INSERT-SUPPLIED-OWNER', 'owner supplied awareness_at', '2000-01-01T00:00:00Z')$q$,
    '23001', 'insert', 'table owner cannot supply awareness_at either');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO incidents (ref, summary, awareness_at_source)
      VALUES ('INSERT-SUPPLIED-OWNER-SRC', 'owner supplied provenance', 'backfill:earliest_of_detected_reported_created')$q$,
    '23001', 'insert', 'table owner cannot label a clock origin as inferred at insert');

  -- Passing now() explicitly is the one caller-supplied value that is accepted,
  -- because it is exactly what the default would have produced.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO incidents (ref, summary, awareness_at)
      VALUES ('INSERT-EXPLICIT-NOW', 'explicitly passing now()', now())$q$,
    'insert', 'explicitly passing now() is accepted: it is the value the default gives');

  -- Positive control for the two rejections above: the insert path itself works,
  -- so a 42501 above is about the column and not about a broken fixture.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO incidents (ref, summary)
      VALUES ('INSERT-CONTROL', 'a report with no clock fields in it')$q$,
    'insert', 'a report with no clock fields in the payload is accepted');

  -- And the rejected inserts left nothing behind.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM incidents
      WHERE ref IN ('INSERT-SUPPLIED-RUNTIME', 'INSERT-SUPPLIED-SOURCE', 'INSERT-SUPPLIED-OWNER')),
    '0', 'insert', 'rejected inserts left no rows behind');
END
$$;

-- Every role that can file a report gets the same server-set clock, because
-- Directus authenticates all of them with the same database credential.
DO $$
DECLARE
  v_role text;
  v_roles text[] := ARRAY[
    'super_admin', 'area_admin', 'branch_admin',
    'welfare_officer', 'staff_volunteer', 'member'
  ];
BEGIN
  FOREACH v_role IN ARRAY v_roles LOOP
    -- as_role(NULL, ...) is the session role: the grants below need to be made
    -- by someone who has grant option, and the ambient role at this point is
    -- whatever the previous helper left behind.
    PERFORM test_support.as_role(NULL,
      format('GRANT SELECT ON incidents TO directus_%I', v_role));
    PERFORM test_support.as_role(NULL,
      format('GRANT SELECT ON incidents_breach_clock TO directus_%I', v_role));
    PERFORM test_support.as_role(NULL,
      format('GRANT INSERT (ref, summary, severity, status, detected_at) ON incidents TO directus_%I', v_role));

    PERFORM test_support.assert_raises(format('directus_%s', v_role),
      format($q$INSERT INTO incidents (ref, summary, awareness_at)
               VALUES ('INSERT-ROLE-%s', 'role supplied the clock', '2000-01-01')$q$, v_role),
      '42501', 'insert', v_role || ': cannot supply awareness_at when filing a report');

    -- as_role, not probe: the row has to survive so the stamp can be read back.
    PERFORM test_support.as_role(format('directus_%s', v_role),
      format($q$INSERT INTO incidents (ref, summary)
               VALUES ('INSERT-ROLE-OK-%s', 'ordinary report')$q$, v_role));

    PERFORM test_support.assert_equals(
      (SELECT awareness_at_source FROM incidents WHERE ref = 'INSERT-ROLE-OK-' || v_role),
      'insert_default', 'insert',
      v_role || ': the clock origin is stamped by the database for this role too');
  END LOOP;
END
$$;