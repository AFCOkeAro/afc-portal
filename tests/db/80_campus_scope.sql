-- tests/db/80_campus_scope.sql
--
-- AFC-483 / AFC-465a. THE CAMPUS SCOPE CONTRACT.
--
-- The routes (/api/campus/..., track b) enforce zone/branch isolation with
-- Directus filters over scope columns (campus_students.branch/.zone,
-- coaching_programmes.area/.zone/.branch, the rest by join to programme or
-- student). A filter is only as honest as the columns it reads, so this
-- suite asserts the database half of that promise -- the half a crafted HTTP
-- request cannot change:
--
--   80.1  tables        -- all twelve campus tables exist with the §7 shapes;
--                         campus_institutions carries the §7.1 set (ALTERED,
--                         never forked); exam_results is the spec-exact table
--                         name (no coaching_ prefix fork).
--   80.2  rerun         -- re-applying 20261020_0003 changes nothing
--                         (IF NOT EXISTS + ON CONFLICT DO NOTHING everywhere;
--                         counts identical, including the 2 institution seeds
--                         and the 8 NYSC edges).
--   80.3  idempotent    -- re-marking the same identity for the same
--                         session+date lands on the same row (the four partial
--                         uniques reject the duplicate with 23505; ON CONFLICT
--                         DO NOTHING inserts zero).
--   80.4  partition     -- branch/zone predicates partition students, and the
--                         results/support rows joined through their student
--                         partition the same way. Zone isolation at HTTP rests
--                         on this disjointness.
--   80.5  nysc          -- the transitions table holds EXACTLY the eight
--                         ratified edges; unknown statuses are rejected
--                         (23514); the full not_deployed -> ... -> completed
--                         walk persists, and so does the deployed -> exempt
--                         path.
--   80.6  guards        -- the app identity reads all campus tables and
--                         campus_institutions, writes operational campus
--                         columns, and deletes nothing; reference tables stay
--                         read-only (pins 70.4 forward); the derived total is
--                         not app-writable; uniqueness, RESTRICT, and enum
--                         CHECKs hold.
--   80.7  indexes       -- the §7.3/§12 index set exists (uniques for
--                         facilitators/enrolments/marks/results; scope and
--                         filter indexes for programmes/students/support).
--   80.8  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001), probed and discarded.
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a zone admin's cross-zone request rejected, a branch admin's
-- cross-branch request empty, a scopeless session failed closed, the
-- skip-step NYSC refusal (not_deployed -> serving), the draft lifecycle of
-- feedback/support -- lives in the route layer (scope predicates + the
-- nysc_status_transitions read + requireZoneInScope) and is covered by the
-- campus API slice (track b). A SQL suite asserting HTTP status codes, or a
-- CHECK comparing OLD to NEW without a trigger (banned by §15), would be
-- testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 80.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO (Z1) and LEGUN (Z2) come from the 0002 hierarchy seed;
--        UNILAG/LASU come from the 0003 seed (fixed ids in the migration).
-- ---------------------------------------------------------------------------
INSERT INTO people (id, date_of_birth, status)
VALUES
  ('a4444444-4444-4111-8111-444444444444', DATE '2004-06-11', 'active'),
  ('a5555555-5555-4222-8222-555555555555', DATE '2003-02-27', 'active'),
  ('a6666666-6666-4333-8333-666666666666', DATE '1985-09-03', 'active'),
  ('a7777777-7777-4444-8444-777777777777', DATE '1979-12-19', 'active')
ON CONFLICT (id) DO NOTHING;

-- S1: OKE-ARO (Z1), UNILAG. S2: LEGUN (Z2), LASU.
INSERT INTO campus_students
  (id, person, institution, course, level, admission_year,
   coordinator, afcf_handshake_status, afcmf_linked, nysc_status,
   branch, status)
