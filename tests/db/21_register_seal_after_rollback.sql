-- tests/db/21_register_seal_after_rollback.sql
--
-- AFC-264 / AFC-253. THE SUITE THAT EXERCISES THE REVERSED STATE.
--
-- Everything else in tests/db/ asserts the FORWARD state: 0001 then 0002
-- installed, then prove the clock and the evidence seal hold. Not one of them
-- asserted what the register looks like AFTER a reversal. That gap is the whole
-- defect. rollback/20261006_0002_incidents_awareness_at.down.sql used to drop
-- incidents_no_delete and incidents_no_truncate along with the clock objects,
-- so reversing the clock migration silently disarmed the breach register, and
-- no suite in this directory could have noticed.
--
-- Reproduced by execution, five rows present, shipped 0001 then 0002 then the
-- down script:
--
--   directus_app             still refused, 42501  <- the GRANT layer only
--   fully-granted app role   DELETE  succeeded, rows 5 -> 4
--   fully-granted app role   TRUNCATE succeeded, rows 4 -> 0
--   directus_migrator        DELETE and TRUNCATE both succeeded
--
-- TWO DESIGN DECISIONS, both load-bearing.
--
-- 1. WHICH IDENTITIES. Never directus_app alone. Its 42501 survives the
--    reversal because the column-grant layer is independent of the trigger, so a
--    check on that identity reads green over an unsealed register. Every refusal
--    below is asserted for the TABLE OWNER and for a fully-granted app-style
--    role (table-level SELECT, INSERT, UPDATE, DELETE, TRUNCATE -- what
--    20_immutability.sql hands every v4 role), which are the two identities for
--    which the seal is the only thing standing. directus_app is asserted too,
--    once, as the second layer rather than as the control.
--
-- 2. WHY THE REFUSALS ARE NOT ALL PROBES. test_support.probe() runs its
--    statement in a subtransaction that is ALWAYS discarded, so a DELETE that
--    succeeded there would leave no trace and a following row count would read
--    unchanged: a vacuous green. The CTO hit exactly that false green while
--    reproducing this. So every refusal below comes in two parts:
--      * test_support.assert_raises, which proves the guard rejected it, and
--      * a REAL, COMMITTED attempt followed by assert_equals on count(*), which
--        proves nothing was removed.
--    The count assertion is the one that catches an open register even if the
--    raise assertion is somehow satisfied.

-- ---------------------------------------------------------------------------
-- Probe 1: a register that holds evidence.
--
-- A throwaway schema AUTHORIZED to directus_migrator, so the probe table's
-- owner is directus_migrator -- the owner identity the acceptance criterion is
-- about, not the harness session role. Follows the 30_backfill_survival.sql /
-- 40_clock.sql pattern; the schema is created by the session role because
-- directus_migrator holds no CREATE on the database, which is the credential
-- split working as intended.
-- ---------------------------------------------------------------------------
CREATE SCHEMA register_seal_probe AUTHORIZATION directus_migrator;

SET ROLE directus_migrator;
SET search_path = register_seal_probe, public;
\i services/directus/schema/migrations/20261006_0001_incidents.sql
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
RESET ROLE;
SET search_path = public;

DO $$
DECLARE
  v_owner text;
  v_trigs integer;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner
    FROM pg_class WHERE oid = 'register_seal_probe.incidents'::regclass;
  PERFORM test_support.assert_equals(v_owner, 'directus_migrator', 'seal-rb',
    'the probe register is owned by directus_migrator, so "table owner" below means something');

  -- The forward state, asserted first. Without this, a reversed-state assertion
  -- could pass because the fixture never had a seal in the first place.
  SELECT count(*) INTO v_trigs
    FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'register_seal_probe' AND c.relname = 'incidents'
     AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate');
  PERFORM test_support.assert_equals(v_trigs::text, '2', 'seal-rb',
    'precondition: 0001 + 0002 leave both evidence guards on the probe register');
END
$$;

-- The fully-granted app-style role, plus schema USAGE so it can reach the probe.
-- Exactly the grants 20_immutability.sql gives every v4 role, minus the ones no
-- Directus policy maps to, so the seal has to be the thing that refuses.
DO $$
BEGIN
  PERFORM test_support.as_role(NULL,
    'GRANT USAGE ON SCHEMA register_seal_probe TO directus_app, test_table_super');
  PERFORM test_support.as_role(NULL,
    'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON register_seal_probe.incidents TO test_table_super');
END
$$;

