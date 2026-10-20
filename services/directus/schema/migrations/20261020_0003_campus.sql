-- 20261020_0003_campus.sql
--
-- Campus care (Slice 5a). AFC-483 / AFC-465a, spec authority
-- docs/planning/data-model-expansion.md §7 (campus care), §10 (scope model),
-- §11 (permission matrix), §12 (indexes), §13 (Flows), §14 (enforcement) and
-- docs/adr/ADR-0010-slice5-campus-prioryear-hardening.md decision 1.
--
-- WHAT THIS FILE ALTERs (never forks)
--   campus_institutions -- §7.1 field set: id, name (required), town, state,
--   coordinator (person), notes, status. Created as a reference-only
--   placeholder by 20261020_0002_hierarchy.sql ("reference only; full campus
--   care stays in Slice 5"). This file brings that same table to the §7.1
--   field set with idempotent ADD COLUMN IF NOT EXISTS work, a guarded named
--   status CHECK (hardens Directus-first databases that carry the columns
--   without the check; a no-op where the 0002 inline check already holds),
--   and a status index. It creates NO second institutions table.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no campus/coaching/exam/support table other than campus_institutions
-- exists in services/directus/schema/migrations/):
--   campus_students           -- §7.2: 1-N extension of people (a person may
--                              hold successive student rows across
--                              institutions; person is required but NOT unique).
--   coaching_programmes       -- §7.3: WAEC/UTME/other exam programmes with
--                              area/zone/branch scope (nullable: null = wider).
--   coaching_timetable        -- §7.3: weekly slots per programme.
--   coaching_facilitators     -- §7.3: person <-> programme assignments.
--   coaching_students         -- §7.3: enrolments (campus_student OR person --
--                              see CHOICE below).
--   coaching_class_attendance -- §7.3: per-slot (or per-programme+date) marks.
--   coaching_progress         -- §7.3: assessments with score/max_score.
--   exam_results              -- §7.3: WAEC/UTME/admission outcomes, scores
--                              jsonb (shape extended deliberately, never raw
--                              SQL -- ADR-0010 tech-debt ledger).
--   coaching_resources        -- §7.3: programme/timetable content.
--   coaching_feedback         -- §7.3: student-or-guardian feedback.
--   campus_financial_support  -- §7.3: proposed -> approved -> disbursed.
--   nysc_status_transitions   -- the §7.2 NYSC graph as queryable reference
--                              rows (see CHOICE below; not in §7, stated).
--
-- CHOICE, STATED (issue: "student (campus_student or person)" on
-- coaching_students and "timetable (or programme+date)" on attendance):
-- two nullable columns with an exactly-one CHECK, not one bare uuid and not
-- a kind flag. coaching_students carries campus_student + person with
-- CHECK (exactly one NOT NULL); attendance carries timetable + programme
-- with CHECK (at least one NOT NULL, i.e. a slot mark or a general
-- programme+date mark) and its student side mirrors the enrolment pattern.
-- A single untyped uuid column could not carry a FOREIGN KEY to either
-- parent, and a kind flag beside one column is the same fork with a label.
-- The partial unique indexes (§5/§6) enforce one enrolment / one mark per
-- identity shape, which is what makes re-marking idempotent.
--
-- CHOICE, STATED (issue shorthand: "person links SET NULL"): holds for
-- NULLABLE person links (coordinators, timetable facilitator, guardians --
-- a pastor leaving does not delete the row, same posture as 0002). REQUIRED
-- person links (campus_students.person, facilitator.person, enrolment and
-- mark student links) are ON DELETE RESTRICT, like blessings.person in 0011:
-- a required FK with SET NULL is unstatable, and a CASCADE would silently
-- erase ministry facts when a person row goes. Erasure of a person with
-- campus rows is a reviewed migrator step that clears the campus rows first.
-- No CASCADE anywhere in this file.
--
-- CHOICE, STATED (NYSC transitions "validated"): the vocabulary is pinned
-- here (named CHECK on campus_students.nysc_status) and the allowed graph is
-- published here as seeded nysc_status_transitions rows the portal route
-- reads. Step refusal (e.g. not_deployed -> serving) is a ROUTE rule -- a
-- CHECK cannot compare OLD to NEW without a trigger, and this history
-- installs no opaque triggers (denorm via Flow, §13/§15 posture, same as
-- 0002/0003-attendance/0010/0011). Suite 80 asserts the exact edge set, the
-- full lifecycle walk, and the exempt path; the skip-step refusal lives in
-- the campus API slice (track b), not in a CHECK that cannot see the actor.
--
-- CHOICE, STATED (scope columns on coaching children): only campus_students
-- (§7.2 branch/zone) and coaching_programmes (§7.3 area/zone/branch scope)
-- carry scope columns. Timetable/attendance/progress/results/resources/
-- feedback/support resolve scope by joining to programme (or to student ->
-- branch). §10 is satisfied -- every operational record reaches its deepest
-- scope field -- without inventing denorm columns the spec never lists. If
-- list filters need the denorm for speed, the owning slice adds Flow-kept
-- columns the way hierarchy-flows.md does; this file does not guess them.
--
-- CHOICE, STATED (campus_institutions stays read-only to the app): the 0002
-- ceiling (SELECT only; rows land as reviewed migration/seed rows) is KEPT,
-- not widened. Institutions are global reference (no branch/zone scope, the
-- matrix gives zone/branch admins R only); the campus APIs create students
-- and programmes, not institutions. Widening would turn suite 70.4 red --
-- that suite pins the read-only ceiling and is the control working. Any
-- future widening is a CTO decision with 70.4 updated alongside, not a side
-- effect of this slice. Operational tables below get SELECT + INSERT/UPDATE
-- on operational columns and NO DELETE (audited ministry facts; erasure runs
-- as retention_worker, never through the API).
--
-- CHOICE, STATED (financial_support_total): plain numeric, Flow-maintained
-- (sum of disbursed support), same posture as attendance.total (Flow, not a
-- trigger). It is deliberately ABSENT from the app INSERT/UPDATE grant lists
-- -- the app never hand-edits a derived sum -- exactly as the GENERATED
-- total is absent in 0011.
--
-- CHOICE, STATED (status vocabularies the spec leaves open): programme /
-- timetable / facilitator / enrolment use active/inactive (lifecycle, same
-- closed pair as 0002 structure); feedback uses new/reviewed/closed (a
-- report moves, it does not toggle); resources carry plain-text type and
-- visibility (the spec names no values; inventing an enum here would strand
-- real uploads). Rating is 1-5 when present. exam_results couples status to
-- exam (admitted/not_admitted only for admission; passed/failed never for
-- admission; pending allowed everywhere).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   people / branches / zones / areas themselves. Parent tables are
--   referenced only where they exist (§conditional FKs under FIXED constraint
--   names, so the owning slice and this file agree; a missing parent skips
--   loudly rather than forking a table another slice owns -- the 0002/0003
--   merge-contract pattern). Rerunning this file after the parents land
--   completes the FKs.
--
-- NUMBERING NOTE (stated, not hidden): services/directus/schema/migrations/
-- also holds 20261020_0003_attendance_counts.sql (parallel slice, same date
-- prefix, different collection family). The two 0003 files sort
-- attendance < campus, apply in that order, and touch disjoint table sets;
-- neither assumes the other's tables exist. If the attendance file is
-- renamed, this file is unaffected.
--
-- GRANTS (expansion §10, matrix §11 rows campus_* / coaching_* /
-- exam_results): Postgres sees one app identity, so branch/zone scoping, the
-- coordinator/own-student read restriction (§11.1), and the dept-head 403
-- live in the Directus policy + portal route filters, not here. This layer
-- states the ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE
-- on operational columns, NO DELETE on any table in this file (campus rows
-- hold minors' PII; support rows are financial facts). campus_institutions
-- and nysc_status_transitions stay SELECT-only reference (see CHOICE above).
--
-- SEED: two reference institutions (UNILAG, LASU -- fixed ids, ON CONFLICT
-- (id) DO NOTHING) and the eight NYSC edges (ON CONFLICT DO NOTHING), so the
-- file reruns cleanly on a seeded database. No personal data in seeds: names
-- are institution names, no emails, phones, or person links.
--
-- Rollback: rollback/20261020_0003_campus.down.sql (refuses while any created
-- table holds rows -- including the eight seeded edges, which a reviewed step
-- clears first, same posture as the 0002 Lagos North seed; drops in
-- dependency order, no CASCADE; campus_institutions columns are left in place
-- -- widening a live reference table is not reversed, the 0012 people
-- precedent).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
-- No durations, no awareness_at.

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
-- 1. campus_institutions §7.1 (ALTER, never CREATE -- 0002 merge contract).
--    Idempotent column ensures + guarded named status CHECK + status index.
--    Grants untouched: SELECT-only reference (see header CHOICE).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.campus_institutions') IS NULL THEN
    RAISE NOTICE 'Skipping campus_institutions §7.1 hardening: table not present (the hierarchy-owning slice creates it; this migration re-runs when it lands). No fork created.';
    RETURN;
  END IF;

  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS name text;
  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS town text;
  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS state text;
  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS coordinator uuid;
  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS notes text;
  ALTER TABLE campus_institutions ADD COLUMN IF NOT EXISTS status text;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_institutions_status_valid') THEN
    ALTER TABLE campus_institutions
      ADD CONSTRAINT campus_institutions_status_valid
      CHECK (status IS NULL OR status IN ('active', 'inactive'));
    RAISE NOTICE 'campus_institutions_status_valid ensured.';
  ELSE
    RAISE NOTICE 'campus_institutions_status_valid already present, left alone.';
  END IF;

  RAISE NOTICE 'campus_institutions §7.1 columns ensured (ALTER, never forked).';
END
$$;

CREATE INDEX IF NOT EXISTS campus_institutions_status_idx
  ON campus_institutions (status);

-- Conditional person FK for the coordinator (nullable person link SET NULL).
DO $$
BEGIN
  IF to_regclass('public.campus_institutions') IS NULL THEN
    RAISE NOTICE 'Skipping campus_institutions_coordinator_fkey: table not present.';
  ELSIF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping campus_institutions_coordinator_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_institutions_coordinator_fkey') THEN
    ALTER TABLE campus_institutions ADD CONSTRAINT campus_institutions_coordinator_fkey
      FOREIGN KEY (coordinator) REFERENCES people(id) ON DELETE SET NULL;
    RAISE NOTICE 'campus_institutions_coordinator_fkey ensured (person link SET NULL).';
  ELSE
    RAISE NOTICE 'campus_institutions_coordinator_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. campus_students (§7.2).
--    person required RESTRICT (see header CHOICE); institution RESTRICT (an
--    institution with students is not deleted by accident); branch RESTRICT
--    (scope parent, same posture as blessings.branch); zone/coordinator
--    denorm SET NULL. financial_support_total is Flow-maintained (see header).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus_students (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person                  uuid NOT NULL,
  institution             uuid,
  course                  text,
  level                   text CHECK (level IS NULL OR level IN
                            ('freshman', 'sophomore', 'junior', 'senior',
                             'final_year', 'graduated', 'other')),
  admission_year          integer CHECK (admission_year IS NULL OR (admission_year BETWEEN 1900 AND 2100)),
  graduation_year         integer CHECK (graduation_year IS NULL OR (graduation_year BETWEEN 1900 AND 2100)),
  coordinator             uuid,
  afcf_handshake_status   text NOT NULL DEFAULT 'not_contacted'
                            CHECK (afcf_handshake_status IN
                              ('not_contacted', 'contacted', 'connected',
                               'active', 'declined')),
  afcmf_linked            boolean NOT NULL DEFAULT false,
  nysc_status             text NOT NULL DEFAULT 'not_deployed'
                            CHECK (nysc_status IN
                              ('not_deployed', 'waiting_callup', 'deployed',
                               'serving', 'completed', 'exempt')),
  nysc_deployment         text,
  next_checkup_date       date,
  financial_support_total numeric(14,2),
  branch                  uuid,
  zone                    uuid,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'inactive', 'graduated')),
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campus_students_years_ordered
    CHECK (admission_year IS NULL OR graduation_year IS NULL
           OR admission_year <= graduation_year)
);

