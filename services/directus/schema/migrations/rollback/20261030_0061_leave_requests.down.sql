-- rollback/20261030_0061_leave_requests.down.sql
--
-- Reversal for 20261030_0061 (AFC-930 leave register).
--
-- What it destroys, stated plainly:
--   leave_request_events -- the per-request audit rows (child, dropped first).
--   leave_requests       -- the leave rows themselves.
--   No parent table is touched (requester_user/decided_by/created_by/
--   actor_user are bare uuids, no FK): people, branches, zones and
--   directus_users are never touched. No CASCADE needed beyond the
--   child-first drop order (the events FK is CASCADE, but the explicit
--   order keeps the rollback readable without it).

-- ---------------------------------------------------------------------------
-- 0. Refuse while leave rows exist. These are audited ministry facts holding
--    personal data; take a verified copy before proceeding. Empty tables
--    roll back, populated ones do not.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_requests integer;
  v_events integer;
BEGIN
  SELECT count(*) INTO v_requests FROM leave_requests;
  SELECT count(*) INTO v_events FROM leave_request_events;

  IF v_requests > 0 OR v_events > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back leave_requests: leave_requests holds % row(s), leave_request_events holds % row(s). These are audited ministry facts holding personal data. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_requests, v_events
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'leave_requests 0061 rollback proceeding: no leave rows. Re-apply 20261030_0061 to restore.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Child first, then parent. No CASCADE: the order is the guarantee.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS leave_request_events;
DROP TABLE IF EXISTS leave_requests;