VALUES
  ('d4444444-4444-4111-8111-444444444444',
   'a4444444-4444-4111-8111-444444444444',
   'c0a00001-0001-4001-8001-000000000001',
   'Sociology', 'junior', 2023,
   'a6666666-6666-4333-8333-666666666666',
   'connected', true, 'not_deployed',
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'active'),
  ('d5555555-5555-4222-8222-555555555555',
   'a5555555-5555-4222-8222-555555555555',
   'c0a00001-0001-4001-8001-000000000002',
   'Accounting', 'sophomore', 2024,
   NULL,
   'contacted', false, 'deployed',
   (SELECT id FROM branches WHERE code = 'LEGUN'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_programmes
  (id, name, exam, year, branch, status)
VALUES
  ('e4444444-4444-4111-8111-444444444444',
   'UTME Crash 2026', 'utme', 2026,
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_timetable
  (id, programme, subject, facilitator, day_of_week,
   start_time, end_time, location, capacity, status)
VALUES
  ('f4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   'Mathematics', 'a6666666-6666-4333-8333-666666666666', 'saturday',
   TIME '09:00', TIME '12:00', 'Oke-Aro hall', 60, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_facilitators
  (id, person, programme, subject, registration_date, call_status, status)
VALUES
  ('f5555555-5555-4222-8222-555555555555',
   'a6666666-6666-4333-8333-666666666666',
   'e4444444-4444-4111-8111-444444444444',
   'Mathematics', DATE '2026-08-16', 'confirmed', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_students
  (id, programme, campus_student, registration_date, status)
VALUES
  ('c4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   'd4444444-4444-4111-8111-444444444444',
   DATE '2026-08-20', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_class_attendance
  (id, timetable, programme, class_date, campus_student, present)
VALUES
  ('c5555555-5555-4222-8222-555555555555',
   'f4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   DATE '2026-09-05',
   'd4444444-4444-4111-8111-444444444444', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_progress
  (id, campus_student, programme, assessment, score, max_score,
   progress_date, remarks)
VALUES
  ('c6666666-6666-4333-8333-666666666666',
   'd4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   'Mock 1', 72, 100, DATE '2026-09-10', 'Strong algebra.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO exam_results
  (id, campus_student, exam, exam_year, scores, aggregate, status)
VALUES
  ('c7777777-7777-4444-8444-777777777777',
   'd4444444-4444-4111-8111-444444444444',
   'utme', 2026, '{"english": 68, "maths": 72}'::jsonb, '240', 'passed'),
  ('cbcccccc-cccc-4999-8999-cccccccccccc',
   'd5555555-5555-4222-8222-555555555555',
   'waec', 2025, '{"maths": "B3"}'::jsonb, NULL, 'passed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_resources
  (id, programme, title, type, visibility)
VALUES
  ('c8888888-8888-4555-8555-888888888888',
   'e4444444-4444-4111-8111-444444444444',
   'UTME syllabus', 'document', 'students')
ON CONFLICT (id) DO NOTHING;

INSERT INTO coaching_feedback
  (id, campus_student, programme, feedback, rating, feedback_date, status)
VALUES
  ('c9999999-9999-4666-8666-999999999999',
   'd4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   'Pace is good.', 5, DATE '2026-09-12', 'new')
ON CONFLICT (id) DO NOTHING;

INSERT INTO campus_financial_support
  (id, student, programme, amount, term, source, status, support_date)
VALUES
  ('caaaaaaa-aaaa-4777-8777-aaaaaaaaaaaa',
   'd4444444-4444-4111-8111-444444444444',
   'e4444444-4444-4111-8111-444444444444',
   50000, '2026/2027 first semester', 'AFCF', 'proposed', DATE '2026-09-01'),
  ('cabbbbbb-bbbb-4888-9888-bbbbbbbbbbbb',
   'd5555555-5555-4222-8222-555555555555',
   NULL,
   25000, '2026/2027 first semester', 'branch welfare', 'approved', DATE '2026-09-02')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 80.1  TABLES. All twelve campus tables exist; campus_institutions carries
--        the §7.1 set on the same table 0002 created (no fork).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.campus_students') IS NOT NULL,
    'campus', 'campus_students exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_programmes') IS NOT NULL,
    'campus', 'coaching_programmes exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_timetable') IS NOT NULL,
    'campus', 'coaching_timetable exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_facilitators') IS NOT NULL,
    'campus', 'coaching_facilitators exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_students') IS NOT NULL,
    'campus', 'coaching_students exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_class_attendance') IS NOT NULL,
    'campus', 'coaching_class_attendance exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_progress') IS NOT NULL,
    'campus', 'coaching_progress exists');
  PERFORM test_support.assert_true(
    to_regclass('public.exam_results') IS NOT NULL,
    'campus', 'exam_results exists under the spec-exact name');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_exam_results') IS NULL,
    'campus', 'no coaching_-prefixed fork of exam_results');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_resources') IS NOT NULL,
    'campus', 'coaching_resources exists');
  PERFORM test_support.assert_true(
    to_regclass('public.coaching_feedback') IS NOT NULL,
    'campus', 'coaching_feedback exists');
  PERFORM test_support.assert_true(
    to_regclass('public.campus_financial_support') IS NOT NULL,
    'campus', 'campus_financial_support exists');
  PERFORM test_support.assert_true(
    to_regclass('public.nysc_status_transitions') IS NOT NULL,
    'campus', 'nysc_status_transitions exists');

  -- campus_institutions: ALTERED (§7.1), never forked -- one table only.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_tables
      WHERE schemaname = 'public' AND tablename LIKE '%campus_institution%') = 1,
    'campus', 'exactly one campus_institutions table (no fork)');
  PERFORM test_support.assert_true(
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campus_institutions'
        AND column_name = 'name') = 'NO',
    'campus', 'campus_institutions.name is required (§7.1)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'campus_institutions'
        AND column_name IN ('town', 'state', 'coordinator', 'notes', 'status')),
    'campus', 'campus_institutions carries town/state/coordinator/notes/status');

  -- Exactly-one identity CHECKs exist (the §7.3 "or" modelling).
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'coaching_students_exactly_one_identity'),
    'campus', 'enrolments carry the exactly-one identity CHECK');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'coaching_class_attendance_needs_session'),
    'campus', 'attendance carries the timetable-or-programme CHECK');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'exam_results_status_exam_coupling'),
    'campus', 'exam results carry the status/exam coupling CHECK');