COMMENT ON TABLE campus_students IS
  'Campus students (data-model-expansion §7.2, AFC-483). N rows per person over time (person required, not unique); institution RESTRICTs; branch is the scope parent (RESTRICT); zone/coordinator are denorm SET NULL. nysc_status vocabulary is pinned here; the allowed graph lives in nysc_status_transitions and step refusal in the campus API route (no opaque triggers). financial_support_total is Flow-maintained and absent from the app grant lists.';

CREATE INDEX IF NOT EXISTS campus_students_person_idx ON campus_students (person);
CREATE INDEX IF NOT EXISTS campus_students_institution_idx ON campus_students (institution)
  WHERE institution IS NOT NULL;
CREATE INDEX IF NOT EXISTS campus_students_level_idx ON campus_students (level)
  WHERE level IS NOT NULL;
CREATE INDEX IF NOT EXISTS campus_students_nysc_status_idx ON campus_students (nysc_status);
CREATE INDEX IF NOT EXISTS campus_students_status_idx ON campus_students (status);
CREATE INDEX IF NOT EXISTS campus_students_branch_status_idx ON campus_students (branch, status);

-- ---------------------------------------------------------------------------
-- 3. coaching_programmes (§7.3).
--    Scope is area/zone/branch, all nullable (null = wider than that level).
--    branch RESTRICT (scope parent); zone/area denorm SET NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_programmes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  exam       text NOT NULL
               CHECK (exam IN ('waec', 'utme', 'other')),
  year       integer CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100)),
  area       uuid,
  zone       uuid,
  branch     uuid,
  scope_note text,
  status     text NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coaching_programmes IS
  'Coaching programmes (data-model-expansion §7.3, AFC-483). exam+year names the diet; area/zone/branch carry the scope (null = wider). branch RESTRICTs; zone/area are denorm SET NULL.';

