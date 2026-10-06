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
--   THE CALLER SUPPLIES NO CLOCK ON A LIVE RUN, AND NO ACTOR AT ALL. Both were
--   measured as forgeable on a pristine HEAD by the independent security review
--   (AFC-230, findings F1, F2, F5, F6, F7; implemented in AFC-249):
--
--     * p_now made the selection instant a caller argument, so one call with a
--       future instant selected clocks whose due dates had not arrived, and one
--       call with a past instant selected nothing while records were due and
--       reported status='succeeded' with zero candidates. Both directions are
--       an NDPA failure and neither needs a forged clock.
--     * p_actor was written straight into retention_runs.actor, which is the
--       attribution evidence for an erasure.
--     * p_now also stamped started_at and finished_at, and
--       retention_metrics.retention_last_run_at is max(started_at) feeding the
--       stale-job alarm. max() is monotone over an append-only table, so one
--       forged run pinned that alarm at infinity permanently.
--     * p_actor was accepted as an empty string.
--     * the hold branch wrote retention_clocks.state='held' above the mode
--       branch, so a PREVIEW mutated state.
--
--   p_now and p_actor are still in the signature. p_now is kept because a
--   preview is legitimately asked about a future instant (F7: forward only) and
--   because AFC-167 froze the signature; p_actor is kept because the operator's
--   own words about a run are worth recording -- in actor_label, which is a
--   label and is not read as an attribution. Neither is trusted on a live run.
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
  -- The database's clock, and the instant selection is made at. Deliberately two
  -- names for what is one value on a live run: v_db_now is what the manifest and
  -- every timestamp are stamped from, and v_select_now is the predicate's right
  -- operand. On a dry run they differ by design and only v_select_now moves.
  v_db_now      timestamptz := now();
  v_select_now  timestamptz;
  v_can_login   boolean;
  v_session     text := session_user::text;
