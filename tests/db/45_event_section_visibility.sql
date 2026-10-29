-- tests/db/45_event_section_visibility.sql
--
-- AFC-871 (parent AFC-460). THE EVENT SECTION-VISIBILITY CONTRACT.
--
-- Migration 0045 adds per-section visibility (registration, speakers,
-- resources, schedule: draft/private/public/login/custom) plus the three
-- programme-detail sections (speakers/resources/schedule jsonb arrays) on
-- events. The public feed serves a section only when its mark is 'public';
-- login/custom/draft/private fail closed.
--
--   45.1 shape       -- the seven columns exist with the documented types,
--                        nullability and fail-closed defaults.
--   45.2 enums       -- outside the five marks is rejected (23514) on all
--                        four columns; a non-array section is rejected;
--                        login/custom store (they fail closed at the route,
--                        not here).
--   45.3 default+backfill -- fresh rows default private/empty; re-applying
--                        0045 opens private sections on public events but
--                        never overwrites a staff-set mark.
--   45.4 guards      -- the app identity reads/inserts/updates the new
--                        columns, still deletes nothing, and gets 23514 (not
--                        a silent pass) for bad marks.
--   45.5 rerun       -- re-applying 20261028_0045 changes nothing.
--   45.6 rollback    -- configured rows refuse; unconfigured rows drop the
--                        columns; the forward file is re-applied after.
--   45.7 acceptance  -- the public-feed predicate (public + published +
--                        section public) serves exactly the open rows: no
--                        login/custom leak, no scope leak.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- the public detail endpoint, the register stepper, the staff section
-- editors -- lives in the route layer and is covered by the AFC-871 web
-- contract suite. No retention probe: sections carry no retention clock.

