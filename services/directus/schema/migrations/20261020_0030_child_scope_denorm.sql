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
-- Safe to re-run: columns use IF NOT EXISTS, triggers are dropped first, and
-- the backfill only writes rows whose scope is still null.

CREATE OR REPLACE FUNCTION afc_set_child_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  fk uuid;
  p_branch uuid;
  p_branch_text text;
  p_zone uuid;
BEGIN
  fk := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF fk IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_ARGV[2] = '1' THEN
    EXECUTE format('SELECT branch::text, zone FROM %I WHERE id = $1', TG_ARGV[1])
      INTO p_branch_text, p_zone USING fk;
  ELSIF TG_ARGV[2] = '0' THEN
    EXECUTE format('SELECT branch::text FROM %I WHERE id = $1', TG_ARGV[1])
      INTO p_branch_text USING fk;
  ELSE
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

-- (child, fk column, parent, mode: 1=branch+zone, 0=branch-only, 2=zone-only)
CREATE TEMP TABLE afc_child_scope (
  child text, fk text, parent text, mode text
);

INSERT INTO afc_child_scope VALUES
  ('people_departments',        'people',           'people',              '0'),
  ('attendance_records',        'session',          'attendance_sessions', '1'),
  ('attendance_counts',         'session',          'attendance_sessions', '1'),
  ('visitor_journey_transitions','visitor',         'visitors',            '0'),
  ('welfare_contributions',     'case',             'welfare_cases',       '0'),
  ('welfare_case_events',       'case',             'welfare_cases',       '0'),
  ('communication_recipients',  'communication',    'communications',      '0'),
  ('consent_records',           'person',           'people',              '0'),
  ('coaching_timetable',        'programme',        'coaching_programmes', '1'),
  ('coaching_facilitators',     'programme',        'coaching_programmes', '1'),
  ('coaching_students',         'programme',        'coaching_programmes', '1'),
  ('coaching_class_attendance', 'programme',        'coaching_programmes', '1'),
  ('coaching_progress',         'campus_student',   'campus_students',     '1'),
  ('coaching_resources',        'programme',        'coaching_programmes', '1'),
  ('coaching_feedback',         'campus_student',   'campus_students',     '1'),
  ('campus_financial_support',  'student',          'campus_students',     '1'),
  ('exam_results',              'campus_student',   'campus_students',     '1'),
  ('blessing_events',           'blessing',         'blessings',           '1'),
  ('transfer_events',           'transfer',         'transfers',           '2'),
  ('marriage_matter_events',    'marriage_matter',  'marriage_matters',    '1'),
  ('minutes_attendees',         'minute',           'office_minutes',      '1'),
  ('office_minute_events',      'minute',           'office_minutes',      '1'),
  ('task_events',               'task',             'tasks',               '1'),
  ('announcement_events',       'announcement',     'announcements',       '1'),
  ('youth_profile_events',      'profile',          'youth_profiles',      '1'),
  ('celebration_events',        'celebration',      'celebrations',        '1');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM afc_child_scope LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL', r.child);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL', r.child);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (branch)', r.child || '_branch_idx', r.child);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (zone)', r.child || '_zone_idx', r.child);
    EXECUTE format('DROP TRIGGER IF EXISTS afc_set_scope ON %I', r.child);
    EXECUTE format(
      'CREATE TRIGGER afc_set_scope BEFORE INSERT OR UPDATE OF %I ON %I '
      'FOR EACH ROW EXECUTE FUNCTION afc_set_child_scope(%L, %L, %L)',
      r.fk, r.child, r.fk, r.parent, r.mode);
  END LOOP;
END
$$;

-- Backfill existing rows from their parent (only where still null).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM afc_child_scope LOOP
    IF r.mode = '1' THEN
      EXECUTE format(
        'UPDATE %I c SET branch = p.branch, zone = p.zone FROM %I p '
        'WHERE c.%I = p.id AND (c.branch IS NULL OR c.zone IS NULL)',
        r.child, r.parent, r.fk);
    ELSIF r.mode = '0' THEN
      EXECUTE format(
        'UPDATE %I c SET branch = CASE '
        'WHEN p.branch::text ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' '
        'THEN p.branch::text::uuid END, zone = b.zone FROM %I p '
        'LEFT JOIN branches b ON b.id = CASE '
        'WHEN p.branch::text ~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'' '
        'THEN p.branch::text::uuid END '
        'WHERE c.%I = p.id AND (c.branch IS NULL OR c.zone IS NULL)',
        r.child, r.parent, r.fk);
    ELSE
      EXECUTE format(
        'UPDATE %I c SET zone = p.zone FROM %I p '
        'WHERE c.%I = p.id AND c.zone IS NULL',
        r.child, r.parent, r.fk);
    END IF;
  END LOOP;
END
$$;

DROP TABLE afc_child_scope;