CREATE INDEX IF NOT EXISTS coaching_programmes_exam_year_idx
  ON coaching_programmes (exam, year);
CREATE INDEX IF NOT EXISTS coaching_programmes_branch_idx
  ON coaching_programmes (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS coaching_programmes_zone_idx
  ON coaching_programmes (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS coaching_programmes_status_idx
  ON coaching_programmes (status);

-- ---------------------------------------------------------------------------
-- 4. coaching_timetable (§7.3). programme RESTRICT (a programme with slots is
--    not deleted by accident); facilitator nullable person link SET NULL.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_timetable (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme    uuid NOT NULL REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  subject      text NOT NULL,
  facilitator  uuid,
  day_of_week  text CHECK (day_of_week IS NULL OR day_of_week IN
                  ('monday', 'tuesday', 'wednesday', 'thursday',
                   'friday', 'saturday', 'sunday')),
  start_time   time,
  end_time     time,
  location     text,
  capacity     integer CHECK (capacity IS NULL OR capacity >= 0),
  status       text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'inactive')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_timetable_hours_ordered
    CHECK (start_time IS NULL OR end_time IS NULL OR start_time < end_time)
);

COMMENT ON TABLE coaching_timetable IS
  'Weekly coaching slots (data-model-expansion §7.3, AFC-483). programme RESTRICTs; facilitator is a nullable person link (SET NULL, conditional FK below). Scope resolves through programme (see header CHOICE).';

CREATE INDEX IF NOT EXISTS coaching_timetable_programme_day_idx
  ON coaching_timetable (programme, day_of_week);
CREATE INDEX IF NOT EXISTS coaching_timetable_programme_idx
  ON coaching_timetable (programme);

-- ---------------------------------------------------------------------------
-- 5. coaching_facilitators (§7.3). person + programme required RESTRICT; one
--    assignment per (programme, person).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_facilitators (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person            uuid NOT NULL,
  programme         uuid NOT NULL REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  subject           text,
  registration_date date,
  call_status       text NOT NULL DEFAULT 'registered'
                      CHECK (call_status IN
                        ('registered', 'called', 'confirmed', 'declined')),
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE coaching_facilitators IS
  'Facilitator assignments (data-model-expansion §7.3, AFC-483). person required RESTRICT (conditional FK below); programme RESTRICTs. One row per (programme, person).';

CREATE UNIQUE INDEX IF NOT EXISTS coaching_facilitators_programme_person_uidx
  ON coaching_facilitators (programme, person);
CREATE INDEX IF NOT EXISTS coaching_facilitators_programme_idx
  ON coaching_facilitators (programme);
CREATE INDEX IF NOT EXISTS coaching_facilitators_person_idx
  ON coaching_facilitators (person);

-- ---------------------------------------------------------------------------
-- 6. coaching_students (§7.3). Enrolment is campus_student OR person
--    (exactly one; see header CHOICE). programme RESTRICTs; student links
--    RESTRICT. One enrolment per identity shape per programme.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_students (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme         uuid NOT NULL REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  campus_student    uuid REFERENCES campus_students(id) ON DELETE RESTRICT,
  person            uuid,
  registration_date date,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_students_exactly_one_identity
    CHECK ((campus_student IS NOT NULL)::integer
           + (person IS NOT NULL)::integer = 1)
);

COMMENT ON TABLE coaching_students IS
  'Coaching enrolments (data-model-expansion §7.3, AFC-483). campus_student xor person (exactly-one CHECK); programme and both student links RESTRICT. Scope resolves through programme.';

CREATE UNIQUE INDEX IF NOT EXISTS coaching_students_programme_cstudent_uidx
  ON coaching_students (programme, campus_student)
  WHERE campus_student IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS coaching_students_programme_person_uidx
  ON coaching_students (programme, person)
  WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS coaching_students_programme_idx
  ON coaching_students (programme);

-- ---------------------------------------------------------------------------
-- 7. coaching_class_attendance (§7.3). timetable xor (programme+date) is
--    "at least one" (a slot mark or a general programme+date mark; see header
--    CHOICE). Student side mirrors enrolments. Both scope links RESTRICT.
--    The four partial uniques are the idempotency control: re-marking the
--    same identity for the same session+date lands on the same row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_class_attendance (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timetable      uuid REFERENCES coaching_timetable(id) ON DELETE RESTRICT,
  programme      uuid REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  class_date     date NOT NULL,
  campus_student uuid REFERENCES campus_students(id) ON DELETE RESTRICT,
  person         uuid,
  present        boolean NOT NULL DEFAULT false,
  marked_by      uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_class_attendance_needs_session
    CHECK (timetable IS NOT NULL OR programme IS NOT NULL),
  CONSTRAINT coaching_class_attendance_exactly_one_identity
    CHECK ((campus_student IS NOT NULL)::integer
           + (person IS NOT NULL)::integer = 1)
);

COMMENT ON TABLE coaching_class_attendance IS
  'Class attendance marks (data-model-expansion §7.3, AFC-483; §14 idempotency test). timetable (slot mark) or programme+class_date (general mark); student is campus_student xor person. Partial uniques make re-marking idempotent. Scope resolves through programme/timetable.';

CREATE UNIQUE INDEX IF NOT EXISTS coaching_attendance_slot_cstudent_uidx
  ON coaching_class_attendance (timetable, campus_student, class_date)
  WHERE timetable IS NOT NULL AND campus_student IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS coaching_attendance_slot_person_uidx
  ON coaching_class_attendance (timetable, person, class_date)
  WHERE timetable IS NOT NULL AND person IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS coaching_attendance_prog_cstudent_uidx
  ON coaching_class_attendance (programme, campus_student, class_date)
  WHERE programme IS NOT NULL AND timetable IS NULL AND campus_student IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS coaching_attendance_prog_person_uidx
  ON coaching_class_attendance (programme, person, class_date)
  WHERE programme IS NOT NULL AND timetable IS NULL AND person IS NOT NULL;
CREATE INDEX IF NOT EXISTS coaching_attendance_programme_date_idx
  ON coaching_class_attendance (programme, class_date);
CREATE INDEX IF NOT EXISTS coaching_attendance_timetable_date_idx
  ON coaching_class_attendance (timetable, class_date);

-- ---------------------------------------------------------------------------
-- 8. coaching_progress (§7.3). Student side mirrors enrolments; programme
--    RESTRICTs. recorded_by is a bare uuid (Directus actor, owned elsewhere --
--    the 0011 recorded_by precedent).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_progress (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_student uuid REFERENCES campus_students(id) ON DELETE RESTRICT,
  person         uuid,
  programme      uuid NOT NULL REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  assessment     text,
  score          numeric CHECK (score IS NULL OR score >= 0),
  max_score      numeric CHECK (max_score IS NULL OR max_score > 0),
  progress_date  date,
  remarks        text,
  recorded_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_progress_exactly_one_identity
    CHECK ((campus_student IS NOT NULL)::integer
           + (person IS NOT NULL)::integer = 1),
  CONSTRAINT coaching_progress_score_within_max
    CHECK (score IS NULL OR max_score IS NULL OR score <= max_score)
);

COMMENT ON TABLE coaching_progress IS
  'Coaching assessments (data-model-expansion §7.3, AFC-483). Student is campus_student xor person; programme RESTRICTs. Scores are coordinator/branch-admin/own-student reads (§11.1) via policy, not here.';

CREATE INDEX IF NOT EXISTS coaching_progress_cstudent_prog_date_idx
  ON coaching_progress (campus_student, programme, progress_date);
CREATE INDEX IF NOT EXISTS coaching_progress_person_prog_date_idx
  ON coaching_progress (person, programme, progress_date);

-- ---------------------------------------------------------------------------
-- 9. exam_results (§7.3). Student side mirrors enrolments. scores is jsonb
--    (shape extended deliberately, never raw SQL -- ADR-0010 tech-debt
--    ledger). Status is coupled to exam (see header CHOICE).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_student uuid REFERENCES campus_students(id) ON DELETE RESTRICT,
  person         uuid,
  exam           text NOT NULL
                   CHECK (exam IN ('waec', 'utme', 'admission')),
  exam_year      integer CHECK (exam_year IS NULL OR (exam_year BETWEEN 1900 AND 2100)),
  scores         jsonb NOT NULL DEFAULT '{}'::jsonb,
  aggregate      text,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN
                     ('pending', 'passed', 'failed',
                      'admitted', 'not_admitted')),
  institution    text,
  recorded_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_results_exactly_one_identity
    CHECK ((campus_student IS NOT NULL)::integer
           + (person IS NOT NULL)::integer = 1),
  CONSTRAINT exam_results_status_exam_coupling
    CHECK ((exam = 'admission' OR status NOT IN ('admitted', 'not_admitted'))
           AND (exam <> 'admission' OR status NOT IN ('passed', 'failed')))
);

