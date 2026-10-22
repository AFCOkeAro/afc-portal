-- 20261022_0035_marriage_cases.sql
--
-- Marriage pipeline (AFC-674, scope A). Brother/sister language throughout:
-- the pipeline never names a groom or a bride.
--
-- WHAT THIS FILE CREATES (nothing else -- verified: no marriage_cases /
-- marriage_case_events table exists in services/directus/schema/migrations/):
--   marriage_cases       -- one row per couple: brother_person (required
--                           anchor), sister_person (nullable until she is
--                           linked in-DB), branch required + zone denorm,
--                           stage enum following the user flow, halt/transfer
--                           close, wedding + rehearsal + engagement dates,
--                           vow choice (default B), wedding-info verify flag,
--                           report columns (officiating minister, Bible
--                           passage, certificate type), per-stage file slots
--                           (consent letters, passports, LGA/FG certificate,
--                           bridal list, scanned certificate, couple +
--                           presentation photos).
--   marriage_case_events -- explicit stage history/audit (created /
--                           stage_changed / halted / transferred_out /
--                           approved / note), following the
--                           welfare_case_events precedent -- never silent
--                           reliance on the Directus activity log.
--
-- CHOICE, STATED (issue: "stage enum matching user flow"): the 24 flow
-- stages are one closed CHECK list in pipeline order (introduction ...
-- reported) plus two terminal closes (halted, transferred_out). Forward
-- order is a ROUTE rule (AC: zonal/overseer approvals, attire-check gate,
-- rehearsal enforcement at the API layer with contract tests) -- a CHECK
-- cannot know the actor or the approval, and the matrix gives non-admins
-- no silent skip. The DB owns only what is actor-independent: the closed
-- vocabulary, halted-needs-reason, transferred_out-needs-destination, and
-- the rehearsal lead time.
--
-- CHOICE, STATED (issue: "halted (reason required) from any stage"): enforced
-- here as CONSTRAINT marriage_cases_halt_needs_reason (halted rows must
-- carry a non-blank halt_reason). The route additionally writes a
-- marriage_case_events 'halted' row; the CHECK is the backstop a crafted
-- request cannot skip.
--
-- CHOICE, STATED (issue: "transfer-out letter flow closes file when sister
-- is out-of-area"): enforced here as CONSTRAINT
-- marriage_cases_transfer_needs_branch (transferred_out rows must name the
-- receiving branch). The letter itself is a route artefact (phase C); the
-- DB owns only that a transfer-close names where the file went.
--
-- CHOICE, STATED (issue: "rehearsal >= 3 days before wedding enforced"):
-- enforced here as CONSTRAINT marriage_cases_rehearsal_before_wedding
-- (where both dates are present, rehearsal_date <= wedding_date - 3).
-- Actor-independent date arithmetic belongs in the CHECK so no route can
-- write a 1-day-lead rehearsal by accident; the route re-checks for the
-- failure shape {code, fields}.
--
-- CHOICE, STATED (issue: "vow type, default B"): vow_type is nullable-open
-- text with DEFAULT 'B', NOT a closed enum. The source wording attachment
-- (AFC-460 comment 054cc4a5, 0d3ece5e) is transcribed in phase B; closing
-- the enum before transcription would invent vocabulary. Phase B may
-- tighten this to an enum once the wording is read field-for-field.
--
-- CHOICE, STATED (issue: file uploads): nine nullable bare-uuid file slots
-- (Directus files owned elsewhere, same posture as office_minutes.file in
-- 0013 and recorded_by in 0034). No FK onto directus_files: the portal
-- writes the file first and stores the id, exactly like 0013.
--
-- CHOICE, STATED (issue: "sister link-in-DB or transfer path"): sister_person
-- is nullable (SET NULL: unlinking the sister never destroys the case) and
-- brother_person is RESTRICT (the anchoring brother is not deleted by
-- accident) -- the same split 0013 used for person/partner_person.
--
-- CHOICE, STATED (scope of this migration vs phases B-E): counselling-series
-- progress, per-stage form answers, task lists, announcements and calendar
-- writes live in tasks / announcements / events (already exist) and in
-- phase-B form tables / phase-C routes -- NOT here. This file is the
-- pipeline spine only, so its rollback boundary stays one table + its trail.
--
-- GRANTS (expansion §10, matrix row marriage_matters extended): Postgres sees
-- one app identity, so scoping lives in the portal routes. This layer states
-- the ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE on
-- operational columns, NO DELETE on either table (cases are ministry facts;
-- corrections are UPDATEs and erasure runs as retention_worker, never
-- through the API). REVOKE PUBLIC re-asserted.
--
-- Rollback: rollback/20261022_0035_marriage_cases.down.sql (refuses while
-- either table holds rows; drops the trail then the case table, no CASCADE).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
--
-- SECURITY NOTE (Coder instructions): this migration touches people-linked
-- personal data (the church served includes minors). It is HELD for CTO
-- review (MediaTech) before it lands -- the board declined a separate
-- security reviewer seat, so a CTO review is a recorded degradation, not
-- independent review. Stated here rather than implied.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
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
-- 1. marriage_cases. Branch required (a scopeless case is invisible
--    fail-closed, same posture as marriage_matters in 0013); zone denorm
--    via branch, Flow/route-maintained with a rerunnable backfill below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marriage_cases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brother_person  uuid NOT NULL,
  sister_person   uuid,
  branch          uuid NOT NULL,
  zone            uuid,
  stage           text NOT NULL DEFAULT 'introduction'
                    CHECK (stage IN (
                      'introduction', 'zonal_review', 'overseer_review',
                      'proposal_male', 'counselling_prayer',
                      'parental_consent_brother', 'propose', 'sister_prayer',
                      'proposal_female', 'parental_consent_sister',
                      'terms_signatures', 'family_introduction', 'date_fixed',
                      'questionnaires_counselling', 'lga_certificate',
                      'engagement_schedule', 'wedding_info', 'music_selection',
                      'ministers_mail', 'attire_check',
                      'announcements_calendar', 'rehearsal', 'wedding',
                      'reported', 'halted', 'transferred_out')),
  halt_reason     text,
  transfer_to_branch uuid,
  wedding_date    date,
  rehearsal_date  date,
  engagement_date date,
  vow_type        text NOT NULL DEFAULT 'B'
                    CHECK (btrim(vow_type) <> ''),
  wedding_info_verified boolean NOT NULL DEFAULT false,
  terms_signed    boolean NOT NULL DEFAULT false,
  officiating_minister uuid,
  bible_passage   text,
  certificate_type text
                    CHECK (certificate_type IS NULL
                           OR certificate_type IN ('lga', 'fg', 'church', 'other')),
  consent_brother_file   uuid,
  consent_sister_file    uuid,
  passport_brother_file  uuid,
  passport_sister_file   uuid,
  lga_certificate_file   uuid,
  bridal_list_file       uuid,
  marriage_certificate_file uuid,
  couple_photo_file      uuid,
  presentation_photo_file uuid,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marriage_cases_halt_needs_reason
    CHECK (stage <> 'halted'
           OR (halt_reason IS NOT NULL AND btrim(halt_reason) <> '')),
  CONSTRAINT marriage_cases_transfer_needs_branch
    CHECK (stage <> 'transferred_out' OR transfer_to_branch IS NOT NULL),
  CONSTRAINT marriage_cases_rehearsal_before_wedding
    CHECK (rehearsal_date IS NULL OR wedding_date IS NULL
           OR rehearsal_date <= wedding_date - 3)
);