BEGIN
  IF p_mode NOT IN ('dry_run', 'live') THEN
    RAISE EXCEPTION 'retention.run mode must be dry_run or live, got %', p_mode
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------------
  -- WHO RAN THIS, BEFORE ANY WORK IS DONE.
  --
  -- session_user survives into this SECURITY DEFINER body and reads the role the
  -- connection authenticated as, which is what makes it the right source: it is
  -- not an argument, so no caller can write it, and it is not current_user,
  -- which is the engine owner and would name every run after the same role.
  --
  -- A session that authenticated as a role with no LOGIN is refused rather than
  -- recorded as something. That role is one the engine assumed through SET ROLE
  -- -- a credential nobody holds -- and an erasure attributed to it names nobody.
  -- 23001 rather than 22023, because this is a control refusing an operation and
  -- not a malformed argument; an operator reading the log needs to see which of
  -- those it was.
  -- ---------------------------------------------------------------------
  SELECT r.rolcanlogin INTO v_can_login
    FROM pg_roles r WHERE r.rolname = session_user;

  IF NOT COALESCE(v_can_login, false) THEN
    RAISE EXCEPTION
      'retention.run session % is not a role that can log in, so this run could not be attributed to an accountable identity. An erasure is attributed to the session that performed it; a session that authenticated as nothing would be attributed to nobody.'
      , v_session
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- The label is still checked, because a run whose only human-readable field is
  -- empty is a run nobody can find in the log. 22023: this is argument
  -- validation, and an operator reading a log should be able to tell the
  -- difference between "you passed something invalid" and "a control stopped you".
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION
      'retention.run requires a non-empty actor label naming the source of the run (a scheduler, an operator, a review sweep). It is stored as actor_label; the attribution itself is the session.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---------------------------------------------------------------------
  -- THE CLOCK. Two-sided on live, forward-only on preview.
  --
  -- Not "reject p_now > now() + one day". That option is one-sided: it closes
  -- the widening direction and leaves the suppressing direction open, and
  -- suppressing erasure is the NDPA failure that needs no forged future clock at
  -- all -- retention.run('x','live','1970-01-01') erased nothing while records
  -- were due and reported success with zero candidates, which is
  -- indistinguishable from "nothing to do".
  --
  -- So on live the parameter is not interpreted, it is CHECKED, and any value
  -- other than the database's own clock is refused rather than ignored. Ignored
  -- would be worse than refused in the other direction: the caller would see a
  -- successful run over the wrong window and have no reason to know.
  --
  -- The DEFAULT is now(), which is the transaction timestamp, so the ordinary
  -- two-argument call passes this check exactly. That is why the equality is a
  -- check rather than a heuristic: p_now is now() by construction when the
  -- caller supplied nothing.
  -- ---------------------------------------------------------------------
  IF p_mode = 'live' THEN
    IF p_now IS DISTINCT FROM v_db_now THEN
      RAISE EXCEPTION
        'retention.run(''live'') takes its selection instant from the database and refuses a caller-supplied clock. Supplied % against the database''s %: a future instant erases records before their due date and a past instant erases nothing while records are due, and both are NDPA failures. Run it dry with a forward instant to see the future, then live without one.'
        , p_now, v_db_now
        USING ERRCODE = 'restrict_violation';
    END IF;
    v_select_now := v_db_now;
  ELSE
    -- A preview may look FORWARD -- that is what a preview is for -- but never
    -- backward past now(). A 1970 preview reports zero candidates for a schedule
    -- that has thirty, and a preview that under-reports is a control lying to
    -- the person deciding whether to enable the live run.
    IF p_now < v_db_now THEN
      RAISE EXCEPTION
        'retention.run(''dry_run'') may look forward from now(), not backward. Supplied % against the database''s %: a preview anchored in the past hides records that are already due, which is the same over-retention failure as a live run with a forged past clock.'
        , p_now, v_db_now
        USING ERRCODE = 'restrict_violation';
    END IF;
    v_select_now := p_now;
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

  -- The manifest header. Three of these four values are the database's:
  --
  --   actor          session_user, because the attribution evidence for an
  --                  erasure is the session that performed it and a session is
  --                  not something the caller gets to write.
  --   actor_label    the caller's string, kept as a label.
  --   started_at     now(), because retention_metrics.retention_last_run_at is
  --                  max(started_at) over an append-only table feeding the
  --                  stale-job alarm, so one forged value would pin that alarm
  --                  at infinity for ever.
  --   preview_instant  only ever a forward-looking preview instant, and only on
  --                  a dry run. On live it is NULL, because a live run has no
  --                  caller-supplied clock at all.
  INSERT INTO retention_runs
    (run_id, mode, status, actor, actor_label, preview_instant, lock_token, started_at)
  VALUES
    (v_run_id, p_mode, 'running', v_session, p_actor,
     CASE WHEN p_mode = 'dry_run' THEN v_select_now END,
     v_lock_key::text, v_db_now);

  BEGIN
    FOR c IN
      SELECT rc.id, rc.person_id, rc.retention_class, rc.policy_id,
             rc.policy_version, rc.due_at, rc.state, rc.ladder_stage,
             rp.delete_enabled, rp.ladder_stages
        FROM retention_clocks rc
        JOIN retention_policies rp ON rp.id = rc.policy_id
       -- A clock is a candidate at all only when its due date is reached.
       -- Selection is by due_at, not by state, so an 'indeterminate' clock
       -- (due_at NULL) can never be selected: NULL <= v_select_now is NULL, not
       -- true.
       --
       -- v_select_now, not p_now, and on a live run those are equal only
       -- because the check above refused every other value. The predicate reads
       -- the variable rather than the argument so that "the live path selects
       -- on the database clock" is visible in the SQL rather than an invariant
       -- a later edit could quietly break.
       WHERE rc.due_at IS NOT NULL
         AND rc.due_at <= v_select_now
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
        -- Marking the clock held is a WRITE, so it belongs to the mode that is
        -- allowed to write. It used to sit above this branch and run in both
        -- modes, so a PREVIEW changed retention_clocks.state from 'live' to
        -- 'held' -- and the next sync_clocks() will not move it back, because a
        -- hold outranks a resync by design. A preview that cannot be undone by
        -- the next real run is not a preview.
        --
        -- The manifest still records the hold, which is the whole point of the
        -- branch: a dry run reports what it would skip and why, and changes
        -- nothing.
        IF p_mode = 'live' THEN
          UPDATE retention_clocks SET state = 'held' WHERE id = c.id;
        END IF;
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
       SET finished_at = v_db_now,
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
    --
    -- The session is named, not the caller's string. The log is read by whoever
    -- has to answer "who did this", and the answer to that is the credential that
    -- connected -- the caller's string is in the WARNING as the label, because a
    -- label is useful for finding the run and is not an identity.
    RAISE WARNING
      'retention.run FAILED session=% label=% mode=% error=%',
      v_session, p_actor, p_mode, left(SQLERRM, 1500);
    PERFORM pg_advisory_unlock(v_lock_key);
    RAISE;
  END;
