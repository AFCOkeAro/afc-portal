-- tests/db/42_directus_runtime_matrix.sql
--
-- AFC-783 (follow-up to AFC-749). THE DIRECTUS RUNTIME GRANT MATRIX.
--
-- Migration 20261024_0042 grants directus_app SELECT/INSERT/UPDATE/DELETE on
-- every migrator-owned directus_* table (USAGE + SELECT on directus_*
-- sequences), revokes PUBLIC on tables AND sequences, and refuses while any
-- directus_* object is foreign-owned. Staging root cause: Directus booted as
-- directus_app with zero grants on directus_migrations and died on SELECT
-- at startup.
--
--   42.1  matrix      -- probes owned by the migrator get the four DML verbs
--                         (privilege catalog) plus a serial-sequence INSERT
--                         with no id supplied.
--   42.2  verbs       -- the runtime identity round-trips INSERT/SELECT/
--                         UPDATE/DELETE on a probe; TRUNCATE is refused
--                         (42501: the matrix is exactly four verbs, no more)
--                         and PUBLIC reads nothing.
--   42.3  fail-closed -- a foreign-owned directus_* table makes the migration
--                         refuse with restrict_violation (the real file,
--                         re-applied inside a caught block), naming the object.
--   42.4  ceiling     -- 0042 widens nothing on application tables:
--                         directus_app still cannot DELETE from incidents
--                         (SELECT-only since 0001) and still reads it.
--   42.5  rollback    -- the down script revokes the matrix (SELECT now
--                         42501); re-applying forward converges back.
--
-- What this suite does NOT assert (stated, not missing): the live boot --
-- Directus starting as directus_app against a transferred database with
-- /server/health 200 and an API round-trip -- needs a running Directus 11
-- and is the operator's staging checklist (runbook section 8.5), not a
-- PGlite assertion. This suite proves the matrix; staging proves the boot.
--
-- Fixture hygiene: probes are migrator-owned (the migration's precondition)
-- and dropped at the end, so later suites never see the directus_* prefix.
-- Suite 50 builds its own directus_permissions double afterwards; ordering
-- 42 < 50 is load-bearing and stated here, not assumed.

-- ---------------------------------------------------------------------------
-- Probes. A serial PK (sequence-grant path, the directus_activity shape)
-- and a uuid PK (the directus_revisions shape). Migrator-owned, like every
-- real directus_* table after the runbook 8.3 transfer.
-- ---------------------------------------------------------------------------
CREATE TABLE directus_probe_ledger (
  id      serial PRIMARY KEY,
  payload text NOT NULL
);

CREATE TABLE directus_probe_events (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload text NOT NULL
);

ALTER TABLE directus_probe_ledger OWNER TO directus_migrator;
ALTER TABLE directus_probe_events OWNER TO directus_migrator;

-- ---------------------------------------------------------------------------
-- 42.1  MATRIX. The forward file grants the four verbs on both probes.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261024_0042_directus_runtime_matrix.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    test_support.can_select('directus_app', 'directus_probe_ledger'), 'runtime-matrix',
    'directus_app can SELECT the activity-shaped probe (serial PK)');
  PERFORM test_support.assert_true(
    test_support.can_select('directus_app', 'directus_probe_events'), 'runtime-matrix',
    'directus_app can SELECT the revision-shaped probe (uuid PK)');
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'directus_probe_ledger'), 'runtime-matrix',
    'directus_app can INSERT the ledger probe');
  PERFORM test_support.assert_true(
    test_support.can_insert('directus_app', 'directus_probe_events'), 'runtime-matrix',
    'directus_app can INSERT the events probe');
  PERFORM test_support.assert_true(
    test_support.can_update('directus_app', 'directus_probe_ledger'), 'runtime-matrix',
    'directus_app can UPDATE the ledger probe');
  PERFORM test_support.assert_true(
    test_support.can_delete('directus_app', 'directus_probe_ledger'), 'runtime-matrix',
    'directus_app can DELETE the ledger probe (Directus manages its own rows)');

  -- The serial backing sequence: an INSERT that names no id must work, which
  -- is USAGE on directus_probe_ledger_id_seq rather than any table verb.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO directus_probe_ledger (payload) VALUES ('seq-probe')$q$,
    'runtime-matrix', 'directus_app INSERTs without an id -- the backing sequence grant holds');
END $$;

