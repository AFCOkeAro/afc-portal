-- rollback/20261024_0042_directus_runtime_matrix.down.sql
--
-- Reversal for 20261024_0042 (AFC-783 Directus runtime grant matrix).
--
-- What it destroys: exactly the grants the forward file added -- the four
-- DML verbs on every directus_* table, USAGE + SELECT on every directus_*
-- sequence. Application-table grants are untouched (the forward file grants
-- on none), and no table, column, trigger, function, rule, or constraint is
-- dropped anywhere in this file -- the rollback-control gate has nothing to
-- reconcile. No DROP TRIGGER / DROP FUNCTION / DROP RULE appears here.
--
-- What it does NOT destroy: rows, tables, or the migrator's ownership.
-- Revoking Directus's runtime DML stops a running Directus, which is the
-- point of a reversal paired with the runbook rollback (previous wiring +
-- previous WEB_IMAGE, runbook section 8.4).
--
-- HOW IT FAILS (stated, because a rollback that strands is worse than none):
-- REVOKE, like GRANT, needs ownership. Objects this sequence no longer owns
-- (an operator moved them after the forward apply) are SKIPPED with a NOTICE
-- naming each one, never a RAISE: a reversal must run even on a drifted
-- database. Re-run the forward file afterwards to converge back.
--
-- Where the roles are absent (forward never applied on a database without
-- bootstrap) every statement is conditional and the script is a NOTICE-only
-- no-op. Absent tables are not failure either.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_seq text;
  v_tables integer := 0;
  v_skipped integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_app') THEN
    RAISE NOTICE '0042 rollback: directus_app is absent -- nothing granted, nothing to revoke.';
    RETURN;
  END IF;

  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname LIKE 'directus\_%' ESCAPE '\'
     ORDER BY c.relname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.relname = v_table
        AND c.relnamespace = 'public'::regnamespace
        AND c.relowner = 'directus_migrator'::regrole
    ) THEN
      EXECUTE format('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.%I FROM directus_app', v_table);
      v_tables := v_tables + 1;
    ELSE
      RAISE NOTICE '0042 rollback: skipping % (not owned by directus_migrator).', v_table;
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  FOR v_seq IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relname LIKE 'directus\_%' ESCAPE '\'
     ORDER BY c.relname
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.relname = v_seq
        AND c.relnamespace = 'public'::regnamespace
        AND c.relowner = 'directus_migrator'::regrole
    ) THEN
      EXECUTE format('REVOKE USAGE, SELECT ON SEQUENCE public.%I FROM directus_app', v_seq);
    ELSE
      RAISE NOTICE '0042 rollback: skipping sequence % (not owned by directus_migrator).', v_seq;
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '0042 rollback complete: revoked on % table(s), skipped % object(s) not owned by directus_migrator.', v_tables, v_skipped;
END
$$;
