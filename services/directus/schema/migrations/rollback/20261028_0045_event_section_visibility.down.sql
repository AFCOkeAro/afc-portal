-- rollback/20261028_0045_event_section_visibility.down.sql
--
-- Reversal for 20261028_0045_event_section_visibility.sql (AFC-871).
--
-- What it destroys, stated plainly:
--   events.registration_visibility / speakers_visibility /
--   resources_visibility / schedule_visibility -- per-section access marks.
--     Refusal is narrow: login/custom/draft anywhere, or public on a
--     non-public event, is a deliberate staff access decision and refuses.
--     private anywhere, and public on a public event, are the default and
--     the forward backfill respectively -- both re-derivable, both safe to
--     drop. (A post-migration public event whose sections stayed private
--     is the fail-closed default, not configuration, and rolls back.)
--   events.speakers / events.resources / events.schedule -- staff-entered
--     programme content. A non-empty array refuses; an empty array drops.
--
-- What it does NOT destroy: events rows (only columns are dropped), the
-- legacy visibility/status columns (untouched), or any grant on any other
-- table. Where events is absent (forward never applied) every statement is
-- conditional and the script is a no-op with a NOTICE.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back configured section data the legacy column cannot
--    re-derive. Unconfigured rows (backfill values + empty arrays) roll
--    back; anything staff deliberately set needs a verified copy first.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_configured integer := 0;
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'events absent: 0045 rollback is a no-op (forward never applied).';
    RETURN;
  END IF;

  SELECT count(*) INTO v_configured FROM events
   WHERE registration_visibility IN ('login', 'custom', 'draft')
      OR speakers_visibility IN ('login', 'custom', 'draft')
      OR resources_visibility IN ('login', 'custom', 'draft')
      OR schedule_visibility IN ('login', 'custom', 'draft')
      OR (registration_visibility = 'public' AND visibility <> 'public')
      OR (speakers_visibility = 'public' AND visibility <> 'public')
      OR (resources_visibility = 'public' AND visibility <> 'public')
      OR (schedule_visibility = 'public' AND visibility <> 'public')
      OR speakers <> '[]'::jsonb
      OR resources <> '[]'::jsonb
      OR schedule <> '[]'::jsonb;

  IF v_configured > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event section visibility: % event row(s) carry configured section data (staff-set marks or non-empty sections) the legacy visibility column cannot re-derive. Take a verified copy before proceeding. Unconfigured rows roll back; configured rows do not.',
      v_configured
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'event section-visibility rollback proceeding: no configured rows. Re-apply 20261028_0045 to get the columns back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The seven columns. No cascading drop. Guarded: absence is not failure.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE events DROP COLUMN IF EXISTS registration_visibility;
  ALTER TABLE events DROP COLUMN IF EXISTS speakers_visibility;
  ALTER TABLE events DROP COLUMN IF EXISTS resources_visibility;
  ALTER TABLE events DROP COLUMN IF EXISTS schedule_visibility;
  ALTER TABLE events DROP COLUMN IF EXISTS speakers;
  ALTER TABLE events DROP COLUMN IF EXISTS resources;
  ALTER TABLE events DROP COLUMN IF EXISTS schedule;
END
$$;