-- ---------------------------------------------------------------------------
-- 42.2  VERBS. Full round-trip as the runtime identity; the three denials
--         that prove the matrix is four verbs and PUBLIC is out (tables
--         and sequences).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO directus_probe_events (payload) VALUES ('round-trip')$q$,
    'runtime-matrix', 'directus_app INSERTs the events probe');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM directus_probe_events$q$,
    'runtime-matrix', 'directus_app SELECTs the events probe');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE directus_probe_events SET payload = 'round-trip-2'$q$,
    'runtime-matrix', 'directus_app UPDATEs the events probe');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$DELETE FROM directus_probe_events$q$,
    'runtime-matrix', 'directus_app DELETEs the events probe');

  -- No fifth verb: TRUNCATE was never granted, so the grant list refuses it
  -- before any trigger could. 42501, not 23001 -- this is the grant layer.
  PERFORM test_support.assert_raises('directus_app',
    $q$TRUNCATE directus_probe_ledger$q$,
    '42501', 'runtime-matrix', 'directus_app cannot TRUNCATE a system table -- the matrix stops at four verbs');

  -- PUBLIC was revoked: the least-privileged v4 role reads nothing.
  PERFORM test_support.assert_raises('directus_public',
    $q$SELECT count(*) FROM directus_probe_ledger$q$,
    '42501', 'runtime-matrix', 'PUBLIC reads nothing on the system tables after 0042');

  -- PUBLIC was revoked on sequences too: no USAGE for anyone outside the matrix.
  PERFORM test_support.assert_raises('directus_public',
    $q$SELECT nextval('directus_probe_ledger_id_seq')$q$,
    '42501', 'runtime-matrix', 'PUBLIC has no USAGE on the system sequences after 0042');
END $$;

-- ---------------------------------------------------------------------------
-- 42.3  FAIL-CLOSED. A foreign-owned directus_* table makes the REAL forward
--         file refuse (restrict_violation), naming the object -- re-applied
--         here inside a caught block so the suite survives the refusal it
--         proves. Outer tag is $test$ because the inlined file uses $$.
-- ---------------------------------------------------------------------------
CREATE TABLE directus_probe_foreign (id uuid PRIMARY KEY DEFAULT gen_random_uuid());

DO $test$
DECLARE
  v_got text := NULL;
BEGIN
  BEGIN
\i services/directus/schema/migrations/20261024_0042_directus_runtime_matrix.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;

  PERFORM test_support.assert_true(
    v_got IS NOT NULL, 'runtime-matrix',
    'the migration refused while a foreign-owned directus_* table exists (got: ' || COALESCE(v_got, 'no refusal -- FAIL') || ')');
  PERFORM test_support.assert_true(
    v_got LIKE '23001%' AND v_got LIKE '%directus_probe_foreign%', 'runtime-matrix',
    'the refusal is restrict_violation and names directus_probe_foreign with the transfer step');
END $test$;

DROP TABLE directus_probe_foreign;

-- ---------------------------------------------------------------------------
-- 42.4  CEILING. 0042 names no application table, and the grant layer still
--         shows it: incidents is SELECT-only for directus_app since 0001, and
--         a DELETE there is still refused by the grant list (42501), while
--         reads still work. If this ever flips, a matrix file widened the
--         application ceiling and this is the assertion that says so.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM incidents$q$,
    '42501', 'runtime-matrix', 'directus_app still cannot DELETE an application table after 0042');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM incidents$q$,
    'runtime-matrix', 'directus_app still reads incidents after 0042 -- the ceiling is intact, not broken');
END $$;

-- ---------------------------------------------------------------------------
-- 42.5  ROLLBACK. The down script revokes the matrix (best-effort, never
--         stranding); forward re-apply converges. Then the probes go so the
--         directus_* prefix is clean for suite 50 and everything after.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/rollback/20261024_0042_directus_runtime_matrix.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT count(*) FROM directus_probe_ledger$q$,
    '42501', 'runtime-matrix', 'after rollback directus_app reads nothing -- the matrix is fully revoked');
END $$;

\i services/directus/schema/migrations/20261024_0042_directus_runtime_matrix.sql

DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM directus_probe_ledger$q$,
    'runtime-matrix', 're-applying forward converges: reads work again (idempotent matrix)');
END $$;

DROP TABLE directus_probe_ledger;
DROP TABLE directus_probe_events;
