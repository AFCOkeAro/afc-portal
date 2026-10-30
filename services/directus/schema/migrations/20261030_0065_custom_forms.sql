-- Migration 0065: custom forms register (AFC-897, chairman ask
-- 2026-10-29).
--
-- WHAT THIS CREATES (verified: no custom_forms table exists in
-- services/directus/schema/migrations/):
--   custom_forms -- one row per staff-built form: a name, the linked
--   module (one of the seven v1 collections below), and a schema jsonb
--   holding the ordered field list. Phase 1 only: register + builder +
--   render. Versioning and approvals are explicitly later, so definitions
--   are immutable except delete (recreate to revise; each revision is a
--   distinct row, never a silent rewrite).
--
-- WHY A jsonb SCHEMA, NOT A FIELDS TABLE. The field list is a form
-- definition, not relational data: it is read whole, written whole, and
-- never joined. A child table would buy join semantics nobody queries and
-- a second rollback surface. The route owns field validity (keys must be
-- live DB columns of the linked module, required coverage of the
-- NOT NULL-no-default columns enforced at create time); the DB owns only
-- the closed module vocabulary, the shape (object with a fields array),
-- and the (module, name) dedup.
--
-- WHY THE MODULE VOCABULARY IS CLOSED AT SEVEN. Each linked module needs
-- a renderer mount and a submission path the generic route can write
-- safely. Events (multi-step programme create) and marriage (matter/case
-- duality) need per-module handling and stay out of v1; the route refuses
-- them with 400 rather than half-supporting them.
--
-- NO FOREIGN KEY ON module: a module is a collection name, not a row.
-- NO BRANCH/ZONE DENORM: definitions are global taxonomy (the expense
-- categories precedent), not branch data; reads are staff-wide, writes
-- ride the area-only routes.
--
-- GRANTS (0060 precedent): directus_app SELECTs; INSERT on the definition
-- columns; UPDATE on name/schema only (module is locked after create --
-- re-homing a definition orphans its renders); DELETE for withdrawal.
-- REVOKE PUBLIC. No roles provisioned (ADR-0002).
--
-- Rollback: rollback/20261030_0065_custom_forms.down.sql (refuses while
-- rows exist; drops the table). Owner: migration role
-- (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
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
-- 1. OWNERSHIP PRECONDITION. Brand-new register: fail closed if a leftover
--    table from a failed apply is owned by someone else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('custom_forms')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the custom forms register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. custom_forms. One row per definition: name unique within its module.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_forms (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL CHECK (btrim(name) <> ''),
  module               text NOT NULL CHECK (
    module IN ('visitors', 'people', 'households', 'welfare_cases',
               'blessings', 'announcements', 'tasks')
  ),
  schema               jsonb NOT NULL DEFAULT '{"version":1,"fields":[]}',
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_forms_name_once UNIQUE (module, name),
  CONSTRAINT custom_forms_schema_shape CHECK (
    jsonb_typeof(schema) = 'object'
    AND (schema -> 'fields') IS NOT NULL
    AND jsonb_typeof(schema -> 'fields') = 'array'
  )
);

COMMENT ON TABLE custom_forms IS
  'AFC-897: staff-built form definitions. One row per form: name unique '
  'within its linked module, schema jsonb holds the ordered field list '
  '(keys are live DB columns of the module, enforced route-side). Phase 1 '
  'only: no versioning, no approvals. Definitions are immutable except '
  'delete; module is locked after create.';

CREATE INDEX IF NOT EXISTS custom_forms_module_idx
  ON custom_forms (module);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT on the definition
--    columns; UPDATE on name/schema (module locked); DELETE for
--    withdrawal. REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON custom_forms TO directus_app;
GRANT INSERT (name, module, schema, created_by)
  ON custom_forms TO directus_app;
GRANT UPDATE (name, schema)
  ON custom_forms TO directus_app;
GRANT DELETE ON custom_forms TO directus_app;

REVOKE ALL ON custom_forms FROM PUBLIC;