-- ---------------------------------------------------------------------------
-- 45.1 SHAPE. Columns, types, nullability, fail-closed defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_default text;
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('registration_visibility', 'speakers_visibility',
          'resources_visibility', 'schedule_visibility',
          'speakers', 'resources', 'schedule')) = 7, 'sections',
    'events carries the four visibility marks and the three section arrays (7)');

  -- Visibility marks are text, sections are jsonb.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name LIKE '%_visibility' AND data_type = 'text') = 4, 'sections',
    'the four marks are text');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('speakers', 'resources', 'schedule')
        AND data_type = 'jsonb') = 3, 'sections',
    'speakers/resources/schedule are jsonb');

  -- All seven are NOT NULL (fail closed beats absent).
  FOR v_nullable IN
    SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name IN ('registration_visibility', 'speakers_visibility',
         'resources_visibility', 'schedule_visibility',
         'speakers', 'resources', 'schedule')
  LOOP
    PERFORM test_support.assert_equals(v_nullable, 'NO', 'sections',
      'section columns are NOT NULL (no absent mark, no absent list)');
  END LOOP;

  -- Defaults: private marks, empty arrays.
  FOR v_default IN
    SELECT column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name LIKE '%_visibility'
  LOOP
    PERFORM test_support.assert_true(v_default LIKE '%private%', 'sections',
      'visibility default is private (' || coalesce(v_default, 'no default') || ')');
  END LOOP;
  FOR v_default IN
    SELECT column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND column_name IN ('speakers', 'resources', 'schedule')
  LOOP
    PERFORM test_support.assert_true(v_default LIKE '%[]%', 'sections',
      'section default is an empty array (' || coalesce(v_default, 'no default') || ')');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 45.2 ENUMS. Five marks, arrays only, login/custom storable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Section Enum Probe', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET registration_visibility = ''friends'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'an undocumented registration mark is rejected');
  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET speakers_visibility = ''friends'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'an undocumented speakers mark is rejected');
  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET resources_visibility = ''friends'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'an undocumented resources mark is rejected');
  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET schedule_visibility = ''friends'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'an undocumented schedule mark is rejected');

  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET speakers = ''{"name":"Ada"}'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'a speakers object is rejected (arrays only)');
  PERFORM test_support.assert_raises(NULL,
    'UPDATE events SET schedule = ''"Sunday"'' WHERE id = ''' || v_event::text || '''',
    '23514', 'sections', 'a schedule scalar is rejected (arrays only)');

  -- login/custom store: the database records the mark; the route fails it
  -- closed. Rejecting them here would invent a policy the spec never states.
  PERFORM test_support.assert_not_raises(NULL,
    'UPDATE events SET registration_visibility = ''login'', speakers_visibility = ''custom'' WHERE id = ''' || v_event::text || '''',
    'sections', 'login/custom marks store (fail-closed lives at the route, not here)');
  PERFORM test_support.assert_not_raises(NULL,
    'UPDATE events SET speakers = ''[{"name":"Ada","role":"Choir"}]'' WHERE id = ''' || v_event::text || '''',
    'sections', 'a speakers array writes');

  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 45.3 DEFAULT + BACKFILL. Fresh rows fail closed; re-apply opens public
--        rows but never overwrites a staff-set mark.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Section Default Probe', now(), now());

  PERFORM test_support.assert_true(
    (SELECT registration_visibility FROM events WHERE title = 'Section Default Probe') = 'private', 'sections',
    'a fresh row defaults registration_visibility to private (fail closed)');
  PERFORM test_support.assert_true(
    (SELECT speakers FROM events WHERE title = 'Section Default Probe') = '[]'::jsonb, 'sections',
    'a fresh row defaults speakers to an empty array');

  -- The guarded backfill: make one row public, give another a staff-set
  -- login mark, then re-apply below.
  UPDATE events SET visibility = 'public' WHERE title = 'Section Default Probe';
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Section Staff Probe', now(), now());
  UPDATE events SET visibility = 'public', registration_visibility = 'login'
   WHERE title = 'Section Staff Probe';
END $$;

-- Re-apply at top level (a \i inside a DO body would land mid-function).
\i services/directus/schema/migrations/20261028_0045_event_section_visibility.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT registration_visibility FROM events WHERE title = 'Section Default Probe') = 'public', 'sections',
    're-apply: a public row still on the default opens (backfill)');
  PERFORM test_support.assert_true(
    (SELECT registration_visibility FROM events WHERE title = 'Section Staff Probe') = 'login', 'sections',
    're-apply: a staff-set login mark is never overwritten by the backfill');

  DELETE FROM events WHERE title IN ('Section Default Probe', 'Section Staff Probe');
END $$;

-- ---------------------------------------------------------------------------
-- 45.4 GUARDS. The app reads/inserts/updates the new columns, deletes
--        nothing, and gets CHECK failures (not silent passes) for bad marks.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Section Guard Event', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_not_raises('directus_app',
    'SELECT registration_visibility, speakers, resources, schedule FROM events WHERE false',
    'sections', 'app reads the section columns');
  PERFORM test_support.assert_not_raises('directus_app',
    'INSERT INTO events (title, start_at, end_at, registration_visibility, speakers) VALUES (''Section App Probe'', now(), now(), ''public'', ''[]'')',
    'sections', 'app inserts the section columns (probe row cleaned below)');
  PERFORM test_support.assert_not_raises('directus_app',
    'UPDATE events SET schedule_visibility = ''public'' WHERE false',
    'sections', 'app updates a section mark');
  PERFORM test_support.assert_not_raises('directus_app',
    'UPDATE events SET resources = resources WHERE false',
    'sections', 'app updates a section array');

  -- A CHECK fires on a written row, never on a matched-zero UPDATE, so
  -- the bad-mark probe inserts (the 44.4 pattern); WHERE false would pass
  -- vacuously and certify nothing.
  PERFORM test_support.assert_raises('directus_app',
    'INSERT INTO events (title, start_at, end_at, resources_visibility) VALUES (''Section Bad Mark'', now(), now(), ''friends'')',
    '23514', 'sections', 'a bad mark is rejected for the app too');
  PERFORM test_support.assert_raises('directus_app',
    'DELETE FROM events WHERE false',
    '42501', 'sections', 'app cannot DELETE events (cancelled, never deleted, per 0021)');

  DELETE FROM events WHERE title IN ('Section Guard Event', 'Section App Probe');
END $$;

-- ---------------------------------------------------------------------------
-- 45.5 RERUN. Re-applying 20261028_0045 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261028_0045_event_section_visibility.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('registration_visibility', 'speakers_visibility',
          'resources_visibility', 'schedule_visibility',
          'speakers', 'resources', 'schedule')) = 7, 'sections',
    'rerun: the seven columns survive (IF NOT EXISTS, grants intact)');
END $$;

-- ---------------------------------------------------------------------------
-- 45.6 ROLLBACK. Configured rows refuse; unconfigured rows drop the
--        columns; the forward file is re-applied after. The refusal pin is
--        the down script's own guard predicate (79.9 precedent), not the
--        script's NOTICE text.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  INSERT INTO events (title, start_at, end_at, registration_visibility,
      speakers)
    VALUES ('Section Configured Probe', now(), now(), 'login',
      '[{"name":"Ada"}]');

  PERFORM test_support.assert_raises(NULL,
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM events
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
          OR schedule <> '[]'::jsonb) > 0 THEN RAISE EXCEPTION 'refusing to roll back event section visibility: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'sections',
    'rollback refuses while a configured row exists (login mark + content)');

  DELETE FROM events WHERE title = 'Section Configured Probe';
END $outer$;

\i services/directus/schema/migrations/rollback/20261028_0045_event_section_visibility.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'registration_visibility'), 'sections',
    'empty rollback: the mark columns are gone');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'speakers'), 'sections',
    'empty rollback: the section arrays are gone');
END $$;

-- Leave the columns present, as the forward migration leaves them.
\i services/directus/schema/migrations/20261028_0045_event_section_visibility.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('registration_visibility', 'speakers_visibility',
          'resources_visibility', 'schedule_visibility',
          'speakers', 'resources', 'schedule')) = 7, 'sections',
    're-apply: the seven columns are back (idempotent forward, apply order)');
END $$;

-- ---------------------------------------------------------------------------
-- 45.7 ACCEPTANCE, as the public-feed predicate over the table itself.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_open uuid;
  v_login uuid;
  v_draft uuid;
  v_served integer;
BEGIN
  INSERT INTO events (title, start_at, end_at, visibility, status,
      registration_visibility)
    VALUES ('Section Open Programme', now(), now() + interval '1 day',
      'public', 'published', 'public') RETURNING id INTO v_open;
  INSERT INTO events (title, start_at, end_at, visibility, status,
      registration_visibility)
    VALUES ('Section Login Programme', now(), now() + interval '1 day',
      'public', 'published', 'login') RETURNING id INTO v_login;
  INSERT INTO events (title, start_at, end_at, visibility, status,
      registration_visibility)
    VALUES ('Section Branch Programme', now(), now() + interval '1 day',
      'branch', 'published', 'public') RETURNING id INTO v_draft;

  -- The exact predicate the public feed must apply: legacy public +
  -- published + section public. Anything else fails closed.
  SELECT count(*) INTO v_served FROM events
   WHERE visibility = 'public' AND status = 'published'
     AND registration_visibility = 'public';
  PERFORM test_support.assert_true(v_served >= 1 AND EXISTS (
    SELECT 1 FROM events WHERE id = v_open AND visibility = 'public'
      AND status = 'published' AND registration_visibility = 'public'), 'sections',
    'ACCEPTANCE: the open programme is served by the public predicate');
  PERFORM test_support.assert_true(NOT EXISTS (
    SELECT 1 FROM events WHERE id IN (v_login, v_draft) AND visibility = 'public'
      AND status = 'published' AND registration_visibility = 'public'), 'sections',
    'ACCEPTANCE: login-marked and branch-scoped rows never pass the public predicate (no leak)');

  DELETE FROM events WHERE id IN (v_open, v_login, v_draft);
END $$;