-- Fixtures, through directus_app so every clock origin is genuinely server-set.
--
-- FIVE ROWS, and that number is load-bearing: DELETE on an empty table matches
-- no row, the row-level trigger never fires, no error is raised, and the check
-- reads as a pass. A single-row register makes the count assertions weaker too,
-- because a TRUNCATE that succeeded would still leave the DELETE assertion's row
-- count looking untouched.
DO $$
BEGIN
  PERFORM test_support.as_role(NULL, 'SET search_path = register_seal_probe, public');
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO incidents (ref, summary, severity, status, detected_at) VALUES
        ('SEAL-1', 'Filed by Directus, the only runtime identity', 'critical', 'open', now() - interval '1 hour'),
        ('SEAL-2', 'A second row, so a DELETE is observable in the count',   'major',    'investigating', now() - interval '2 hours'),
        ('SEAL-3', 'A third row',                                           'minor',    'contained', now() - interval '3 hours'),
        ('SEAL-4', 'A fourth row',                                          'major',    'reported', now() - interval '4 hours'),
        ('SEAL-5', 'A fifth row',                                           'critical', 'closed', now() - interval '5 hours')$q$);
  PERFORM test_support.as_role(NULL, 'SELECT 1');   -- restore the session role

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_probe.incidents), '5', 'seal-rb',
    'precondition: the probe register holds five rows, so every refusal below is observable');
END
$$;

-- ---------------------------------------------------------------------------
-- The reversal, from the SHIPPED file, run as the table owner.
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;
SET search_path = register_seal_probe, public;
\i services/directus/schema/migrations/rollback/20261006_0002_incidents_awareness_at.down.sql
RESET ROLE;
SET search_path = public;

-- ---------------------------------------------------------------------------
-- POST-REVERSAL. This is the assertion the whole issue turns on.
--
-- The clock objects and both awareness columns are gone. The evidence seal is
-- not. Both identities that could actually reach the table in production are
-- refused, and each refusal is paired with a row count.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- The clock really did go, so this is not a no-op that happens to look safe.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_namespace n
                 JOIN pg_proc p ON p.pronamespace = n.oid
                WHERE n.nspname = 'register_seal_probe'
                  AND p.proname = 'incidents_guard_awareness'),
    'seal-rb', 'the reversal removed incidents_guard_awareness, so this is a real reversal');

  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_attribute
                 WHERE attrelid = 'register_seal_probe.incidents'::regclass
                   AND attname = 'awareness_at' AND NOT attisdropped),
    'seal-rb', 'the reversal dropped the awareness_at column, so this is a real reversal');

  -- The clock guards went.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_trigger t
                 JOIN pg_class c ON c.oid = t.tgrelid
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'register_seal_probe' AND c.relname = 'incidents'
                  AND t.tgname IN ('incidents_immutable_awareness', 'incidents_no_caller_clock')),
    'seal-rb', 'both clock triggers are gone after the reversal');
END
$$;

-- The seal itself: present, by name and by count.
DO $$
DECLARE
  v_trigs integer;
  v_names text;
BEGIN
  SELECT count(*), string_agg(t.tgname, ', ' ORDER BY t.tgname)
    INTO v_trigs, v_names
    FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'register_seal_probe' AND c.relname = 'incidents'
     AND NOT t.tgisinternal
     AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate');

  PERFORM test_support.assert_equals(v_trigs::text, '2', 'seal-rb',
    'after the reversal the register carries both evidence guards again');
  PERFORM test_support.assert_equals(v_names, 'incidents_no_delete, incidents_no_truncate', 'seal-rb',
    'and they are the guards with those names, not something that merely looks like a control');
END
$$;

