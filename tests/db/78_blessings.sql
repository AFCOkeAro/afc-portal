-- tests/db/78_blessings.sql
--
-- AFC-474 / AFC-463c. THE BLESSINGS CONTRACT.
--
-- The routes (/api/blessings, CSV, event/service surfaces, profile roll-ups)
-- enforce branch/zone isolation with Directus filters over denorm columns
-- (portal.ts scope helpers). A filter is only as honest as the columns it
-- reads, so this suite asserts the database half of that promise -- the half
-- a crafted HTTP request cannot change:
--
--   78.1  tables        -- blessings and blessing_events exist with the §3.4
--                         shapes; total_count is GENERATED (male+female).
--   78.2  rerun         -- re-applying 20261020_0011 changes nothing
--                         (IF NOT EXISTS everywhere; counts identical).
--   78.3  total         -- THE TOTAL-DERIVATION LENS: male=3/female=2 reads
--                         back total=5 with no write to total; an edit to male
--                         moves total; naming total_count in an INSERT/UPDATE
--                         is refused (428C9).
--   78.4  other_label   -- THE OTHER_LABEL LENS: blessing_type = other
--                         requires a non-blank other_label (23514); any other
--                         type accepts a NULL label.
--   78.5  constraints   -- branch and service_date required; unknown
--                         blessing_type rejected; negative counts rejected;
--                         multi-type per program accepted (no uniqueness
--                         across types: US-B1 AC2).
--   78.6  links         -- zone denorm backfills from the branch; deleting a
--                         branch with blessings is refused (RESTRICT);
--                         deleting a linked service/event keeps the fact and
--                         clears the link (SET NULL); deleting a blessing
--                         removes its trail (CASCADE).
--   78.7  guards        -- the app identity reads both tables, writes
--                         operational columns, and deletes nothing (blessings
--                         are audited ministry facts; erasure runs as
--                         retention_worker).
--   78.8  indexes       -- the §3.4 + issue index set exists; branch and zone
--                         predicates partition fixture rows the way the list
--                         route filters them.
--   78.9  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a zone admin's cross-zone blessing rejected, a branch export
-- containing only its own branch, sort/CSV row-equality -- lives in the
-- route layer (requireZoneInScope + scope predicates + the shared collector)
-- and is covered by tests/web/blessings.contract.mjs. A SQL suite asserting
-- HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 78.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO (Z1) and SANGO (Z2) come from the hierarchy seed (LEGUN
--        moved to Z1 under the user-confirmed map, AFC-578).
-- ---------------------------------------------------------------------------
INSERT INTO blessings
  (id, blessing_type, male_count, female_count, branch, service_date, notes)
VALUES
  ('b1111111-1111-4111-8111-111111111111', 'salvation', 3, 2,
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-04', 'Sunday service'),
  ('b2222222-2222-4222-8222-222222222222', 'healing', 1, 4,
    (SELECT id FROM branches WHERE code = 'SANGO'), DATE '2026-10-04', 'Midweek service')
ON CONFLICT (id) DO NOTHING;

INSERT INTO blessing_events
  (id, blessing, event_type, detail)
VALUES
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    'b1111111-1111-4111-8111-111111111111', 'created', 'Recorded 3 male, 2 female')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 78.1  TABLES. Both tables exist with the §3.4 columns; total is generated.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.blessings') IS NOT NULL,
    'blessings', 'blessings exists');
  PERFORM test_support.assert_true(
    to_regclass('public.blessing_events') IS NOT NULL,
    'blessings', 'blessing_events exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'blessings'
               AND column_name IN ('blessing_type', 'other_label', 'male_count',
                 'female_count', 'total_count', 'branch', 'zone', 'bsc',
                 'session', 'event', 'sunday_service', 'service_date',
                 'recorded_by', 'notes')
             HAVING count(*) = 14),
    'blessings', 'blessings carries the full §3.4 column set');
  PERFORM test_support.assert_true(
    (SELECT is_generated = 'ALWAYS' FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'blessings'
        AND column_name = 'total_count'),
    'blessings', 'total_count is GENERATED ALWAYS (male+female), never hand-edited');
END $$;

-- ---------------------------------------------------------------------------
-- 78.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0011_blessings.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessings
      WHERE id IN ('b1111111-1111-4111-8111-111111111111',
                   'b2222222-2222-4222-8222-222222222222')) = 2,
    'blessings', 'rerun: both fixture blessings survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessing_events
      WHERE id = 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1') = 1,
    'blessings', 'rerun: the fixture audit row survives');
END $$;

