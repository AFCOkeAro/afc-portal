-- rollback/20261028_0049_role_grant_overrides.down.sql
--
-- Reversal for 20261028_0049_role_grant_overrides.sql (AFC-836).
--
-- What it destroys, stated plainly:
--   role_grant_overrides -- every super_admin delta row. Refuses while
--   rows exist: a rolled-back delta silently re-locks (revoke rows) or
--   re-opens (grant rows) access, so an empty table is the precondition.
--
-- What it does NOT destroy: roles, policies, permissions, or any grant on
-- any other table. Where the table is absent (forward never applied)
-- every statement is IF EXISTS and the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.role_grant_overrides') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM role_grant_overrides;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back role_grant_overrides: the table holds % row(s). Clear the matrix deltas first (re-grant or un-revoke from the Roles UI); an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'role_grant_overrides rollback proceeding: no deltas.';
END $$;

DROP TABLE IF EXISTS role_grant_overrides;