COMMENT ON TABLE exam_results IS
  'Exam outcomes (data-model-expansion §7.3 exam_results, AFC-483). Student is campus_student xor person. scores jsonb shape is extended deliberately, never raw SQL. admitted/not_admitted only for admission; passed/failed never for admission.';

CREATE UNIQUE INDEX IF NOT EXISTS exam_results_cstudent_uidx
  ON exam_results (campus_student, exam, exam_year)
  WHERE campus_student IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exam_results_person_uidx
  ON exam_results (person, exam, exam_year)
  WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS exam_results_exam_year_idx
  ON exam_results (exam, exam_year);

-- ---------------------------------------------------------------------------
-- 10. coaching_resources (§7.3). programme xor timetable content link (at
--     least one; see header CHOICE). type/visibility are plain text (the spec
--     names no values; no invented enum -- see header CHOICE).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_resources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme   uuid REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  timetable   uuid REFERENCES coaching_timetable(id) ON DELETE RESTRICT,
  title       text NOT NULL,
  file        uuid,
  type        text,
  visibility  text,
  uploaded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_resources_needs_owner
    CHECK (programme IS NOT NULL OR timetable IS NOT NULL)
);

COMMENT ON TABLE coaching_resources IS
  'Coaching content (data-model-expansion §7.3, AFC-483). programme and/or timetable own it (at least one); both RESTRICT. type/visibility are plain text -- the spec names no vocabulary.';

