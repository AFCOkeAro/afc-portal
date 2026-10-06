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

CREATE SCHEMA IF NOT EXISTS test_support;

CREATE TABLE IF NOT EXISTS test_support.results (
  seq    serial PRIMARY KEY,
  suite  text        NOT NULL,
  name   text        NOT NULL,
  ok     boolean     NOT NULL,
  detail text
);

-- Test-only schema: the roles below need to record results while impersonated.
-- This harness never runs against production, so PUBLIC access here buys
-- simplicity rather than exposure.
GRANT USAGE ON SCHEMA test_support TO PUBLIC;
GRANT INSERT, SELECT ON test_support.results TO PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE test_support.results_seq_seq TO PUBLIC;

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
CREATE OR REPLACE FUNCTION test_support.probe(p_role text, p_stmt text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_got text;
  v_msg text;
BEGIN
  BEGIN
    BEGIN
      EXECUTE 'SET LOCAL ROLE ' || quote_ident(
        COALESCE(p_role, (SELECT v FROM test_support.config WHERE k = 'session_role'))
      );
      EXECUTE p_stmt;
      v_got := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_got := SQLSTATE;
      v_msg := SQLERRM;
    END;
    PERFORM test_support._rollback();
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- inner subtransaction discarded: role switch undone, probe's writes undone
  END;
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

CREATE OR REPLACE FUNCTION test_support.assert_true(
  p_cond boolean, p_suite text, p_name text, p_detail text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_support.results (suite, name, ok, detail)
  VALUES (p_suite, p_name, COALESCE(p_cond, false), p_detail);
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

  IF v_got IS NULL THEN
    INSERT INTO test_support.results (suite, name, ok, detail)
    VALUES (p_suite, p_name, false,
            'no error raised, expected ' || p_expected_sqlstate || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- statement succeeded but % was expected: %',
      p_suite, p_name, p_expected_sqlstate, p_stmt;
  ELSIF split_part(v_got, ' | ', 1) <> p_expected_sqlstate THEN
    INSERT INTO test_support.results (suite, name, ok, detail)
    VALUES (p_suite, p_name, false,
            'expected ' || p_expected_sqlstate || ' got ' || v_got || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- expected % got % : %',
      p_suite, p_name, p_expected_sqlstate, v_got, p_stmt;
  ELSE
    INSERT INTO test_support.results (suite, name, ok, detail)
    VALUES (p_suite, p_name, true, v_got);
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
    INSERT INTO test_support.results (suite, name, ok, detail)
    VALUES (p_suite, p_name, false, 'unexpected ' || v_got || ' from: ' || p_stmt);
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- statement raised % but should not have: %',
      p_suite, p_name, v_got, p_stmt;
  ELSE
    INSERT INTO test_support.results (suite, name, ok, detail)
    VALUES (p_suite, p_name, true, 'no error, as expected');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION test_support.assert_equals(
  p_actual text, p_expected text, p_suite text, p_name text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO test_support.results (suite, name, ok, detail)
  VALUES (p_suite, p_name, p_actual IS NOT DISTINCT FROM p_expected,
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
  INSERT INTO test_support.results (suite, name, ok, detail)
  VALUES (p_suite, p_name, v_ok,
          'actual=' || COALESCE(v_actual, 'NULL')
          || ' expected=' || COALESCE(v_expected, 'NULL'));
  IF NOT v_ok THEN
    RAISE EXCEPTION 'ASSERTION FAILED: [%] % -- actual % expected %',
      p_suite, p_name, COALESCE(v_actual, 'NULL'), COALESCE(v_expected, 'NULL');
  END IF;
END $$;