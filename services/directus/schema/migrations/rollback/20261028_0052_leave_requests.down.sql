-- rollback/20261028_0052_leave_requests.down.sql
--
-- Reversal for 20261028_0052_leave_requests.sql (AFC-842).
--
-- What it destroys, stated plainly:
--   leave_requests -- every leave request row. Refuses while rows exist:
--   a rolled-back register silently drops the leave history, so a
--   non-empty table does not roll back.
--
-- What it does NOT destroy: branches/zones/people rows (only referenced),
-- roles, policies, permissions, or any grant on any other table. Where the
-- table is absent (forward never applied) the script is a no-op with a
-- NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.leave_requests') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM leave_requests;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back leave requests: the table holds % row(s). Clear the requests first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'leave rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS leave_requests;
