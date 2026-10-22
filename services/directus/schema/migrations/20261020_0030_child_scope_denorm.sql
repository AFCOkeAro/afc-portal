-- AFC RBAC: denormalise branch/zone onto child collections so Directus
-- row-level policies can scope them (data-model-expansion §10).
--
-- Background: the child tables below reach a branch only through a parent
-- (session, person, programme, campus_student, case, ...). Directus permission
-- filters can only reference fields on the row itself, and staging's
-- directus_relations metadata is empty, so relational filters fail closed
-- with 403. Adding the two scope columns (and keeping them in sync from the
-- parent) makes the flat `$CURRENT_USER` filters in the generated policies
-- work without relying on Directus relation metadata.
--
-- Shape (AFC-700): every child gets top-level static statements -- ALTER
-- TABLE ... ADD COLUMN, CREATE INDEX, DROP/CREATE TRIGGER -- one block per
-- child, no staging table, no DO-loop over a driver list. Static text is
-- what the rollback-control gate can attribute: the up migration previously
-- built every trigger inside EXECUTE format() in a DO block, so the gate saw
-- 26 dropped controls with "no scanned file" as their creator. There is no
-- CREATE TEMP TABLE anywhere here: the driver list used to live in one, and
-- PGlite runs this file as directus_migrator in a database where TEMP
-- creation is refused (42501), while postgres:16 is fine with it. Static
-- statements run on both with no new privilege (least privilege, ADR-0002).
--
-- people-parent guard (AFC-700): the migration history's people table is the
-- retention anchor (20261006_0004) plus ALTERs, and none of them carries a
-- branch column -- the full v4 people record, including staging's varchar
-- branch graft, lives in the Directus project, not in this sequence. The two
-- people-parent children (people_departments, consent_records) therefore get
-- the same columns and triggers as every other child, but the trigger
-- function and the backfill only touch parent.branch where that column
-- actually exists (information_schema check), skipping loudly where it does
-- not. Behaviour for parents WITH branch is byte-for-byte the old behaviour.
-- No branch column is added to people here: that is a data-model change
-- needing its own migration + review.
--
-- Safe to re-run: columns use IF NOT EXISTS, indexes use IF NOT EXISTS,
-- triggers are dropped first, and the backfill only writes rows whose scope
-- is still null.

CREATE OR REPLACE FUNCTION afc_set_child_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fk uuid;
  p_branch uuid;
  p_branch_text text;
  p_zone uuid;
  v_has_branch boolean;
  v_has_zone boolean;
BEGIN
  fk := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF fk IS NULL THEN
    RETURN NEW;
  END IF;

  -- Guard: only touch parent.branch / parent.zone where those columns exist.
  -- Scratch databases built from this history have no people.branch (see file
  -- header); staging and project databases do. Skipping leaves the child's
  -- scope null rather than raising 42703. The backfill NOTICE (below) is the
  -- loud record; per-row notices here would flood every insert, so the
  -- trigger skips silently.
  SELECT
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = TG_ARGV[1]
               AND column_name = 'branch'),
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = TG_ARGV[1]
               AND column_name = 'zone')
    INTO v_has_branch, v_has_zone;

  IF TG_ARGV[2] = '1' THEN
    IF v_has_branch THEN
      EXECUTE format('SELECT branch::text, zone FROM %I WHERE id = $1', TG_ARGV[1])
        INTO p_branch_text, p_zone USING fk;
    ELSIF v_has_zone THEN
      EXECUTE format('SELECT zone FROM %I WHERE id = $1', TG_ARGV[1])
        INTO p_zone USING fk;
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_ARGV[2] = '0' THEN
    IF NOT v_has_branch THEN
      RETURN NEW;
    END IF;
    EXECUTE format('SELECT branch::text FROM %I WHERE id = $1', TG_ARGV[1])
      INTO p_branch_text USING fk;
  ELSE
    IF NOT v_has_zone THEN
      RETURN NEW;
    END IF;
    EXECUTE format('SELECT zone FROM %I WHERE id = $1', TG_ARGV[1])
      INTO p_zone USING fk;
  END IF;

  -- `people.branch` is varchar in staging (app-compat graft); only accept a
  -- real uuid, never error a write on legacy text.
  IF p_branch_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    p_branch := p_branch_text::uuid;
  END IF;
  IF TG_ARGV[2] = '0' AND p_branch IS NOT NULL THEN
    SELECT zone INTO p_zone FROM branches WHERE id = p_branch;
  END IF;

  IF p_branch IS NOT NULL THEN
    NEW.branch := p_branch;
  END IF;
  IF p_zone IS NOT NULL THEN
    NEW.zone := p_zone;
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Per-child scope columns, indexes and sync triggers.
-- (child, fk column, parent, mode: 1=branch+zone, 0=branch-only, 2=zone-only)
-- ---------------------------------------------------------------------------

