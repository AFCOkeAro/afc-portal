-- rollback/20261020_0013_office.down.sql
--
-- Reversal for 20261020_0013_office.sql. AFC-477 / AFC-463f.
--
-- What it destroys, stated plainly:
--   transfers / transfer_events, marriage_matters / marriage_matter_events,
--   office_minutes / minutes_attendees / office_minute_events,
--   tasks / task_events, announcements / announcement_events,
--   event_referrals.
--   The conditional FKs (§9: transfers_*_fkey, marriage_matters_*_fkey,
--   office_minutes_*_fkey, minutes_attendees_person_fkey,
--   tasks_*_fkey, announcements_*_fkey, event_referrals_*_fkey,
--   events_attendance_session_fkey) die with their tables; they constrain no
--   surviving object, so there is nothing to drop separately. Parent tables
--   (people/branches/zones/events/attendance_sessions/...) are never touched:
--   this migration never created them.
--   The events §9.6 DELTA COLUMNS (overview, invite_a_friend_enabled,
--   attendance_session) are NOT dropped here: they live on a table this
--   migration never created, and removing a column from a surviving object
--   is a control removal the rollback-control gate (F1) refuses to reconcile
--   silently. A reviewed migrator step removes them if the events slice
--   ever wants them gone; this script leaves another slice's table exactly
--   as it found it, minus the FK this file added (dropped below, only where
--   this file created it).
--   No CASCADE: a hidden dependency must fail loudly, not vanish silently.
--   No trigger or function is created by the forward file, so the
--   rollback-control gate has only drops of objects this same migration
--   created to reconcile (F1: each referent goes in this same script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back office records that hold rows.
--
-- Office rows are captured ministry facts. Empty tables roll back; anything
-- else needs a verified copy first and a reviewed step, not this script.
-- Every audit trail counts as rows: rolling back over events would destroy
-- the record of what happened, which is exactly what the trail is for.
-- minutes_attendees counts as rows (attendance facts, not join noise).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count integer;
BEGIN
  FOR v_count IN
    SELECT count(*) FROM transfers
    UNION ALL SELECT count(*) FROM transfer_events
    UNION ALL SELECT count(*) FROM marriage_matters
    UNION ALL SELECT count(*) FROM marriage_matter_events
    UNION ALL SELECT count(*) FROM office_minutes
    UNION ALL SELECT count(*) FROM minutes_attendees
    UNION ALL SELECT count(*) FROM office_minute_events
    UNION ALL SELECT count(*) FROM tasks
    UNION ALL SELECT count(*) FROM task_events
    UNION ALL SELECT count(*) FROM announcements
    UNION ALL SELECT count(*) FROM announcement_events
    UNION ALL SELECT count(*) FROM event_referrals
  LOOP
    IF v_count > 0 THEN
      RAISE EXCEPTION
        'refusing to roll back office: an office table holds % row(s). These are captured ministry facts including their audit trails. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
        v_count
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  RAISE NOTICE
    'office rollback proceeding: no office rows. Re-apply 20261020_0013 to restore the tables.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Drop the FK this file added to a surviving table (only where present).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.events') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_session_fkey') THEN
    ALTER TABLE events DROP CONSTRAINT events_attendance_session_fkey;
    RAISE NOTICE 'events_attendance_session_fkey dropped (added by 0012, host table survives).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables in dependency order: audit/children before parents.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS announcement_events;
DROP TABLE IF EXISTS task_events;
DROP TABLE IF EXISTS office_minute_events;
DROP TABLE IF EXISTS marriage_matter_events;
DROP TABLE IF EXISTS transfer_events;
DROP TABLE IF EXISTS minutes_attendees;
DROP TABLE IF EXISTS event_referrals;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS office_minutes;
DROP TABLE IF EXISTS marriage_matters;
DROP TABLE IF EXISTS transfers;