-- The refusals. assert_raises first (it is the control assertion and it is what
-- fails loudly when the guard is missing), then a real committed attempt paired
-- with a row count.
DO $$
BEGIN
  -- Table owner.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-2'$q$,
    '23001', 'seal-rb', 'after the reversal, DELETE is still refused for the TABLE OWNER');

  PERFORM test_support.assert_raises('directus_migrator',
    $q$TRUNCATE register_seal_probe.incidents$q$,
    '23001', 'seal-rb', 'after the reversal, TRUNCATE is still refused for the TABLE OWNER');

  -- Fully-granted app-style session: what 20_immutability.sql hands every v4
  -- role, and therefore what a Directus Flow `exec` or a psql session as
  -- directus_app would be holding in a policy that maps table-level ALL.
  PERFORM test_support.assert_raises('test_table_super',
    $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-3'$q$,
    '23001', 'seal-rb', 'after the reversal, DELETE is still refused for a FULLY-GRANTED app role');

  PERFORM test_support.assert_raises('test_table_super',
    $q$TRUNCATE register_seal_probe.incidents$q$,
    '23001', 'seal-rb', 'after the reversal, TRUNCATE is still refused for a FULLY-GRANTED app role');

  -- Second layer, asserted so the grant list is not mistaken for the control.
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-1'$q$,
    '42501', 'seal-rb', 'directus_app is refused too, on the grant layer -- which is why it cannot be the only check');

  PERFORM test_support.assert_true(
    test_support.probe('directus_app', 'DELETE FROM register_seal_probe.incidents WHERE ref = ''SEAL-1''') IS NOT NULL
    AND split_part(test_support.probe('directus_app', 'DELETE FROM register_seal_probe.incidents WHERE ref = ''SEAL-1'''), ' | ', 1) = '42501',
    'seal-rb', 'the directus_app refusal is specifically 42501 (grant layer), not the trigger');
END
$$;

-- ---------------------------------------------------------------------------
-- The non-vacuous pair: a REAL attempt, not a discarded subtransaction, then
-- count(*). Each attempt is followed immediately by its row count, so the
-- assertion that reports first on a red run is the one that names the damage.
--
-- test_support.as_role does SET LOCAL ROLE, which leaks until the end of the
-- enclosing transaction when nothing raises. Each block ends with
-- as_role(NULL, 'SELECT 1') to put the session role back unconditionally -- on
-- both paths, so a sealed register and an open one leave the same state behind.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role('directus_migrator',
      $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-2'$q$);
    v_got := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the owner DELETE after the reversal removed nothing: five rows still present');
  PERFORM test_support.assert_equals(v_got, '23001', 'seal-rb',
    'and it was refused by the trigger, 23001');
END
$$;

DO $$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role('directus_migrator',
      $q$TRUNCATE register_seal_probe.incidents$q$);
    v_got := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the owner TRUNCATE after the reversal removed nothing: five rows still present');
  PERFORM test_support.assert_equals(v_got, '23001', 'seal-rb',
    'and it was refused by the trigger, 23001');
END
$$;

DO $$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role('test_table_super',
      $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-3'$q$);
    v_got := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the fully-granted DELETE after the reversal removed nothing: five rows still present');
  PERFORM test_support.assert_equals(v_got, '23001', 'seal-rb',
    'and it was refused by the trigger, 23001');
END
$$;

DO $$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role('test_table_super',
      $q$TRUNCATE register_seal_probe.incidents$q$);
    v_got := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the fully-granted TRUNCATE after the reversal removed nothing: five rows still present');
  PERFORM test_support.assert_equals(v_got, '23001', 'seal-rb',
    'and it was refused by the trigger, 23001');
END
$$;

DO $$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role('directus_app',
      $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-1'$q$);
    v_got := 'no error raised';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the directus_app DELETE after the reversal removed nothing: five rows still present');
  PERFORM test_support.assert_equals(v_got, '42501', 'seal-rb',
    'and it was refused by the grant list, 42501');
END
$$;

-- The register as a whole, after every attempt above. Nothing was destroyed by
-- the reversal: it removes clock objects and two columns, not evidence.
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_probe.incidents), '5', 'seal-rb',
    'after the whole reversal and every attempt, the register still holds all five rows');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_probe.incidents WHERE ref LIKE 'SEAL-%'), '5', 'seal-rb',
    'and all five are the rows that were filed, none recreated');
END
$$;

-- ---------------------------------------------------------------------------
-- RECOVERY DRILL. Re-applying 0002 has to restore the clock AND leave the seal
-- standing. The seal does not depend on this file any more -- but a reversal
-- followed by a re-apply is the sequence an operator actually performs, and it
-- must not be the sequence that opens the register.
-- ---------------------------------------------------------------------------
SET ROLE directus_migrator;
SET search_path = register_seal_probe, public;
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
RESET ROLE;
SET search_path = public;

DO $$
DECLARE
  v_rows  integer;
  v_trigs integer;
  v_names text;
