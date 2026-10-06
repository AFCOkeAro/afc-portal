-- rollback/20261006_0004_retention.down.sql
--
-- Reversal for 20261006_0004_retention.sql. Deployment & release lens: no
-- deploy ships without a rollback path, so this is part of the change.
--
-- SAFE TO RUN WHENEVER THE SCHEDULE IS EMPTY.
--
-- What it destroys, stated plainly, because that is the whole question when
-- deciding whether to run it:
--
--   retention_clocks   -- the computed due dates. Recomputable: the next
--                         sync_clocks() rebuilds them from the anchors.
--   legal_holds        -- THE ONE THING THAT MUST NOT BE LOST. A legal hold is
--                         a record that erasure was withheld. Rolling this back
--                         while any hold is active destroys the evidence of a
--                         legal decision and, because the rollback also removes
--                         the trigger that refuses unresolvable holds, lets the
--                         next run erase what was being protected.
--   retention_runs /
--   retention_run_items -- THE COMPLIANCE MANIFEST. The record of what was
--                         erased, when, under which policy version. This is
--                         evidence a data subject or the NDPC may ask for.
--   retention_policies -- THE SCHEDULE. Superseded rather than updated in
--                         normal operation, so this loses the version history
--                         that answers "what rule was in force when we deleted
--                         this?".
--
-- ORDER MATTERS: the guard is added below so the rollback itself cannot run
-- while a hold is active, rather than trusting the operator to check first.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a schedule that is in force.
--
-- An open legal hold is the unambiguous stop condition. No hold and no erased
-- clock is the other one: if anything has already been erased, the manifest is
-- evidence and this file should not be reachable at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holds  integer;
  v_erased integer;
BEGIN
  SELECT count(*) INTO v_holds FROM legal_holds WHERE released_at IS NULL;
  IF v_holds > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back retention: % legal hold(s) are still active. A hold is a record that erasure was withheld, and rolling this back removes both the hold and the control that refuses an unresolvable one.'
      , v_holds
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_erased FROM retention_clocks WHERE state = 'deleted';
  IF v_erased > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back retention: % clock(s) are recorded as erased. The manifest is the evidence of what was erased, under which policy version, and when. Take a verified copy of retention_runs and retention_run_items before proceeding, and record where it went.'
      , v_erased
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'retention rollback proceeding: no active holds, no erased clocks. retention_policies and retention_run_items history is still being destroyed -- take a copy first if there is any.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Engine. Dropped before the tables, because the functions depend on them.
--
-- The schema itself is dropped last. It is a bootstrap object, so a fresh
-- deployment recreates it from bootstrap/0001_roles.sql; the REVOKE PUBLIC in
-- that file is what makes recreation safe.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS retention.release_hold(uuid, uuid);
DROP FUNCTION IF EXISTS retention.run(text, text, timestamptz);
DROP FUNCTION IF EXISTS retention.sync_clocks(timestamptz);
DROP FUNCTION IF EXISTS retention.resolve_anchor(text, uuid);
DROP FUNCTION IF EXISTS retention.has_active_hold(uuid, text);
DROP FUNCTION IF EXISTS retention.terminal_ladder_stage(jsonb);
DROP FUNCTION IF EXISTS retention.ladder_reached(jsonb, text);
DROP FUNCTION IF EXISTS retention.anchor_missing(timestamptz, timestamptz, integer, integer);
DROP FUNCTION IF EXISTS retention.compute_due_date(timestamptz, timestamptz, integer, integer, text);
DROP FUNCTION IF EXISTS retention.add_years(timestamptz, integer);

-- ---------------------------------------------------------------------------
-- 2. Grants, before the objects. Revoking after a DROP is fine in PostgreSQL,
-- but doing it first means a partially-applied rollback leaves nothing granted
-- to a role that can no longer reach the objects.
-- ---------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM retention_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA retention FROM retention_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA retention FROM directus_app;

