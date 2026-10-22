-- tests/db/96_marriage_cases.sql
--
-- AFC-674 scope A. THE MARRIAGE-PIPELINE CONTRACT.
--
-- The routes (phase C: /api/marriage/cases, transitions, approvals,
-- transfer-close; phase D: calendar writes; phase F: report) enforce the
-- pipeline order with Directus filters over denorm columns (scopeFilter /
-- requireCan). A filter is only as honest as the columns it reads, so this
-- suite asserts the database half of that promise -- the half a crafted HTTP
-- request cannot change:
--
--   96.1  tables        -- marriage_cases + marriage_case_events exist with
--                         the §A column sets; the stage vocabulary is closed.
--   96.2  rerun         -- re-applying 20261022_0035 changes nothing
--                         (IF NOT EXISTS everywhere; fixture rows survive).
--   96.3  constraints   -- closed stage vocab; branch + brother required;
--                         halted needs a reason; transferred_out names the
--                         receiving branch; rehearsal keeps its 3-day lead;
--                         vow defaults to B; wedding-info starts unverified.
--   96.4  links         -- zone denorm backfills; branch/brother RESTRICT;
--                         sister SET NULL; trail CASCADE.
--   96.5  guards        -- the app identity reads everything, writes
--                         operational columns, deletes nothing.
--   96.6  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): forward stage
-- order, zonal/overseer approval gates, the attire-check gate, calendar
-- writes, prefill-verify, vow wording, report scoping -- all live in the
-- route layer and belong in the phase-C/F contract suites. A SQL suite
-- asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 96.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO and LEGUN come from the 0002 hierarchy seed. people is the
--        0004 minimal anchor (id/status): brother + sister below satisfy the
--        conditional person FKs where people exists.
-- ---------------------------------------------------------------------------
INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000002', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000003', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_cases
  (id, brother_person, sister_person, branch, stage, wedding_date, notes)
VALUES
  ('22111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'introduction', DATE '2026-12-19', 'Brother and sister introduced at branch')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_cases
  (id, brother_person, branch, stage, halt_reason)
VALUES
  ('22222222-2222-4222-8222-222222222222',
    '00000000-0000-4000-8000-000000000002',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'halted', 'Parental consent withheld on the sister''s side')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_cases
  (id, brother_person, sister_person, branch, stage, transfer_to_branch)
VALUES
  ('22333333-3333-4333-8333-333333333333',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'transferred_out',
    (SELECT id FROM branches WHERE code = 'LEGUN'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_case_events
  (id, marriage_case, from_stage, to_stage, event_type, detail)
VALUES
  ('22444444-4444-4444-8444-444444444444',
    '22111111-1111-4111-8111-111111111111',
    NULL, 'introduction', 'created', 'Case opened at branch')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 96.1  TABLES. Both pipeline tables exist with their scope-A columns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.marriage_cases') IS NOT NULL, 'marriage', 'marriage_cases exists');
  PERFORM test_support.assert_true(
    to_regclass('public.marriage_case_events') IS NOT NULL, 'marriage', 'marriage_case_events exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'marriage_cases'
               AND column_name IN ('brother_person', 'sister_person', 'branch',
                 'zone', 'stage', 'halt_reason', 'transfer_to_branch',
                 'wedding_date', 'rehearsal_date', 'engagement_date',
                 'vow_type', 'wedding_info_verified', 'terms_signed',
                 'officiating_minister', 'bible_passage', 'certificate_type',
                 'consent_brother_file', 'consent_sister_file',
                 'passport_brother_file', 'passport_sister_file',
                 'lga_certificate_file', 'bridal_list_file',
                 'marriage_certificate_file', 'couple_photo_file',
                 'presentation_photo_file', 'notes', 'created_by')
             HAVING count(*) = 27),
    'marriage', 'marriage_cases carries the full scope-A column set + zone denorm');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'marriage_case_events'
               AND column_name IN ('marriage_case', 'from_stage', 'to_stage',
                 'event_type', 'detail', 'actor_user')
             HAVING count(*) = 6),
    'marriage', 'marriage_case_events carries the trail column set');
END $$;

-- ---------------------------------------------------------------------------
-- 96.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261022_0035_marriage_cases.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_cases
      WHERE id = '22111111-1111-4111-8111-111111111111') = 1,
    'marriage', 'rerun: the fixture case survives');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_case_events
      WHERE id = '22444444-4444-4444-8444-444444444444') = 1,
    'marriage', 'rerun: the fixture trail row survives');
END $$;

-- ---------------------------------------------------------------------------
-- 96.3  CONSTRAINTS. Closed vocab, required scope, halt/transfer closes,
--        rehearsal lead, vow default, verify flag.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Unknown stage rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, stage) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'flying')$q$,
    '23514', 'marriage', 'an unknown pipeline stage is rejected');
  -- Case without a branch rejected (scopeless record invisible).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch) VALUES ('00000000-0000-4000-8000-000000000002', NULL)$q$,
    '23502', 'marriage', 'a case without a branch is rejected');
  -- Case without a brother rejected (no anchor).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch) VALUES (NULL, (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23502', 'marriage', 'a case without a brother is rejected');
  -- Halted without a reason rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, stage) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'halted')$q$,
    '23514', 'marriage', 'a halt without a reason is rejected');
  -- Halted with a blank reason rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, stage, halt_reason) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'halted', '   ')$q$,
    '23514', 'marriage', 'a halt with a blank reason is rejected');
  -- Transfer-close without a destination rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, stage) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'transferred_out')$q$,
    '23514', 'marriage', 'a transfer-close without a receiving branch is rejected');
  -- Rehearsal two days before the wedding rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, wedding_date, rehearsal_date) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), DATE '2026-12-19', DATE '2026-12-17')$q$,
    '23514', 'marriage', 'a rehearsal two days before the wedding is rejected');
  -- Unknown audit event type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_case_events (marriage_case, event_type) VALUES ('22111111-1111-4111-8111-111111111111', 'deleted')$q$,
    '23514', 'marriage', 'an unknown trail event type is rejected');
  -- Unknown certificate type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_cases (brother_person, branch, certificate_type) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'palace')$q$,
    '23514', 'marriage', 'an unknown certificate type is rejected');
