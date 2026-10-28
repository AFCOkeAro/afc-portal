-- Migration 0052: leave requests (AFC-842, chairman direction 2026-10-28).
--
-- New Church Office menu for Annual Leave. One register: leave_requests
-- (one row per request; requester, dates, computed working days, type,
-- reason, status, decider). Approvals ride the same row (status +
-- decided_by/at); there is no separate decision table to drift.
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, resolved from the requester's scope at
-- write time). No afc_set_scope trigger: a 30th trigger would break the
-- versioned suite-94 pin, and the portal route owns scope here. Suite 94
-- is untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app. DELETE is granted
-- here: withdrawing a draft request is the tool, and corrections ride the
-- same row; there is no financial trail on this register. REVOKE PUBLIC.
-- No roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-842). R2 CTO review on
-- the AFC-842 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0052_leave_requests.down.sql
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
         AND c.relname IN ('leave_requests')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the leave register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. leave_requests. One row per request; approvals ride the same row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  person               uuid REFERENCES people(id) ON DELETE SET NULL,
  start_date           date NOT NULL,
  end_date             date NOT NULL,
  days                 integer NOT NULL CHECK (days >= 1),
  leave_type           text NOT NULL DEFAULT 'annual'
                         CHECK (leave_type IN
                           ('annual', 'sick', 'maternity', 'compassionate',
                            'unpaid', 'other')),
  reason               text,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'declined', 'cancelled')),
  decided_by           uuid,
  decided_at           timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates CHECK (end_date >= start_date)
);

COMMENT ON TABLE leave_requests IS
  'AFC-842: staff leave requests (Church Office). days counts start..end inclusive, stamped by the route. status rides the same row (pending/approved/declined/cancelled); branch/zone are route-stamped denorms (0044 choice-8 precedent, no scope trigger).';

CREATE INDEX IF NOT EXISTS leave_requests_branch_idx
  ON leave_requests (branch);
CREATE INDEX IF NOT EXISTS leave_requests_person_idx
  ON leave_requests (person) WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_status_idx
  ON leave_requests (status);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns (branch/zone/person/days/decided stamps are
--    write-once, route-stamped); DELETE granted (withdrawing a draft is
--    the tool; no financial trail on this register). REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON leave_requests TO directus_app;
GRANT INSERT (branch, zone, person, start_date, end_date, days, leave_type, reason, status, decided_by, decided_at, created_by)
  ON leave_requests TO directus_app;
GRANT UPDATE (leave_type, reason, status, decided_by, decided_at)
  ON leave_requests TO directus_app;
GRANT DELETE ON leave_requests TO directus_app;

REVOKE ALL ON leave_requests FROM PUBLIC;
