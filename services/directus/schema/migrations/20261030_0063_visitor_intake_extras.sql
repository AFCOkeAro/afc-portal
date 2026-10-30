-- Migration 0063: visitor intake extras (AFC-907, chairman direction
-- 2026-10-30).
--
-- Intake gains four columns on the 0025 register, all nullable-or-defaulted
-- so existing rows keep parsing:
--   address               -- free-text home address (no new register).
--   campaign              -- source campaign attribution, FK to campaigns
--                            (campaign deleted -> attribution clears, the
--                            visitor row stays).
--   source                -- where the visitor came from: outreach, referral,
--                            social_media, event, walk_in, website, other.
--   is_cross_branch_visit -- server-computed at create/update: true when the
--                            contact matches a person in another branch (a
--                            member visiting for the first time). Follow-up
--                            surfaces read this flag; it is never client-set
--                            (the form schema omits it and the routes stamp
--                            it from the member-check probe).
--
-- Grants: the four columns join the 0025 INSERT/UPDATE lists for
-- directus_app (same ceiling, no widening). REVOKE PUBLIC. No roles
-- provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-907). R2 CTO review on
-- the AFC-907 thread before landing.
--
-- Rollback: rollback/20261030_0063_visitor_intake_extras.down.sql
-- (drops the four columns; entered addresses/sources/attributions go with
-- them). Owner: migration role (directus_migrator). Never run as
-- directus_app.

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
-- 1. OWNERSHIP PRECONDITION (0042 pattern). The 0025 register must exist and
--    be owned by directus_migrator -- otherwise 0025 never applied and this
--    file must fail naming 0025, not invent the table here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_owner text;
BEGIN
  SELECT c.relowner::regrole::text INTO v_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'visitors';

  IF v_owner IS NULL THEN
    RAISE EXCEPTION
      'refusing 0063: visitors is absent -- apply 0025 first, this file only '
      'extends the intake columns, never creates the register.'
      USING ERRCODE = 'restrict_violation';
  ELSIF v_owner <> 'directus_migrator' THEN
    RAISE EXCEPTION
      'refusing 0063: visitors is owned by %, not directus_migrator, and only '
      'an owner may alter it. Transfer ownership to directus_migrator first, '
      'then re-run this migration.',
      v_owner
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The four intake columns.
-- ---------------------------------------------------------------------------
ALTER TABLE visitors
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS campaign uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text
    CHECK (source IS NULL OR source IN
      ('outreach', 'referral', 'social_media', 'event', 'walk_in', 'website', 'other')),
  ADD COLUMN IF NOT EXISTS is_cross_branch_visit boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN visitors.source IS
  'AFC-907: where the visitor came from (outreach, referral, social_media, event, walk_in, website, other).';
COMMENT ON COLUMN visitors.is_cross_branch_visit IS
  'AFC-907: server-stamped at create/update when the contact matches a person in another branch. Never client-set.';

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. The four columns join the 0025 lists; the
--    ceiling is otherwise exactly 0025. REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT INSERT (address, campaign, source, is_cross_branch_visit)
  ON visitors TO directus_app;
GRANT UPDATE (address, campaign, source, is_cross_branch_visit)
  ON visitors TO directus_app;

REVOKE ALL ON visitors FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 4. Verify the effective privilege, then stop.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['address', 'campaign', 'source', 'is_cross_branch_visit']) AS c
   WHERE NOT has_column_privilege('directus_app', 'public.visitors', c, 'INSERT')
      OR NOT has_column_privilege('directus_app', 'public.visitors', c, 'UPDATE');

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing 0063: directus_app lacks INSERT+UPDATE on visitors(%) after '
      'the grant -- intake writes would fail.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;
