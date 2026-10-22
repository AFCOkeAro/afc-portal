-- tests/db/97_marriage_case_forms.sql
--
-- AFC-677 phase B. THE FORM-SUBMISSIONS CONTRACT.
--
-- Migration 0036 adds marriage_case_forms: one row per filled source form
-- (16 closed keys, see the marriage-transcription document on AFC-677),
-- JSONB payload, case CASCADE. The routes (phase B: /api/marriage/cases
-- forms submit, prefill-verify, vow generator, print views) validate each
-- payload against its zod schema and read the latest row per key. This
-- suite asserts the database half of that promise -- the half a crafted
-- HTTP request cannot change:
--
--   97.1  table         -- marriage_case_forms exists with the phase-B
--                         column set; the form_key vocabulary is closed.
--   97.2  rerun         -- re-applying 20261022_0036 changes nothing
--                         (IF NOT EXISTS everywhere; fixture rows survive).
--   97.3  constraints   -- case required; unknown key rejected; payload
--                         defaults to {}; resubmission appends (no UNIQUE).
--   97.4  links         -- bogus case rejected (23503); submissions follow
--                         their case (CASCADE).
--   97.5  guards        -- the app identity reads everything, writes
--                         operational columns, never re-homes a submission,
--                         deletes nothing.
--   97.6  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): per-form field
-- shapes (zod layer, shared schemas), prefill-verify and vow wording
-- (route layer), print CSS, report scoping -- all belong in the phase-B/F
-- contract suites. A SQL suite asserting HTTP status codes would be
-- testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 97.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO comes from the 0002 hierarchy seed; people is the 0004
--        minimal anchor (id/status).
-- ---------------------------------------------------------------------------
INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000005', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000006', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_cases
  (id, brother_person, sister_person, branch, stage, notes)
VALUES
  ('23111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'proposal_male', 'Phase-B fixture case: brother and sister linked')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_case_forms
  (id, marriage_case, form_key, stage, payload)
VALUES
  ('23222222-2222-4222-8222-222222222222',
    '23111111-1111-4111-8111-111111111111',
    'proposal_male', 'proposal_male',
    '{"branch": "OKE-ARO", "applicant": "fixture brother"}')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 97.1  TABLE. The submissions table exists with the phase-B column set.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.marriage_case_forms') IS NOT NULL, 'marriage', 'marriage_case_forms exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'marriage_case_forms'
               AND column_name IN ('marriage_case', 'form_key', 'stage',
                 'payload', 'submitted_by')
             HAVING count(*) = 5),
    'marriage', 'marriage_case_forms carries the phase-B column set');
  PERFORM test_support.assert_true(
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'marriage_case_forms'
        AND column_name = 'payload') = 'jsonb',
    'marriage', 'submission payloads are JSONB, not text');
END $$;

-- ---------------------------------------------------------------------------
-- 97.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261022_0036_marriage_case_forms.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_case_forms
      WHERE id = '23222222-2222-4222-8222-222222222222') = 1,
    'marriage', 'rerun: the fixture submission survives');
END $$;

-- ---------------------------------------------------------------------------
-- 97.3  CONSTRAINTS. Case required; closed key vocab; payload default;
--        resubmission appends.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Submission without a case rejected (no orphan answers).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_case_forms (marriage_case, form_key) VALUES (NULL, 'form_a')$q$,
    '23502', 'marriage', 'a submission without a case is rejected');
  -- Unknown form key rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_case_forms (marriage_case, form_key) VALUES ('23111111-1111-4111-8111-111111111111', 'tithe_card')$q$,
    '23514', 'marriage', 'an unknown form key is rejected');
END $$;

-- Payload defaults to {} (route may omit it on a staged save). The fixture
-- row is a plain INSERT (probes inside assert_not_raises are discarded, so a
-- default can only be pinned on a persisted row).
INSERT INTO marriage_case_forms (id, marriage_case, form_key)
VALUES ('23333333-3333-4333-8333-333333333333',
  '23111111-1111-4111-8111-111111111111', 'form_a')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO marriage_case_forms (marriage_case, form_key) VALUES ('23111111-1111-4111-8111-111111111111', 'form_a')$q$,
    'marriage', 'a submission without a payload is accepted (defaults to {})');
END $$;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT payload::text FROM marriage_case_forms WHERE id = '23333333-3333-4333-8333-333333333333'),
    '{}',
    'marriage', 'the omitted payload defaults to an empty object');
