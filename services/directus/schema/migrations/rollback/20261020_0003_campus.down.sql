-- rollback/20261020_0003_campus.down.sql
--
-- Reversal for 20261020_0003_campus.sql. AFC-483 / AFC-465a.
--
-- What it destroys, stated plainly:
--   campus_students, coaching_programmes, coaching_timetable,
--   coaching_facilitators, coaching_students, coaching_class_attendance,
--   coaching_progress, exam_results, coaching_resources,
--   coaching_feedback, campus_financial_support, nysc_status_transitions --
--   the Slice 5a campus tables INCLUDING the two seeded institutions'
--   student rows (the institutions themselves are NOT dropped -- see below)
--   and the eight seeded NYSC edges.
--
-- What it deliberately does NOT destroy:
--   campus_institutions and its §7.1 columns/index. The table belongs to
--   20261020_0002 (its down script drops it); the §7.1 columns were an ALTER
--   onto a live reference table, and widening a live table is not reversed
--   by dropping columns Directus rows may use (the 0012 people precedent).
--   Parent tables (people/branches/zones/areas) are never touched: this
--   migration never created them; the conditional FKs die with the tables
--   that carry them, so there is nothing to drop separately.
--
-- ORDER: refuse first (while any created table holds rows -- seeds count, so
-- a seeded database clears the reference rows in a reviewed step first, the
-- 0002 Lagos North posture), then tables in dependency order (children
-- before parents). No CASCADE: a hidden dependency must fail loudly, not
-- vanish silently. No trigger/function is created by the forward file, so
-- the rollback-control gate has only drops of objects this same migration
-- created to reconcile (F1: each referent goes in this same script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back campus tables that hold rows.
--
-- Campus rows hold minors' PII and financial facts. Empty tables roll back;
-- anything else needs a verified copy first and a reviewed step, not this
-- script. Seed rows count: the eight NYSC edges and any student rows block
-- until a reviewed step clears them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_students integer; v_programmes integer; v_timetable integer;
  v_facilitators integer; v_enrol integer; v_attendance integer;
  v_progress integer; v_results integer; v_resources integer;
  v_feedback integer; v_support integer; v_transitions integer;
BEGIN
  SELECT count(*) INTO v_students FROM campus_students;
  SELECT count(*) INTO v_programmes FROM coaching_programmes;
  SELECT count(*) INTO v_timetable FROM coaching_timetable;
  SELECT count(*) INTO v_facilitators FROM coaching_facilitators;
  SELECT count(*) INTO v_enrol FROM coaching_students;
  SELECT count(*) INTO v_attendance FROM coaching_class_attendance;
  SELECT count(*) INTO v_progress FROM coaching_progress;
  SELECT count(*) INTO v_results FROM exam_results;
  SELECT count(*) INTO v_resources FROM coaching_resources;
  SELECT count(*) INTO v_feedback FROM coaching_feedback;
  SELECT count(*) INTO v_support FROM campus_financial_support;
  SELECT count(*) INTO v_transitions FROM nysc_status_transitions;

  IF v_students > 0 OR v_programmes > 0 OR v_timetable > 0
     OR v_facilitators > 0 OR v_enrol > 0 OR v_attendance > 0
     OR v_progress > 0 OR v_results > 0 OR v_resources > 0
     OR v_feedback > 0 OR v_support > 0 OR v_transitions > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back campus: students=%, programmes=%, timetable=%, facilitators=%, enrolments=%, attendance=%, progress=%, results=%, resources=%, feedback=%, support=%, transitions=% row(s). These are campus ministry records (some hold minors'' PII) including the seeded NYSC edges. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_students, v_programmes, v_timetable, v_facilitators, v_enrol,
      v_attendance, v_progress, v_results, v_resources, v_feedback,
      v_support, v_transitions
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'campus rollback proceeding: no campus rows. The two seeded institutions stay in campus_institutions (owned by 20261020_0002) -- re-apply 20261020_0003 to restore the tables.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables in dependency order: leaves before the tables they reference.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS coaching_feedback;
DROP TABLE IF EXISTS coaching_resources;
DROP TABLE IF EXISTS exam_results;
DROP TABLE IF EXISTS coaching_progress;
DROP TABLE IF EXISTS coaching_class_attendance;
DROP TABLE IF EXISTS coaching_students;
DROP TABLE IF EXISTS coaching_facilitators;
DROP TABLE IF EXISTS coaching_timetable;
DROP TABLE IF EXISTS campus_financial_support;
DROP TABLE IF EXISTS campus_students;
DROP TABLE IF EXISTS coaching_programmes;
DROP TABLE IF EXISTS nysc_status_transitions;
