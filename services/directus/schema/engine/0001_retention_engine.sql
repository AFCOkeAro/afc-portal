-- services/directus/schema/engine/0001_retention_engine.sql
--
-- THE RETENTION ENGINE. AFC-167 / ADR-159-2 D1-D6.
--
-- WHY THIS FILE IS NOT UNDER migrations/
--   Two reasons, both load-bearing.
--
--   1. It is scanned by scripts/retention-literal-gate.sh. The migrations
--      directory is exempt from that gate, because a migration has to be able
--      to state the period it was created with. The engine must never be able
--      to state one at all. Putting the code that computes a due date in the
--      exempt directory would make D1 unenforceable exactly where it matters
--      most, and the gate would be a green tick over an unenforced rule.
--
--   2. It is not schema history. Migrations are an ordered, reviewed record of
--      what the database looked like on a date. The engine is behaviour that
--      can be replaced without a migration. Conflating them means every engine
--      fix gets a migration number, and the history stops being readable.
--
-- Loaded by scripts/run-db-tests.mjs after the migrations, as the owner role,
-- and in production by the same bootstrap path that applies migrations.
--
-- D1. NO RETENTION PERIOD APPEARS IN THIS FILE. Not in a function body, not in
-- a default, not in a comment. Every duration is read from
-- retention_policies, which is the single auditable place the schedule lives,
-- and every anchor and erasure target is read from the two source-map tables.
-- A counsel instruction that changes a period is a row update. If you find
-- yourself wanting to type a number here, that is the bug this file is
-- arranged to prevent.
--
-- Build vs buy: settled in ADR-159-2 section 3. Third-party retention/DSAR
-- tooling was rejected -- the integration surface (a policy table, a computed
-- due date, a deletion job, a manifest) costs more than it saves at our size.
-- REVISIT TRIGGER, and not earlier: distinct retention classes exceed roughly
-- fifteen, OR a second legal entity comes into scope. Recorded here so the next
-- engineer finds it in the file rather than in a meeting.

-- The schema is a bootstrap object, created alongside the roles, because the
-- engine installs as directus_migrator and that role has no CREATE on the
-- database. Failing loudly rather than creating it here keeps the grant
-- requirement in one documented place instead of two.
DO $$
BEGIN
  IF to_regnamespace('retention') IS NULL THEN
    RAISE EXCEPTION
      'schema retention is missing. It is a bootstrap object (see services/directus/schema/migrations/README.md), created alongside retention_worker.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

COMMENT ON SCHEMA retention IS
  'Retention engine. Config-driven: retention_policies holds the schedule, the two source maps hold anchor and erasure-target resolution, and this schema holds no period.';

-- Default deny on the schema itself, then the two roles that need it. Without
-- this, PUBLIC gets USAGE on a newly created schema and every role in the
-- instance can reach the deletion path.
REVOKE ALL ON SCHEMA retention FROM PUBLIC;