CREATE INDEX IF NOT EXISTS coaching_resources_programme_idx
  ON coaching_resources (programme) WHERE programme IS NOT NULL;
CREATE INDEX IF NOT EXISTS coaching_resources_timetable_idx
  ON coaching_resources (timetable) WHERE timetable IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 11. coaching_feedback (§7.3). campus_student xor guardian (person link SET
--     NULL -- a guardian leaving does not delete the report). programme
--     RESTRICTs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coaching_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_student uuid REFERENCES campus_students(id) ON DELETE RESTRICT,
  guardian       uuid,
  programme      uuid NOT NULL REFERENCES coaching_programmes(id) ON DELETE RESTRICT,
  feedback       text,
  rating         integer CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  feedback_date  date,
  status         text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new', 'reviewed', 'closed')),
  handled_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_feedback_exactly_one_reporter
    CHECK ((campus_student IS NOT NULL)::integer
           + (guardian IS NOT NULL)::integer = 1)
);

COMMENT ON TABLE coaching_feedback IS
  'Student/guardian feedback (data-model-expansion §7.3, AFC-483). campus_student xor guardian (guardian SET NULL, conditional FK below); programme RESTRICTs. new -> reviewed -> closed is a route lifecycle.';

CREATE INDEX IF NOT EXISTS coaching_feedback_programme_idx
  ON coaching_feedback (programme);