-- people_departments (people, mode 0)
ALTER TABLE people_departments ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE people_departments ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS people_departments_branch_idx ON people_departments (branch);
CREATE INDEX IF NOT EXISTS people_departments_zone_idx ON people_departments (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON people_departments;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF people ON people_departments FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('people', 'people', '0');

-- attendance_records (session -> attendance_sessions, mode 1)
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE attendance_records ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_records_branch_idx ON attendance_records (branch);
CREATE INDEX IF NOT EXISTS attendance_records_zone_idx ON attendance_records (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON attendance_records;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF session ON attendance_records FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('session', 'attendance_sessions', '1');

-- attendance_counts (session -> attendance_sessions, mode 1)
ALTER TABLE attendance_counts ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE attendance_counts ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS attendance_counts_branch_idx ON attendance_counts (branch);
CREATE INDEX IF NOT EXISTS attendance_counts_zone_idx ON attendance_counts (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON attendance_counts;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF session ON attendance_counts FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('session', 'attendance_sessions', '1');

-- visitor_journey_transitions (visitor -> visitors, mode 0)
ALTER TABLE visitor_journey_transitions ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE visitor_journey_transitions ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS visitor_journey_transitions_branch_idx ON visitor_journey_transitions (branch);
CREATE INDEX IF NOT EXISTS visitor_journey_transitions_zone_idx ON visitor_journey_transitions (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON visitor_journey_transitions;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF visitor ON visitor_journey_transitions FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('visitor', 'visitors', '0');

-- welfare_contributions (case -> welfare_cases, mode 0)
ALTER TABLE welfare_contributions ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE welfare_contributions ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS welfare_contributions_branch_idx ON welfare_contributions (branch);
CREATE INDEX IF NOT EXISTS welfare_contributions_zone_idx ON welfare_contributions (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON welfare_contributions;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF "case" ON welfare_contributions FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('case', 'welfare_cases', '0');

-- welfare_case_events (case -> welfare_cases, mode 0)
ALTER TABLE welfare_case_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE welfare_case_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS welfare_case_events_branch_idx ON welfare_case_events (branch);
CREATE INDEX IF NOT EXISTS welfare_case_events_zone_idx ON welfare_case_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON welfare_case_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF "case" ON welfare_case_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('case', 'welfare_cases', '0');

-- communication_recipients (communication -> communications, mode 0)
ALTER TABLE communication_recipients ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE communication_recipients ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS communication_recipients_branch_idx ON communication_recipients (branch);
CREATE INDEX IF NOT EXISTS communication_recipients_zone_idx ON communication_recipients (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON communication_recipients;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF communication ON communication_recipients FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('communication', 'communications', '0');

-- consent_records (person -> people, mode 0)
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE consent_records ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS consent_records_branch_idx ON consent_records (branch);
CREATE INDEX IF NOT EXISTS consent_records_zone_idx ON consent_records (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON consent_records;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF person ON consent_records FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('person', 'people', '0');

-- coaching_timetable (programme -> coaching_programmes, mode 1)
ALTER TABLE coaching_timetable ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_timetable ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_timetable_branch_idx ON coaching_timetable (branch);
CREATE INDEX IF NOT EXISTS coaching_timetable_zone_idx ON coaching_timetable (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_timetable;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF programme ON coaching_timetable FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('programme', 'coaching_programmes', '1');

-- coaching_facilitators (programme -> coaching_programmes, mode 1)
ALTER TABLE coaching_facilitators ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_facilitators ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_facilitators_branch_idx ON coaching_facilitators (branch);
CREATE INDEX IF NOT EXISTS coaching_facilitators_zone_idx ON coaching_facilitators (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_facilitators;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF programme ON coaching_facilitators FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('programme', 'coaching_programmes', '1');

-- coaching_students (programme -> coaching_programmes, mode 1)
ALTER TABLE coaching_students ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_students ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_students_branch_idx ON coaching_students (branch);
CREATE INDEX IF NOT EXISTS coaching_students_zone_idx ON coaching_students (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_students;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF programme ON coaching_students FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('programme', 'coaching_programmes', '1');

-- coaching_class_attendance (programme -> coaching_programmes, mode 1)
ALTER TABLE coaching_class_attendance ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_class_attendance ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_class_attendance_branch_idx ON coaching_class_attendance (branch);
CREATE INDEX IF NOT EXISTS coaching_class_attendance_zone_idx ON coaching_class_attendance (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_class_attendance;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF programme ON coaching_class_attendance FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('programme', 'coaching_programmes', '1');

-- coaching_progress (campus_student -> campus_students, mode 1)
ALTER TABLE coaching_progress ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_progress ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_progress_branch_idx ON coaching_progress (branch);
CREATE INDEX IF NOT EXISTS coaching_progress_zone_idx ON coaching_progress (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_progress;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF campus_student ON coaching_progress FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('campus_student', 'campus_students', '1');

-- coaching_resources (programme -> coaching_programmes, mode 1)
ALTER TABLE coaching_resources ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_resources ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_resources_branch_idx ON coaching_resources (branch);
CREATE INDEX IF NOT EXISTS coaching_resources_zone_idx ON coaching_resources (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_resources;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF programme ON coaching_resources FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('programme', 'coaching_programmes', '1');

-- coaching_feedback (campus_student -> campus_students, mode 1)
ALTER TABLE coaching_feedback ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE coaching_feedback ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS coaching_feedback_branch_idx ON coaching_feedback (branch);
CREATE INDEX IF NOT EXISTS coaching_feedback_zone_idx ON coaching_feedback (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON coaching_feedback;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF campus_student ON coaching_feedback FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('campus_student', 'campus_students', '1');

-- campus_financial_support (student -> campus_students, mode 1)
ALTER TABLE campus_financial_support ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE campus_financial_support ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS campus_financial_support_branch_idx ON campus_financial_support (branch);
CREATE INDEX IF NOT EXISTS campus_financial_support_zone_idx ON campus_financial_support (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON campus_financial_support;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF student ON campus_financial_support FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('student', 'campus_students', '1');

-- exam_results (campus_student -> campus_students, mode 1)
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE exam_results ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS exam_results_branch_idx ON exam_results (branch);
CREATE INDEX IF NOT EXISTS exam_results_zone_idx ON exam_results (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON exam_results;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF campus_student ON exam_results FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('campus_student', 'campus_students', '1');

-- blessing_events (blessing -> blessings, mode 1)
ALTER TABLE blessing_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE blessing_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS blessing_events_branch_idx ON blessing_events (branch);
CREATE INDEX IF NOT EXISTS blessing_events_zone_idx ON blessing_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON blessing_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF blessing ON blessing_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('blessing', 'blessings', '1');

-- transfer_events (transfer -> transfers, mode 2)
ALTER TABLE transfer_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE transfer_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS transfer_events_branch_idx ON transfer_events (branch);
CREATE INDEX IF NOT EXISTS transfer_events_zone_idx ON transfer_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON transfer_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF transfer ON transfer_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('transfer', 'transfers', '2');

-- marriage_matter_events (marriage_matter -> marriage_matters, mode 1)
ALTER TABLE marriage_matter_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE marriage_matter_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS marriage_matter_events_branch_idx ON marriage_matter_events (branch);
CREATE INDEX IF NOT EXISTS marriage_matter_events_zone_idx ON marriage_matter_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON marriage_matter_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF marriage_matter ON marriage_matter_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('marriage_matter', 'marriage_matters', '1');

-- minutes_attendees (minute -> office_minutes, mode 1)
ALTER TABLE minutes_attendees ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE minutes_attendees ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS minutes_attendees_branch_idx ON minutes_attendees (branch);
CREATE INDEX IF NOT EXISTS minutes_attendees_zone_idx ON minutes_attendees (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON minutes_attendees;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF minute ON minutes_attendees FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('minute', 'office_minutes', '1');

-- office_minute_events (minute -> office_minutes, mode 1)
ALTER TABLE office_minute_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE office_minute_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS office_minute_events_branch_idx ON office_minute_events (branch);
CREATE INDEX IF NOT EXISTS office_minute_events_zone_idx ON office_minute_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON office_minute_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF minute ON office_minute_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('minute', 'office_minutes', '1');

-- task_events (task -> tasks, mode 1)
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE task_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS task_events_branch_idx ON task_events (branch);
CREATE INDEX IF NOT EXISTS task_events_zone_idx ON task_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON task_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF task ON task_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('task', 'tasks', '1');

-- announcement_events (announcement -> announcements, mode 1)
ALTER TABLE announcement_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE announcement_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS announcement_events_branch_idx ON announcement_events (branch);
CREATE INDEX IF NOT EXISTS announcement_events_zone_idx ON announcement_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON announcement_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF announcement ON announcement_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('announcement', 'announcements', '1');

-- youth_profile_events (profile -> youth_profiles, mode 1)
ALTER TABLE youth_profile_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE youth_profile_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS youth_profile_events_branch_idx ON youth_profile_events (branch);
CREATE INDEX IF NOT EXISTS youth_profile_events_zone_idx ON youth_profile_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON youth_profile_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF profile ON youth_profile_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('profile', 'youth_profiles', '1');

-- celebration_events (celebration -> celebrations, mode 1)
ALTER TABLE celebration_events ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE celebration_events ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS celebration_events_branch_idx ON celebration_events (branch);
CREATE INDEX IF NOT EXISTS celebration_events_zone_idx ON celebration_events (zone);
DROP TRIGGER IF EXISTS afc_set_scope ON celebration_events;
CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF celebration ON celebration_events FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope('celebration', 'celebrations', '1');

-- ---------------------------------------------------------------------------
-- Backfill existing rows from their parent (only where still null).
-- Mode-1 parents all carry branch+zone in this history; mode-0 non-people
-- parents all carry branch; transfers carries zone. The two people-parent
-- children are conditional (see header).
-- ---------------------------------------------------------------------------

UPDATE attendance_records c SET branch = p.branch, zone = p.zone FROM attendance_sessions p WHERE c.session = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE attendance_counts c SET branch = p.branch, zone = p.zone FROM attendance_sessions p WHERE c.session = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE visitor_journey_transitions c SET branch = p.branch, zone = b.zone FROM visitors p LEFT JOIN branches b ON b.id = p.branch WHERE c.visitor = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE welfare_contributions c SET branch = p.branch, zone = b.zone FROM welfare_cases p LEFT JOIN branches b ON b.id = p.branch WHERE c."case" = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE welfare_case_events c SET branch = p.branch, zone = b.zone FROM welfare_cases p LEFT JOIN branches b ON b.id = p.branch WHERE c."case" = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE communication_recipients c SET branch = p.branch, zone = b.zone FROM communications p LEFT JOIN branches b ON b.id = p.branch WHERE c.communication = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_timetable c SET branch = p.branch, zone = p.zone FROM coaching_programmes p WHERE c.programme = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_facilitators c SET branch = p.branch, zone = p.zone FROM coaching_programmes p WHERE c.programme = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_students c SET branch = p.branch, zone = p.zone FROM coaching_programmes p WHERE c.programme = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_class_attendance c SET branch = p.branch, zone = p.zone FROM coaching_programmes p WHERE c.programme = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_progress c SET branch = p.branch, zone = p.zone FROM campus_students p WHERE c.campus_student = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_resources c SET branch = p.branch, zone = p.zone FROM coaching_programmes p WHERE c.programme = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE coaching_feedback c SET branch = p.branch, zone = p.zone FROM campus_students p WHERE c.campus_student = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE campus_financial_support c SET branch = p.branch, zone = p.zone FROM campus_students p WHERE c.student = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE exam_results c SET branch = p.branch, zone = p.zone FROM campus_students p WHERE c.campus_student = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE blessing_events c SET branch = p.branch, zone = p.zone FROM blessings p WHERE c.blessing = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE transfer_events c SET zone = p.zone FROM transfers p WHERE c.transfer = p.id AND c.zone IS NULL;
UPDATE marriage_matter_events c SET branch = p.branch, zone = p.zone FROM marriage_matters p WHERE c.marriage_matter = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE minutes_attendees c SET branch = p.branch, zone = p.zone FROM office_minutes p WHERE c.minute = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE office_minute_events c SET branch = p.branch, zone = p.zone FROM office_minutes p WHERE c.minute = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE task_events c SET branch = p.branch, zone = p.zone FROM tasks p WHERE c.task = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE announcement_events c SET branch = p.branch, zone = p.zone FROM announcements p WHERE c.announcement = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE youth_profile_events c SET branch = p.branch, zone = p.zone FROM youth_profiles p WHERE c.profile = p.id AND (c.branch IS NULL OR c.zone IS NULL);
UPDATE celebration_events c SET branch = p.branch, zone = p.zone FROM celebrations p WHERE c.celebration = p.id AND (c.branch IS NULL OR c.zone IS NULL);

-- people-parent children: conditional on people.branch existing (see header).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'people'
                AND column_name = 'branch') THEN
    UPDATE people_departments c SET branch = CASE WHEN p.branch::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p.branch::text::uuid END, zone = b.zone FROM people p LEFT JOIN branches b ON b.id = CASE WHEN p.branch::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p.branch::text::uuid END WHERE c.people = p.id AND (c.branch IS NULL OR c.zone IS NULL);
    UPDATE consent_records c SET branch = CASE WHEN p.branch::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p.branch::text::uuid END, zone = b.zone FROM people p LEFT JOIN branches b ON b.id = CASE WHEN p.branch::text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN p.branch::text::uuid END WHERE c.person = p.id AND (c.branch IS NULL OR c.zone IS NULL);
  ELSE
    RAISE NOTICE '0030 backfill: people.branch is absent in this database, skipping people_departments + consent_records (no parent scope to copy).';
  END IF;
END
$$;
