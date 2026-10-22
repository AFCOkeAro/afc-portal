-- 20261022_0036_marriage_case_forms.sql
--
-- Marriage phase B (AFC-677). Per-stage form submissions for the
-- brother/sister pipeline (migration 0035): one row per filled form.
--
-- WHAT THIS FILE CREATES (nothing else -- verified: no marriage_case_forms
-- table exists in services/directus/schema/migrations/):
--   marriage_case_forms -- one row per submitted source form (the 16
--                           transcribed on AFC-677 document
--                           `marriage-transcription`): proposal_male,
--                           proposal_female, form_a, premarital_q1,
--                           premarital_q2, engagement_list, form_c_guideline,
--                           wedding_programme, wedding_info, music_selection,
--                           requirements_dressing, engagement_procedures,
--                           counselling_curriculum, documentation_checklist,
--                           couple_orientation, vows. Payload is JSONB: the
--                           route validates each form_key against its zod
--                           schema, the DB owns only the closed vocabulary
--                           and the case link.
--
-- CHOICE, STATED (issue: resubmission): no UNIQUE on
-- (marriage_case, form_key). A corrected form appends a new row; readers
-- take the latest. A unique constraint would force upsert logic into the
-- route and destroy the correction history the counsellor signs off.
--
-- CHOICE, STATED (issue: stage column): `stage` is nullable-open text, NOT
-- a CHECK onto MARRIAGE_CASE_STAGES. It records the pipeline stage at
-- submission time for the print view; the route owns stage validity (the
-- case row carries the authoritative stage). Closing it here would fork
-- the vocabulary 0035 owns.
--
-- CHOICE, STATED (issue: payload shape): payload is JSONB DEFAULT '{}'.
-- Field-level NOT NULLs live in the zod schemas (phase-B routes), not in
-- JSONB keys -- a CHECK cannot version form revisions, the route can.
--
-- CHOICE, STATED (issue: wedding-info verify / vow wording): the verify
-- flag and vow choice stay on marriage_cases (wedding_info_verified,
-- vow_type) -- they gate transitions, so they belong on the case row.
-- This table holds the filled answers; the case row holds the gates.
--
-- GRANTS (expansion §10, matrix row marriage_cases extended): Postgres sees
-- one app identity, so scoping lives in the portal routes. This layer states
-- the ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE on
-- operational columns, NO DELETE (submissions are ministry facts;
-- corrections append, erasure runs as retention_worker, never through the
-- API). REVOKE PUBLIC re-asserted. The case/form_key link columns are NOT
-- in the UPDATE list: a submission is never re-homed onto another case or
-- re-typed after the fact.
--
-- Rollback: rollback/20261022_0036_marriage_case_forms.down.sql (refuses
-- while rows exist; drops the table, never touches marriage_cases or its
-- trail). Owner: migration role (directus_migrator). Never run as
-- directus_app. Role hygiene per ADR-0002: this file provisions no roles
-- and grants no role-creation or superuser capability; only GRANT/REVOKE.
--
-- SECURITY NOTE (Coder instructions): submissions hold questionnaire
-- answers and family details -- personal data including minors'. This file
-- is HELD for CTO (MediaTech) review before it lands -- the board declined
-- a separate security reviewer seat, so a CTO review is a recorded
-- degradation, not independent review. Stated here rather than implied.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
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
-- 1. marriage_case_forms. One row per submitted form; payload JSONB.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marriage_case_forms (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marriage_case   uuid NOT NULL REFERENCES marriage_cases(id) ON DELETE CASCADE,
  form_key        text NOT NULL
                    CHECK (form_key IN (
                      'proposal_male', 'proposal_female', 'form_a',
                      'premarital_q1', 'premarital_q2',
                      'engagement_list', 'form_c_guideline',
                      'wedding_programme', 'wedding_info',
                      'music_selection', 'requirements_dressing',
                      'engagement_procedures', 'counselling_curriculum',
                      'documentation_checklist', 'couple_orientation',
                      'vows')),
  stage           text,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marriage_case_forms IS
  'Marriage phase B (AFC-677). One row per filled source form (16 keys, see transcription document marriage-transcription on AFC-677); payload JSONB validated by route zod schemas. Resubmission appends; readers take the latest. Brother/sister language only.';

CREATE INDEX IF NOT EXISTS marriage_case_forms_case_key_idx
  ON marriage_case_forms (marriage_case, form_key, created_at);

-- ---------------------------------------------------------------------------
-- 2. Least-privilege ceiling (see header). No DELETE: submissions are
--    audited ministry facts; corrections append and erasure runs as
--    retention_worker.
-- ---------------------------------------------------------------------------
GRANT SELECT ON marriage_case_forms TO directus_app;
GRANT INSERT (marriage_case, form_key, stage, payload, submitted_by)
  ON marriage_case_forms TO directus_app;
GRANT UPDATE (stage, payload)
  ON marriage_case_forms TO directus_app;

REVOKE ALL ON marriage_case_forms FROM PUBLIC;
