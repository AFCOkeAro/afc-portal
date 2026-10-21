-- rollback/20261020_0027_groups_multilevel_departments.down.sql
--
-- Reversal for 20261020_0027_groups_multilevel_departments.sql (AFC-593).
--
-- REFUSES (fail closed, no partial unpick) while any department carries a
-- zone/area scope link or any group/music/security/kitchen/sanitation/
-- elementary-typed row exists: dropping the columns or narrowing the CHECK
-- under live rows would destroy scope facts or orphan board rows. Empty
-- the scope links and remove the seeded groups first (codes
-- LAG-NORTH-GROUP-1..4), then re-run.
--
-- Otherwise: drops the single-scope CHECK, restores the 0020 nine-value
-- type CHECK, drops the zone/area FKs + columns + indexes. The Group 1-4
-- seed rows are expected to be gone already (the refuse guard above); this
-- script deletes nothing itself.
--
-- Owner: migration role (directus_migrator). Never run as directus_app.

DO $$
DECLARE
  v_scoped integer;
  v_typed integer;
BEGIN
  IF to_regclass('public.departments') IS NULL THEN
    RAISE NOTICE 'departments not present: nothing to roll back.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_scoped FROM departments
   WHERE zone IS NOT NULL OR area IS NOT NULL;
  IF v_scoped > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back groups/multilevel departments: % department row(s) carry a zone/area scope link. '
      'Clear the links first (reviewed data edit), then re-run. Nothing was dropped.',
      v_scoped
      USING ERRCODE = 'restrict_violation';
  END IF;

  SELECT count(*) INTO v_typed FROM departments
   WHERE department_type IN
    ('group', 'music', 'security', 'kitchen', 'sanitation', 'elementary');
  IF v_typed > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back groups/multilevel departments: % department row(s) use the widened types '
      '(group/music/security/kitchen/sanitation/elementary, incl. seeded Groups 1-4). '
      'Remove or retype them first (reviewed data edit), then re-run. Nothing was dropped.',
      v_typed
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_single_scope_check;
  ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_type_widened_check;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_department_type_check') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_department_type_check
      CHECK (department_type IS NULL OR department_type IN
        ('youth', 'teens', 'worship', 'welfare', 'outreach',
         'children', 'media', 'ushering', 'admin'));
    RAISE NOTICE '0020 department_type CHECK restored.';
  END IF;

  ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_zone_fkey;
  ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_area_fkey;
  ALTER TABLE departments DROP COLUMN IF EXISTS zone;
  ALTER TABLE departments DROP COLUMN IF EXISTS area;
  DROP INDEX IF EXISTS departments_zone_idx;
  DROP INDEX IF EXISTS departments_area_idx;

  RAISE NOTICE 'groups/multilevel rollback proceeding: scope links empty, widened types absent. Re-apply 20261020_0027 to get them back.';
END
$$;