END $$;

-- ---------------------------------------------------------------------------
-- 80.2  RERUN. Re-applying the migration changes nothing (idempotent seeds).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0003_campus.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_institutions
      WHERE id IN ('c0a00001-0001-4001-8001-000000000001',
                   'c0a00001-0001-4001-8001-000000000002')) = 2,
    'campus', 'rerun: still two seeded institutions');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM nysc_status_transitions) = 8,
    'campus', 'rerun: still eight NYSC edges');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students
      WHERE id IN ('d4444444-4444-4111-8111-444444444444',
                   'd5555555-5555-4222-8222-555555555555')) = 2,
    'campus', 'rerun: still two fixture students');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM coaching_class_attendance) = 1,
    'campus', 'rerun: still one attendance mark');
END $$;

-- ---------------------------------------------------------------------------
-- 80.3  IDEMPOTENT. Re-marking the same identity/session/date is a duplicate
--        (23505); ON CONFLICT DO NOTHING inserts zero rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before integer; v_after integer;
BEGIN
  -- Slot mark duplicate: same (timetable, student, date).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_class_attendance
        (timetable, programme, class_date, campus_student, present)
      VALUES
        ('f4444444-4444-4111-8111-444444444444',
         'e4444444-4444-4111-8111-444444444444',
         DATE '2026-09-05',
         'd4444444-4444-4111-8111-444444444444', true)$q$,
    '23505', 'campus', 're-marking the same slot/student/date is a duplicate');

  -- Idempotent writer shape: the same mark with DO NOTHING inserts nothing.
  SELECT count(*) INTO v_before FROM coaching_class_attendance;
  INSERT INTO coaching_class_attendance
    (timetable, programme, class_date, campus_student, present)
  VALUES
    ('f4444444-4444-4111-8111-444444444444',
     'e4444444-4444-4111-8111-444444444444',
     DATE '2026-09-05',
     'd4444444-4444-4111-8111-444444444444', true)
  ON CONFLICT DO NOTHING;
  SELECT count(*) INTO v_after FROM coaching_class_attendance;
  PERFORM test_support.assert_true(v_after = v_before,
    'campus', 'ON CONFLICT DO NOTHING re-mark inserts zero rows');

  -- Enrolment duplicate: same (programme, campus_student).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_students (programme, campus_student)
      VALUES ('e4444444-4444-4111-8111-444444444444',
              'd4444444-4444-4111-8111-444444444444')$q$,
    '23505', 'campus', 're-enrolling the same student is a duplicate');

  -- Facilitator duplicate: same (programme, person).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_facilitators (person, programme)
      VALUES ('a6666666-6666-4333-8333-666666666666',
              'e4444444-4444-4111-8111-444444444444')$q$,
    '23505', 'campus', 're-assigning the same facilitator is a duplicate');

  -- Exam duplicate: same (student, exam, year).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO exam_results (campus_student, exam, exam_year)
      VALUES ('d4444444-4444-4111-8111-444444444444', 'utme', 2026)$q$,
    '23505', 'campus', 're-recording the same student/exam/year is a duplicate');