CREATE INDEX IF NOT EXISTS coaching_feedback_status_idx
  ON coaching_feedback (status);

-- ---------------------------------------------------------------------------
-- 12. campus_financial_support (§7.3). student required RESTRICT; programme
--     nullable SET NULL (support outlives a programme cycle -- the money fact
--     survives a programme correction, the 0011 program-link precedent).
--     proposed -> approved -> disbursed is a route lifecycle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campus_financial_support (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student      uuid NOT NULL REFERENCES campus_students(id) ON DELETE RESTRICT,
  programme    uuid REFERENCES coaching_programmes(id) ON DELETE SET NULL,
  amount       numeric(14,2) CHECK (amount IS NULL OR amount >= 0),
  term         text,
  source       text,
  status       text NOT NULL DEFAULT 'proposed'
                 CHECK (status IN ('proposed', 'approved', 'disbursed')),
  approved_by  uuid,
  support_date date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE campus_financial_support IS
  'Campus financial support (data-model-expansion §7.3, AFC-483). student required RESTRICT; programme nullable SET NULL. Amounts are coordinator/branch-admin/own-student reads (§11.1) via policy, not here.';

CREATE INDEX IF NOT EXISTS campus_support_student_status_idx
  ON campus_financial_support (student, status);
CREATE INDEX IF NOT EXISTS campus_support_programme_idx
  ON campus_financial_support (programme) WHERE programme IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 13. nysc_status_transitions (the §7.2 graph as reference rows; see header
--     CHOICE). SELECT-only reference, seeded below. Terminal states
--     (completed, exempt) carry no outgoing edge by construction.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nysc_status_transitions (
  from_status text NOT NULL
    CHECK (from_status IN
      ('not_deployed', 'waiting_callup', 'deployed',
       'serving', 'completed', 'exempt')),
  to_status   text NOT NULL
    CHECK (to_status IN
      ('not_deployed', 'waiting_callup', 'deployed',
       'serving', 'completed', 'exempt')),
  PRIMARY KEY (from_status, to_status),
  CONSTRAINT nysc_status_transitions_no_self_loop
    CHECK (from_status <> to_status)
);

COMMENT ON TABLE nysc_status_transitions IS
  'Allowed NYSC status edges (data-model-expansion §7.2 vocabulary, AFC-483). Seeded reference the campus API route reads to validate transitions; completed and exempt are terminal (no outgoing rows).';

-- ---------------------------------------------------------------------------
-- 14. Conditional FKs onto parent tables owned elsewhere (the 0002/0003
--     merge-contract pattern). Each lands only where the parent exists, under
--     a FIXED name so reruns and the contract test agree; a missing parent
--     skips loudly rather than forking a table another slice owns. Rerunning
--     this file after the parents land completes the FKs. Required person
--     links RESTRICT (see header CHOICE); nullable person/denorm links
--     SET NULL; branch scope links RESTRICT; zone/area denorm SET NULL.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- people (required student/person links RESTRICT; nullable person links SET NULL).
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping campus person FKs: people not present (the people-owning slice re-runs this migration when the table lands).';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_students_person_fkey') THEN
      ALTER TABLE campus_students ADD CONSTRAINT campus_students_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'campus_students_person_fkey ensured (required, RESTRICT).';
    ELSE
      RAISE NOTICE 'campus_students_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_students_coordinator_fkey') THEN
      ALTER TABLE campus_students ADD CONSTRAINT campus_students_coordinator_fkey
        FOREIGN KEY (coordinator) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'campus_students_coordinator_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'campus_students_coordinator_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_timetable_facilitator_fkey') THEN
      ALTER TABLE coaching_timetable ADD CONSTRAINT coaching_timetable_facilitator_fkey
        FOREIGN KEY (facilitator) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'coaching_timetable_facilitator_fkey ensured (nullable person link SET NULL).';
    ELSE
      RAISE NOTICE 'coaching_timetable_facilitator_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_facilitators_person_fkey') THEN
      ALTER TABLE coaching_facilitators ADD CONSTRAINT coaching_facilitators_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'coaching_facilitators_person_fkey ensured (required, RESTRICT).';
    ELSE
      RAISE NOTICE 'coaching_facilitators_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_students_person_fkey') THEN
      ALTER TABLE coaching_students ADD CONSTRAINT coaching_students_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'coaching_students_person_fkey ensured (required-when-set, RESTRICT).';
    ELSE
      RAISE NOTICE 'coaching_students_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_attendance_person_fkey') THEN
      ALTER TABLE coaching_class_attendance ADD CONSTRAINT coaching_attendance_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'coaching_attendance_person_fkey ensured (required-when-set, RESTRICT).';
    ELSE
      RAISE NOTICE 'coaching_attendance_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_progress_person_fkey') THEN
      ALTER TABLE coaching_progress ADD CONSTRAINT coaching_progress_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'coaching_progress_person_fkey ensured (required-when-set, RESTRICT).';
    ELSE
      RAISE NOTICE 'coaching_progress_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'exam_results_person_fkey') THEN
      ALTER TABLE exam_results ADD CONSTRAINT exam_results_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'exam_results_person_fkey ensured (required-when-set, RESTRICT).';
    ELSE
      RAISE NOTICE 'exam_results_person_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_feedback_guardian_fkey') THEN
      ALTER TABLE coaching_feedback ADD CONSTRAINT coaching_feedback_guardian_fkey
        FOREIGN KEY (guardian) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'coaching_feedback_guardian_fkey ensured (nullable person link SET NULL).';
    ELSE
      RAISE NOTICE 'coaching_feedback_guardian_fkey already present, left alone.';
    END IF;
  END IF;

  -- campus_institutions (enrolment scope parent RESTRICT; never forked).
  IF to_regclass('public.campus_institutions') IS NULL THEN
    RAISE NOTICE 'Skipping campus_students_institution_fkey: campus_institutions not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_students_institution_fkey') THEN
    ALTER TABLE campus_students ADD CONSTRAINT campus_students_institution_fkey
      FOREIGN KEY (institution) REFERENCES campus_institutions(id) ON DELETE RESTRICT;
    RAISE NOTICE 'campus_students_institution_fkey ensured (RESTRICT).';
  ELSE
    RAISE NOTICE 'campus_students_institution_fkey already present, left alone.';
  END IF;

  -- branches (scope parents RESTRICT).
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping campus branch FKs: branches not present (the hierarchy-owning slice re-runs this migration when the table lands).';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_students_branch_fkey') THEN
      ALTER TABLE campus_students ADD CONSTRAINT campus_students_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
      RAISE NOTICE 'campus_students_branch_fkey ensured (scope parent RESTRICT).';
    ELSE
      RAISE NOTICE 'campus_students_branch_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_programmes_branch_fkey') THEN
      ALTER TABLE coaching_programmes ADD CONSTRAINT coaching_programmes_branch_fkey
        FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
      RAISE NOTICE 'coaching_programmes_branch_fkey ensured (scope parent RESTRICT).';
    ELSE
      RAISE NOTICE 'coaching_programmes_branch_fkey already present, left alone.';
    END IF;
  END IF;

  -- zones (denorm SET NULL).
  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping campus zone FKs: zones not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campus_students_zone_fkey') THEN
      ALTER TABLE campus_students ADD CONSTRAINT campus_students_zone_fkey
        FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
      RAISE NOTICE 'campus_students_zone_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'campus_students_zone_fkey already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_programmes_zone_fkey') THEN
      ALTER TABLE coaching_programmes ADD CONSTRAINT coaching_programmes_zone_fkey
        FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
      RAISE NOTICE 'coaching_programmes_zone_fkey ensured (denorm SET NULL).';
    ELSE
      RAISE NOTICE 'coaching_programmes_zone_fkey already present, left alone.';
    END IF;
  END IF;

  -- areas (denorm SET NULL).
  IF to_regclass('public.areas') IS NULL THEN
    RAISE NOTICE 'Skipping coaching_programmes_area_fkey: areas not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coaching_programmes_area_fkey') THEN
    ALTER TABLE coaching_programmes ADD CONSTRAINT coaching_programmes_area_fkey
      FOREIGN KEY (area) REFERENCES areas(id) ON DELETE SET NULL;
    RAISE NOTICE 'coaching_programmes_area_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'coaching_programmes_area_fkey already present, left alone.';
  END IF;
