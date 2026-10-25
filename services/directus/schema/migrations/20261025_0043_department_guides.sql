-- 20261025_0043_department_guides.sql
--
-- Department guides (AFC-800, parent AFC-759: per-group workflows and guides
-- on departments).
--
-- Spec authority: AFC-800 §§A-D (table department_guides, Nuxt server routes
-- GET/POST/PATCH under /api/departments/:id/guides, Guides tab on the
-- department page, contract tests/web/department-guides.contract.mjs).
--
-- WHAT THIS FILE CREATES (verified: no department_guides object exists in
-- services/directus/schema/):
--   department_guides -- one instructional row per department, ordered by
--     (sort_order, id):
--     id           uuid PK DEFAULT gen_random_uuid()
--     department   uuid NOT NULL REFERENCES departments(id) ON DELETE RESTRICT
--                    (a department with guides is never deleted by accident;
--                    same reasoning as 0020 stated choice 1)
--     title        text NOT NULL CHECK (btrim(title) <> '')
--     body         text NOT NULL DEFAULT '' (Markdown, rendered through the
--                    shared XSS-safe renderer; raw HTML never reaches v-html)
--     sort_order   int NOT NULL DEFAULT 0
--     created_by   uuid NULL (the staff user that wrote the row; no FK --
--                    directus_users is not in this schema)
--     created_at / updated_at timestamptz NOT NULL DEFAULT now()
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No DELETE path anywhere: guides are department facts and unlink-style
--   history is kept by never deleting (retention posture, AFC-800 §B: NO
--   DELETE route, NO GRANT DELETE). No RLS/policy rows: branch scoping lives
--   in the Directus policy + portal route filters (departmentScopeFilter),
--   not here -- same posture as 0020/0027.
--
-- IDEMPOTENCY (0041 precedent): CREATE TABLE IF NOT EXISTS, then
-- per-column ALTER TABLE ... ADD COLUMN IF NOT EXISTS, per-constraint
-- fixed-name guards, CREATE INDEX IF NOT EXISTS. A re-run converges and
-- changes nothing.
--
-- SECURITY NOTE: this migration touches departments (board-shaped) and adds
-- an app-writable content table that holds instructional text only -- no
-- names, no contact details, no personal data. It widens the 0020 ceiling
-- by SELECT + scoped INSERT/UPDATE on department_guides alone; no DELETE
-- anywhere. There is no independent security reviewer on this team (board
-- declined the seat on cost); the CTO self-review of this migration is a
-- recorded degradation, not independent review. Do not treat a green gate
-- as clearance.
--
-- GRANTS (expansion §10 posture: one app identity; branch scoping lives in
-- the Directus policy + portal route filters, not here). This layer states
-- the ceiling only: directus_app reads guides, inserts the four
-- route-written columns, updates title/body/sort_order/updated_at; it
-- deletes nothing. REVOKE ALL ON department_guides FROM PUBLIC is
-- re-asserted (defence in depth; 0040 precedent).
--
-- Rollback: rollback/20261025_0043_department_guides.down.sql (refuses while
-- any row exists -- guides are department facts with no legacy copy; empty
-- rolls back, then the forward file re-applies). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation or
-- superuser capability; only GRANT/REVOKE below.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0041
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
-- 1. department_guides. departments is owned by 20261020_0020 (scope
--    columns by 20261020_0027); only the guides table lands here.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION
      'departments is missing: 20261020_0020 must be applied before 20261025_0043. '
      'That migration owns this table; this migration only references it.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  CREATE TABLE IF NOT EXISTS department_guides (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    department   uuid NOT NULL,
    title        text NOT NULL,
    body         text NOT NULL DEFAULT '',
    sort_order   integer NOT NULL DEFAULT 0,
    created_by   uuid NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
  );

  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS department uuid;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS title text;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS body text;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS sort_order integer;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS created_by uuid;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS created_at timestamptz;
  ALTER TABLE department_guides ADD COLUMN IF NOT EXISTS updated_at timestamptz;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_guides_department_fkey') THEN
    ALTER TABLE department_guides ADD CONSTRAINT department_guides_department_fkey
      FOREIGN KEY (department) REFERENCES departments(id) ON DELETE RESTRICT;
    RAISE NOTICE 'department_guides_department_fkey ensured (a department with guides is never deleted by accident).';
  ELSE
    RAISE NOTICE 'department_guides_department_fkey already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'department_guides_title_check') THEN
    ALTER TABLE department_guides ADD CONSTRAINT department_guides_title_check
      CHECK (btrim(title) <> '');
    RAISE NOTICE 'department_guides_title_check ensured (blank titles are refused, not trimmed silently).';
  ELSE
    RAISE NOTICE 'department_guides_title_check already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS department_guides_department_sort_idx
  ON department_guides (department, sort_order, id);

-- ---------------------------------------------------------------------------
-- 2. Least-privilege ceiling. The app reads guides, writes the four
--    route-written columns, and refreshes updated_at on edit; it deletes
--    nothing (retention posture: no DELETE route, no DELETE grant).
-- ---------------------------------------------------------------------------
GRANT SELECT ON department_guides TO directus_app;

GRANT INSERT (department, title, body, sort_order)
  ON department_guides TO directus_app;
GRANT UPDATE (title, body, sort_order, updated_at)
  ON department_guides TO directus_app;

REVOKE ALL ON department_guides FROM PUBLIC;
