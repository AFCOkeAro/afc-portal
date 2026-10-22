-- tests/db/assert.sql
--
-- Minimal assertion harness. No pgTAP dependency: the confidence boundary here
-- is a handful of SQL behaviours, and a dependency-free harness is easier to
-- trust than a test extension in CI.
--
-- The important design point is how a probe is run. Every probe executes inside
-- a subtransaction that is ALWAYS discarded, whatever the outcome:
--
--   * `SET LOCAL ROLE` inside plpgsql leaks into the rest of the enclosing
--     block, so a role switch has to be undone by construction, not by hoping a
--     RESET ROLE on the next line runs.
--   * A probe that succeeds has usually mutated the row it was probing, and the
--     next assertion should not see that.
--
-- So the probe runs, its result is captured into plpgsql variables (which are
-- not transactional), and the enclosing block is then made to roll back by
-- raising a sentinel that the immediate handler swallows.
--
-- ---------------------------------------------------------------------
-- THE LEDGER: an outcome leaves the database as a NOTICE (AFC-203)
-- ---------------------------------------------------------------------
-- THERE IS DELIBERATELY NO test_support.results TABLE. It used to be the ledger:
--
--     INSERT INTO test_support.results (suite, name, ok, detail) VALUES (...);
--     IF NOT ok THEN RAISE EXCEPTION 'ASSERTION FAILED: ...'; END IF;
--
-- Every suite file is executed as ONE implicit transaction -- the driver sends
-- the whole file as a single multi-statement query -- so the RAISE rolled the
-- INSERT back along with the work it had just described. A failed suite
-- persisted ZERO rows: not the failure, and not the assertions that had already
-- passed before it. Measured, on a clean tree: rows before=311, after=311,
-- probe rows persisted=0, from two passing assertions and one failing one.
--
-- That made the runner's summary line a tautology rather than a measurement.
-- `notOk` counted rows where ok = false, and no such row could physically exist,
-- so every run of this suite printed `0 failing` -- including every run that
-- failed on an assertion. The assertion COUNT was wrong too: a suite that died
-- at its first assertion contributed 0 rows instead of its real count, so a
-- reader could not tell from the ledger whether the assertions after the
-- failure had been evaluated. That is the one question the ledger exists to
-- answer.
--
-- A ledger that structurally cannot record a failure is worse than no ledger,
-- because it prints a number.
--
-- A NOTICE is not transactional: the backend writes it to the client as it is
-- executed, so it survives the rollback that destroys the work it describes.
-- Verified on PGlite for all three shapes -- a notice raised inside a discarded
-- subtransaction, one inside a transaction that is then ROLLBACKed, and one
-- inside a statement that raises on the next line -- and in every shape the
-- notice arrived.
--
-- Consequences the runner relies on:
--   * one notice per ASSERTION ATTEMPTED, emitted before the RAISE, so the
--     reported count equals the number of assertions attempted on a RED run as
--     well as on a green one;
--   * the outcome of a failing assertion reaches the runner even though its
--     transaction is rolled back, so `0 failing` is finally a measurement.
--
-- The payload is JSON behind a fixed marker so that a detail string may contain
-- anything -- quotes, newlines, the marker itself -- and still arrive intact. The
-- runner refuses to run rather than under-count if a marked message will not
-- parse, so a broken ledger cannot masquerade as a shorter one.
--
-- DO NOT ADD THE TABLE BACK. A row written inside the transaction that fails is
-- a row that is missing on exactly the runs that need it, and anyone who queries
-- it instead of the notice stream is reading a false green.
CREATE SCHEMA IF NOT EXISTS test_support;

-- Test-only schema: the roles below need to read the harness's config while
-- impersonated. This harness never runs against production, so PUBLIC access
-- here buys simplicity rather than exposure. Recording an outcome needs no
-- privilege at all, which is the other reason it is a NOTICE and not a write.
GRANT USAGE ON SCHEMA test_support TO PUBLIC;