-- ---------------------------------------------------------------------------
-- 78.3  TOTAL DERIVATION. The testing lens: total is derived, never stored
--        by hand.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- 3 male + 2 female reads back as total 5 with no write to total.
  PERFORM test_support.assert_equals(
    (SELECT total_count::text FROM blessings
      WHERE id = 'b1111111-1111-4111-8111-111111111111'),
    '5',
    'blessings', 'total derives as male+female (3+2=5)');
  PERFORM test_support.assert_equals(
    (SELECT total_count::text FROM blessings
      WHERE id = 'b2222222-2222-4222-8222-222222222222'),
    '5',
    'blessings', 'total derives as male+female (1+4=5)');

  -- Naming total_count in an INSERT is refused (428C9, generated-always).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, male_count, female_count, total_count, branch, service_date) VALUES ('healing', 1, 1, 99, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '428C9', 'blessings', 'hand-writing total_count on INSERT is refused');

  -- Naming total_count in an UPDATE is refused the same way.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE blessings SET total_count = 99 WHERE id = 'b1111111-1111-4111-8111-111111111111'$q$,
    '428C9', 'blessings', 'hand-writing total_count on UPDATE is refused');

  -- Positive: zero counts are a valid (empty) record, total 0. A plain
  -- persistent INSERT (not a probe: probes roll back, and the total below
  -- must observe the row). ON CONFLICT keeps this file rerunnable.
END $$;

INSERT INTO blessings (id, blessing_type, branch, service_date)
  VALUES ('b0000000-0000-4000-8000-0000000000b0', 'sanctification',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT total_count::text FROM blessings
      WHERE id = 'b0000000-0000-4000-8000-0000000000b0'),
    '0',
    'blessings', 'a zero-count blessing totals 0');
END $$;

-- An edit to male moves total (plain statement, not a probe: the UPDATE must
-- be observed, then restored; both directions are asserted).
UPDATE blessings SET male_count = 4
  WHERE id = 'b2222222-2222-4222-8222-222222222222';

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT total_count::text FROM blessings
      WHERE id = 'b2222222-2222-4222-8222-222222222222'),
    '8',
    'blessings', 'editing male moves total (4+4=8)');
END $$;

UPDATE blessings SET male_count = 1
  WHERE id = 'b2222222-2222-4222-8222-222222222222';

-- ---------------------------------------------------------------------------
-- 78.4  OTHER_LABEL. The testing lens: other requires a name.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, branch, service_date) VALUES ('other', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'blessing_type other without other_label is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, other_label, branch, service_date) VALUES ('other', '   ', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'blessing_type other with a blank other_label is rejected');
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO blessings (id, blessing_type, other_label, male_count, female_count, branch, service_date) VALUES ('b0b0b0b0-0b0b-40b0-8b0b-0b0b0b0b0b0b', 'other', 'Delivered from addiction', 2, 1, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11') ON CONFLICT (id) DO NOTHING$q$,
    'blessings', 'blessing_type other with a label is accepted');
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO blessings (id, blessing_type, male_count, branch, service_date) VALUES ('b0c0c0c0-0c0c-40c0-8c0c-0c0c0c0c0c0c', 'reanointing', 1, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11') ON CONFLICT (id) DO NOTHING$q$,
    'blessings', 'a named type with no label is accepted');
END $$;

-- ---------------------------------------------------------------------------
-- 78.5  CONSTRAINTS. Required scope, closed enum, non-negative counts,
--        multi-type per program (US-B1 AC2).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A blessing requires a branch: a scopeless blessing would be invisible.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, branch, service_date) VALUES ('healing', NULL, DATE '2026-10-11')$q$,
    '23502', 'blessings', 'a blessing without a branch is rejected');
  -- service_date is required: the bucket reports group by it.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, branch, service_date) VALUES ('healing', (SELECT id FROM branches WHERE code = 'OKE-ARO'), NULL)$q$,
    '23502', 'blessings', 'a blessing without a service_date is rejected');
  -- Unknown blessing_type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, branch, service_date) VALUES ('baptism_water', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'an unknown blessing_type is rejected');
  -- Negative counts rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, male_count, branch, service_date) VALUES ('healing', -1, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'a negative male_count is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessings (blessing_type, female_count, branch, service_date) VALUES ('healing', -2, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')$q$,
    '23514', 'blessings', 'a negative female_count is rejected');
  -- Unknown audit event type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO blessing_events (blessing, event_type) VALUES ('b1111111-1111-4111-8111-111111111111', 'deleted')$q$,
    '23514', 'blessings', 'an unknown audit event type is rejected');
  -- Multi-type per program: two types on the same date/branch coexist.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO blessings (id, blessing_type, male_count, female_count, branch, service_date) VALUES ('b0d0d0d0-0d0d-40d0-8d0d-0d0d0d0d0d0d', 'sanctification', 1, 1, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-04') ON CONFLICT (id) DO NOTHING$q$,
    'blessings', 'a second blessing type on the same program date is accepted');
