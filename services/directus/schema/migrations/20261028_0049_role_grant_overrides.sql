-- Migration 0049: role grant overrides (AFC-836, chairman direction).
--
-- Lets a super_admin reshape ANY role (including built-ins) from the
-- Roles matrix UI without editing role-matrix.ts. One row per
-- (role, collection, action) names the delta from the code matrix:
--   effect = 'grant'  -- granted on top of the matrix (Directus parity
--                          row is created alongside, same as customs);
--   effect = 'revoke' -- refused even though the matrix grants it.
--
-- Portal enforcement consults the table in requireCan (deny wins) and in
-- /api/me/permissions (sidebar gating); the toggle endpoints keep the
-- Directus policy in agreement (revoke deletes the matching permission
-- rows, grant creates one). No silent disagreement between the two layers.
--
-- Grants: SELECT/INSERT/DELETE for directus_app (reads run through the
-- portal; writes ride the super_admin session). No UPDATE (toggle =
-- delete + insert). REVOKE PUBLIC. No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-836). R2 CTO review on
-- the AFC-836 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0049_role_grant_overrides.down.sql
-- (refuses while rows exist; drops the table). Owner: migration role
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
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). Nothing pre-exists to own
--    here (brand-new register), so this block only guards the pathological
--    case of a leftover table from a failed apply owned by someone else.
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
         AND c.relname IN ('role_grant_overrides')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the overrides register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. role_grant_overrides. One row per (role, collection, action) names
--    the delta; effect decides the direction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_grant_overrides (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_key             text NOT NULL,
  collection           text NOT NULL,
  action               text NOT NULL CHECK (action IN ('create', 'read', 'update', 'delete')),
  effect               text NOT NULL CHECK (effect IN ('grant', 'revoke')),
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  -- Full Directus rows touched by this toggle, so un-do restores parity:
  -- revoke stores the deleted rows here; grant stores created row ids.
  snapshot             jsonb,
  CONSTRAINT role_grant_overrides_once UNIQUE (role_key, collection, action)
);

COMMENT ON TABLE role_grant_overrides IS
  'AFC-836: super_admin deltas over the code matrix. grant = allow on top of role-matrix.ts; revoke = refuse even though the matrix allows it. Portal requireCan consults it (deny wins); toggle endpoints keep Directus policies in agreement.';

CREATE INDEX IF NOT EXISTS role_grant_overrides_role_idx
  ON role_grant_overrides (role_key);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT + DELETE for
--    toggles (a toggle is delete + insert, never UPDATE). NO UPDATE.
--    REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON role_grant_overrides TO directus_app;
GRANT INSERT (role_key, collection, action, effect, created_by)
  ON role_grant_overrides TO directus_app;
GRANT DELETE ON role_grant_overrides TO directus_app;

REVOKE ALL ON role_grant_overrides FROM PUBLIC;