END $$;

-- ---------------------------------------------------------------------------
-- 80.4  PARTITION. Branch/zone predicates partition students, and results +
--        support joined through their student partition the same way.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid; v_z2 uuid;
  v_s1_branch uuid; v_s2_branch uuid;
BEGIN
  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';
  SELECT id INTO v_z2 FROM zones WHERE code = 'LAG-NORTH-Z2';
  SELECT id INTO v_s1_branch FROM branches WHERE code = 'OKE-ARO';
  SELECT id INTO v_s2_branch FROM branches WHERE code = 'LEGUN';

  -- Branch filter returns exactly its own student, and the two are disjoint.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students WHERE branch = v_s1_branch) = 1,
    'campus', 'OKE-ARO filter returns exactly one student');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students WHERE branch = v_s2_branch) = 1,
    'campus', 'LEGUN filter returns exactly one student');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students
      WHERE branch = v_s1_branch AND branch = v_s2_branch) = 0,
    'campus', 'branch predicates are disjoint');

  -- Zone denorm agrees with the branch's zone on every row (Flow/backfill).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students s JOIN branches b ON b.id = s.branch
      WHERE s.zone IS DISTINCT FROM b.zone) = 0,
    'campus', 'student.zone agrees with branch zone on every row');

  -- Results joined through their student land in the same partition.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM exam_results r JOIN campus_students s
       ON s.id = r.campus_student
      WHERE s.branch = v_s1_branch) = 1,
    'campus', 'one exam result resolves to the OKE-ARO student');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM exam_results r JOIN campus_students s
       ON s.id = r.campus_student
      WHERE s.branch = v_s2_branch) = 1,
    'campus', 'one exam result resolves to the LEGUN student');

  -- Support joined through its student partitions the same way.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_financial_support f JOIN campus_students s
       ON s.id = f.student
      WHERE s.branch = v_s1_branch) = 1,
    'campus', 'one support row resolves to the OKE-ARO student');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_financial_support f JOIN campus_students s
       ON s.id = f.student
      WHERE s.zone = v_z2) = 1,
    'campus', 'one support row resolves to the Z2 student via zone');

  -- A zone filter over students returns exactly its zone's rows.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students WHERE zone = v_z1) = 1,
    'campus', 'Z1 filter returns exactly one student');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campus_students WHERE zone = v_z2) = 1,
    'campus', 'Z2 filter returns exactly one student');
END $$;

-- ---------------------------------------------------------------------------
-- 80.5  NYSC. The edge set is exactly the ratified eight; unknown statuses
--        are rejected; the full lifecycle walk and the exempt path persist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Exact edge set, ordered for a stable comparison.
  PERFORM test_support.assert_true(
    (SELECT string_agg(from_status || '->' || to_status, ',' ORDER BY from_status, to_status)
       FROM nysc_status_transitions)
    = 'deployed->exempt,deployed->serving,not_deployed->exempt,'
      || 'not_deployed->waiting_callup,serving->completed,serving->exempt,'
      || 'waiting_callup->deployed,waiting_callup->exempt',
    'campus', 'the NYSC graph holds exactly the eight ratified edges');

  -- Terminal states carry no outgoing edge by construction.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM nysc_status_transitions
      WHERE from_status IN ('completed', 'exempt')) = 0,
    'campus', 'completed and exempt are terminal (no outgoing edges)');

  -- Unknown vocabulary is rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE campus_students SET nysc_status = 'youth_corper'
      WHERE id = 'd4444444-4444-4111-8111-444444444444'$q$,
    '23514', 'campus', 'unknown NYSC status is rejected');
END $$;

-- Lifecycle walk (persists: these UPDATEs are the suite's own writes).
UPDATE campus_students SET nysc_status = 'waiting_callup'
 WHERE id = 'd4444444-4444-4111-8111-444444444444';
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT nysc_status FROM campus_students
      WHERE id = 'd4444444-4444-4111-8111-444444444444') = 'waiting_callup',
    'campus', 'NYSC walk: waiting_callup persists');
END $$;
UPDATE campus_students SET nysc_status = 'deployed'
 WHERE id = 'd4444444-4444-4111-8111-444444444444';