END $$;

-- ---------------------------------------------------------------------------
-- 78.6  LINKS. Denorm backfill, RESTRICT on the branch, SET NULL on program
--        links, CASCADE on the trail. Throwaway rows keep fixtures intact;
--        probe writes roll back (assert.sql), so throwaways are persistent
--        INSERTs with ON CONFLICT and only the deletes/counts are observed.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM blessings WHERE id = 'b1111111-1111-4111-8111-111111111111'),
    (SELECT zone::text FROM branches WHERE code = 'OKE-ARO'),
    'blessings', 'blessing zone agrees with its branch zone (denorm backfill)');
  -- A branch with blessings is not deleted by accident.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM branches WHERE code = 'OKE-ARO'$q$,
    '23503', 'blessings', 'deleting a branch with blessings is refused (RESTRICT)');
  -- The trail is accepted: created + updated + freeform note.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO blessing_events (id, blessing, event_type, detail) VALUES ('e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2', 'b1111111-1111-4111-8111-111111111111', 'note', 'Pastor confirmed the count') ON CONFLICT (id) DO NOTHING$q$,
    'blessings', 'a freeform audit note is accepted');
END $$;

-- Program-link SET NULL, probed on throwaway rows. events and
-- sunday_services may be absent from the scratch DB (other slices own them):
-- the probe runs only where the parent exists, and where it does not the
-- suite pins the absence instead of forking the table.
INSERT INTO blessings (id, blessing_type, branch, service_date)
  VALUES ('b9999999-9999-4999-8999-999999999999', 'healing',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_has_events boolean := to_regclass('public.events') IS NOT NULL;
  v_has_services boolean := to_regclass('public.sunday_services') IS NOT NULL;
  v_required text[];
  v_event uuid;
BEGIN
  IF NOT v_has_events THEN
    PERFORM test_support.assert_true(
      to_regclass('public.events') IS NULL,
      'blessings', 'events absent: the event link stays conditional, not forked');
  END IF;
  IF NOT v_has_services THEN
    PERFORM test_support.assert_true(
      to_regclass('public.sunday_services') IS NULL,
      'blessings', 'sunday_services absent: the service link stays conditional, not forked');
  END IF;

  -- A parent owned by another slice may exist with required columns this
  -- probe does not supply. The probe then skips loudly (naming the columns)
  -- rather than failing on another slice's NOT NULL -- the same "skip loudly,
  -- never fork" posture as the migration's conditional FKs.
  IF v_has_events THEN
    SELECT coalesce(array_agg(column_name), '{}') INTO v_required
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events'
       AND is_nullable = 'NO' AND column_default IS NULL;
    IF NOT (v_required <@ ARRAY['id', 'title', 'start_at', 'end_at']) THEN
      RAISE NOTICE 'events probe skipped: required columns % exceed the probe supply (id, title, start_at, end_at).',
        v_required;
      v_has_events := false;
    END IF;
  END IF;

  IF v_has_services THEN
    SELECT coalesce(array_agg(column_name), '{}') INTO v_required
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'sunday_services'
       AND is_nullable = 'NO' AND column_default IS NULL;
    IF NOT (v_required <@ ARRAY['id', 'branch', 'service_date']) THEN
      RAISE NOTICE 'sunday_services probe skipped: required columns % exceed the probe supply (id, branch, service_date).',
        v_required;
      v_has_services := false;
    END IF;
  END IF;

  IF v_has_events THEN
    INSERT INTO events (id, title, start_at, end_at) VALUES
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Throwaway crusade',
       TIMESTAMPTZ '2026-10-11 09:00:00+00', TIMESTAMPTZ '2026-10-11 12:00:00+00')
      ON CONFLICT (id) DO NOTHING
      RETURNING id INTO v_event;
    SELECT id INTO v_event FROM events WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    UPDATE blessings SET event = v_event
      WHERE id = 'b9999999-9999-4999-8999-999999999999';
    DELETE FROM events WHERE id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    PERFORM test_support.assert_true(
      (SELECT event FROM blessings WHERE id = 'b9999999-9999-4999-8999-999999999999') IS NULL,
      'blessings', 'the fact survives its event: link clears (SET NULL)');
  END IF;

  IF v_has_services THEN
    INSERT INTO sunday_services (id, branch, service_date) VALUES
      ('99999999-9999-4999-8999-999999999999',
        (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
      ON CONFLICT (id) DO NOTHING;
    UPDATE blessings SET sunday_service = '99999999-9999-4999-8999-999999999999'
      WHERE id = 'b9999999-9999-4999-8999-999999999999';
    DELETE FROM sunday_services WHERE id = '99999999-9999-4999-8999-999999999999';
    PERFORM test_support.assert_true(
      (SELECT sunday_service FROM blessings WHERE id = 'b9999999-9999-4999-8999-999999999999') IS NULL,
      'blessings', 'the fact survives its service: link clears (SET NULL)');
  END IF;
END $$;

-- Trail CASCADE, probed on a throwaway blessing so fixtures survive. The
-- DELETE is a plain statement, not a probe: probes roll back, and the counts
-- below must observe the CASCADE. Top-of-file INSERTs restore the throwaway
-- on rerun (ON CONFLICT), so this stays rerunnable.
INSERT INTO blessings (id, blessing_type, branch, service_date)
  VALUES ('b8888888-8888-4888-8888-888888888888', 'healing',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-11')
  ON CONFLICT (id) DO NOTHING;
INSERT INTO blessing_events (id, blessing, event_type)
  VALUES ('e8e8e8e8-e8e8-4e8e-8e8e-e8e8e8e8e8e8',
    'b8888888-8888-4888-8888-888888888888', 'created')
  ON CONFLICT (id) DO NOTHING;

DELETE FROM blessings WHERE id IN
  ('b9999999-9999-4999-8999-999999999999', 'b8888888-8888-4888-8888-888888888888');

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessings WHERE id IN
      ('b9999999-9999-4999-8999-999999999999', 'b8888888-8888-4888-8888-888888888888')) = 0,
    'blessings', 'the throwaway blessings are gone (migrator delete)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessing_events WHERE blessing = 'b8888888-8888-4888-8888-888888888888') = 0,
    'blessings', 'the trail follows its blessing (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 78.7  GUARDS. The app ceiling: read everywhere, write operational
--        columns, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM blessings$q$,
    'blessings', 'directus_app can read blessings');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM blessing_events$q$,
    'blessings', 'directus_app can read the audit trail');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO blessings (blessing_type, male_count, female_count, branch, service_date, notes) VALUES ('salvation', 2, 3, (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-10-18', 'probe')$q$,
    'blessings', 'directus_app can record blessings');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE blessings SET female_count = 4 WHERE id = 'b2222222-2222-4222-8222-222222222222'$q$,
    'blessings', 'directus_app can update counts');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO blessing_events (blessing, event_type, detail) VALUES ('b1111111-1111-4111-8111-111111111111', 'note', 'probe')$q$,
    'blessings', 'directus_app can write audit rows');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM blessings WHERE id = 'b1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'blessings', 'directus_app has no DELETE on blessings');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM blessing_events WHERE blessing = 'b1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'blessings', 'directus_app has no DELETE on the audit trail');