BEGIN
  -- Re-seed only if something upstream lost a row. Nothing should have, and the
  -- assertion below says so either way.
  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  IF v_rows = 0 THEN
    PERFORM test_support.as_role(NULL, 'SET search_path = register_seal_probe, public');
    PERFORM test_support.as_role('directus_app',
      $q$INSERT INTO incidents (ref, summary, severity, status, detected_at)
        VALUES ('SEAL-1', 're-seeded', 'critical', 'open', now()),
               ('SEAL-2', 're-seeded', 'major', 'open', now()),
               ('SEAL-3', 're-seeded', 'minor', 'open', now()),
               ('SEAL-4', 're-seeded', 'major', 'open', now()),
               ('SEAL-5', 're-seeded', 'critical', 'open', now())$q$);
    PERFORM test_support.as_role(NULL, 'SELECT 1');
  END IF;

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_probe.incidents), '5', 'seal-rb',
    'the re-applied 0002 did not consume or duplicate a row');

  -- All four triggers are back: the two clock guards and the two evidence guards.
  SELECT count(*), string_agg(t.tgname, ', ' ORDER BY t.tgname)
    INTO v_trigs, v_names
    FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'register_seal_probe' AND c.relname = 'incidents'
     AND NOT t.tgisinternal;

  PERFORM test_support.assert_equals(v_trigs::text, '4', 'seal-rb',
    'after re-applying 0002 the register carries all four triggers');
  PERFORM test_support.assert_equals(
    v_names, 'incidents_immutable_awareness, incidents_no_caller_clock, incidents_no_delete, incidents_no_truncate',
    'seal-rb', 'and they are the four guards by name');

  -- The ordering constraint is back, which is the other half of 0002.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_constraint
      WHERE conname = 'incidents_reported_after_awareness'
        AND conrelid = 'register_seal_probe.incidents'::regclass),
    '1', 'seal-rb', 'the incidents_reported_after_awareness constraint is back');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_views
      WHERE schemaname = 'register_seal_probe' AND viewname = 'incidents_breach_clock'),
    '1', 'seal-rb', 'the clock view is back');
END
$$;

-- And the seal is refused again, for both identities, after the recovery.
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-4'$q$,
    '23001', 'seal-rb', 'after the recovery, DELETE is refused again for the TABLE OWNER');
  PERFORM test_support.assert_raises('test_table_super',
    $q$DELETE FROM register_seal_probe.incidents WHERE ref = 'SEAL-4'$q$,
    '23001', 'seal-rb', 'after the recovery, DELETE is refused again for a FULLY-GRANTED app role');
  PERFORM test_support.assert_raises('test_table_super',
    $q$TRUNCATE register_seal_probe.incidents$q$,
    '23001', 'seal-rb', 'after the recovery, TRUNCATE is refused again for a FULLY-GRANTED app role');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_probe.incidents), '5', 'seal-rb',
    'the recovery refused all three and removed nothing');
END
$$;

-- ---------------------------------------------------------------------------
-- THE ONLY DISARM PATH. rollback/0001 refuses while the register holds evidence.
--
-- assert_raises cannot be used for a whole file: its probe executes a single
-- statement string, and this is a script. So the shipped script's statements are
-- executed inside this plpgsql body -- real text, spliced by the runner's \i --
-- and the refusal is caught here. That is a stronger test than a copy of the
-- guard would be: the assertion is about the file an operator runs.
--
-- TWO INVARIANTS the splice depends on, both of which a future edit could break:
--   * this block's dollar tag is $seal$, not $$, so the shipped script's own
--     `DO $$ ... $$` guard does not terminate this one;
--   * every statement in the shipped script is valid inside a plpgsql body (no
--     SET, no transaction control, no meta-commands).
-- ---------------------------------------------------------------------------
DO $seal$
DECLARE
  v_got  text;
  v_rows integer;
BEGIN
  BEGIN
    PERFORM test_support.as_role(NULL, 'SET search_path = register_seal_probe, public');
\i services/directus/schema/migrations/rollback/20261006_0001_incidents.down.sql
    v_got := 'no error raised -- the disarm ran against a register holding evidence';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.as_role(NULL, 'SELECT 1');

  PERFORM test_support.assert_equals(v_got, '23001', 'seal-rb',
    '0001''s down script REFUSES while the register holds rows (restrict_violation), as it must for an NDPA s.40(2) register');

  SELECT count(*) INTO v_rows FROM register_seal_probe.incidents;
  PERFORM test_support.assert_equals(v_rows::text, '5', 'seal-rb',
    'the refused disarm destroyed nothing: five rows still present');

  -- And the seal is still standing after the refusal, which a partially-applied
  -- disarm would not be.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'register_seal_probe' AND c.relname = 'incidents'
        AND NOT t.tgisinternal
        AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate')),
    '2', 'seal-rb', 'the refused disarm left both evidence guards in place');

  PERFORM test_support.assert_raises('test_table_super',
    $q$TRUNCATE register_seal_probe.incidents$q$,
    '23001', 'seal-rb', 'the register is still sealed after the refusal');
