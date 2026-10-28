-- Migration 0050: session activities (AFC-826, chairman direction 2026-10-27).
--
-- Schedule sessions ARE attendance_sessions (one model: the Schedule tab
-- builds the event's session list, and attendance capture/check-in already
-- reads the same rows). What is missing is the per-session activity
-- breakdown (Music, Prayer, Announcement, Talk, ...). This register holds
-- one row per programme item inside a session.
--
-- Design (recorded on AFC-826 before code): no new schedule/session header
-- tables -- attendance_sessions already carries event, session_date,
-- session_type, session_name. Ordering inside an event schedule is
-- (session_date, session_name); activities order by (position, created_at).
--
-- Scope (choice 8, the 0044 event_expenses precedent): branch/zone are
-- route-stamped denorms (SET NULL, from the parent session at write time).
-- No afc_set_scope trigger: a 29th trigger would break the versioned
-- suite-94 pin, and the portal route owns scope here the same way it does
-- for expenses. Suite 94 is untouched by this slice.
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app. DELETE is granted
-- here (unlike the attendance/financial registers): activities are
-- programme draft content, and add/remove is the core of the builder. Wrong
-- items are removed, not voided -- there is no financial/audit trail on
-- this register. REVOKE PUBLIC. No roles provisioned (ADR-0002).
--
-- Down-order caveat (the 0023 pattern): this slice owns the FK
-- session_activities_session_fkey referencing attendance_sessions. Suites
-- 86/88 park that constraint around the 0023 empty rollback and re-add it
-- after, the same way they park the 0034 blessing_recipients links.
--
-- Review: R1 self-claim by the operator run (AFC-826). R2 CTO review on
-- the AFC-826 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0050_session_activities.down.sql
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
         AND c.relname IN ('session_activities')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the activities register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. session_activities. One row per programme item inside a session.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_activities (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session              uuid NOT NULL,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  activity_type        text NOT NULL
                         CHECK (activity_type IN
                           ('music', 'prayer', 'announcement', 'talk',
                            'bible_reading', 'offering', 'testimony', 'drama',
                            'communion', 'welcome', 'closing', 'other')),
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  position             integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  duration_minutes     integer CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes                text,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_activities_once UNIQUE (session, activity_type, title, position)
);

COMMENT ON TABLE session_activities IS
  'AFC-826: programme items inside an attendance session (schedule builder). session cascades: deleting a session removes its programme. branch/zone are route-stamped denorms from the parent session (0044 choice-8 precedent, no scope trigger). Position orders items within a session.';

-- Named FK (parked by suites 86/88 around the 0023 empty rollback).
DO $$
BEGIN
  IF to_regclass('public.session_activities') IS NOT NULL
     AND to_regclass('public.attendance_sessions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'session_activities_session_fkey') THEN
    ALTER TABLE session_activities ADD CONSTRAINT session_activities_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE CASCADE;
    RAISE NOTICE 'session_activities_session_fkey ensured (programme cascades with its session).';
  ELSE
    RAISE NOTICE 'session_activities_session_fkey already present or a referent is absent, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS session_activities_session_idx
  ON session_activities (session);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns (session/branch/zone write-once, route-stamped);
--    DELETE granted (programme draft content -- add/remove is the builder;
--    no audit trail on this register). REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON session_activities TO directus_app;
GRANT INSERT (session, branch, zone, activity_type, title, position, duration_minutes, notes, created_by)
  ON session_activities TO directus_app;
GRANT UPDATE (activity_type, title, position, duration_minutes, notes)
  ON session_activities TO directus_app;
GRANT DELETE ON session_activities TO directus_app;

REVOKE ALL ON session_activities FROM PUBLIC;
