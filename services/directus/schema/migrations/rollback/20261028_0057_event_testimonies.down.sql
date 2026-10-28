-- rollback/20261028_0057_event_testimonies.down.sql
--
-- Reversal for 20261028_0057_event_testimonies.sql (AFC-828 phase 4).
--
-- What it destroys, stated plainly:
--   event_testimonies -- every shared testimony. Refuses while rows exist:
--   a rolled-back register silently drops what the public shared, so a
--   non-empty table does not roll back.
--
-- What it does NOT destroy: events/branches/zones rows (only referenced),
-- roles, policies, permissions, or any grant on any other table. Where the
-- table is absent (forward never applied) the script is a no-op with a
-- NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_testimonies') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM event_testimonies;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event testimonies: the table holds % row(s). Clear the submissions first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'testimonies rollback proceeding: no rows.';
END $$;

DROP TABLE IF EXISTS event_testimonies;
