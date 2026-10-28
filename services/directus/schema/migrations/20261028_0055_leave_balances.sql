-- Migration 0055: leave balances (AFC-854 phase 1, chairman direction
-- 2026-10-29).
--
-- Minimal church HR starts with Time Off: one leave_balances row per
-- person per year names the annual allowance in working days. Used and
-- remaining days are computed against the AFC-842 leave_requests register
-- in phase 2 (that slice is staged but unmerged; this register stands
-- alone by design so HR phase 1 lands without stacking on it).
--
-- A balance cannot exist without its holder: person is NOT NULL and the
-- link cascades (documented deviation from the generic SET NULL denorm
-- convention — an orphaned allowance is meaningless, unlike a cleared
-- denorm).
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, resolved from the person row at write
-- time). No afc_set_scope trigger: a 31st trigger would break the
-- versioned suite-94 pin, and the portal route owns scope here. Suite 94
-- is untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app (allowance admin
-- is programme content; add/remove is the tool). REVOKE PUBLIC.
-- No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-854). R2 CTO review on
-- the AFC-854 thread before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0055_leave_balances.down.sql
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
-- 1. OWNERSHIP PRECONDITION. Brand-new register: fail closed if a leftover
--    table from a failed apply is owned by someone else.
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
         AND c.relname IN ('leave_balances')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the balances register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. leave_balances. One allowance row per person per year.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_balances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person               uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  year                 integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  allowance_days       integer NOT NULL CHECK (allowance_days >= 0),
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_balances_once UNIQUE (person, year)
);

COMMENT ON TABLE leave_balances IS
  'AFC-854: annual leave allowance in working days per person per year (Time Off phase 1). Person link cascades (an allowance cannot outlive its holder); branch/zone are route-stamped denorms (0044 choice-8 precedent, no scope trigger). Used/remaining compute against leave_requests in phase 2.';

CREATE INDEX IF NOT EXISTS leave_balances_person_idx
  ON leave_balances (person);
CREATE INDEX IF NOT EXISTS leave_balances_year_idx
  ON leave_balances (year);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns; DELETE granted (allowance admin is programme
--    content). REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON leave_balances TO directus_app;
GRANT INSERT (person, year, allowance_days, branch, zone, created_by)
  ON leave_balances TO directus_app;
GRANT UPDATE (allowance_days, branch, zone)
  ON leave_balances TO directus_app;
GRANT DELETE ON leave_balances TO directus_app;

REVOKE ALL ON leave_balances FROM PUBLIC;
