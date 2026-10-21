-- 20261020_0027_groups_multilevel_departments.sql
--
-- Groups 1-4 + multi-level departments (AFC-593, parent AFC-460).
-- Spec authority: issue AFC-593 user org facts 2026-10-21 (area HQ groups
-- 1-4 with leaders; departments at branch, zone and area levels with
-- leaders forming the management team per level), CTO grounding
-- (people_departments junction role=leader is the leadership mechanism),
-- docs/planning/data-model.md §2.2 (departments, branch null = area-wide)
-- + §2.4 (junction), docs/planning/data-model-expansion.md §2 (hierarchy)
-- + §10 (one app identity, scoping in policy + route filters).
--
-- WHAT THIS FILE DOES
--   1. departments.zone + departments.area (nullable FKs, SET NULL): the
--      zone/area scope missing from 0020. A department is addressed at
--      exactly one level -- branch, zone, or area-wide -- enforced by a
--      CHECK. Branch keeps ON DELETE RESTRICT (0020 stated choice 1);
--      zone/area are SET NULL (denorm-style: a zone/area delete clears the
--      scope link, never the department row -- same reasoning as 0002 §10).
--   2. Widens departments.department_type to include 'group' (Area-HQ
--      Groups 1-4 reuse the department machinery -- no parallel table
--      without cause) plus the user-named ministry types missing from the
--      0020 set: 'music', 'security', 'kitchen', 'sanitation',
--      'elementary'. Existing nine values unchanged. 'ushers' stays
--      'ushering', WCS stays 'welfare' (labels, not new enums).
--   3. Seeds Groups 1-4 idempotently: codes LAG-NORTH-GROUP-1..4,
--      department_type 'group', area = LAG-NORTH where that area exists
--      (area-wide by construction: branch NULL, zone NULL). ON CONFLICT
--      (code) DO NOTHING + guarded UPDATEs so reruns change nothing.
--      Leaders are assigned via the junction role=leader (existing write
--      path); this file invents no person rows.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No new table for groups (architecture lens: reusing departments +
--   junction keeps one membership model, one permission surface, one
--   retention story). No seed of the named ministries per level: the user
--   has not confirmed names per level, so ministries stay creatable
--   (widened enum) and only Groups 1-4 are seeded -- per the issue.
--   No new write paths, no DELETE grants, no role provisioning.
--
-- CHOICE, STATED (spec-silent, smallest defensible, named for review)
--   Groups are area-scoped (area = LAG-NORTH) rather than pinned to a
--   single HQ branch row: no HQ branch row exists as a distinct record,
--   and "area HQ" in the user facts is the area level meeting at HQ.
--   If the board later names an HQ branch, moving four rows by code is a
--   data edit, not a model change.
--
-- SECURITY NOTE: this migration touches departments (board-shaped, no
-- personal data in the seed -- place/group names only) and widens the
-- 0020 ceiling by two UPDATE columns (zone, area) for directus_app so the
-- board can scope departments. There is no independent security reviewer
-- on this team (board declined the seat on cost); the CTO self-review of
-- this migration is a recorded degradation, not independent review. Do
-- not treat a green gate as clearance.
--
-- GRANTS (expansion §10 posture: one app identity; scoping lives in the
-- Directus policy + portal route filters, not here). This layer states
-- the ceiling only: directus_app gains INSERT/UPDATE on zone + area;
-- every 0020 grant is otherwise unchanged. No DELETE anywhere.
--
-- Rollback: rollback/20261020_0027_groups_multilevel_departments.down.sql
-- (refuses while any department carries a zone/area link or a group-type
-- row exists; otherwise drops the scope CHECK, restores the 0020 type
-- CHECK, drops the columns). Owner: migration role (directus_migrator).
-- Never run as directus_app. Role hygiene per ADR-0002: this file
-- provisions no roles and grants no role-creation or superuser
-- capability; only GRANT below.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT below -- this file mints no roles (ADR-0002,
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
-- 1. departments.zone + departments.area. ALTER, never CREATE TABLE:
--    departments is owned by 20261020_0020. Only this slice's scope lands
--    here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION
      'departments is missing: 20261020_0020 must be applied before 20261020_0027. '
      'The households/departments register owns this table; this migration only extends it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  ALTER TABLE departments ADD COLUMN IF NOT EXISTS zone uuid;
  ALTER TABLE departments ADD COLUMN IF NOT EXISTS area uuid;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_zone_fkey') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'departments_zone_fkey ensured (zone delete clears the scope link, never the department).';
  ELSE
    RAISE NOTICE 'departments_zone_fkey already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_area_fkey') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_area_fkey
      FOREIGN KEY (area) REFERENCES areas(id) ON DELETE SET NULL;
    RAISE NOTICE 'departments_area_fkey ensured (area delete clears the scope link, never the department).';
  ELSE
    RAISE NOTICE 'departments_area_fkey already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS departments_zone_idx ON departments (zone)
  WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS departments_area_idx ON departments (area)
  WHERE area IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Single-level scope CHECK: a department lives at exactly one level.
