-- 20261006_0005_retention_attribution.sql
--
-- Attribution for erasure and for the release of a legal hold. AFC-249, from the
-- independent security review on AFC-230 (findings F2, F3, F5).
--
-- WHAT THIS CHANGES, AND WHY IT IS SCHEMA AT ALL
--   0004 made retention_runs.actor the attribution evidence for erasure, by its
--   own stated rationale -- and then let the caller write it. A record of who
--   erased a child's data, in a column the eraser fills in, is not evidence. So
--   the column now carries the DATABASE's answer to "which session did this",
--   and the caller's string moves to actor_label where it is a label and nothing
--   more. Nothing is deleted: the operator's own words are still recorded, one
--   column away from the field they must never have controlled.
--
--   release_hold's p_released_by had the same shape and is gone at the engine
--   layer (0001_retention_engine.sql). What it is replaced with needs a table,
--   and that is what this migration adds: a mapping from a database role to the
--   principal a release is attributed to. It ships EMPTY, for the same reason
--   0004 seeds no policy row -- a plausible-looking default principal is an
--   attribution nobody chose.
--
--   retention_runs.started_at/finished_at were stamped from retention.run's
--   p_now, a caller-supplied value. retention_metrics.retention_last_run_at is
--   max(started_at) and feeds the stale-job alarm, and max() is monotone over
--   an append-only table, so ONE forged run pinned that alarm at infinity
--   permanently. Both timestamps are now stamped from now(); the caller's
--   forward-looking preview instant is kept, in its own column, where it cannot
--   move a metric.
--
-- NO DURATION APPEARS HERE. See the note in 0004 and ADR-159-2 D1.
--
-- Rollback: rollback/20261006_0005_retention_attribution.down.sql. Additive in
-- the forward direction, so the down file drops what this added and restores the
-- release_hold shape -- which is exactly the forgery path this migration closes,
-- and is recorded as such rather than left for an operator to discover.

-- ---------------------------------------------------------------------------
-- 1. retention_runs: who ran it, said by the database.
-- ---------------------------------------------------------------------------
-- actor_label is the operator's own string ('scheduler:nightly',
-- 'dpo:quarterly-sweep'). It is deliberately NOT constrained to be unique and
-- NOT indexed as one: two runs may carry the same label, because a label names a
-- source, not a session. The column a reviewer reads to attribute an erasure is
-- actor, and actor is derived inside the SECURITY DEFINER from session_user.
ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS actor_label text;

COMMENT ON COLUMN retention_runs.actor IS
  'The session that ran the engine, derived inside retention.run from session_user. NOT caller-supplied: this is the attribution evidence for an NDPA s.40(2) erasure, and a caller that names its own actor has written its own evidence.';

COMMENT ON COLUMN retention_runs.actor_label IS
  'The caller''s string, kept as a label. Names the SOURCE of the run (a scheduler, an operator, a review sweep); it is not an attribution and must never be read as one. NULL where the caller supplied none.';

-- preview_instant: the instant a dry run was ASKED about, which is legitimately
-- in the operator's gift because a preview may look forward (AFC-249 F7). It
-- lives in its own column because the run's own start and finish are not the
-- operator's to write, and a single column cannot be both.
ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS preview_instant timestamptz;

COMMENT ON COLUMN retention_runs.preview_instant IS
  'dry_run only: the future instant the caller asked the preview to look at. Never written on a live run -- a live run has no caller-supplied clock at all (AFC-249 F1). Kept separate from started_at/finished_at so that retention_last_run_at cannot be moved by a caller.';

-- An empty actor is not an actor. NOT NULL already refuses a missing one; this
-- refuses the empty string, which is what a caller who wanted no attribution and
-- supplied the cheapest thing that satisfies NOT NULL would have written.
-- Together with the NOT NULL this makes "every run records who ran it" a
-- schema-level fact rather than an assertion about whatever the test suite
-- happened to pass.
ALTER TABLE retention_runs
  DROP CONSTRAINT IF EXISTS retention_runs_actor_not_blank;
ALTER TABLE retention_runs
  ADD CONSTRAINT retention_runs_actor_not_blank CHECK (btrim(actor) <> '');

-- ---------------------------------------------------------------------------
-- 2. retention_principals: a database role -> the principal a release names.
--
-- WHY A TABLE AND NOT session_user
--   retention.run records a role name, and session_user is one, so F2 needed
--   nothing new. A release is different: legal_holds.released_by is a uuid
--   pointing at a directus_users row (data-model-v4), and session_user is a role
--   name. There is no way to turn one into the other without a mapping, and the
--   mapping is the whole trust decision -- so it is a row somebody chose, not a
--   value the caller passes.
--
-- WHY IT SHIPS EMPTY
--   A row here decides which person is named on a release of a legal hold. A
--   seeded default would be an attribution nobody chose, attached to a document
--   that decides whether a child's record may be erased. Provisioning it is an
--   owner-role operation on purpose, in the same shape as enabling
--   delete_enabled: an audited decision, recorded in the table rather than
--   assumed in the code.
--
-- NOT A NEW LOGIN
--   ADR-0004 keeps identity and capability separate, and this does not disturb
--   that: no role is created, no membership is granted, and directus_app is the
--   only login that can reach retention.release_hold. What this records is
--   which principal the application connection speaks for -- which is a fact
--   about one shared connection, not a new credential and not a new capability.
CREATE TABLE IF NOT EXISTS retention_principals (
  -- The database role the release is attributed through. session_user, verbatim.
  role_name    text PRIMARY KEY,
  -- The directus_users row a release under that role is stamped with.
  principal_id uuid NOT NULL UNIQUE,
  -- WHY this role speaks for this principal. Read by a reviewer; never by code.
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE retention_principals IS
  'Which principal a legal-hold release is attributed to, per database role. Read by retention.release_hold from session_user; never written by the path that reads it. Ships empty: a seeded principal is an attribution nobody chose.';

-- 2b. Owner-only, as a trigger rather than as a grant list.
--
-- directus_app holds no INSERT/UPDATE/DELETE here, so the grant list already
-- holds -- but a grant list can be widened by accident, and this table decides
-- whose name goes on the release of a legal hold. Same reasoning as
-- retention_clocks.state and retention_policies.delete_enabled: permissions are
-- a layer, a trigger is the control.
--
-- Tested with current_user for the same reason those two are: this is an
-- owner-role table and the engine reaches it as the owner.
CREATE OR REPLACE FUNCTION retention_principals_assert_owner_writes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'directus_migrator' THEN
    RAISE EXCEPTION
      'retention_principals is written only under the owner role. It decides which principal a legal-hold release is attributed to, and a session that may change that can attribute a release to whoever it likes.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS retention_principals_owner_writes ON retention_principals;
CREATE TRIGGER retention_principals_owner_writes
  BEFORE INSERT OR UPDATE OR DELETE ON retention_principals
  FOR EACH ROW EXECUTE FUNCTION retention_principals_assert_owner_writes();

-- ---------------------------------------------------------------------------
-- 3. Grants. Default deny, then the minimum.
--
-- SELECT to directus_app so an operator can answer "who is this connection
-- attributed as?" -- the same reasoning as the read grant on the schedule: the
-- answer is not a secret, and an operator who cannot see it cannot answer a
-- data subject's question about it.
--
-- No INSERT/UPDATE/DELETE anywhere below the owner. The release path reads this
-- table as the SECURITY DEFINER owner; it never writes it.
-- ---------------------------------------------------------------------------
REVOKE ALL ON retention_principals FROM PUBLIC;
GRANT SELECT ON retention_principals TO directus_app;