END
$$;

-- Backfill the denorm where the branch parent is known. Rerunnable: only
-- rows whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.campus_students') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE campus_students s
       SET zone = br.zone
      FROM branches br
     WHERE s.zone IS NULL AND s.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'campus_students zone denorm backfilled from branches.';
  ELSE
    RAISE NOTICE 'campus_students zone backfill skipped: table or branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 15. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--     campus rows hold minors' PII, support rows are financial facts, and
--     erasure runs as retention_worker, never through the API.
--     financial_support_total is derived (Flow) and absent from both column
--     lists on purpose; id/created_at/updated_at are never app-written.
-- ---------------------------------------------------------------------------
GRANT SELECT ON campus_students TO directus_app;
GRANT INSERT (person, institution, course, level, admission_year,
  graduation_year, coordinator, afcf_handshake_status, afcmf_linked,
  nysc_status, nysc_deployment, next_checkup_date, branch, zone, status,
  notes)
  ON campus_students TO directus_app;
GRANT UPDATE (person, institution, course, level, admission_year,
  graduation_year, coordinator, afcf_handshake_status, afcmf_linked,
  nysc_status, nysc_deployment, next_checkup_date, branch, zone, status,
  notes)
  ON campus_students TO directus_app;

GRANT SELECT ON coaching_programmes TO directus_app;
GRANT INSERT (name, exam, year, area, zone, branch, scope_note, status)
  ON coaching_programmes TO directus_app;
GRANT UPDATE (name, exam, year, area, zone, branch, scope_note, status)
  ON coaching_programmes TO directus_app;

GRANT SELECT ON coaching_timetable TO directus_app;
GRANT INSERT (programme, subject, facilitator, day_of_week, start_time,
  end_time, location, capacity, status)
  ON coaching_timetable TO directus_app;
