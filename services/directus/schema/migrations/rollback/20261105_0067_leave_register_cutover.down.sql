-- rollback/20261105_0067_leave_register_cutover.down.sql
--
-- Reversal for 20261105_0067 (AFC-1058 leave-register cutover).
--
-- What it destroys, stated plainly:
--   leave_request_events     -- the per-request audit rows (child, dropped
--                              first). Includes the cutover `created`
--                              backfills and the D1/D2 conversion notes.
--   the 0067 reshape of leave_requests -- dropped whole and re-created in
--      the 0052 shape below (byte-equivalent to the 0052 CREATE TABLE:
--      person/days columns, 0052 CHECK sets incl. maternity/declined/
--      cancelled, SET NULL links, DELETE grant).
--   No parent table is touched (all person/branch/zone links are SET NULL
--   references; requester_user/decided_by/created_by/actor_user are bare
--   uuids, no FK): people, branches, zones and directus_users are never
--   touched. No CASCADE: the child-first drop order is the guarantee.
--
-- WHY DROP + RE-CREATE (not ALTER): the 0067 CHECKs guard a table that
-- survives an ALTER-based reversal, so dropping them piecemeal would
-- disarm the register without restoring its guards (the AFC-253 shape
-- scripts/migration-rollback-gate.sh exists to catch). Dropping the
-- reshaped table and re-creating the 0052 shape restores every guard
-- with the shape in one auditable step.
--
-- What it CANNOT restore, stated plainly: per-row data flattened by the
-- forward cutover (stored `days` counts, maternity/cancelled originals,
-- person-vs-requester_person distinction beyond the backfill). Reversal is
-- therefore allowed ONLY on an empty register; populated tables refuse.
-- Restoring a populated register means re-applying 0067 after restoring
-- the verified pre-cutover copy, not running this script.

-- ---------------------------------------------------------------------------
-- 0. Refuse while leave rows exist. These are audited ministry facts
--    holding personal data; take a verified copy before proceeding. Empty
--    tables roll back, populated ones do not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_requests integer := 0;
  v_events integer := 0;
BEGIN
  IF to_regclass('public.leave_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_requests FROM leave_requests;
  END IF;
  IF to_regclass('public.leave_request_events') IS NOT NULL THEN
    SELECT count(*) INTO v_events FROM leave_request_events;
  END IF;

  IF v_requests > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back the leave cutover (0067): leave_requests holds % row(s), leave_request_events holds % row(s). These are audited ministry facts holding personal data. Restore the verified pre-cutover copy and re-apply 20261105_0067 instead; empty tables roll back, populated ones do not.',
      v_requests, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'leave cutover 0067 rollback proceeding: no leave rows. Re-apply 20261105_0067 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Child first, then the reshaped parent. No CASCADE: the order is the
--    guarantee.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS leave_request_events;
DROP TABLE IF EXISTS leave_requests;

-- ---------------------------------------------------------------------------
-- 2. Re-create the 0052 shape (byte-equivalent to the 0052 CREATE TABLE).
--    Conditional parent links (the 0003 merge-contract pattern): each FK
--    lands only where the parent exists, exactly as a fresh 0052 apply
--    would leave them.
-- ---------------------------------------------------------------------------
CREATE TABLE leave_requests (
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
-- 3. Restore the 0052 grant ceiling, DELETE included (withdrawing a draft
--    is the tool on the 0052 shape; no financial trail on this register).
-- ---------------------------------------------------------------------------
REVOKE ALL ON leave_requests FROM directus_app;
GRANT SELECT ON leave_requests TO directus_app;
GRANT INSERT (branch, zone, person, start_date, end_date, days, leave_type, reason, status, decided_by, decided_at, created_by)
  ON leave_requests TO directus_app;
GRANT UPDATE (leave_type, reason, status, decided_by, decided_at)
  ON leave_requests TO directus_app;
GRANT DELETE ON leave_requests TO directus_app;

REVOKE ALL ON leave_requests FROM PUBLIC;
