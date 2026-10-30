-- rollback/20261029_0061_session_resources.down.sql
--
-- Reversal for 20261029_0061_session_resources.sql (AFC-883).
--
-- What it destroys, stated plainly:
--   event_resources.session_id -- the session handout link. Refuses while
--   any link is set: a rolled-back column silently detaches handouts from
--   the sessions they were shared at, so a non-empty column does not
--   roll back.
--
-- What it does NOT destroy: event_resources rows (untouched), sessions
-- rows (only referenced), the Directus file rows behind uploads, roles,
-- policies, permissions, or any grant on any other column. Where the
-- column is absent the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF to_regclass('public.event_resources') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'event_resources'
                    AND column_name = 'session_id') THEN
    SELECT count(*) INTO v_rows FROM event_resources WHERE session_id IS NOT NULL;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back session links: % resource row(s) still link a session. Clear the session links first; an empty column rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'session-link rollback proceeding: no links set.';
END $$;

ALTER TABLE IF EXISTS event_resources DROP COLUMN IF EXISTS session_id;