GRANT UPDATE (programme, subject, facilitator, day_of_week, start_time,
  end_time, location, capacity, status)
  ON coaching_timetable TO directus_app;

GRANT SELECT ON coaching_facilitators TO directus_app;
GRANT INSERT (person, programme, subject, registration_date, call_status,
  status)
  ON coaching_facilitators TO directus_app;
GRANT UPDATE (person, programme, subject, registration_date, call_status,
  status)
  ON coaching_facilitators TO directus_app;

GRANT SELECT ON coaching_students TO directus_app;
GRANT INSERT (programme, campus_student, person, registration_date, status)
  ON coaching_students TO directus_app;
GRANT UPDATE (programme, campus_student, person, registration_date, status)
  ON coaching_students TO directus_app;

GRANT SELECT ON coaching_class_attendance TO directus_app;
GRANT INSERT (timetable, programme, class_date, campus_student, person,
  present, marked_by)
  ON coaching_class_attendance TO directus_app;
GRANT UPDATE (timetable, programme, class_date, campus_student, person,
  present, marked_by)
  ON coaching_class_attendance TO directus_app;

GRANT SELECT ON coaching_progress TO directus_app;
GRANT INSERT (campus_student, person, programme, assessment, score,
  max_score, progress_date, remarks, recorded_by)
  ON coaching_progress TO directus_app;
GRANT UPDATE (campus_student, person, programme, assessment, score,
  max_score, progress_date, remarks, recorded_by)
  ON coaching_progress TO directus_app;

GRANT SELECT ON exam_results TO directus_app;
GRANT INSERT (campus_student, person, exam, exam_year, scores, aggregate,
  status, institution, recorded_by)
  ON exam_results TO directus_app;
GRANT UPDATE (campus_student, person, exam, exam_year, scores, aggregate,
  status, institution, recorded_by)
  ON exam_results TO directus_app;

GRANT SELECT ON coaching_resources TO directus_app;
GRANT INSERT (programme, timetable, title, file, type, visibility,
  uploaded_by)
  ON coaching_resources TO directus_app;
GRANT UPDATE (programme, timetable, title, file, type, visibility,
  uploaded_by)
  ON coaching_resources TO directus_app;

GRANT SELECT ON coaching_feedback TO directus_app;
GRANT INSERT (campus_student, guardian, programme, feedback, rating,
  feedback_date, status, handled_by)
  ON coaching_feedback TO directus_app;
GRANT UPDATE (campus_student, guardian, programme, feedback, rating,
  feedback_date, status, handled_by)
  ON coaching_feedback TO directus_app;

GRANT SELECT ON campus_financial_support TO directus_app;
GRANT INSERT (student, programme, amount, term, source, status,
  approved_by, support_date)
  ON campus_financial_support TO directus_app;
GRANT UPDATE (student, programme, amount, term, source, status,
  approved_by, support_date)
  ON campus_financial_support TO directus_app;

-- Reference: SELECT-only (seeded rows the routes read, never app-written).
GRANT SELECT ON nysc_status_transitions TO directus_app;

REVOKE ALL ON campus_students FROM PUBLIC;
REVOKE ALL ON coaching_programmes FROM PUBLIC;
REVOKE ALL ON coaching_timetable FROM PUBLIC;
REVOKE ALL ON coaching_facilitators FROM PUBLIC;
REVOKE ALL ON coaching_students FROM PUBLIC;
REVOKE ALL ON coaching_class_attendance FROM PUBLIC;
REVOKE ALL ON coaching_progress FROM PUBLIC;
REVOKE ALL ON exam_results FROM PUBLIC;
REVOKE ALL ON coaching_resources FROM PUBLIC;
REVOKE ALL ON coaching_feedback FROM PUBLIC;
REVOKE ALL ON campus_financial_support FROM PUBLIC;
REVOKE ALL ON nysc_status_transitions FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 16. SEED -- reference institutions + the NYSC graph. Idempotent: fixed ids
--     for institutions (ON CONFLICT (id) DO NOTHING; name carries no unique
--     constraint per §7.1, so the id is the identity), natural-key conflicts
--     for edges. No personal data: institution names only, no person links.
-- ---------------------------------------------------------------------------
INSERT INTO campus_institutions (id, name, town, state, notes, status) VALUES
  ('c0a00001-0001-4001-8001-000000000001',
   'University of Lagos', 'Akoka', 'Lagos',
   'Seed reference (AFC-483 Slice 5a). Coordinator assigned by the campus team.',
   'active'),
  ('c0a00001-0001-4001-8001-000000000002',
   'Lagos State University', 'Ojo', 'Lagos',
   'Seed reference (AFC-483 Slice 5a). Coordinator assigned by the campus team.',
   'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO nysc_status_transitions (from_status, to_status) VALUES
  ('not_deployed',   'waiting_callup'),
  ('not_deployed',   'exempt'),
  ('waiting_callup', 'deployed'),
  ('waiting_callup', 'exempt'),
  ('deployed',       'serving'),
  ('deployed',       'exempt'),
  ('serving',        'completed'),
  ('serving',        'exempt')
ON CONFLICT DO NOTHING;