-- The one and only way an assertion outcome leaves this transaction.
--
-- The marker is duplicated in scripts/run-db-tests.mjs. Change one and you
-- change both, or the ledger silently empties -- which is exactly what
-- `node scripts/run-db-tests.mjs --self-test` exists to catch.
CREATE OR REPLACE FUNCTION test_support._record(
  p_suite text, p_name text, p_ok boolean, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE 'AFC_ASSERT/1 %',
    json_build_object(
      'suite', p_suite,
      'name',  p_name,
      'ok',    COALESCE(p_ok, false),
      'detail', p_detail
    )::text;
END $$;

-- The role that owns this harness. Captured once, because SET LOCAL ROLE leaks
-- out of every helper and no test may rely on the ambient role: NULL means "the
-- session role" everywhere in this harness.
CREATE TABLE IF NOT EXISTS test_support.config (k text PRIMARY KEY, v text);
INSERT INTO test_support.config (k, v) VALUES ('session_role', current_user)
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
GRANT SELECT ON test_support.config TO PUBLIC;

-- Every role in the v4 permission matrix (data-model-v4.md 5), plus one role with
-- strictly more privilege than any Directus role can hold. Created here rather
-- than inside a suite: a suite that fails rolls back, and the suites after it
-- must not lose their cast.
DO $$
DECLARE
  v_role text;
  v_roles text[] := ARRAY[
    'super_admin', 'area_admin', 'branch_admin',
    'welfare_officer', 'staff_volunteer', 'member', 'public'
  ];
BEGIN
  FOREACH v_role IN ARRAY v_roles LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_' || v_role) THEN
      EXECUTE format('CREATE ROLE directus_%I LOGIN', v_role);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_table_super') THEN
    CREATE ROLE test_table_super LOGIN;
  END IF;
END $$;

-- Sentinel raised purely to force a rollback. Never a real test failure.
CREATE OR REPLACE FUNCTION test_support._rollback()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'afc_test_support_rollback' USING ERRCODE = 'P0001';
END $$;

-- Runs p_stmt as p_role inside a discarded subtransaction.
-- Returns the SQLSTATE, or NULL when the statement succeeded.
--
-- AFC-257 / F4. The role switch and the statement must NOT share an exception
-- scope. They used to: `SET LOCAL ROLE` and `EXECUTE p_stmt` sat inside one
-- `BEGIN ... EXCEPTION WHEN OTHERS`, and the handler could not tell which of
-- the two raised, so a REFUSED SWITCH was returned as though the statement had
-- raised. Measured from a real directus_app session:
--
--   probe('retention_worker', 'SELECT 1')  ->  42501 | permission denied to set role "retention_worker"
--   assert_raises('retention_worker', 'SELECT 1', '42501', ...)  ->  PASSED
--
-- `SELECT 1` cannot raise 42501. The statement never ran; the switch was
-- refused, and the assertion certified the refusal as the statement's outcome.
-- Any assertion whose named role the impersonated session does not hold could
-- be satisfied this way, either direction.
--
-- So the switch is captured in its OWN scope, and a refused switch is returned
-- behind a marker (`ROLE_SWITCH_REFUSED`) that is not a five-character SQLSTATE
-- and therefore can never equal an expected code. `assert_raises` cannot pass on
-- it, `assert_not_raises` cannot pass on it, and no statement assertion can
-- satisfy it. A refused switch is a broken fixture and is reported as one.
--
-- Requirement kept intact: naming the role the session already is still works.
-- That switch is ACCEPTED, so the statement runs and the probe returns its real
-- outcome (q2b). Only the refusal is now distinguished.
CREATE OR REPLACE FUNCTION test_support.probe(p_role text, p_stmt text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_switch     text;  -- sqlstate of SET LOCAL ROLE, NULL when the switch was accepted
  v_switch_msg text;
  v_got        text;  -- sqlstate of p_stmt, NULL when the statement succeeded
  v_msg        text;
BEGIN
  BEGIN
    -- The switch gets its own exception scope, so a refusal cannot be mistaken
    -- for the statement's outcome (AFC-257).
    BEGIN
      EXECUTE 'SET LOCAL ROLE ' || quote_ident(
        COALESCE(p_role, (SELECT v FROM test_support.config WHERE k = 'session_role'))
      );
    EXCEPTION WHEN OTHERS THEN
      v_switch := SQLSTATE;
      v_switch_msg := SQLERRM;
    END;

    -- Run the statement only if the switch was accepted. Otherwise the probe
    -- would execute p_stmt under the WRONG identity and report that as the
    -- statement's own behaviour.
    IF v_switch IS NULL THEN
      BEGIN
        EXECUTE p_stmt;
        v_got := NULL;
      EXCEPTION WHEN OTHERS THEN
        v_got := SQLSTATE;
        v_msg := SQLERRM;
      END;
    END IF;

    PERFORM test_support._rollback();
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- inner subtransaction discarded: role switch undone, probe's writes undone
  END;

  IF v_switch IS NOT NULL THEN
    -- A marker, not a SQLSTATE: split_part(..., ' | ', 1) can never equal the
    -- five-character code a statement assertion expects, so the refusal cannot
    -- be certified by assert_raises or assert_not_raises.
    RETURN 'ROLE_SWITCH_REFUSED ' || v_switch
      || CASE WHEN v_switch_msg IS NULL THEN '' ELSE ' | ' || v_switch_msg END;
  END IF;
  -- the message rides along in the sqlstate slot only in debug builds, so it is
  -- appended where the assertion can print it
  RETURN v_got || CASE WHEN v_msg IS NULL THEN '' ELSE ' | ' || v_msg END;
END $$;

-- Runs a statement as p_role and lets it persist. Unlike probe(), this does NOT
-- roll back -- use it for fixture setup. p_role NULL means the session role.
--
-- Note: `SET LOCAL ROLE` inside a function leaks until the end of the enclosing
-- transaction, so every privileged statement names its role explicitly and no
-- test relies on the ambient one. Assertions still work under any role because
-- test_support is granted to PUBLIC above.
CREATE OR REPLACE FUNCTION test_support.as_role(p_role text, p_stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(
    COALESCE(p_role, (SELECT v FROM test_support.config WHERE k = 'session_role'))
  );
  EXECUTE p_stmt;
END $$;

CREATE OR REPLACE FUNCTION test_support.can_select(p_role text, p_table text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT has_table_privilege(p_role, 'public.' || p_table, 'SELECT')
$$;

CREATE OR REPLACE FUNCTION test_support.can_insert(p_role text, p_table text, p_cols text[] DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_cols IS NULL THEN
    RETURN has_table_privilege(p_role, 'public.' || p_table, 'INSERT');
  END IF;
  RETURN NOT EXISTS (
    SELECT 1 FROM unnest(p_cols) AS c
    WHERE NOT has_column_privilege(p_role, 'public.' || p_table, c, 'INSERT')
  );
END $$;

CREATE OR REPLACE FUNCTION test_support.can_update(p_role text, p_table text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT has_table_privilege(p_role, 'public.' || p_table, 'UPDATE')
$$;

CREATE OR REPLACE FUNCTION test_support.can_delete(p_role text, p_table text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT has_table_privilege(p_role, 'public.' || p_table, 'DELETE')
$$;

CREATE OR REPLACE FUNCTION test_support.table_exists(p_table text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT to_regclass('public.' || p_table) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION test_support.column_exists(p_table text, p_col text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = p_table
                    AND column_name = p_col)
$$;

CREATE OR REPLACE FUNCTION test_support.assert_true(
  p_cond boolean, p_suite text, p_name text, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test_support._record(p_suite, p_name, COALESCE(p_cond, false), p_detail);
  IF NOT COALESCE(p_cond, false) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- %', p_suite, p_name, COALESCE(p_detail, 'no detail');
  END IF;
END $$;

-- The workhorse. p_role NULL means "as the runner session".
--   23001 restrict_violation   the trigger rejected it -- THE CONTROL
--   42501 insufficient_privilege the grant list rejected it -- second layer
--   23514 check_violation      a CHECK constraint rejected it
--   0A000 feature_not_supported the operation does not exist (e.g. TRUNCATE
--                              denied by a privilege error, not a trigger)
CREATE OR REPLACE FUNCTION test_support.assert_raises(
  p_role text, p_stmt text, p_expected_sqlstate text, p_suite text, p_name text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_got text;
BEGIN
  v_got := test_support.probe(p_role, p_stmt);

  -- AFC-299 / F2. A refused role switch is a broken FIXTURE, not the
  -- statement's outcome, and no expected string a caller can legitimately pass
  -- begins with the marker -- so this fails regardless of p_expected_sqlstate.
  -- Before this branch the marker was accepted only when the caller passed the
  -- marker's own split_part prefix as p_expected_sqlstate, which no call site
  -- did: the guarantee was convention-enforced, not type-enforced.
  IF v_got LIKE 'ROLE_SWITCH_REFUSED %' THEN
    PERFORM test_support._record(p_suite, p_name, false,
      'a refused role switch is a broken fixture, not the statement''s outcome: ' || v_got);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- a refused role switch is a broken fixture: %',
      p_suite, p_name, v_got;
  END IF;

  IF v_got IS NULL THEN
    PERFORM test_support._record(p_suite, p_name, false,
      'no error raised, expected ' || p_expected_sqlstate || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- statement succeeded but % was expected: %',
      p_suite, p_name, p_expected_sqlstate, p_stmt;
  ELSIF split_part(v_got, ' | ', 1) <> p_expected_sqlstate THEN
    PERFORM test_support._record(p_suite, p_name, false,
      'expected ' || p_expected_sqlstate || ' got ' || v_got || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- expected % got % : %',
      p_suite, p_name, p_expected_sqlstate, v_got, p_stmt;
  ELSE
    PERFORM test_support._record(p_suite, p_name, true, v_got);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION test_support.assert_not_raises(
  p_role text, p_stmt text, p_suite text, p_name text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_got text;
BEGIN
  v_got := test_support.probe(p_role, p_stmt);

  IF v_got IS NOT NULL THEN
    PERFORM test_support._record(p_suite, p_name, false,
      'unexpected ' || v_got || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- statement raised % but should not have: %',
      p_suite, p_name, v_got, p_stmt;
  ELSE
    PERFORM test_support._record(p_suite, p_name, true, 'no error, as expected');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION test_support.assert_equals(
  p_actual text, p_expected text, p_suite text, p_name text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM test_support._record(p_suite, p_name, p_actual IS NOT DISTINCT FROM p_expected,
          'actual=' || COALESCE(p_actual, 'NULL') || ' expected=' || COALESCE(p_expected, 'NULL'));
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- actual % expected %',
      p_suite, p_name, COALESCE(p_actual, 'NULL'), COALESCE(p_expected, 'NULL');
  END IF;
END $$;

-- Compares two INSTANTS. Added in AFC-202.
--
-- WHY THIS IS NOT assert_equals WITH A CAST. Casting a timestamptz to text
-- renders it in the SESSION TimeZone, so an assertion of the shape
-- `assert_equals(<column>::text, <a UTC-pinned string literal>, ...)` only
-- holds on a session whose TimeZone is UTC. PGlite defaults to GMT and GitHub
-- Actions' ubuntu-latest defaults to UTC, so that shape went green in CI by
-- accident of the runner's clock rather than because the assertion was correct.
-- For a control that is NDPA s.40(2) legal evidence, that is the worst
-- available failure mode: the evidence is right for the wrong reason.
-- `timestamptz = timestamptz` compares instants and is therefore independent of
-- the session TimeZone, of DateStyle, and of the host.
--
-- NOTE FOR THE NEXT SEARCH. The anti-pattern is deliberately described in words
-- here rather than written out, so that `grep -E "::text" tests/db/*.sql` next
-- to a '+00' timestamp literal returns nothing. A comment that quotes the wrong
-- form makes the check that catches the wrong form report a false positive for
-- ever, and it gets deleted by the first person who tidies the file.
--
-- The detail string is rendered AT UTC on both sides, so a failure message is
-- the same text on every runner and a red run can be compared across hosts.
-- Microseconds are included: a rendering that silently truncated would let two
-- differing instants print identically. The offset is TZH:TZM with no literal
-- '+' in the mask -- a bare '+' is not a format code, so it prints as itself and
-- the message comes out as '++00:00'.
CREATE OR REPLACE FUNCTION test_support.assert_instant(
  p_actual timestamptz, p_expected timestamptz, p_suite text, p_name text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_actual   text := to_char(p_actual   AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US TZH:TZM');
  v_expected text := to_char(p_expected AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US TZH:TZM');
  -- IS NOT DISTINCT FROM, so a NULL actual FAILS the way a wrong instant fails
  -- instead of passing on a NULL comparison.
  v_ok boolean := p_actual IS NOT DISTINCT FROM p_expected;
BEGIN
  PERFORM test_support._record(p_suite, p_name, v_ok,
          'actual=' || COALESCE(v_actual, 'NULL')
          || ' expected=' || COALESCE(v_expected, 'NULL'));
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- actual % expected %',
      p_suite, p_name, COALESCE(v_actual, 'NULL'), COALESCE(v_expected, 'NULL');
  END IF;
END $$;