--    Area-wide = branch NULL AND zone NULL (area may be set or NULL for
--    back-compat with 0020 rows where branch null already meant area-wide).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_single_scope_check') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_single_scope_check
      CHECK (
        (CASE WHEN branch IS NOT NULL THEN 1 ELSE 0 END
       + CASE WHEN zone IS NOT NULL THEN 1 ELSE 0 END) <= 1
      );
    RAISE NOTICE 'departments_single_scope_check ensured (branch XOR zone; area-wide when both null).';
  ELSE
    RAISE NOTICE 'departments_single_scope_check already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Widen department_type: 'group' + user-named ministries. The 0020 CHECK
--    was inline (auto-named departments_department_type_check); drop that
--    name if present, then ensure the widened named CHECK. A database that
--    already carries the widened CHECK is a no-op.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_department_type_check') THEN
    ALTER TABLE departments DROP CONSTRAINT departments_department_type_check;
    RAISE NOTICE 'departments_department_type_check dropped (superseded by the widened set).';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'departments_type_widened_check') THEN
    ALTER TABLE departments ADD CONSTRAINT departments_type_widened_check
      CHECK (department_type IS NULL OR department_type IN
        ('youth', 'teens', 'worship', 'welfare', 'outreach',
         'children', 'media', 'ushering', 'admin',
         'group', 'music', 'security', 'kitchen', 'sanitation',
         'elementary'));
    RAISE NOTICE 'departments_type_widened_check ensured (0020 nine + group/music/security/kitchen/sanitation/elementary).';
  ELSE
    RAISE NOTICE 'departments_type_widened_check already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. The app scopes departments (zone/area) and
--    reads them for the management-team rollup; erasure never runs through
--    the API. 0020 grants are otherwise unchanged.
-- ---------------------------------------------------------------------------
GRANT INSERT (zone, area) ON departments TO directus_app;
GRANT UPDATE (zone, area) ON departments TO directus_app;

-- ---------------------------------------------------------------------------
-- 5. SEED -- Area-HQ Groups 1-4 (idempotent; ON CONFLICT (code) DO
--    NOTHING). Codes are the identity; the area FK resolves by code
--    subselect (NULL where LAG-NORTH was never seeded -- still area-wide
--    by construction). No personal data: group names only, no emails,
--    phones, or person links. Leaders attach later via the junction
--    role=leader (existing members.post write path).
-- ---------------------------------------------------------------------------
INSERT INTO departments (name, code, department_type, branch, zone, area, description, status) VALUES
  ('Group 1', 'LAG-NORTH-GROUP-1', 'group', NULL, NULL,
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'Area HQ group 1 (AFC-593). Leaders via people_departments role=leader.', 'active'),
  ('Group 2', 'LAG-NORTH-GROUP-2', 'group', NULL, NULL,
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'Area HQ group 2 (AFC-593). Leaders via people_departments role=leader.', 'active'),
  ('Group 3', 'LAG-NORTH-GROUP-3', 'group', NULL, NULL,
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'Area HQ group 3 (AFC-593). Leaders via people_departments role=leader.', 'active'),
  ('Group 4', 'LAG-NORTH-GROUP-4', 'group', NULL, NULL,
   (SELECT id FROM areas WHERE code = 'LAG-NORTH'),
   'Area HQ group 4 (AFC-593). Leaders via people_departments role=leader.', 'active')
ON CONFLICT (code) DO NOTHING;

-- Rerun repair: a row that predates the area seed keeps its code but may
-- carry a NULL area; backfill it without touching names or leaders.
UPDATE departments SET area = (SELECT id FROM areas WHERE code = 'LAG-NORTH')
 WHERE code IN ('LAG-NORTH-GROUP-1', 'LAG-NORTH-GROUP-2',
                'LAG-NORTH-GROUP-3', 'LAG-NORTH-GROUP-4')
   AND area IS NULL
   AND EXISTS (SELECT 1 FROM areas WHERE code = 'LAG-NORTH');