COMMENT ON TABLE marriage_cases IS
  'Marriage pipeline (AFC-674 scope A). One row per couple; brother/sister language only. Branch required for §10 scoping; sister nullable until linked in-DB (SET NULL); brother RESTRICT. Stage is the user-flow vocabulary; halted needs a reason, transferred_out names the receiving branch, rehearsal keeps a 3-day lead. Report columns (minister, passage, certificate type, scanned certificate + photos) ride the same row. Counselling progress, tasks, announcements and calendar writes live in their own tables (phases C/D), not here.';

CREATE INDEX IF NOT EXISTS marriage_cases_branch_idx
  ON marriage_cases (branch);
CREATE INDEX IF NOT EXISTS marriage_cases_zone_idx
  ON marriage_cases (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS marriage_cases_stage_idx
  ON marriage_cases (stage);
CREATE INDEX IF NOT EXISTS marriage_cases_brother_idx
  ON marriage_cases (brother_person);
CREATE INDEX IF NOT EXISTS marriage_cases_sister_idx
  ON marriage_cases (sister_person) WHERE sister_person IS NOT NULL;
CREATE INDEX IF NOT EXISTS marriage_cases_wedding_date_idx
  ON marriage_cases (wedding_date) WHERE wedding_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. marriage_case_events. Explicit stage history (created / stage_changed /
--    halted / transferred_out / approved / note), same shape as
--    welfare_case_events and marriage_matter_events -- the portal route is
--    the writer, the table is the trail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marriage_case_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marriage_case   uuid NOT NULL REFERENCES marriage_cases(id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text,
  event_type      text NOT NULL DEFAULT 'note'
                    CHECK (event_type IN ('created', 'stage_changed', 'halted',
                      'transferred_out', 'approved', 'note')),
  detail          text,
  actor_user      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marriage_case_events IS
  'Explicit marriage-pipeline audit (AFC-674). The portal route writes created on open, stage_changed on every transition, halted/transferred_out on close, approved on zonal/overseer gates, note for freeform.';

CREATE INDEX IF NOT EXISTS marriage_case_events_case_created_idx
  ON marriage_case_events (marriage_case, created_at);

-- ---------------------------------------------------------------------------
-- 3. Conditional FKs onto parent tables owned elsewhere (the 0003
--    merge-contract pattern). Each lands only where the parent exists, under
--    a FIXED name so reruns and the contract test agree; a missing parent
--    skips loudly rather than forking a table another slice owns.
--    Branches/brother RESTRICT (a case-bearing branch or brother is not
--    deleted by accident); sister/zone/transfer-branch SET NULL (denorm and
--    links yield, the case survives); trail CASCADE (see §2, real FK --
--    referent created here).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_cases person FKs: people not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_cases_brother_fkey') THEN
      ALTER TABLE marriage_cases ADD CONSTRAINT marriage_cases_brother_fkey
        FOREIGN KEY (brother_person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'marriage_cases_brother_fkey ensured (RESTRICT).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_cases_sister_fkey') THEN
      ALTER TABLE marriage_cases ADD CONSTRAINT marriage_cases_sister_fkey
        FOREIGN KEY (sister_person) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'marriage_cases_sister_fkey ensured (SET NULL: unlinking the sister never destroys the case).';
    END IF;
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_cases branch FKs: branches not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_cases_branch_fkey') THEN
      ALTER TABLE marriage_cases ADD CONSTRAINT marriage_cases_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
      RAISE NOTICE 'marriage_cases_branch_fkey ensured (RESTRICT).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_cases_transfer_branch_fkey') THEN
      ALTER TABLE marriage_cases ADD CONSTRAINT marriage_cases_transfer_branch_fkey
        FOREIGN KEY (transfer_to_branch) REFERENCES branches(id) ON DELETE SET NULL;
      RAISE NOTICE 'marriage_cases_transfer_branch_fkey ensured (SET NULL).';
    END IF;
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_cases_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_cases_zone_fkey') THEN
    ALTER TABLE marriage_cases ADD CONSTRAINT marriage_cases_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'marriage_cases_zone_fkey ensured (denorm SET NULL).';
  END IF;
END
$$;

-- Backfill the denorm where the branch parent is known. Rerunnable: only rows
-- whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.marriage_cases') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE marriage_cases m SET zone = br.zone
      FROM branches br WHERE m.zone IS NULL AND m.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'marriage_cases zone denorm backfilled from branch.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (see header). No DELETE on either table:
--    cases are audited ministry facts; erasure runs as retention_worker.
-- ---------------------------------------------------------------------------
GRANT SELECT ON marriage_cases TO directus_app;
GRANT INSERT (brother_person, sister_person, branch, zone, stage, halt_reason,
  transfer_to_branch, wedding_date, rehearsal_date, engagement_date, vow_type,
  wedding_info_verified, terms_signed, officiating_minister, bible_passage,
  certificate_type, consent_brother_file, consent_sister_file,
  passport_brother_file, passport_sister_file, lga_certificate_file,
  bridal_list_file, marriage_certificate_file, couple_photo_file,
  presentation_photo_file, notes, created_by)
  ON marriage_cases TO directus_app;
GRANT UPDATE (sister_person, zone, stage, halt_reason, transfer_to_branch,
  wedding_date, rehearsal_date, engagement_date, vow_type,
  wedding_info_verified, terms_signed, officiating_minister, bible_passage,
  certificate_type, consent_brother_file, consent_sister_file,
  passport_brother_file, passport_sister_file, lga_certificate_file,
  bridal_list_file, marriage_certificate_file, couple_photo_file,
  presentation_photo_file, notes)
  ON marriage_cases TO directus_app;

GRANT SELECT ON marriage_case_events TO directus_app;
GRANT INSERT (marriage_case, from_stage, to_stage, event_type, detail, actor_user)
  ON marriage_case_events TO directus_app;
GRANT UPDATE (detail) ON marriage_case_events TO directus_app;

REVOKE ALL ON marriage_cases FROM PUBLIC;
REVOKE ALL ON marriage_case_events FROM PUBLIC;
