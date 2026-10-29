-- Migration 0058: profile photos (AFC-864, chairman direction 2026-10-29).
--
-- The profile and household pages show no image. This adds one photo slot
-- per person and per household: photo_file holds a Directus file id, served
-- through a proxied photo route (never a bare Directus URL), following the
-- event_resources upload precedent (AFC-844: file id on the row, proxy for
-- bytes). Plain uuid, deliberately no FOREIGN KEY to directus_files: that
-- table is owned by the Directus system identity, and a cross-owner FK from
-- a migrator-owned table would break the ownership model the 0042 pattern
-- protects. Orphan file rows are Directus-side data, never app-schema state.
--
-- Grants: UPDATE (photo_file) only — reads ride the existing table SELECTs,
-- INSERT never carries a photo (upload-then-set is one auditable step in the
-- photo route). REVOKE PUBLIC is table-level and already in force; columns
-- take no PUBLIC grant. No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-864). R2 CTO review on the
-- AFC-864 thread before landing. No independent security reviewer (board
-- declined the seat on cost); a CTO review is a recorded degradation, not
-- independent review.
--
-- Rollback: rollback/20261029_0058_profile_photos.down.sql (refuses while
-- any photo is set; drops the columns when clear). Owner: migration role
-- (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
    WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP PRECONDITION. Brand-new columns on migrator-owned tables:
--    fail closed if either table is owned by someone else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('people', 'households')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the profile-photo columns: % is not owned by '
      'directus_migrator, and only an owner may alter it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. photo_file on people + households. One photo slot each.
-- ---------------------------------------------------------------------------
ALTER TABLE people ADD COLUMN IF NOT EXISTS photo_file uuid;
ALTER TABLE households ADD COLUMN IF NOT EXISTS photo_file uuid;

COMMENT ON COLUMN people.photo_file IS
  'AFC-864: profile photo (Directus file id, served through the proxied photo route). Plain uuid, no FK: directus_files is system-owned.';
COMMENT ON COLUMN households.photo_file IS
  'AFC-864: household photo (Directus file id, served through the proxied photo route). Plain uuid, no FK: directus_files is system-owned.';

CREATE INDEX IF NOT EXISTS people_photo_file_idx ON people (photo_file)
  WHERE photo_file IS NOT NULL;
CREATE INDEX IF NOT EXISTS households_photo_file_idx ON households (photo_file)
  WHERE photo_file IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. UPDATE the slot; reads ride the table SELECTs.
-- ---------------------------------------------------------------------------
GRANT UPDATE (photo_file) ON people TO directus_app;
GRANT UPDATE (photo_file) ON households TO directus_app;