END $$;

-- All 16 transcribed keys are accepted (the vocabulary matches the 16 files).
DO $$
DECLARE
  k text;
  keys text[] := ARRAY['proposal_male', 'proposal_female', 'form_a',
    'premarital_q1', 'premarital_q2', 'engagement_list', 'form_c_guideline',
    'wedding_programme', 'wedding_info', 'music_selection',
    'requirements_dressing', 'engagement_procedures', 'counselling_curriculum',
    'documentation_checklist', 'couple_orientation', 'vows'];
BEGIN
  -- PGlite pins an older grammar that rejects a literal in FOREACH, so the
  -- vocabulary rides a variable (same 16 keys, same assertion).
  FOREACH k IN ARRAY keys LOOP
    PERFORM test_support.assert_not_raises('directus_migrator',
      format($q$INSERT INTO marriage_case_forms (marriage_case, form_key) VALUES ('23111111-1111-4111-8111-111111111111', %L) ON CONFLICT DO NOTHING$q$, k),
      'marriage', format('form key %s is accepted', k));
  END LOOP;
END $$;

-- Resubmission appends: no UNIQUE on (marriage_case, form_key). The second
-- row is a plain INSERT (probes are discarded, so history can only be shown
-- on persisted rows).
INSERT INTO marriage_case_forms (id, marriage_case, form_key, stage, payload)
VALUES ('23444444-4444-4334-8444-444444444444',
  '23111111-1111-4111-8111-111111111111', 'proposal_male', 'proposal_male',
  '{"correction": true}')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_case_forms
      WHERE marriage_case = '23111111-1111-4111-8111-111111111111'
        AND form_key = 'proposal_male') >= 2,
    'marriage', 'a corrected form appends a new row; history is kept');
END $$;

-- ---------------------------------------------------------------------------
-- 97.4  LINKS. Bogus case rejected; submissions follow their case.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_case_forms (marriage_case, form_key) VALUES ('99999999-9999-4999-8999-999999999999', 'form_a')$q$,
    '23503', 'marriage', 'a submission naming a missing case is rejected');
END $$;

-- Throwaway CASCADE: delete a throwaway case, its submissions follow.
INSERT INTO marriage_cases
  (id, brother_person, branch)
VALUES
  ('23999999-9999-4999-8999-999999999999',
    '00000000-0000-4000-8000-000000000005',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'))
ON CONFLICT (id) DO NOTHING;
INSERT INTO marriage_case_forms (id, marriage_case, form_key)
  VALUES ('23989898-9898-4989-8989-989898989898',
    '23999999-9999-4999-8999-999999999999', 'vows')
  ON CONFLICT (id) DO NOTHING;

DELETE FROM marriage_cases WHERE id = '23999999-9999-4999-8999-999999999999';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM marriage_case_forms WHERE marriage_case = '23999999-9999-4999-8999-999999999999') = 0,
    'marriage', 'submissions follow their case (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 97.5  GUARDS. The app ceiling: read everywhere, write operational
--        columns, never re-home, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM marriage_case_forms$q$,
    'marriage', 'directus_app can read marriage_case_forms');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO marriage_case_forms (marriage_case, form_key, stage, payload) VALUES ('23111111-1111-4111-8111-111111111111', 'wedding_info', 'wedding_info', '{"place": "Anthony Village"}')$q$,
    'marriage', 'directus_app can submit forms');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE marriage_case_forms SET payload = '{"place": "Anthony Village Tabernacle"}' WHERE id = '23222222-2222-4222-8222-222222222222'$q$,
    'marriage', 'directus_app can correct a payload');

  -- The ceiling: a submission is never re-homed or re-typed (link columns
  -- are outside the UPDATE list), and nothing deletes.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE marriage_case_forms SET form_key = 'vows' WHERE id = '23222222-2222-4222-8222-222222222222'$q$,
    '42501', 'marriage', 'directus_app cannot re-type a submission');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM marriage_case_forms WHERE id = '23222222-2222-4222-8222-222222222222'$q$,
    '42501', 'marriage', 'directus_app has no DELETE on marriage_case_forms');
END $$;

-- ---------------------------------------------------------------------------
-- 97.6  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM marriage_case_forms) > 0 THEN RAISE EXCEPTION 'refusing to roll back marriage_case_forms: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'marriage', 'rollback refuses while submissions exist');
END $outer$;
