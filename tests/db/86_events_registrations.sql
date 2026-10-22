-- tests/db/86_events_registrations.sql
--
-- AFC-566 (parent AFC-460). THE EVENTS + REGISTRATIONS REGISTER CONTRACT.
--
-- Staging 500s on /api/events/* traced to the same class as AFC-550 and
-- 0020: the routes read events + event_registrations, but no versioned
-- migration created them (0005 adds invite columns only conditionally;
-- 0017 adds group_code only conditionally). 0021 closes the gap. This suite
-- pins what the portal routes need from those tables.
--
--   86.1  shape         -- both tables exist with the columns the routes
--                           select (EVENT_FIELDS / REGISTRATION_FIELDS),
--                           the documented types, nullability and defaults.
--   86.2  enums         -- event_type/visibility/status/registration_status/
--                           payment_status/source/age_group outside the
--                           documented sets are rejected (23514); slug and
--                           ticket_code unique; group_code length gate.
--   86.3  links         -- registration to a missing event fails (23503);
--                           event on a missing branch fails; registration
--                           person SET NULLs (pinned via confdeltype, never
--                           by deleting a retention-managed person);
--                           deleting an event CASCADES its registrations;
--                           the 0005 merge stays open (no
--                           event_invites_event_fkey -- choice 6).
--   86.4  overlap       -- re-applying 0005 + 0017 changes nothing: the
--                           invite deltas and group_code are IF NOT EXISTS
--                           no-ops over 0021's tables.
--   86.5  guards        -- the app identity reads/inserts/updates
--                           operational columns and deletes nothing (42501
--                           on DELETE); validation rejects bad rows for the
--                           app too.
--   86.6  rerun         -- re-applying 20261020_0021 changes nothing.
--   86.7  empty rollback -- with no rows the down script drops both
--                           registers; the forward file is re-applied after.
--   86.8  acceptance    -- zero orphan registrations, zero duplicate
--                           tickets.
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- branch scoping, capability gates, check-in idempotency, group
-- idempotency keys -- lives in the route layer and is covered by
-- tests/web/event-registration-completion.contract.mjs. No retention probe:
-- these registers carry no retention clock; erasure runs as
-- retention_worker.

-- ---------------------------------------------------------------------------
-- 86.1  SHAPE. Tables, columns, types, nullability, defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_nullable text;
  v_default text;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NOT NULL
    AND to_regclass('public.event_registrations') IS NOT NULL, 'events',
    'events and event_registrations both exist');

  -- Route-selected event columns (EVENT_FIELDS in index.get + [id].get).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('id', 'title', 'slug', 'summary', 'event_type',
          'branch', 'start_at', 'end_at', 'location', 'address', 'capacity',
          'waitlist_enabled', 'registration_open', 'registration_opens_at',
          'registration_closes_at', 'fee_amount', 'currency',
          'requires_guardian_consent', 'collect_medical', 'age_min',
          'age_max', 'visibility', 'status')) = 23, 'events',
    'events carries every column the routes select (23 incl. slug, visibility)');

  -- 0005 invite deltas ride the same table (no fork, no second ALTER).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events'
        AND column_name IN ('invite_eligible', 'invite_requires_approval',
          'live_join_url', 'reminders_enabled', 'reminder_offsets')) = 5, 'events',
    'events carries the five 0005 invite-delta columns');

  -- Route-selected registration columns (REGISTRATION_FIELDS, 27 incl.
  -- group_code + created_at which the S4 page and CSV need).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event_registrations'
        AND column_name IN ('id', 'event', 'person', 'registrant_first_name',
          'registrant_last_name', 'email', 'phone', 'date_of_birth',
          'age_group', 'branch', 'guardian_name', 'guardian_phone',
          'guardian_email', 'guardian_consent', 'consent_signed_at',
          'medical_notes', 'allergies', 'emergency_contact_name',
          'emergency_contact_phone', 'amount_expected', 'amount_paid',
          'payment_status', 'payment_reference', 'ticket_code',
          'group_code', 'registration_status', 'source', 'created_at')) = 28, 'events',
    'event_registrations carries every column the routes select (28 incl. group_code, ticket_code)');

  -- Slug/ticket are nullable UNIQUE (Flow-assigned, never client-sent).
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'events'
     AND column_name = 'slug';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'events',
    'events.slug is nullable (Flow assigns it after create)');
  SELECT is_nullable INTO v_nullable FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'event_registrations'
     AND column_name = 'ticket_code';
  PERFORM test_support.assert_equals(v_nullable, 'YES', 'events',
    'ticket_code is nullable (Flow assigns it; staff path forbids it)');

  -- Defaults: draft/pending/not_required/public_form + invite flags.
  FOR v_default IN
    SELECT column_default FROM information_schema.columns
     WHERE table_schema = 'public'
       AND ((table_name = 'events' AND column_name IN ('status', 'invite_eligible', 'reminders_enabled'))
         OR (table_name = 'event_registrations' AND column_name IN ('registration_status', 'payment_status', 'source')))
  LOOP
    PERFORM test_support.assert_true(v_default IS NOT NULL, 'events',
      'reviewed default present (' || v_default || ')');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 86.2  ENUMS. Documented sets enforced at write; uniques enforced.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO events (title, event_type, start_at, end_at) VALUES ('Rogue', 'rave', now(), now())$q$,
    '23514', 'events', 'an undocumented event_type is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO events (title, status, start_at, end_at) VALUES ('Rogue', 'teleported', now(), now())$q$,
    '23514', 'events', 'a non draft/published/closed/cancelled status is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status) VALUES (gen_random_uuid(), 'A', 'B', 'teleported')$q$,
    '23514', 'events', 'an undocumented registration_status is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, payment_status) VALUES (gen_random_uuid(), 'A', 'B', 'bartered')$q$,
    '23514', 'events', 'an undocumented payment_status is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, source) VALUES (gen_random_uuid(), 'A', 'B', 'carrier_pigeon')$q$,
    '23514', 'events', 'an undocumented source is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, group_code) VALUES (gen_random_uuid(), 'A', 'B', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$q$,
    '23514', 'events', 'a 65-char group_code is rejected (0017 length gate)');
END $$;

DO $$
DECLARE
  v_event uuid;
  v_event2 uuid;
BEGIN
  INSERT INTO events (title, slug, start_at, end_at)
    VALUES ('Slug Probe', 'slug-86-probe', now(), now()) RETURNING id INTO v_event;
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO events (title, slug, start_at, end_at) VALUES (''Slug Probe 2'', ''slug-86-probe'', now(), now())',
    '23505', 'events', 'events.slug unique is enforced (no forked event URLs)');

  INSERT INTO events (title, start_at, end_at)
    VALUES ('Ticket Probe', now(), now()) RETURNING id INTO v_event2;
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, ticket_code)
    VALUES (v_event2, 'Ticket', 'Holder', 'tix-86-probe');
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, ticket_code) VALUES (''' || v_event2::text || ''', ''Double'', ''Holder'', ''tix-86-probe'')',
    '23505', 'events', 'ticket_code unique is enforced (no double ticket)');

  DELETE FROM event_registrations WHERE ticket_code = 'tix-86-probe';
  DELETE FROM events WHERE id IN (v_event, v_event2);
END $$;

-- ---------------------------------------------------------------------------
-- 86.3  LINKS. FKs fail closed; delete semantics per §7 + choice 2.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_event uuid;
  v_orphan uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_branch FROM branches LIMIT 1;

  -- Registration to a missing event fails (23503), never silently.
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name) VALUES (''' || v_orphan::text || ''', ''No'', ''Event'')',
    '23503', 'events', 'a registration on a missing event is rejected');

  -- Event on a missing branch fails (stated choice 1: RESTRICT parent).
  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO events (title, branch, start_at, end_at) VALUES (''Nowhere'', ''' || v_orphan::text || ''', now(), now())',
    '23503', 'events', 'an event on a missing branch is rejected');

  INSERT INTO events (title, branch, start_at, end_at)
    VALUES ('Link Event', v_branch, now(), now()) RETURNING id INTO v_event;
  INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name)
    VALUES (v_event, 'Link', 'Member');

  -- Event delete CASCADES its registrations (§7: meaningless without the event).
  DELETE FROM events WHERE id = v_event;
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM event_registrations WHERE event = v_event), 'events',
    'deleting an event cascades its registrations');

  -- Person link is SET NULL (pinned via the constraint definition -- people
  -- rows are retention-managed and cannot be deleted even by the migrator,
  -- so no live-fire delete here).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_registrations_person_fkey'
               AND confdeltype = 'n'), 'events',
    'registration person FK is SET NULL (person leaving never deletes the row)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_registrations_event_fkey'
               AND confdeltype = 'c'), 'events',
    'registration event FK is CASCADE (row meaningless without its event)');

  -- The 0005 merge stays OPEN (choice 6): no FK on event_invites.event,
  -- because suite 73 pins bare-uuid inserts as fixtures.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_invites_event_fkey'), 'events',
    'no event_invites_event_fkey: the 0005 merge stays visibly open, never silently assumed');

  -- The 0013 + 0011 merges are CLOSED from the events side (§3): the FKs
  -- this migration added under the owning migrations' fixed names.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_event_fkey'), 'events',
    'event_referrals_event_fkey present: 0021 closed the 0013 merge');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_event_fkey'), 'events',
    'blessings_event_fkey present: 0021 closed the 0011 merge (fact survives its event, SET NULL)');
END $$;

-- ---------------------------------------------------------------------------
-- 86.4  OVERLAP. Re-applying 0005 + 0017 + 0013 changes nothing over 0021:
--        the invite deltas, group_code and §9.6 columns are IF NOT EXISTS
--        no-ops, and the merge FKs are already present under their fixed
--        names (0010 §3 precedent: the parent-landing slice closes them).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0005_event_invites.sql

\i services/directus/schema/migrations/20261020_0017_event_group_code.sql

\i services/directus/schema/migrations/20261020_0013_office.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'events'
               AND column_name = 'invite_eligible')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'events'
               AND column_name = 'overview')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'events'
               AND column_name = 'invite_a_friend_enabled')
    AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'event_registrations'
               AND column_name = 'group_code')
    AND EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_registrations_group_code_len')
    AND EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'event_referrals_event_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'blessings_event_fkey'), 'events',
    'overlap: invite deltas, §9.6 columns, group_code + CHECK and both merge FKs survive the 0005/0017/0013 re-apply');
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NOT NULL
    AND to_regclass('public.event_registrations') IS NOT NULL, 'events',
    'overlap: both 0021 tables survive the re-apply');
END $$;

-- ---------------------------------------------------------------------------
-- 86.5  GUARDS. The app reads/inserts/updates operational columns and
--        deletes nothing; validation rejects bad rows for the app too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_event uuid;
BEGIN
  INSERT INTO events (title, start_at, end_at)
    VALUES ('Guard Event', now(), now()) RETURNING id INTO v_event;

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM events$q$,
    'events', 'app reads events');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM event_registrations$q$,
    'events', 'app reads registrations (medical fields ride the grant; the route layer hides them per role)');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name) VALUES ($q$ ||
      '''' || v_event::text || ''', ''Guard'', ''Walk-in'')',
    'events', 'app creates the staff walk-in row (probe cleaned below)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE event_registrations SET registration_status = 'confirmed' WHERE event IS NULL$q$,
    'events', 'app advances registration status (check-in path)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE events SET status = status WHERE id IS NULL$q$,
    'events', 'app flips event status');

  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM events WHERE false$q$,
    '42501', 'events', 'app cannot DELETE events (cancelled, never deleted)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM event_registrations WHERE false$q$,
    '42501', 'events', 'app cannot DELETE registrations (terminal states, never deleted)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO event_registrations (event, registrant_first_name, registrant_last_name, registration_status) VALUES (gen_random_uuid(), 'Bad', 'Row', 'teleported')$q$,
    '23514', 'events', 'a bad status is rejected for the app too');

  DELETE FROM event_registrations WHERE event = v_event;
  DELETE FROM events WHERE id = v_event;
END $$;

-- ---------------------------------------------------------------------------
-- 86.6  RERUN. Re-applying 20261020_0021 changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0021_events_registrations.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NOT NULL
    AND to_regclass('public.event_registrations') IS NOT NULL, 'events',
    'rerun: both tables present (IF NOT EXISTS, grants intact, seeds absent by design)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM events WHERE slug = 'slug-86-probe') = 0, 'events',
    'rerun: probe rows stayed cleaned (no invented catalogue data)');
END $$;

-- ---------------------------------------------------------------------------
-- 86.7  EMPTY ROLLBACK, DOCUMENTED ORDER. Down-order is load-bearing (0021
--        down header): 0023's events_attendance_session_fkey lives ON the
--        events table 0021's down drops, so 0023 reverses FIRST -- reversing
--        0021 alone would strand that FK. This section proves the
--        documented order end to end.
-- ---------------------------------------------------------------------------
-- Suite 79's office fixtures occupy events (one fixture event + its
-- referral, seeded there under the 0013 merge). The down scripts refuse
-- while rows exist, so this section parks those two known fixture rows,
-- runs the ordered empty rollback, re-applies forward in apply order, and
-- restores them byte for byte -- the 84.5 "restore the tree" posture.
-- 79's assertions already ran.
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_registrations) = 0
    AND (SELECT count(*) FROM attendance_sessions) = 0
    AND (SELECT count(*) FROM attendance_records) = 0, 'events',
    'pre-rollback: empty registers (probes above cleaned up; 88 has not run yet)');

  DELETE FROM events WHERE id = '00000000-0000-4000-8000-0000000000e1';
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM events) = 0
    AND NOT EXISTS (SELECT 1 FROM event_referrals
                     WHERE id = '61111111-1111-4111-8111-111111111111'), 'events',
    'pre-rollback: 79 fixture event parked (its referral cascaded with it)');
END $$;

-- 0034 links blessing_recipients to attendance_sessions/events; those FKs
-- would block the register drops below, so they are parked and re-added after.
ALTER TABLE blessing_recipients DROP CONSTRAINT IF EXISTS blessing_recipients_session_fkey;
ALTER TABLE blessing_recipients DROP CONSTRAINT IF EXISTS blessing_recipients_event_fkey;
\i services/directus/schema/migrations/rollback/20261020_0023_attendance_sessions.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.attendance_sessions') IS NULL
    AND to_regclass('public.attendance_records') IS NULL, 'events',
    'reverse order: sessions registers go first (0023 down)');
END $$;

\i services/directus/schema/migrations/rollback/20261020_0021_events_registrations.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NULL
    AND to_regclass('public.event_registrations') IS NULL, 'events',
    'empty-table rollback: both tables are gone (0021 down second)');
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname IN
      ('event_referrals_event_fkey', 'blessings_event_fkey',
       'attendance_counts_session_fkey', 'blessings_session_fkey',
       'events_attendance_session_fkey')), 'events',
    'empty-table rollback: all five merge FKs are gone with their referents');
END $$;

-- Leave the registers present, as the forward migrations leave them --
-- apply order, mirroring the operator checklist.
\i services/directus/schema/migrations/20261020_0021_events_registrations.sql

\i services/directus/schema/migrations/20261020_0023_attendance_sessions.sql
\i services/directus/schema/migrations/20261020_0034_blessings_count_recipients.sql
\i services/directus/schema/migrations/20261020_0030_child_scope_denorm.sql
\i services/directus/schema/migrations/20261020_0031_fill_scope_zone.sql
\i services/directus/schema/migrations/20261022_0039_departments_fill_scope_drop.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NOT NULL
    AND to_regclass('public.event_registrations') IS NOT NULL
    AND to_regclass('public.attendance_sessions') IS NOT NULL
    AND to_regclass('public.attendance_records') IS NOT NULL, 'events',
    're-apply: all four registers are back (idempotent forwards, apply order)');
END $$;

-- Restore 79's fixtures exactly (same fixed ids).
INSERT INTO events (id, title, start_at, end_at)
VALUES
  ('00000000-0000-4000-8000-0000000000e1',
    'Office Fixture Event', TIMESTAMPTZ '2026-10-05 09:00:00+00', TIMESTAMPTZ '2026-10-05 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_referrals (id, event, invitee_name, status)
VALUES
  ('61111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000e1', 'Friend of member', 'invited')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM events WHERE id = '00000000-0000-4000-8000-0000000000e1')
    AND EXISTS (SELECT 1 FROM event_referrals WHERE id = '61111111-1111-4111-8111-111111111111'), 'events',
    'restore: 79 fixtures back in place (tree as found)');
END $$;

-- ---------------------------------------------------------------------------
-- 86.8  ACCEPTANCE, as queries over the registers themselves.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_regs integer;
  v_dup_tickets integer;
BEGIN
  SELECT count(*) INTO v_orphan_regs FROM event_registrations r
   WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = r.event);
  PERFORM test_support.assert_true(v_orphan_regs = 0, 'events',
    'ACCEPTANCE: zero orphan registrations (event FK holds)');

  SELECT count(*) INTO v_dup_tickets
    FROM (SELECT ticket_code FROM event_registrations
           WHERE ticket_code IS NOT NULL
           GROUP BY ticket_code HAVING count(*) > 1) d;
  PERFORM test_support.assert_true(v_dup_tickets = 0, 'events',
    'ACCEPTANCE: zero duplicate tickets (UNIQUE holds, Flow owns assignment)');
END $$;