END
$seal$;

-- ---------------------------------------------------------------------------
-- Probe 2: a register with zero rows. This is the only state in which
-- 0001's down script may run, and it has to actually remove the seal.
--
-- Built the same way, and taken through 0001 -> 0002 -> 0002.down -> 0001.down,
-- which is the operator order: 0001.down cannot drop a table that a live 0002
-- view still depends on, and that failure is the correct outcome rather than
-- something to CASCADE past.
-- ---------------------------------------------------------------------------
CREATE SCHEMA register_seal_empty AUTHORIZATION directus_migrator;

SET ROLE directus_migrator;
SET search_path = register_seal_empty, public;
\i services/directus/schema/migrations/20261006_0001_incidents.sql
\i services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql
RESET ROLE;
SET search_path = public;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM register_seal_empty.incidents), '0', 'seal-rb',
    'precondition: the second probe register is genuinely empty, which is the only state 0001''s down accepts');

  -- An empty register is still SEALED, not merely unwatched. The seal is a
  -- property of the table, and nothing here says it waits for the first row.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$TRUNCATE register_seal_empty.incidents$q$,
    '23001', 'seal-rb', 'an empty register is still sealed against TRUNCATE for the table owner');
END
$$;

SET ROLE directus_migrator;
SET search_path = register_seal_empty, public;
\i services/directus/schema/migrations/rollback/20261006_0002_incidents_awareness_at.down.sql
RESET ROLE;
SET search_path = public;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'register_seal_empty' AND c.relname = 'incidents'
        AND NOT t.tgisinternal
        AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate')),
    '2', 'seal-rb', 'the empty register is still sealed after reversing 0002 as well');
END
$$;

-- The disarm, on an empty register. This one is supposed to succeed.
SET ROLE directus_migrator;
SET search_path = register_seal_empty, public;
\i services/directus/schema/migrations/rollback/20261006_0001_incidents.down.sql
RESET ROLE;
SET search_path = public;

DO $$
DECLARE
  v_left integer;
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'register_seal_empty' AND c.relname = 'incidents'),
    '0', 'seal-rb', '0001''s down script dropped the table of an EMPTY register');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'register_seal_empty' AND NOT t.tgisinternal),
    '0', 'seal-rb', 'and with the table, both guard triggers are gone -- this is the one disarm path');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'register_seal_empty'
        AND p.proname IN ('incidents_forbid_delete', 'incidents_forbid_truncate')),
    '0', 'seal-rb', 'and both guard functions are gone');

  -- Not a schema-lookup error: the assertions above could all read zero because
  -- they were counting in a schema that never existed. The public register --
  -- the real one, built by the runner from the same two shipped migrations --
  -- must still hold its seal.
  SELECT count(*) INTO v_left
    FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('incidents_forbid_delete', 'incidents_forbid_truncate');
  PERFORM test_support.assert_equals(v_left::text, '2', 'seal-rb',
    'the live register in public still has both guard functions -- the probe above was counting a schema that existed');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'incidents'
        AND NOT t.tgisinternal
        AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate')),
    '2', 'seal-rb', 'and the live register is still sealed: 0001 now owns it and asserts it');

  -- The forward control in public is unchanged by anything this file did.
  PERFORM test_support.assert_raises('test_table_super',
    $q$TRUNCATE public.incidents$q$,
    '23001', 'seal-rb', 'the live register still refuses TRUNCATE after this suite has run');
END
$$;

-- 0001 is idempotent over an already-sealed register, which is what makes it
-- safe to re-run over a database that predates this change.
SET ROLE directus_migrator;
SET search_path = public;
\i services/directus/schema/migrations/20261006_0001_incidents.sql
RESET ROLE;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'incidents'
        AND NOT t.tgisinternal
        AND t.tgname IN ('incidents_no_delete', 'incidents_no_truncate')),
    '2', 'seal-rb', 're-running 0001 over an already-sealed register leaves exactly one of each guard');
  PERFORM test_support.assert_raises('test_table_super',
    $q$DELETE FROM public.incidents WHERE ref = 'IMMUT-FIXTURE'$q$,
    '23001', 'seal-rb', 'and the seal still refuses');
END
$$;

DROP SCHEMA register_seal_probe CASCADE;
DROP SCHEMA register_seal_empty CASCADE;