-- ---------------------------------------------------------------------------
-- 3. Triggers and functions, then tables. CASCADE is deliberately NOT used:
-- a silent cascade through a table this shape is exactly how a rollback
-- destroys something the operator did not know was there. If a statement below
-- fails because a dependency exists, that failure is the signal.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS retention_runs_append_only ON retention_runs;
DROP FUNCTION IF EXISTS retention_runs_forbid_mutation();
DROP TRIGGER IF EXISTS retention_run_items_append_only ON retention_run_items;
DROP FUNCTION IF EXISTS retention_run_items_forbid_mutation();

DROP TRIGGER IF EXISTS legal_holds_no_delete ON legal_holds;
DROP TRIGGER IF EXISTS legal_holds_immutable ON legal_holds;
DROP TRIGGER IF EXISTS legal_holds_no_pre_release ON legal_holds;
DROP TRIGGER IF EXISTS legal_holds_scope_exists ON legal_holds;
DROP FUNCTION IF EXISTS legal_holds_forbid_delete();
DROP FUNCTION IF EXISTS legal_holds_guard_placed_fields();
DROP FUNCTION IF EXISTS legal_holds_forbid_pre_release();
DROP FUNCTION IF EXISTS legal_holds_assert_scope_exists();

DROP TRIGGER IF EXISTS retention_policies_delete_enabled_is_audited ON retention_policies;
DROP FUNCTION IF EXISTS retention_policies_guard_delete_enabled();
DROP TRIGGER IF EXISTS retention_clocks_state_is_engine_owned ON retention_clocks;
DROP FUNCTION IF EXISTS retention_clocks_guard_state();

DROP VIEW IF EXISTS retention_metrics;

-- Dependency order, which is NOT the creation order. retention_policies holds
-- FOREIGN KEYs into both source maps (anchor_a, anchor_b), so the policies go
-- first. Getting this backwards is not a cosmetic mistake -- PostgreSQL refuses
-- the drop rather than cascading, which is the correct outcome and the reason
-- this section has no CASCADE: the first attempt at this file failed here with
-- "cannot drop table retention_anchor_sources because other objects depend on
-- it", which is the file working.
DROP TABLE IF EXISTS retention_run_items;
DROP TABLE IF EXISTS retention_runs;
DROP TABLE IF EXISTS legal_holds;
DROP TABLE IF EXISTS retention_clocks;
DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS retention_class_sources;
DROP TABLE IF EXISTS retention_anchor_sources;

-- ---------------------------------------------------------------------------
-- 4. people.
--
-- NOT dropped if it carries the full v4 field set, which is how you know the
-- data-model migration has landed on this table and it is no longer the
-- retention anchor. Dropping it then would take the member records with it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_is_anchor_only boolean;
BEGIN
  SELECT NOT EXISTS (
           SELECT 1 FROM pg_attribute
            WHERE attrelid = 'people'::regclass AND attnum > 0 AND NOT attisdropped
              AND attname IN ('first_name', 'phone', 'email', 'membership_status', 'guardian')
         )
    INTO v_is_anchor_only;

  IF v_is_anchor_only THEN
    DROP TABLE people;
    RAISE NOTICE 'retention rollback: dropped people (still the retention anchor only).';
  ELSE
    RAISE NOTICE
      'retention rollback: people has been extended by the data model and was NOT dropped. Removing the retention columns is a separate, reviewed step.';
  END IF;
END
$$;

-- The engine schema. Recreated by bootstrap/0001_roles.sql, which is also where
-- its PUBLIC revoke lives.
DROP SCHEMA IF EXISTS retention RESTRICT;

-- ---------------------------------------------------------------------------
-- 5. Note for the operator.
--
-- retention_worker and the `retention` schema are bootstrap objects and are not
-- dropped here; a fresh deploy gets them from
-- services/directus/schema/bootstrap/0001_roles.sql. Retention policies and
-- manifests are gone. If that matters, the next step is a restore from backup --
-- and see AFC-169: a record erased from the primary store persists in backup
-- media, so "the backup has it" is true and is also the reason a rollback here
-- does not restore anything that was already erased.
-- ---------------------------------------------------------------------------
