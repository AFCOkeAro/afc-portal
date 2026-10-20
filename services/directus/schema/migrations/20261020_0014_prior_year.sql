-- 20261020_0014_prior_year.sql
--
-- Prior-year import ledger (Slice 5c). AFC-485 / AFC-465c, spec authority
-- docs/planning/prd-expansion.md §9.2 (US-U2/US-A4),
-- docs/planning/data-model-expansion.md §13 (`prior_year.import`),
-- docs/planning/integrations-spec.md §9, ADR-0010 decision 3.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no prior_year_imports / prior_year_import_items table exists in
-- services/directus/schema/migrations/):
--   prior_year_imports       -- one row per uploaded file: domain, source =
--                             'import', data_year, filename, received/imported/
--                             updated/skipped/error counts, imported_by,
--                             imported_at, status.
--   prior_year_import_items  -- one row per received data row: the natural key
--                             (ADR-0010 decision 3), branch/zone scope copy,
--                             target_collection + target_id link, per-row status
--                             and error text.
--
-- CHOICE, STATED (issue: "mark rows source=import"): provenance lives HERE,
-- not as new columns on the domain tables. Adding `source`/`data_year` to
-- `people` or `branch_financial_records` touches personal-data tables and
-- needs a CTO-approved migration of its own; this ledger is the smallest
-- option that still makes every imported row attributable (batch + item +
-- target link) and comparable (data_year + branch/zone scope copy for the
-- compare views). The forward route writes the ledger on every import; the
-- compare views read it for the prior-year side.
--
-- CHOICE, STATED (no raw PII in the ledger): items carry NO name, phone, or
-- email column. The people natural key is the SHA-256 identity hash the
-- route computes (name+phone/email normalised -- integrations-spec §9
-- dedupe); the ledger stores only that hash in `natural_key`. A ledger dump
-- therefore cannot re-identify anyone, which is what keeps this migration
-- out of the personal-data approval path. Asserted in suite 81 §81.7.
--
-- CHOICE, STATED (natural-key uniqueness): UNIQUE (import, natural_key) --
-- one item per key per batch. A re-imported file lands as a NEW batch whose
-- items reference the SAME domain rows (zero new domain rows: the domain
-- upserts rest on the pre-existing unique keys (branch,month),
-- (branch,period), (session,category,sex) pinned by suites 68/71, plus the
-- route's read-then-write for blessings/people). The ledger never invents a
-- cross-domain uniqueness it cannot enforce.
--
-- CHOICE, STATED (no CASCADE): items reference their batch RESTRICT -- a
-- batch with items is not deleted by accident, and the down script refuses
-- while either table holds rows. target_id is a bare uuid (polymorphic
-- across four domains; no FK to invent). branch/zone are bare uuids (the
-- hierarchy slice owns those tables; a conditional FK would couple slices
-- for a scope copy the routes already filter).
--
-- GRANTS (expansion §10 posture: Postgres sees one app identity; branch/zone
-- scoping lives in the Directus policy + portal route filters, not here):
-- directus_app gets SELECT everywhere, INSERT/UPDATE on operational columns,
-- NO DELETE on either table (import history is audit; reversal is a reviewed
-- migrator step, integrations-spec §9 "reversible by batch").
--
-- Rollback: rollback/20261020_0014_prior_year.down.sql (refuses while either
-- table holds rows; drops in dependency order, no CASCADE).
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
-- 1. prior_year_imports -- one row per uploaded file (the batch).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prior_year_imports (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text NOT NULL
                   CHECK (domain IN ('attendance', 'blessings', 'people', 'finance')),
  source         text NOT NULL DEFAULT 'import' CHECK (source = 'import'),
  data_year      integer CHECK (data_year BETWEEN 2000 AND 2100),
  filename       text,
  received_rows  integer NOT NULL DEFAULT 0 CHECK (received_rows >= 0),
  imported_rows  integer NOT NULL DEFAULT 0 CHECK (imported_rows >= 0),
  updated_rows   integer NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  skipped_rows   integer NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  error_rows     integer NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  imported_by    uuid,
  status         text NOT NULL DEFAULT 'received'
                   CHECK (status IN ('received', 'partial', 'committed', 'failed')),
  imported_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE prior_year_imports IS
  'Prior-year CSV import batches (AFC-485, US-U2). One row per uploaded file; source is always import. Per-row detail lives in prior_year_import_items. imported_by is a bare uuid (Directus users are owned elsewhere).';

CREATE INDEX IF NOT EXISTS prior_year_imports_domain_year_idx
  ON prior_year_imports (domain, data_year);

-- ---------------------------------------------------------------------------
-- 2. prior_year_import_items -- one row per received data row.
--
-- natural_key carries the ADR-0010 decision-3 key per domain:
-- attendance (BRANCH|date|service|category), blessings
-- (BRANCH|date|type|label), people (SHA-256 identity hash -- never raw PII),
-- finance (BRANCH|month). UNIQUE (import, natural_key): one item per key per
-- batch; a re-import is a new batch over the same domain rows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prior_year_import_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import            uuid NOT NULL REFERENCES prior_year_imports(id) ON DELETE RESTRICT,
  domain            text NOT NULL
                      CHECK (domain IN ('attendance', 'blessings', 'people', 'finance')),
  source            text NOT NULL DEFAULT 'import' CHECK (source = 'import'),
  data_year         integer CHECK (data_year BETWEEN 2000 AND 2100),
  row_number        integer NOT NULL CHECK (row_number >= 1),
  natural_key       text NOT NULL,
  branch            uuid,
  zone              uuid,
  target_collection text,
  target_id         uuid,
  status            text NOT NULL DEFAULT 'imported'
                      CHECK (status IN ('imported', 'updated', 'skipped', 'error')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prior_year_import_items_import_key_unique UNIQUE (import, natural_key)
);

COMMENT ON TABLE prior_year_import_items IS
  'Per-row prior-year import detail (AFC-485). natural_key is the idempotency key; for people it is a SHA-256 identity hash, never a name/phone/email (no PII column exists on this table by design). branch/zone are scope copies for the compare views. target_id is a bare uuid across four domains.';

CREATE INDEX IF NOT EXISTS prior_year_import_items_import_idx
  ON prior_year_import_items (import);
CREATE INDEX IF NOT EXISTS prior_year_import_items_year_status_idx
  ON prior_year_import_items (data_year, status);
CREATE INDEX IF NOT EXISTS prior_year_import_items_branch_idx
  ON prior_year_import_items (branch) WHERE branch IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Grants: the app ceiling. SELECT everywhere, INSERT/UPDATE on operational
--    columns, NO DELETE on either table (import history is audit; reversal is
--    a reviewed migrator step). source is server-set: absent from the write
--    lists so the app cannot mark a manual row as an import (it defaults).
-- ---------------------------------------------------------------------------
GRANT SELECT ON prior_year_imports TO directus_app;
GRANT INSERT (domain, data_year, filename, received_rows, imported_rows,
  updated_rows, skipped_rows, error_rows, imported_by, status)
  ON prior_year_imports TO directus_app;
GRANT UPDATE (filename, received_rows, imported_rows, updated_rows,
  skipped_rows, error_rows, status, updated_at)
  ON prior_year_imports TO directus_app;

GRANT SELECT ON prior_year_import_items TO directus_app;
GRANT INSERT (import, domain, data_year, row_number, natural_key, branch,
  zone, target_collection, target_id, status, error)
  ON prior_year_import_items TO directus_app;
GRANT UPDATE (target_id, status, error)
  ON prior_year_import_items TO directus_app;

REVOKE ALL ON prior_year_imports FROM PUBLIC;
REVOKE ALL ON prior_year_import_items FROM PUBLIC;
