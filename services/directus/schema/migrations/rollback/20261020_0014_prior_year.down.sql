-- rollback/20261020_0014_prior_year.down.sql
--
-- Reversal for 20261020_0014_prior_year.sql. AFC-485 / AFC-465c.
--
-- What it destroys, stated plainly:
--   prior_year_import_items  -- per-row import detail (child).
--   prior_year_imports       -- import batches.
-- Parent tables (branches/zones/...) are never touched: this migration never
-- created them (branch/zone on items are bare scope copies). No CASCADE: a
-- hidden dependency must fail loudly, not vanish silently. No trigger or
-- function is created by the forward file, so the rollback-control gate has
-- only drops of objects this same migration created to reconcile.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back an import history that holds rows.
--
-- Import batches are the audit trail of what entered the database and when.
-- Empty tables roll back; anything else needs a verified copy first and a
-- reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_batches integer; v_items integer;
BEGIN
  SELECT count(*) INTO v_batches FROM prior_year_imports;
  SELECT count(*) INTO v_items FROM prior_year_import_items;

  IF v_batches > 0 OR v_items > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back prior_year imports: prior_year_imports holds % row(s) and prior_year_import_items holds % row(s). These are the audit trail of imported data. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_batches, v_items
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'prior_year rollback proceeding: no batches or items. Re-apply 20261020_0014 to restore the tables.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables in dependency order: items (child) before imports.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS prior_year_import_items;
DROP TABLE IF EXISTS prior_year_imports;