END $$;

COMMENT ON FUNCTION retention.run(text, text, timestamptz) IS
  'The only deletion path. Dry-run default, single-writer advisory lock, hold checked at erasure time. Order: hold -> ladder -> due -> delete_enabled.

  ATTRIBUTION AND CLOCK, neither of them the caller''s to choose. actor is session_user, read inside this SECURITY DEFINER body; actor_label holds the caller''s string and is a label only. started_at and finished_at are now(), because retention_last_run_at is max(started_at) over an append-only table and one forged value pins the stale-job alarm at infinity.

  On live, p_now is CHECKED against now() and refused with restrict_violation if it differs -- two-sided, because a future instant erases before the due date and a past instant suppresses erasure while records are due. On dry_run a forward p_now is honoured and recorded in preview_instant; a p_now before now() is refused, because a preview that under-reports is the same over-retention failure.

  A dry run writes nothing outside its own manifest rows. Marking a held clock is a live-mode write.';

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

  DEVIATION, recorded deliberately: retention_runs_failed counts runs RECONCILED as failed, not live failures. A run that fails rolls its own row back with the transaction, so it cannot appear here -- see retention.run section 5. Live job failure is alerted from the server log WARNING and the scheduler failure alert. A metric that is structurally always zero is an alarm that always reads healthy, which is worse than no alarm.

  retention_last_run_at is now only as trustworthy as retention_runs.started_at, which is why that column is stamped inside retention.run from now() and not from a parameter (AFC-249 F5). It used to be a caller argument feeding a monotone max() over an append-only table, which meant a single forged run disabled this alarm permanently and silently.';

-- The attribution map the release path reads is a migration object, and a deploy
-- that skipped migration 0005 should say so here rather than failing on the first
-- release with "relation does not exist" -- which is the same fail-loudly
-- discipline the schema check at the top of this file follows.
DO $$
BEGIN
  IF to_regclass('public.retention_principals') IS NULL THEN
    RAISE EXCEPTION
      'public.retention_principals is missing. It is created by migrations/20261006_0005_retention_attribution.sql, and without it a legal-hold release cannot be attributed to a principal the database chose.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- Release of a hold, stamped by the database rather than by the caller. A