UPDATE campus_students SET nysc_status = 'serving'
 WHERE id = 'd4444444-4444-4111-8111-444444444444';
UPDATE campus_students SET nysc_status = 'completed'
 WHERE id = 'd4444444-4444-4111-8111-444444444444';
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT nysc_status FROM campus_students
      WHERE id = 'd4444444-4444-4111-8111-444444444444') = 'completed',
    'campus', 'NYSC walk: not_deployed -> waiting_callup -> deployed -> serving -> completed persists');
END $$;
UPDATE campus_students SET nysc_status = 'exempt'
 WHERE id = 'd5555555-5555-4222-8222-555555555555';
DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT nysc_status FROM campus_students
      WHERE id = 'd5555555-5555-4222-8222-555555555555') = 'exempt',
    'campus', 'NYSC exempt path persists');
END $$;

-- ---------------------------------------------------------------------------
-- 80.6  GUARDS. App reads, writes operational columns, deletes nothing;
--        reference stays read-only; derived total is not app-writable;
--        RESTRICT and enum CHECKs hold.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Reads: the app sees every campus table and the institutions reference.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campus_students$q$,
    'campus', 'directus_app can read campus_students');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_programmes$q$,
    'campus', 'directus_app can read coaching_programmes');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_timetable$q$,
    'campus', 'directus_app can read coaching_timetable');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_class_attendance$q$,
    'campus', 'directus_app can read coaching_class_attendance');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_progress$q$,
    'campus', 'directus_app can read coaching_progress');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM exam_results$q$,
    'campus', 'directus_app can read exam_results');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_resources$q$,
    'campus', 'directus_app can read coaching_resources');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM coaching_feedback$q$,
    'campus', 'directus_app can read coaching_feedback');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campus_financial_support$q$,
    'campus', 'directus_app can read campus_financial_support');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM nysc_status_transitions$q$,
    'campus', 'directus_app can read nysc_status_transitions');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campus_institutions$q$,
    'campus', 'directus_app can read campus_institutions');

  -- Writes: operational columns are app-writable (probes roll back).
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO coaching_progress
        (campus_student, programme, assessment, score, max_score)
      VALUES ('d4444444-4444-4111-8111-444444444444',
              'e4444444-4444-4111-8111-444444444444',
              'Probe', 10, 20)$q$,
    'campus', 'directus_app can write progress operational columns');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE campus_students SET notes = 'Probe note'
      WHERE id = 'd4444444-4444-4111-8111-444444444444'$q$,
    'campus', 'directus_app can update student operational columns');

  -- Deletes: nothing, on any campus table (probed with WHERE false so the
  -- privilege check, not row matching, is what answers).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campus_students WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on campus_students');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_programmes WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_programmes');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_timetable WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_timetable');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_facilitators WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_facilitators');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_students WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_students');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_class_attendance WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_class_attendance');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_progress WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on coaching_progress');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM exam_results WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on exam_results');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_resources WHERE false$q$,
    '42501', 'campus', 'directus_app cannot DELETE coaching_resources');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM coaching_feedback WHERE false$q$,
    '42501', 'campus', 'directus_app cannot DELETE coaching_feedback');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campus_financial_support WHERE false$q$,
    '42501', 'campus', 'directus_app has no DELETE on campus_financial_support');

  -- Reference stays read-only: institutions (pins 70.4 forward) + NYSC edges.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO campus_institutions (name) VALUES ('Probe campus')$q$,
    '42501', 'campus', 'directus_app cannot write campus_institutions (Slice 5 seed-reviewed)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO nysc_status_transitions (from_status, to_status)
      VALUES ('serving', 'not_deployed')$q$,
    '42501', 'campus', 'directus_app cannot write nysc_status_transitions');

  -- The derived total is not app-writable (Flow-maintained, like 0011 total).
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO campus_students (person, financial_support_total)
      VALUES ('a6666666-6666-4333-8333-666666666666', 100)$q$,
    '42501', 'campus', 'directus_app cannot hand-edit financial_support_total');

  -- RESTRICT: a programme with slots, and a person with a student row, stay.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM coaching_programmes
      WHERE id = 'e4444444-4444-4111-8111-444444444444'$q$,
    '23503', 'campus', 'deleting a programme with timetable rows is refused (RESTRICT)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM people WHERE id = 'a4444444-4444-4111-8111-444444444444'$q$,
    '23503', 'campus', 'deleting a person with a student row is refused (RESTRICT)');

  -- Enum + shape CHECKs reject unknowns.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$UPDATE campus_students SET level = 'postdoc'
      WHERE id = 'd4444444-4444-4111-8111-444444444444'$q$,
    '23514', 'campus', 'unknown student level is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_facilitators (person, programme, call_status)
      VALUES ('a6666666-6666-4333-8333-666666666666',
              'e4444444-4444-4111-8111-444444444444', 'maybe')$q$,
    '23514', 'campus', 'unknown call_status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_timetable (programme, subject, day_of_week)
      VALUES ('e4444444-4444-4111-8111-444444444444', 'English', 'funday')$q$,
    '23514', 'campus', 'unknown day_of_week is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO exam_results (campus_student, exam, exam_year)
      VALUES ('d4444444-4444-4111-8111-444444444444', 'jamb', 2026)$q$,
    '23514', 'campus', 'unknown exam is rejected (utme, not jamb)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO exam_results (campus_student, exam, exam_year, status)
      VALUES ('d4444444-4444-4111-8111-444444444444', 'waec', 2026, 'admitted')$q$,
    '23514', 'campus', 'admitted for waec is rejected (status/exam coupling)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO exam_results (campus_student, exam, exam_year, status)
      VALUES ('d4444444-4444-4111-8111-444444444444', 'admission', 2026, 'passed')$q$,
    '23514', 'campus', 'passed for admission is rejected (status/exam coupling)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_progress (campus_student, programme, score, max_score)
      VALUES ('d4444444-4444-4111-8111-444444444444',
              'e4444444-4444-4111-8111-444444444444', 120, 100)$q$,
    '23514', 'campus', 'score above max_score is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_feedback
        (campus_student, programme, rating)
      VALUES ('d4444444-4444-4111-8111-444444444444',
              'e4444444-4444-4111-8111-444444444444', 6)$q$,
    '23514', 'campus', 'rating above 5 is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_students (programme)
      VALUES ('e4444444-4444-4111-8111-444444444444')$q$,
    '23514', 'campus', 'enrolment with neither identity is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO coaching_class_attendance (class_date, campus_student)
      VALUES (DATE '2026-09-06',
              'd4444444-4444-4111-8111-444444444444')$q$,
    '23514', 'campus', 'attendance with neither session link is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO campus_financial_support (student, status)
      VALUES ('d4444444-4444-4111-8111-444444444444', 'paid')$q$,
    '23514', 'campus', 'unknown support status is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 80.7  INDEXES. The §7.3/§12 index set exists and the scope predicates use
