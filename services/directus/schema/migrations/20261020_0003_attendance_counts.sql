-- 20261020_0003_attendance_counts.sql
--
-- Attendance sex/category split (Slice 1c). AFC-468 / AFC-461c, spec authority
-- docs/planning/data-model-expansion.md §3 and docs/planning/prd-expansion.md §2
-- (US-A1..A4).
--
-- WHAT THIS FILE CREATES
--   service_type_definitions -- which categories apply per service type (§3.1).
--   attendance_counts        -- one row per (session, category, sex) (§3.3).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   attendance_sessions. No earlier file in this history creates it (verified:
--   0002 only touches it conditionally and suite 70 pins its absence from the
--   scratch DB), and the session header belongs to the capture slice that owns
--   the Directus collection. Creating it here would fork a table another slice
--   is about to own -- the exact defect 0002's conditional blocks exist to
--   avoid. So this file follows the 0001->0002 WECA pattern instead:
--     * attendance_counts.session is a bare uuid (no FK), with a merge
--       contract below: the sessions-owning migration adds the FK and must not
--       fork this table.
--     * the denorm column this slice needs (service_type_def) lands
--       conditionally (§2): added where the host table exists, skipped loudly
--       where it does not. The zone/bsc denorm columns already landed the same
--       way in 0002 §10.
--
-- BACKFILL (legacy five columns -> child rows)
--   prd-expansion §2.2 names the old five columns adults/youth/teens/children/
--   visitors. The §backfill block maps exactly those columns to category rows
--   with sex = 'unspecified' (historical rows stay valid, shown as unsplit),
--   each column guarded by an information_schema check so a sessions table
--   without a given legacy column skips that column loudly instead of failing.
--   headcount_men/headcount_women are DELIBERATELY NOT mapped: they are already
--   a sex split with no category attribution, and inventing one would corrupt
--   the category breakdown the report groups by. They stay readable so the
--   existing headcount routes keep working.
--
-- TOTAL = SUM(count) (Flow-maintained, no opaque triggers)
--   The session total is written by the documented Flow `attendance.total`
--   (docs/planning/attendance-flows.md §2): the sum of the child rows where
--   split rows exist, else the legacy headcount_total. This file installs no
--   trigger and no function: denorm via Flow (§13), same as the hierarchy
--   denorm in 0002.
--
-- IDEMPOTENT CAPTURE (US-A1 AC3)
--   Retry safety is a uniqueness property, not a code path: UNIQUE
--   (session, category, sex) turns a replayed capture batch into a set of
--   ON CONFLICT DO UPDATE no-ops instead of duplicate rows. Suite 71 pins it.
--
-- GRANTS (expansion §10, column 11.1): Postgres sees one app identity, so
--   branch/zone scoping lives in the Directus policy + portal route filters,
--   not here. This layer states the ceiling only: directus_app gets SELECT
--   everywhere, INSERT/UPDATE on operational columns, NO DELETE on either
--   table (attendance facts are audited; a bad capture is corrected by UPDATE,
--   never silently removed). Definitions are board config: the app may INSERT
--   (including `key`, so the board can add a service type) and UPDATE the
--   descriptive columns, so category sets evolve without a migration; `key` is
--   never updatable (it is the identity other rows resolve by) and nothing is
--   deletable (a retired service type goes status = 'inactive').
--
-- SEED: the eleven service_type keys from §3.1, idempotent via
--   ON CONFLICT (key) DO NOTHING, so board edits to labels/categories via the
--   app are never overwritten by a rerun. `requires_bsc` is false on every
--   seed row: the column exists so the board can mark BSC-level services, and
--   inventing which services those are would be guessing at board policy, not
--   seeding it. Category sets below are the ordered sets the capture form
--   renders; only sunday_school's set is pinned by the spec example.
--
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
-- 1. service_type_definitions (§3.1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_type_definitions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text NOT NULL UNIQUE,
  label             text NOT NULL,
  categories        jsonb NOT NULL
                      CHECK (jsonb_typeof(categories) = 'array'),
  supports_sex_split boolean NOT NULL DEFAULT true,
  requires_bsc      boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE service_type_definitions IS
  'Which categories apply per service type (data-model-expansion §3.1, AFC-468). Board config: the capture form renders exactly the ordered category keys in `categories`.';

CREATE INDEX IF NOT EXISTS service_type_definitions_status_idx
  ON service_type_definitions (status);

-- ---------------------------------------------------------------------------
-- 2. Conditional denorm on the sessions table owned elsewhere.
--    Runs only where the table exists; otherwise a NOTICE names the Directus
--    field spec that remains the authority
--    (docs/planning/attendance-flows.md). No table is created here that
--    another slice owns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping service_type_def denorm: attendance_sessions not present. Directus field service_type_def (M2O service_type_definitions, nullable) per attendance-flows.md §1; the sessions-owning slice adds it with the table.';
  ELSE
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS service_type_def uuid REFERENCES service_type_definitions(id) ON DELETE SET NULL;
    RAISE NOTICE 'attendance_sessions.service_type_def ensured.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. attendance_counts (§3.3, the sex/category split).
--
-- MERGE CONTRACT (the 0001->0002 WECA pattern): `session` is a bare uuid
-- until the sessions-owning migration lands. That migration must
--   ALTER TABLE attendance_counts ADD CONSTRAINT attendance_counts_session_fkey
--   FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE CASCADE;
-- (a count is a fact about its session and is meaningless without it), and it
-- must not fork this table. The constraint name is fixed here so the owning
-- slice and the contract test agree on it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_counts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session              uuid NOT NULL,
  category             text NOT NULL
                         CHECK (category IN
                           ('children', 'teens', 'adults', 'youth', 'teachers',
                            'ministers', 'altar_workers', 'avs', 'visitors', 'other')),
  category_other_label text,
  sex                  text NOT NULL DEFAULT 'unspecified'
                         CHECK (sex IN ('male', 'female', 'unspecified')),
  count                integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  created_by           uuid REFERENCES people(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_counts_other_needs_label
    CHECK (category <> 'other'
           OR (category_other_label IS NOT NULL
               AND btrim(category_other_label) <> '')),
  CONSTRAINT attendance_counts_session_category_sex_unique
    UNIQUE (session, category, sex)
);

COMMENT ON TABLE attendance_counts IS
  'Sex/category split rows (data-model-expansion §3.3, AFC-468). One row per (session, category, sex); the unique constraint is what makes a capture retry idempotent. Historical unsplit rows use sex = unspecified. session is a bare uuid until the sessions-owning slice adds attendance_counts_session_fkey (see merge contract above).';

CREATE INDEX IF NOT EXISTS attendance_counts_session_idx
  ON attendance_counts (session);
CREATE INDEX IF NOT EXISTS attendance_counts_category_idx
  ON attendance_counts (category);

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    attendance facts are audited; corrections are UPDATEs and removals are a
--    reviewed migrator step.
-- ---------------------------------------------------------------------------
GRANT SELECT ON service_type_definitions TO directus_app;
GRANT SELECT ON attendance_counts TO directus_app;

GRANT INSERT (key, label, categories, supports_sex_split, requires_bsc, status) ON service_type_definitions TO directus_app;
GRANT UPDATE (label, categories, supports_sex_split, requires_bsc, status) ON service_type_definitions TO directus_app;

GRANT INSERT (session, category, category_other_label, sex, count, created_by) ON attendance_counts TO directus_app;
GRANT UPDATE (session, category, category_other_label, sex, count, created_by) ON attendance_counts TO directus_app;

REVOKE ALL ON service_type_definitions FROM PUBLIC;
REVOKE ALL ON attendance_counts FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 5. SEED — the eleven service-type keys from §3.1 (idempotent;
--    ON CONFLICT (key) DO NOTHING, so board edits to labels/categories via
--    the app are never overwritten by a rerun).
-- ---------------------------------------------------------------------------
INSERT INTO service_type_definitions (key, label, categories, supports_sex_split, requires_bsc, status) VALUES
  ('sunday_school', 'Sunday School',
    '["children", "teens", "adults", "teachers"]', true, false, 'active'),
  ('elementary', 'Elementary',
    '["children", "teachers"]', true, false, 'active'),
  ('devotional', 'Devotional',
    '["adults", "youth", "ministers"]', true, false, 'active'),
  ('youth_service', 'Youth Service',
    '["youth", "teens", "ministers"]', true, false, 'active'),
  ('revival_service', 'Revival Service',
    '["adults", "youth", "teens", "children", "ministers", "altar_workers", "visitors"]', true, false, 'active'),
  ('sunday_service', 'Sunday Service',
    '["adults", "youth", "teens", "children", "ministers", "altar_workers", "avs", "visitors", "other"]', true, false, 'active'),
  ('midweek', 'Midweek Service',
    '["adults", "youth", "ministers", "visitors"]', true, false, 'active'),
  ('event', 'Event',
    '["adults", "youth", "teens", "children", "visitors", "other"]', true, false, 'active'),
  ('camp', 'Camp',
    '["children", "teens", "youth", "adults", "teachers", "ministers", "altar_workers", "visitors"]', true, false, 'active'),
  ('department', 'Department Meeting',
    '["adults", "youth", "ministers", "visitors"]', true, false, 'active'),
  ('special', 'Special Programme',
    '["adults", "youth", "teens", "children", "teachers", "ministers", "altar_workers", "avs", "visitors", "other"]', true, false, 'active')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. BACKFILL — legacy five columns into child rows (sex = unspecified).
--    Per-column guards: a sessions table without a given legacy column skips
--    that column loudly instead of failing; a missing sessions table skips the
--    whole block loudly (the owning slice re-runs this file on first apply --
--    every statement here is rerunnable, so the backfill fires then).
--    Rerunnable: ON CONFLICT (session, category, sex) DO NOTHING, so a second
--    run inserts nothing. NULL and zero headcounts insert nothing (no row for
--    nothing).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c record;
BEGIN
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'attendance backfill: attendance_sessions not present, skipping (the owning slice re-runs this migration when the table lands).';
    RETURN;
  END IF;

  FOR c IN
    SELECT * FROM (VALUES
      ('headcount_adults',   'adults'),
      ('headcount_youth',    'youth'),
      ('headcount_teens',    'teens'),
      ('headcount_children', 'children'),
      ('headcount_visitors', 'visitors')
    ) AS map(headcount_col, category_key)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'attendance_sessions'
         AND column_name = c.headcount_col
    ) THEN
      EXECUTE format(
        'INSERT INTO attendance_counts (session, category, sex, count) '
        'SELECT id, %L, %L, %I '
        'FROM attendance_sessions WHERE %I IS NOT NULL AND %I > 0 '
        'ON CONFLICT (session, category, sex) DO NOTHING',
        c.category_key, 'unspecified', c.headcount_col,
        c.headcount_col, c.headcount_col);
      RAISE NOTICE 'attendance backfill: % -> category % (sex unspecified).', c.headcount_col, c.category_key;
    ELSE
      RAISE NOTICE 'attendance backfill: column % absent, skipping (no legacy data to map).', c.headcount_col;
    END IF;
  END LOOP;
END
$$;