END $$;

-- Positive edges: the 3-day lead holds exactly, the vow defaults to B, the
-- wedding-info flag starts unverified.
INSERT INTO marriage_cases
  (id, brother_person, branch, wedding_date, rehearsal_date)
VALUES
  ('22555555-5555-4555-8555-555555555555',
    '00000000-0000-4000-8000-000000000002',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    DATE '2026-12-19', DATE '2026-12-16')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT vow_type FROM marriage_cases WHERE id = '22111111-1111-4111-8111-111111111111'),
    'B',
    'marriage', 'the vow type defaults to B');
  PERFORM test_support.assert_true(
    (SELECT wedding_info_verified FROM marriage_cases WHERE id = '22111111-1111-4111-8111-111111111111') = false,
    'marriage', 'wedding-info starts unverified (explicit verify is a route rule)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_cases WHERE id = '22555555-5555-4555-8555-555555555555') = 1,
    'marriage', 'a rehearsal exactly three days before the wedding is accepted');
END $$;

-- ---------------------------------------------------------------------------
-- 96.4  LINKS. Denorm backfill; branch/brother RESTRICT; sister SET NULL;
--        trail CASCADE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM marriage_cases WHERE id = '22111111-1111-4111-8111-111111111111'),
    (SELECT zone::text FROM branches WHERE code = 'OKE-ARO'),
    'marriage', 'case zone agrees with its branch zone (denorm backfill)');
  -- A branch with pipeline cases is not deleted by accident.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM branches WHERE code = 'OKE-ARO'$q$,
    '23503', 'marriage', 'deleting a branch with pipeline cases is refused (RESTRICT)');
  -- A freeform audit note is accepted.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO marriage_case_events (id, marriage_case, event_type, detail) VALUES ('22666666-6666-4666-8666-666666666666', '22111111-1111-4111-8111-111111111111', 'note', 'Zonal pastor prayed with the brother') ON CONFLICT (id) DO NOTHING$q$,
    'marriage', 'a freeform trail note is accepted');
END $$;

-- Throwaway sister link: deleting the sister unlinks her, the case survives.
INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000004', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_cases
  (id, brother_person, sister_person, branch)
VALUES
  ('22777777-7777-4777-8777-777777777777',
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000004',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'))
ON CONFLICT (id) DO NOTHING;

-- people is retention-managed (AFC-295): DELETE is refused for every
-- identity including the cluster superuser, so unlinking is exercised with
-- an UPDATE; the property under test is that the case survives.
UPDATE marriage_cases SET sister_person = NULL WHERE id = '22777777-7777-4777-8777-777777777777';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT sister_person FROM marriage_cases WHERE id = '22777777-7777-4777-8777-777777777777') IS NULL,
    'marriage', 'unlinking the sister leaves the case surviving (SET NULL semantics)');
END $$;

DELETE FROM marriage_cases WHERE id = '22777777-7777-4777-8777-777777777777';

-- Throwaway trail CASCADE: delete a throwaway case, its events follow.
INSERT INTO marriage_cases
  (id, brother_person, branch)
VALUES
  ('22888888-8888-4888-8888-888888888888',
    '00000000-0000-4000-8000-000000000002',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'))
ON CONFLICT (id) DO NOTHING;
INSERT INTO marriage_case_events (id, marriage_case, event_type)
  VALUES ('22848484-8484-4484-8848-484848484848',
    '22888888-8888-4888-8888-888888888888', 'created')
  ON CONFLICT (id) DO NOTHING;

DELETE FROM marriage_cases WHERE id = '22888888-8888-4888-8888-888888888888';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_case_events WHERE marriage_case = '22888888-8888-4888-8888-888888888888') = 0,
    'marriage', 'the trail follows its case (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 96.5  GUARDS. The app ceiling: read everywhere, write operational
--        columns, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM marriage_cases$q$,
    'marriage', 'directus_app can read marriage_cases');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM marriage_case_events$q$,
    'marriage', 'directus_app can read the pipeline trail');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO marriage_cases (brother_person, branch, stage) VALUES ('00000000-0000-4000-8000-000000000002', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'introduction')$q$,
    'marriage', 'directus_app can open cases');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE marriage_cases SET stage = 'zonal_review' WHERE id = '22111111-1111-4111-8111-111111111111'$q$,
    'marriage', 'directus_app can advance the stage');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO marriage_case_events (marriage_case, event_type, detail) VALUES ('22111111-1111-4111-8111-111111111111', 'note', 'probe')$q$,
    'marriage', 'directus_app can write trail rows');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM marriage_cases WHERE id = '22111111-1111-4111-8111-111111111111'$q$,
    '42501', 'marriage', 'directus_app has no DELETE on marriage_cases');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM marriage_case_events WHERE marriage_case = '22111111-1111-4111-8111-111111111111'$q$,
    '42501', 'marriage', 'directus_app has no DELETE on the pipeline trail');
END $$;

-- ---------------------------------------------------------------------------
-- 96.6  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM marriage_cases) > 0 THEN RAISE EXCEPTION 'refusing to roll back marriage_cases: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'marriage', 'rollback refuses while marriage_cases exist');
END $outer$;