END $$;

-- ---------------------------------------------------------------------------
-- 78.8  INDEXES + PARTITION. The §3.4 + issue index set exists; branch and
--        zone predicates partition fixture rows the way the list route
--        filters them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blessings_branch_date_idx'),
    'blessings', 'the (branch, service_date) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blessings_zone_date_idx'),
    'blessings', 'the (zone, service_date) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blessings_type_idx'),
    'blessings', 'the blessing_type index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blessings_session_idx'),
    'blessings', 'the session index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'blessing_events_blessing_created_idx'),
    'blessings', 'the (blessing, created_at) audit index exists');

  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';

  -- Branch predicate: Oke-Aro rows only (fixtures share one date, two
  -- branches; plus the b0* Oke-Aro probe rows from §§78.3-78.5).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessings b
      WHERE b.branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')
        AND b.id IN ('b1111111-1111-4111-8111-111111111111',
                     'b2222222-2222-4222-8222-222222222222')) = 1,
    'blessings', 'a branch predicate isolates exactly that branch''s fixture');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM blessings WHERE zone = v_z1
      AND id IN ('b1111111-1111-4111-8111-111111111111',
                 'b2222222-2222-4222-8222-222222222222')) = 1,
    'blessings', 'a Z1 predicate returns exactly Z1''s fixture');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM blessings WHERE blessing_type = 'salvation'
      AND id IN ('b1111111-1111-4111-8111-111111111111',
                 'b2222222-2222-4222-8222-222222222222')),
    '1',
    'blessings', 'a type predicate isolates the salvation fixture');
END $$;

-- ---------------------------------------------------------------------------
-- 78.9  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM blessings) > 0 OR (SELECT count(*) FROM blessing_events) > 0 THEN RAISE EXCEPTION 'refusing to roll back blessings: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'blessings', 'rollback refuses while blessings or events exist');
END $outer$;
