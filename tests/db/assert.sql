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
BEGIN
  BEGIN
    BEGIN
      IF p_role IS NOT NULL THEN
        EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
      END IF;
      EXECUTE p_stmt;
      v_got := NULL;
    EXCEPTION WHEN OTHERS THEN
      v_got := SQLSTATE;
    END;
    PERFORM test_support._rollback();
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    -- inner subtransaction discarded: role switch undone, probe's writes undone
  END;
  RETURN v_got;
END $$;

-- Runs a statement as p_role and lets it persist. Unlike probe(), this does NOT
-- roll back -- use it for fixture setup.
--
-- Note: `SET LOCAL ROLE` inside a function leaks until the end of the enclosing
-- transaction, so every privileged statement names its role explicitly and no
-- test relies on the ambient one. Assertions still work under any role because
-- test_support is granted to PUBLIC above.
CREATE OR REPLACE FUNCTION test_support.as_role(p_role text, p_stmt text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
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
  ELSIF v_got <> p_expected_sqlstate THEN
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