-- release is the moment erasure becomes permissible again, so the actor on it
-- is evidence, not bookkeeping.
--
-- p_released_by is GONE, and that is the fix rather than a detail of it.
-- AFC-230 measured, on a pristine HEAD, that the stored releaser was the uuid
-- the CALLER supplied: a session with EXECUTE on this function could name any
-- principal it liked as the person who lifted a legal hold, and the hold's own
-- COMMENT claimed the database stamped it. Only released_at was stamped by the
-- database. A comment that says the opposite of what the code does is not a
-- documentation defect on a surface that decides whether a child's record may be
-- erased.
--
-- So there is nowhere to pass a releaser. It is derived here from session_user
-- through retention_principals, which is an owner-written table shipped empty, so
-- a deployment with no provisioned principal REFUSES every release rather than
-- storing a fabricated one. Fail closed, because a release nobody can attribute
-- is a release that cannot be defended to the NDPC, and it unblocks the deletion
-- of records somebody placed a hold on.
--
-- WHAT THIS DOES AND DOES NOT ATTRIBUTE, stated rather than implied. It names the
-- principal the database role speaks for, read from a row somebody provisioned
-- under the owner role. It does not, and cannot, identify which individual
-- operator inside that role pressed the button -- every Directus user shares the
-- one directus_app connection, and the database cannot see past it. Naming a
-- role-bound principal is therefore strictly more than was recorded before and is
-- still not a person. The individual is attributable in Directus, which is where
-- the session lives.
CREATE OR REPLACE FUNCTION retention.release_hold(
  p_hold_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, retention, pg_temp AS $$
DECLARE
  v_released_by uuid;
  v_session     text := session_user::text;
BEGIN
  -- Argument validation first, so an operator who passed nothing gets told what
  -- they passed wrong rather than what their role is missing. 22023, matching
  -- the convention this file already states below: 23001 is reserved for a
  -- control refusing an operation.
  IF p_hold_id IS NULL THEN
    RAISE EXCEPTION 'a legal hold release must name the hold it releases'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Attribute or refuse. There is no third branch, and in particular there is no
  -- branch that stores NULL, because legal_holds.released_by being NULL with
  -- released_at set is the one release row nobody can defend afterwards.
  SELECT rp.principal_id INTO v_released_by
    FROM public.retention_principals rp
   WHERE rp.role_name = v_session;

  IF v_released_by IS NULL THEN
    RAISE EXCEPTION
      'legal hold release refused: database role % has no principal in retention_principals, so a release under it could not be attributed to anyone. Releasing a hold is what makes erasure permissible again, and that decision is attributed to a principal, not to the connection. Provision the role under the owner role, or release under a role that is provisioned.'
      , v_session
      USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE legal_holds
     SET released_by = v_released_by, released_at = now()
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
-- a log to make. The one place this function uses 23001 is the attribution check
-- above, and it is a control refusing an operation -- not an argument check.
COMMENT ON FUNCTION retention.release_hold(uuid) IS
  'Releases a legal hold. BOTH actor and time are stamped by the database: released_at is now() and released_by is the principal retention_principals maps this session role to. The row survives: a release is history. There is no parameter for a caller to name a releaser, and a role with no provisioned principal is refused rather than recorded as unattributed.';

-- ===========================================================================
-- 7. Grants. Default deny, then the minimum.
--
--   retention_worker  EXECUTE on run/sync_clocks only. It holds no DELETE on
--                     any collection; erasure happens inside SECURITY DEFINER
--                     so that "the job is the only deletion path" is enforced
--                     by the grant list rather than by discipline.
--   directus_app      SELECT on the config and clocks, INSERT on legal_holds,
--                     EXECUTE on release_hold(uuid). No UPDATE on legal_holds: a
--                     release goes through the function because the function is
--                     what stamps the releaser from the session, and there is no
--                     parameter left to stamp it with. No DELETE anywhere.
--
--   The two-argument release_hold(uuid, uuid) is dropped above rather than
--   revoked, because a CREATE OR REPLACE cannot change a function's identity
--   and an instance that applied the previous engine would otherwise keep
--   serving it -- still executable, still storing whatever releaser its caller
--   supplied.
-- ===========================================================================
-- Default deny, blanket first. PostgreSQL grants EXECUTE on every new function
-- to PUBLIC, and an explicit REVOKE per function is a list someone has to keep
-- in sync -- the failure mode being a helper added later that nobody revoked.
-- This is the list that cannot drift; the per-function revokes below and the
-- grants that follow are the exceptions, deliberately enumerated.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA retention FROM PUBLIC;

-- The two-argument release_hold(p_hold_id uuid, p_released_by uuid) is REMOVED
-- here, if this instance still carries it.
--
-- CREATE OR REPLACE cannot change a function's identity, so writing the new
-- one-argument body alongside the old two-argument function would leave the old
-- one in the catalog -- still executable by directus_app, still storing whatever
-- releaser its caller supplied. That is the exact forgery AFC-230 measured, and a
-- REVOKE is not enough against it: the ACL would be correct and the parameter
-- would still be there. So it is dropped.
--
-- Conditional, because on a fresh deployment the function was never created and
-- a plain DROP would fail with 42883 on the schema this whole system exists to
-- install. Same conditional-drop shape as the trigger drops above.
DO $$
BEGIN
  IF to_regprocedure('retention.release_hold(uuid, uuid)') IS NOT NULL THEN
    DROP FUNCTION retention.release_hold(uuid, uuid);
    RAISE NOTICE 'engine: dropped the caller-releaser release_hold(uuid, uuid); the releaser is now derived from the session (AFC-249 F3)';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION retention.run(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.sync_clocks(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.release_hold(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.compute_due_date(timestamptz, timestamptz, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.resolve_anchor(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.has_active_hold(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.add_years(timestamptz, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.anchor_missing(timestamptz, timestamptz, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.ladder_reached(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention.terminal_ladder_stage(jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION retention.run(text, text, timestamptz) TO retention_worker;
GRANT EXECUTE ON FUNCTION retention.sync_clocks(timestamptz) TO retention_worker;
GRANT EXECUTE ON FUNCTION retention.release_hold(uuid) TO directus_app;

-- USAGE on the schema is the minimum to resolve these names at all. Only the
-- two roles above get it.
GRANT USAGE ON SCHEMA retention TO retention_worker, directus_app;

-- Directus may read the schedule so an operator can answer a data subject's
-- question about it. The date is not a secret; the fact that we cannot honour
-- it yet would be.
GRANT SELECT ON retention_metrics TO directus_app;
GRANT SELECT ON retention_metrics TO retention_worker;

-- ===========================================================================
-- THE ENTRYPOINT'S EXECUTE SURFACE IS EXACTLY retention_job. ADR-0004.
--
-- WHY HERE AND NOT IN BOOTSTRAP
--   Bootstrap runs before the migrations and before this file, so
--   retention.run does not exist when bootstrap executes and there is nothing to
--   ask has_function_privilege about. This is also the step that grants EXECUTE
--   on the function one line above, so it is where the surface can be asserted
--   against the grant this same file made.
--
-- WHY IT IS NEEDED AT ALL
--   The membership count in bootstrap asserts that exactly one LOGIN identity can
--   REACH retention_worker. That is not the erasure surface. A direct
--   GRANT EXECUTE ON FUNCTION retention.run TO someone reaches the deletion path
--   with no membership of anything, and measured on this engine such a grant
--   leaves the membership count at 1 and leaves bootstrap passing. This is the
--   second of four routes, and it is the one that is easiest to add by accident.
--
-- has_function_privilege, not proacl, for the same reason the checks above use
-- it: the ACL is the grant list and the effective privilege is what the database
-- enforces. It also catches an EXECUTE that arrived through a group role or
-- through PUBLIC, which a proacl read would miss.
--
-- The entrypoint is resolved to its OID rather than named, because
-- has_function_privilege's second argument is a regprocedure and retention.run
-- RETURNS uuid -- the bare signature 'retention.run(text,text,timestamptz)' is
-- not resolvable as one.
DO $$
DECLARE
  v_run_oid oid;
  v_n_run   integer;
  v_holders text;
BEGIN
  -- Resolved by name and arity, and required to be unambiguous, rather than
  -- matched on rendered argument text. Three text-shaped comparisons were tried
  -- against this signature and all three silently matched nothing, because
  -- proargtypes renders as '25 25 1184' with no braces and no names, and
  -- pg_get_function_identity_arguments renders as 'p_actor text, p_mode text,
  -- p_now timestamp with time zone'. An ambiguous match is a louder failure than
  -- a quiet one, so the count is asserted instead: if retention.run is ever
  -- overloaded, this refuses and a human decides which entrypoint is the one.
  SELECT count(*), min(p.oid) INTO v_n_run, v_run_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND p.proname = 'run'
     AND p.pronargs = 3;

  IF v_n_run <> 1 THEN
    RAISE EXCEPTION
      'this engine installs exactly one three-argument retention.run, and % were '
      'found, so the EXECUTE surface cannot be checked unambiguously. A check '
      'that quietly examines the wrong function is worse than no check. Reconcile '
      'the engine signatures with this assertion.',
      v_n_run
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_holders
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND has_function_privilege(r.oid, v_run_oid, 'EXECUTE');

  IF v_holders IS DISTINCT FROM 'retention_job' THEN
    RAISE EXCEPTION
      'the LOGIN roles holding EXECUTE on retention.run are (%), and they must be '
      'exactly retention_job. Anyone else here can execute live erasure without '
      'holding anything from retention_worker, which the membership count in '
      'bootstrap cannot see. Run: REVOKE EXECUTE ON FUNCTION '
      'retention.run(text,text,timestamptz) FROM <role>',
      coalesce(v_holders, '(none)')
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;