-- ===========================================================================
-- 1. computeDueDate -- the ONLY place a due date is produced.
--
--   due = operator(anchor_a_value + floor_years,
--                  anchor_b_value + age_threshold_years)
--
--   The age-anchor term is omitted entirely when age_threshold_years is NULL.
--   greatest()/least() ignore NULL operands, so "omitted" and "ignored" are the
--   same thing here -- which is the correct reading of a policy that has one
--   anchor rather than two.
--
--   Returns NULL when no operand exists at all. The caller turns that into
--   state = 'indeterminate', never into "due" and never into "delete now".
--   See retention.sync_clocks and section 4.
--
--   The interval is BUILT from the configured integer rather than written as a
--   literal. That is not a formatting preference: it is what makes the value
--   genuinely come from the config row.
-- ===========================================================================
CREATE OR REPLACE FUNCTION retention.add_years(
  p_ts timestamptz, p_years integer
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT p_ts + (p_years::text || ' ' ||
                 CASE WHEN abs(p_years) = 1 THEN 'year' ELSE 'years' END)::interval;
$$;

CREATE OR REPLACE FUNCTION retention.compute_due_date(
  p_anchor_a_value      timestamptz,
  p_anchor_b_value      timestamptz,
  p_floor_years         integer,
  p_age_threshold_years integer,
  p_operator            text
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_operator
           WHEN 'whichever_later'
             THEN GREATEST(
                    CASE WHEN p_floor_years IS NOT NULL AND p_anchor_a_value IS NOT NULL
                         THEN retention.add_years(p_anchor_a_value, p_floor_years) END,
                    CASE WHEN p_age_threshold_years IS NOT NULL AND p_anchor_b_value IS NOT NULL
                         THEN retention.add_years(p_anchor_b_value, p_age_threshold_years) END)
           WHEN 'whichever_earlier'
             THEN LEAST(
                    CASE WHEN p_floor_years IS NOT NULL AND p_anchor_a_value IS NOT NULL
                         THEN retention.add_years(p_anchor_a_value, p_floor_years) END,
                    CASE WHEN p_age_threshold_years IS NOT NULL AND p_anchor_b_value IS NOT NULL
                         THEN retention.add_years(p_anchor_b_value, p_age_threshold_years) END)
           ELSE NULL
         END;
$$;

COMMENT ON FUNCTION retention.compute_due_date(timestamptz, timestamptz, integer, integer, text) IS
  'ADR-159-2 D1: the only place a due date is produced. Operands come from retention_policies; this function contains no period.';

-- Fail-closed predicate, named so the call site reads as the decision it is.
-- A configured operand whose anchor value is NULL means the event has not
-- happened yet: the case is not closed. There is no due date, and no path from
-- here to a deletion.
CREATE OR REPLACE FUNCTION retention.anchor_missing(
  p_anchor_a_value timestamptz,
  p_anchor_b_value timestamptz,
  p_floor_years integer,
  p_age_threshold_years integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_floor_years IS NOT NULL AND p_anchor_a_value IS NULL)
      OR (p_age_threshold_years IS NOT NULL AND p_anchor_b_value IS NULL);
$$;

-- ===========================================================================
-- 2. Anchor resolution. Which column holds which event is CONFIG.
--
-- Two shapes, both from retention_anchor_sources:
--   is_person_attribute = true   the value lives on the person row
--   is_person_attribute = false  the value lives on an event row the class
--                                 points at, most recent one wins
--
-- The dynamic SQL is built from a value that only a privileged config edit can
-- change. The tables and columns are constrained by FOREIGN KEY-free config,
-- so a mistyped anchor would raise at run time and fail the whole run closed --
-- the engine never silently reads the wrong column.
-- ===========================================================================
CREATE OR REPLACE FUNCTION retention.resolve_anchor(
  p_anchor_key text, p_person_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_src       public.retention_anchor_sources%ROWTYPE;
  v_value     timestamptz;
BEGIN
  SELECT * INTO v_src FROM public.retention_anchor_sources ras WHERE ras.anchor_key = p_anchor_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention anchor % is not configured in retention_anchor_sources', p_anchor_key
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF v_src.is_person_attribute THEN
    EXECUTE format('SELECT max(%I::timestamptz) FROM public.%I WHERE id = $1',
                   v_src.column_name, v_src.table_name)
      INTO v_value USING p_person_id;
  ELSE
    -- Event anchors: the most recent value at or before now(). An event row
    -- stamped in the future is not evidence the event has happened, and using
    -- it would start the clock before the event.
    EXECUTE format(
      'SELECT max(%I::timestamptz) FROM public.%I WHERE %I = $1 AND %I::timestamptz <= now()',
      v_src.column_name, v_src.table_name, v_src.person_column, v_src.column_name)
      INTO v_value USING p_person_id;
  END IF;

  RETURN v_value;
END $$;

-- ===========================================================================
-- 3. sync_clocks -- materialise and recompute one clock per
--    (person, active policy), per category. Never per person (D3).
--
--    Recomputation is total: every live person x every active policy that names
--    a person anchor gets a clock, and due_at is recomputed from the policy as
--    it stands now. A policy revision therefore moves due dates on the next
--    run with no backfill script and no code change, which is the whole promise
--    of D1.
--
--    state is derived, not stored-and-hoped:
--      anchor missing for a configured operand  -> indeterminate   (fail closed)
--      due_at computed and reached              -> due
--      due_at computed and not yet reached      -> live
--      due_at not computable at all             -> indeterminate
--
--    SCALABILITY, stated rather than discovered later. This is a full
--    recompute: active people x active policies, with one dynamic anchor
--    resolution per pair. At the shape the data model currently implies that is
--    six classes over twenty thousand people, and it is a few hundred thousand
--    single-row lookups per run -- acceptable for a first schedule-driven run,
--    not something to leave unattended at ten times the size. The fix when it
--    bites is to resolve each anchor once per (anchor, person) rather than once
--    per (policy, person): the same answer, computed fewer times, with no change
--    to what is stored. Measured before optimised, per the scalability lens --
--    the input that matters here is the class count, not the row count.
-- ===========================================================================
CREATE OR REPLACE FUNCTION retention.sync_clocks(p_now timestamptz DEFAULT now())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, retention, pg_temp AS $$
DECLARE
  r          public.retention_policies%ROWTYPE;
  v_person   public.people%ROWTYPE;
  v_a        timestamptz;
  v_b        timestamptz;
  v_due      timestamptz;
  v_missing  boolean;
  v_state    text;
  v_count    integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM retention_policies
     WHERE is_active
  ORDER BY retention_class, rule_key
  LOOP
    FOR v_person IN
      SELECT * FROM people WHERE status = 'active' ORDER BY id
    LOOP
      -- A policy with no resolvable person anchor is a configuration error, and
      -- it surfaces as an exception from resolve_anchor() rather than as a
      -- silently skipped row. Silently skipping is how a rule stops firing and
      -- nobody notices for a year.

      v_a := retention.resolve_anchor(r.anchor_a,  v_person.id);
      v_b := CASE WHEN r.anchor_b IS NULL THEN NULL
                  ELSE retention.resolve_anchor(r.anchor_b, v_person.id) END;

      v_missing := retention.anchor_missing(v_a, v_b, r.floor_years, r.age_threshold_years);
      v_due     := retention.compute_due_date(v_a, v_b, r.floor_years, r.age_threshold_years, r.operator);

      -- Fail closed. No branch of this function turns a missing anchor into a
      -- due date, and no branch turns an indeterminate clock into a deletion.
      IF v_missing OR v_due IS NULL THEN
        v_state := 'indeterminate';
        v_due   := NULL;
      ELSIF v_due <= p_now THEN
        v_state := 'due';
      ELSE
        v_state := 'live';
      END IF;

      INSERT INTO retention_clocks AS rc
        (person_id, retention_class, policy_id, policy_version,
         anchor_a_value, anchor_b_value, due_at, state, computed_at)
      VALUES
        (v_person.id, r.retention_class, r.id, r.version,
         v_a, v_b, v_due, v_state, p_now)
      ON CONFLICT (person_id, retention_class) DO UPDATE
        SET policy_id       = EXCLUDED.policy_id,
            policy_version  = EXCLUDED.policy_version,
            anchor_a_value  = EXCLUDED.anchor_a_value,
            anchor_b_value  = EXCLUDED.anchor_b_value,
            due_at          = EXCLUDED.due_at,
            -- 'held' and 'deleted' are not overwritten by a resync. A hold is
            -- a legal decision and survives a schedule change; a deleted clock
            -- is history and its state is what the manifest refers to.
            state           = CASE WHEN rc.state IN ('held', 'deleted', 'pseudonymised')
                                  THEN rc.state ELSE EXCLUDED.state END,
            computed_at     = EXCLUDED.computed_at;

      v_count := v_count + 1;
    END LOOP;
  END LOOP;

  RETURN v_count;
END $$;

COMMENT ON FUNCTION retention.sync_clocks(timestamptz) IS
  'Recomputes one retention clock per (person, active policy class). A missing anchor yields state=indeterminate and due_at NULL: fail closed, never deletable.

  SECURITY DEFINER: this is the engine write path. retention_worker holds SELECT on the tables and no INSERT or UPDATE, so it cannot recompute clocks as itself -- it can only ask the engine to. The same reason retention.run is SECURITY DEFINER, and the same consequence: the owner role holds the write privilege, so the clock-state trigger tests current_user and allows the owner by design.';

-- ===========================================================================
-- 4. has_active_hold -- D4. The hold check, factored so the SELECT and the
--    erasure both call it and cannot disagree.
-- ===========================================================================
CREATE OR REPLACE FUNCTION retention.has_active_hold(
  p_person_id uuid, p_retention_class text
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.legal_holds lh
     WHERE lh.released_at IS NULL
       AND ( (lh.scope_type = 'person'           AND lh.scope_id = p_person_id::text)
          OR (lh.scope_type = 'retention_class'  AND lh.scope_id = p_retention_class)
          OR (lh.scope_type = 'collection'       AND lh.scope_id IN (
                SELECT rcs.table_name FROM public.retention_class_sources rcs
                 WHERE rcs.retention_class = p_retention_class) )
          )
  );
$$;

-- Terminal ladder stage, from the policy's own stage list. The list is config,
-- so counsel adding a stage is a JSON update on the policy row.
CREATE OR REPLACE FUNCTION retention.terminal_ladder_stage(p_ladder jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_ladder) = 'array'
             THEN p_ladder -> -1 ->> 0
           ELSE NULL
         END;
$$;

-- Ladder reached? A policy with no ladder configured has no stages to reach,
-- and treating "no ladder" as "not reached" would strand every record
-- forever. Treating it as reached keeps the fail-closed decision on the two
-- things that are actually load-bearing: the hold and the due date.
CREATE OR REPLACE FUNCTION retention.ladder_reached(
  p_ladder jsonb, p_stage text
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN jsonb_typeof(p_ladder) = 'array'
             THEN p_stage = retention.terminal_ladder_stage(p_ladder)
           ELSE true
         END;
$$;

-- ===========================================================================
-- 5. retention.run -- the only deletion path in the system. D6.
--
--   * single-writer, guarded by pg_try_advisory_lock, so two runs cannot
--     overlap even if the scheduler double-fires
--   * dry_run is the default; 'live' must be passed explicitly
--   * live erasure additionally requires retention_policies.delete_enabled,
--     which is a separately audited config change
--   * idempotent: re-running after a success selects nothing, because every
--     selected clock is already state='deleted' and therefore already_deleted
--   * every examined clock produces one manifest item with a reason for every
--     skip
--
--   Order of checks is fixed and is the security property, not an
--   implementation detail: HOLD (D4) -> LADDER (D5) -> DUE DATE -> delete_enabled.
--   A hold wins over everything, including an already-due clock and an enabled
--   policy. That ordering is asserted in tests/db/61_retention_holds.sql.
--
-- SECURITY DEFINER: the worker role holds no DELETE grant on any collection, so
-- erasure happens through this function's rights. That is deliberate -- it is
-- what makes "the job is the only deletion path" true rather than aspirational.
-- The cost is that this function must re-check the hold at the moment of
-- erasure instead of trusting the selection, because between selection and
-- erasure a hold can be placed. It does.
-- ===========================================================================
CREATE OR REPLACE FUNCTION retention.run(
  p_actor text,
  p_mode text DEFAULT 'dry_run',
  p_now timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, retention, pg_temp AS $$
DECLARE
  v_run_id      uuid := gen_random_uuid();
  v_lock        boolean;
  v_lock_key    bigint := 4210245981; -- arbitrary fixed key; one engine, one slot
  c             record;
  v_held        boolean;
  v_reached     boolean;
  v_enabled     boolean;
  v_action      text;
  v_skip        text;
  v_deleted     integer := 0;
  v_would       integer := 0;
  v_skipped     integer := 0;
  v_held_n      integer := 0;
  v_indet_n     integer := 0;
  v_failed      integer := 0;
  v_targets     integer;
  v_src         record;
  v_erased      record;
BEGIN
  IF p_mode NOT IN ('dry_run', 'live') THEN
    RAISE EXCEPTION 'retention.run mode must be dry_run or live, got %', p_mode
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_lock := pg_try_advisory_lock(v_lock_key);
  IF NOT v_lock THEN
    RAISE EXCEPTION 'a retention run is already in progress (advisory lock %)', v_lock_key
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- SINGLE WRITER, and the limits of this guard are documented rather than
  -- glossed:
  --
  --   * The advisory lock DOES stop a second session. That is the real case:
  --     two scheduler firings overlapping.
  --   * It is RE-ENTRANT within one session, so two calls on the same
  --     connection are not stopped by it. Deployment requirement: one call per
  --     connection, which is what a scheduler does.
  --   * It is RELEASED when a session ends, so it does NOT survive a crash.
  --
  -- There is deliberately NO second "a run is already open" check on the run
  -- table here. It looks like a durable crash guard and is not one: the run row
  -- is written inside the same transaction as the work, so a crashed run rolls
  -- its own row back and leaves nothing for a later run to find. A control that
  -- cannot survive the transaction it is meant to survive is worse than no
  -- control, because it reads as covered. Crash detection is the scheduler's
  -- job-failure alert and the WARNING emitted below -- see the failure handler.

  INSERT INTO retention_runs (run_id, mode, status, actor, lock_token, started_at)
  VALUES (v_run_id, p_mode, 'running', p_actor, v_lock_key::text, p_now);

  BEGIN
    FOR c IN
      SELECT rc.id, rc.person_id, rc.retention_class, rc.policy_id,
             rc.policy_version, rc.due_at, rc.state, rc.ladder_stage,
             rp.delete_enabled, rp.ladder_stages
        FROM retention_clocks rc
        JOIN retention_policies rp ON rp.id = rc.policy_id
       -- A clock is a candidate at all only when its due date is reached.
       -- Selection is by due_at, not by state, so an 'indeterminate' clock
       -- (due_at NULL) can never be selected: NULL <= now() is NULL, not true.
       WHERE rc.due_at IS NOT NULL
         AND rc.due_at <= p_now
         -- Live erasure is only ever against a policy that is currently
         -- active. A clock left behind by a superseded rule is evaluated,
         -- reported, and not erased by a rule that is no longer in force.
         AND (rp.is_active OR p_mode = 'dry_run')
       ORDER BY rc.retention_class, rc.person_id
    LOOP
      -- 1. LEGAL HOLD. Wins over everything below, and is re-read here at the
      --    moment of erasure rather than at selection time.
      v_held := retention.has_active_hold(c.person_id, c.retention_class);
      IF v_held THEN
        UPDATE retention_clocks SET state = 'held' WHERE id = c.id;
        v_action := 'skipped'; v_skip := 'held';
        v_held_n := v_held_n + 1; v_skipped := v_skipped + 1;
      -- 1b. Already erased. Ahead of the enablement check so a second run
      --     reports the truthful reason even if the policy has since been
      --     disabled -- which is what makes the idempotence test meaningful.
      ELSIF c.state = 'deleted' THEN
        v_action := 'skipped'; v_skip := 'already_deleted';
        v_skipped := v_skipped + 1;
      -- 2. LADDER STAGE (D5).
      ELSIF NOT retention.ladder_reached(c.ladder_stages, c.ladder_stage) THEN
        v_action := 'skipped'; v_skip := 'ladder_stage_not_reached';
        v_skipped := v_skipped + 1;
      -- 3. DUE DATE is already satisfied: it is the SELECT predicate. Named
      --    here only so the fixed order is legible in the code.
      -- 4. DELETE ENABLED.
      ELSIF NOT c.delete_enabled THEN
        v_action := 'skipped'; v_skip := 'policy_delete_disabled';
        v_skipped := v_skipped + 1;
      ELSE
        IF p_mode = 'live' THEN
          -- Erase, per category, through the configured target map. The person
          -- row is never touched: D3.
          --
          -- A class with NO configured erasure targets is refused rather than
          -- quietly no-opped. Marking a clock 'deleted' and writing 'deleted'
          -- into the compliance manifest when no row was removed is the one
          -- outcome worse than not running: it is a false record of erasure,
          -- produced by the control that exists to make erasure provable.
          -- Raising here fails the run, leaves the manifest row status='failed',
          -- and stops nobody being erased on a misconfiguration.
          v_targets := (SELECT count(*) FROM public.retention_class_sources rcs
                         WHERE rcs.retention_class = c.retention_class);
          IF v_targets = 0 THEN
            RAISE EXCEPTION
              'retention class % has no erasure targets in retention_class_sources, so no erasure can be performed and none will be recorded as performed.'
              , c.retention_class
              USING ERRCODE = 'restrict_violation';
          END IF;

          -- The table name comes from config only, and a config row naming a
          -- table that does not exist raises here rather than erasing nothing.
          FOR v_src IN
            SELECT rcs.table_name, rcs.person_column
              FROM public.retention_class_sources rcs
             WHERE rcs.retention_class = c.retention_class
          LOOP
            FOR v_erased IN
              EXECUTE format(
                'WITH gone AS (DELETE FROM public.%I WHERE %I = $1 RETURNING 1)
                 SELECT count(*) AS n FROM gone', v_src.table_name, v_src.person_column)
              USING c.person_id
            LOOP
              NULL;
            END LOOP;
          END LOOP;

          UPDATE retention_clocks SET state = 'deleted' WHERE id = c.id;
          v_action := 'deleted'; v_skip := NULL; v_deleted := v_deleted + 1;
        ELSE
          v_action := 'would_delete'; v_skip := NULL; v_would := v_would + 1;
        END IF;
      END IF;

      INSERT INTO retention_run_items
        (run_id, person_id, retention_class, policy_version, due_at, action, skip_reason)
      VALUES
        (v_run_id, c.person_id, c.retention_class, c.policy_version, c.due_at, v_action, v_skip);
    END LOOP;

    -- Indeterminate clocks are not candidates, so they produce no manifest
    -- item. They get their own count, because "the job ran and found N records
    -- it could not date" is a data-quality alarm and reporting it as zero is
    -- how a retention job that silently stops looks compliant.
    SELECT count(*) INTO v_indet_n
      FROM retention_clocks WHERE state = 'indeterminate';
    v_failed := 0;

    UPDATE retention_runs
       SET finished_at = p_now,
           status      = 'succeeded',
           counts      = jsonb_build_object(
             'deleted',     v_deleted,
             'would_delete', v_would,
             'skipped',     v_skipped,
             'held',        v_held_n,
             'indeterminate', v_indet_n,
             'failed',      v_failed
           )
     WHERE run_id = v_run_id;

    PERFORM pg_advisory_unlock(v_lock_key);
    RETURN v_run_id;
  EXCEPTION WHEN OTHERS THEN
    -- Fail the run. The run row and the partial manifest are in the same
    -- transaction as the failure, so they roll back with it: a failed retention
    -- run leaves NO retention_runs row. That is not an oversight, and it is not
    -- papered over with a best-effort UPDATE that dies in the same rollback --
    -- an UPDATE here would appear to record the failure and then be undone.
    --
    -- So the durable evidence is emitted where it survives the abort:
    --
    --   RAISE WARNING  goes to the server log, which is outside the transaction.
    --                 This is what the job-failure alert reads.
    --   the error is re-raised, so the caller and the scheduler both see it and
    --                 the scheduler's own failure alert fires.
    --
    -- Consequence to record against AFC-167 section 8.6: job failure is alerted
    -- from the log and the scheduler, NOT from retention_metrics. A metrics row
    -- that can never be non-zero is an alarm that always reads healthy.
    RAISE WARNING
      'retention.run FAILED actor=% mode=% error=%', p_actor, p_mode, left(SQLERRM, 1500);
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;
END $$;

COMMENT ON FUNCTION retention.run(text, text, timestamptz) IS
  'The only deletion path. Dry-run default, single-writer advisory lock, hold checked at erasure time. Order: hold -> ladder -> due -> delete_enabled.';

-- ===========================================================================
-- 6. Observability. Five metrics, one view. Source of the alert rules.
--
--    A retention job that silently stops is unbounded liability that reports
--    itself as compliant, so `indeterminate` and `held` are exported alongside
--    the deletion counts rather than left to a query somebody remembers to run.
-- ===========================================================================
CREATE OR REPLACE VIEW retention_metrics AS
SELECT
  (SELECT count(*) FROM retention_clocks WHERE due_at IS NOT NULL AND due_at <= now())::bigint
    AS retention_records_past_due,
  (SELECT count(*) FROM retention_clocks WHERE state = 'deleted')::bigint
    AS retention_records_deleted,
  (SELECT count(*) FROM retention_clocks WHERE state = 'held')::bigint
    AS retention_records_held,
  (SELECT count(*) FROM retention_clocks WHERE state = 'indeterminate')::bigint
    AS retention_records_indeterminate,
  (SELECT count(*) FROM retention_runs WHERE status = 'failed')::bigint
    AS retention_runs_failed,
  (SELECT coalesce(string_agg(r.error, ' | '), '') FROM retention_runs r
    WHERE r.status = 'failed') AS retention_runs_failed_reason,
  (SELECT max(started_at) FROM retention_runs)                AS retention_last_run_at,
  (SELECT count(*) FROM retention_clocks WHERE state = 'pseudonymised')::bigint
    AS retention_records_pseudonymised;

COMMENT ON VIEW retention_metrics IS
  'AFC-167 section 8.6 metrics. Alert on: a non-zero indeterminate count (a data-quality alarm, not a delete signal), and job not run in N hours via retention_last_run_at.

  DEVIATION, recorded deliberately: retention_runs_failed counts runs RECONCILED as failed, not live failures. A run that fails rolls its own row back with the transaction, so it cannot appear here -- see retention.run section 5. Live job failure is alerted from the server log WARNING and the scheduler failure alert. A metric that is structurally always zero is an alarm that always reads healthy, which is worse than no alarm.';

-- Release of a hold, stamped by the database rather than by the caller. A
-- release is the moment erasure becomes permissible again, so the actor on it
-- is evidence, not bookkeeping.
CREATE OR REPLACE FUNCTION retention.release_hold(
  p_hold_id uuid, p_released_by uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, retention, pg_temp AS $$
BEGIN
  IF p_released_by IS NULL THEN
    RAISE EXCEPTION 'a legal hold release must name who released it'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE legal_holds
     SET released_by = p_released_by, released_at = now()
   WHERE id = p_hold_id AND released_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active legal hold % to release', p_hold_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END $$;

-- Argument validation on this function uses invalid_parameter_value (22023),
-- not restrict_violation. Across this codebase 23001 means "a control rejected
-- an operation", which is what an immutable trigger or a live hold does; using
-- it for a NULL argument would blur exactly the distinction an operator reads
-- a log to make.
COMMENT ON FUNCTION retention.release_hold(uuid, uuid) IS
  'Releases a legal hold, stamping actor and time from the database. The row survives: a release is history.';

-- ===========================================================================
-- 7. Grants. Default deny, then the minimum.
--
--   retention_worker  EXECUTE on run/sync_clocks only. It holds no DELETE on
--                     any collection; erasure happens inside SECURITY DEFINER
--                     so that "the job is the only deletion path" is enforced
--                     by the grant list rather than by discipline.
--   directus_app      SELECT on the config and clocks, INSERT on legal_holds,
--                     EXECUTE on release_hold. No UPDATE on legal_holds: a
--                     release goes through the function so the actor is
--                     stamped by the database. No DELETE anywhere.
-- ===========================================================================
-- Default deny, blanket first. PostgreSQL grants EXECUTE on every new function
-- to PUBLIC, and an explicit REVOKE per function is a list someone has to keep
-- in sync -- the failure mode being a helper added later that nobody revoked.
-- This is the list that cannot drift; the per-function revokes below and the
-- grants that follow are the exceptions, deliberately enumerated.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA retention FROM PUBLIC;

REVOKE ALL ON FUNCTION retention.run(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.sync_clocks(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.release_hold(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.compute_due_date(timestamptz, timestamptz, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.resolve_anchor(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.has_active_hold(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.add_years(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.anchor_missing(timestamptz, timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.ladder_reached(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.terminal_ladder_stage(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION retention.run(text, text, timestamptz) TO retention_worker;
GRANT EXECUTE ON FUNCTION retention.sync_clocks(timestamptz) TO retention_worker;
GRANT EXECUTE ON FUNCTION retention.release_hold(uuid, uuid) TO directus_app;

-- USAGE on the schema is the minimum to resolve these names at all. Only the
-- two roles above get it.
GRANT USAGE ON SCHEMA retention TO retention_worker, directus_app;

-- Directus may read the schedule so an operator can answer a data subject's
-- question about it. The date is not a secret; the fact that we cannot honour
-- it yet would be.
GRANT SELECT ON retention_metrics TO directus_app;
GRANT SELECT ON retention_metrics TO retention_worker;