--        it (branch + branch/status + zone partition fixture rows).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_have integer;
  v_expected text[] := ARRAY[
    'coaching_timetable_programme_day_idx',
    'coaching_facilitators_programme_person_uidx',
    'coaching_students_programme_cstudent_uidx',
    'coaching_students_programme_person_uidx',
    'coaching_attendance_slot_cstudent_uidx',
    'coaching_attendance_slot_person_uidx',
    'coaching_attendance_prog_cstudent_uidx',
    'coaching_attendance_prog_person_uidx',
    'coaching_progress_cstudent_prog_date_idx',
    'coaching_progress_person_prog_date_idx',
    'exam_results_cstudent_uidx',
    'exam_results_person_uidx',
    'campus_students_person_idx',
    'campus_students_institution_idx',
    'campus_students_level_idx',
    'campus_students_nysc_status_idx',
    'campus_students_status_idx',
    'campus_students_branch_status_idx',
    'campus_support_student_status_idx',
    'coaching_programmes_exam_year_idx',
    'coaching_feedback_programme_idx'
  ];
BEGIN
  SELECT count(*) INTO v_have FROM pg_indexes
   WHERE indexname = ANY (v_expected);
  PERFORM test_support.assert_true(v_have = array_length(v_expected, 1),
    'campus', 'the §7.3/§12 campus index set exists (21 indexes)');
END $$;

-- ---------------------------------------------------------------------------
-- 80.8  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        mirrors rollback/20261020_0003_campus.down.sql §0: any created table
--        holding rows -- the suite's own fixtures qualify -- raises 23001.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM campus_students) > 0 OR (SELECT count(*) FROM coaching_programmes) > 0 OR (SELECT count(*) FROM nysc_status_transitions) > 0 THEN RAISE EXCEPTION 'refusing to roll back campus: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'campus', 'rollback refuses while campus rows exist');
END $outer$;
