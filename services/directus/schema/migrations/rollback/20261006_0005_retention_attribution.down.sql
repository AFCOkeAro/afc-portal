-- rollback/20261006_0005_retention_attribution.down.sql
--
-- Reversal for 20261006_0005_retention_attribution.sql.
--
-- READ THIS BEFORE RUNNING IT, because this rollback puts back something that
-- was a defect.
--
-- Rolling this back restores two caller-supplied values on a SECURITY DEFINER
-- body, both measured by AFC-230's independent security review on AFC-249:
--
--   retention.run(p_actor, ...)   writes the CALLER's string into
--                                  retention_runs.actor, which is the attribution
--                                  evidence for an NDPA s.40(2) erasure.
--   retention.release_hold(id, uuid) stores the CALLER's uuid as the releaser of
--                                  a legal hold, which is the evidence that
--                                  erasure became permissible again.
--
-- So this is a reversal path for a deploy that must ship and then be undone, not
-- a routine. Take the archive copy first, and treat a re-application as urgent
-- rather than scheduled.
--
-- What is destroyed here:
--   retention_principals          -- the role -> principal mapping. Small, and
--                                    rebuildable: it is one row per role that
--                                    releases a legal hold, and the note column
--                                    records why each one exists. Nothing else
--                                    in the schema depends on it.
--   retention_runs.actor_label    -- the operator's own strings. These are the
--                                    only rows this rollback loses, and they are
--                                    lost permanently: retention_runs is
--                                    append-only, so there is no copy. They are
--                                    labels, not attribution -- actor is
--                                    untouched and keeps naming the session --
--                                    but if the labels themselves are evidence in
--                                    your jurisdiction, copy the table first.
--   retention_runs.preview_instant -- which instant each dry run was asked about.
--                                    Same shape of loss as above.
--
-- NOT reversible by this file, and that is the point:
--   the timestamps already written. started_at and finished_at keep the values
--   the corrected engine stamped; this rollback does not rewrite manifest
--   history, and it must not -- the manifest is append-only for exactly this
--   reason.

-- ---------------------------------------------------------------------------
-- 0. The guard. Refuse while a legal hold is active, for the same reason
-- 0004's rollback does: a hold is a record that erasure was withheld, and the
-- mapping being dropped is what makes a release attributable. Dropping it while
-- a hold is live leaves the next release of that hold unattributable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holds integer;
BEGIN
  SELECT count(*) INTO v_holds FROM legal_holds WHERE released_at IS NULL;
  IF v_holds > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back attribution: % legal hold(s) are still active. With retention_principals gone, a release can no longer name a releaser the database chose, and every later release of these holds would be attributed to its caller.'
      , v_holds
      USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE NOTICE
    'attribution rollback proceeding: no active holds. actor_label and preview_instant rows are being dropped and are not recoverable from the schema.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The constraint, then the columns. The constraint first so it cannot fire
-- against the actor column while the file is half-applied.
-- ---------------------------------------------------------------------------
ALTER TABLE retention_runs
  DROP CONSTRAINT IF EXISTS retention_runs_actor_not_blank;

ALTER TABLE retention_runs
  DROP COLUMN IF EXISTS actor_label;

ALTER TABLE retention_runs
  DROP COLUMN IF EXISTS preview_instant;

-- ---------------------------------------------------------------------------
-- 2. The mapping table. Trigger first, then function, then table -- no CASCADE,
-- so a dependency this file did not anticipate stops the rollback loudly.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS retention_principals_owner_writes ON retention_principals;
DROP FUNCTION IF EXISTS retention_principals_assert_owner_writes();
DROP TABLE IF EXISTS retention_principals;

-- ---------------------------------------------------------------------------
-- 3. The grant that went with it. Revoked before the drop above is unreachable
-- anyway; stated so a partially-applied rollback leaves nothing half-granted.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.retention_principals') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON retention_principals FROM PUBLIC';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. The release signature. The engine in
-- services/directus/schema/engine/0001_retention_engine.sql drops
-- release_hold(uuid, uuid) itself during install (AFC-249 F3), so on an instance
-- that applied the new engine the two-argument form is already gone and the
-- only thing this migration can remove is the one-argument form -- which the
-- engine owns, and which is dropped by 0004's rollback along with the rest of
-- retention. There is deliberately no statement here that touches a function in
-- schema retention: a reversal file that half-owns the engine is a file that
-- will be wrong the next time the engine changes shape.
--
-- The engine change and this file MUST be reverted together. The one-argument
-- release_hold reads retention_principals; with the table dropped, every release
-- raises. That is fail-closed and it is still an outage for the DPO, so the
-- engine is reverted in the same change.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Note for the operator.
--
-- 0004's rollback (rollback/20261006_0004_retention.down.sql) also drops
-- retention_principals, so a full teardown of the retention feature does not need
-- this file to have been reverted separately. Run this one first: the guard in
-- section 0 reads legal_holds, which 0004's rollback refuses to run while a hold
-- is active anyway.
-- ---------------------------------------------------------------------------