-- tests/db/81_prior_year_import.sql
--
-- AFC-485 / AFC-465c. THE PRIOR-YEAR IMPORT CONTRACT.
--
-- ADR-0010 decision 3: one CSV template per domain, server-side validation,
-- per-row error report, idempotent natural keys, source-marked comparable
-- rows; re-import in CI must produce zero new rows (idempotency is a test,
-- not a claim).
--
-- What this suite asserts (the database half -- the half a crafted HTTP
-- request cannot change):
--
--   81.1  tables        -- prior_year_imports + prior_year_import_items exist
--                         with the ledger shapes; source defaults to import.
--   81.2  rerun         -- re-applying 20261020_0014 changes nothing
--                         (IF NOT EXISTS everywhere; counts identical).
--   81.3  finance       -- re-importing (LEGUN, 2025-10-01) inserts zero new
--                         rows (ON CONFLICT DO NOTHING); changed values
--                         converge to one row with the latest figures
--                         (ON CONFLICT DO UPDATE -- the SQL half of the
--                         route's read-then-write).
--   81.4  returns       -- re-importing (LEGUN, 2025-10) inserts zero new
--                         return rows; the natural key is (branch, period).
--   81.5  attendance    -- replaying (session, category, sex) inserts zero
--                         new count rows; corrected figures converge
--                         (suite 71 §71.5 pins the constraint; here it is the
--                         import idempotency key).
--   81.6  ledger        -- UNIQUE (import, natural_key): a duplicate item in
--                         one batch is refused; the same key in a NEW batch
--                         is accepted (a re-import is a new batch over the
--                         same domain rows, not a twin); items RESTRICT their
--                         batch (a batch with items is not deleted by accident).
--   81.7  no-pii        -- the items table carries NO name/phone/email column:
--                         the people key is a hash in natural_key, never raw
--                         identity (the route computes SHA-256; SQL asserts the
--                         absence that keeps this migration out of the
--                         personal-data approval path).
--   81.8  guards        -- the app identity reads both tables, writes
--                         operational columns, and deletes nothing (import
--                         history is audit; reversal is a reviewed migrator
--                         step).
--   81.9  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): header/row
-- validation, the per-row error report, CSV parsing, scope 403s, and the
-- people-identity hash itself live in the route layer
-- (apps/web/server/utils/prior-year-import.ts + /api/imports/:domain) and
-- are covered by tests/web/prior-year-import.contract.mjs. A SQL suite
-- asserting HTTP status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 81.0  FIXTURE. Fixed ids and free key space so this file reruns cleanly.
--        LEGUN + OKE-ARO come from the 0002 hierarchy seed. 2025-10 is free:
--        suite 68 holds 2026-01..05 + 2025-12 on other branches/months.
-- ---------------------------------------------------------------------------
INSERT INTO prior_year_imports
  (id, domain, data_year, filename, received_rows, imported_rows, status, imported_by)
VALUES
  ('a1000000-0000-4000-8000-000000008101', 'finance', 2025, 'finance-2025.csv', 1, 1, 'committed', NULL),
  ('a1000000-0000-4000-8000-000000008102', 'attendance', 2025, 'attendance-2025.csv', 2, 2, 'committed', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO branch_financial_records (branch, month, income, currency, status)
VALUES ((SELECT id FROM branches WHERE code = 'LEGUN'), DATE '2025-10-01', 40800.00, 'NGN', 'submitted')
ON CONFLICT (branch, month) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 81.1  TABLES. Both ledger tables exist with the §13 shapes; source
--        defaults to import.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.prior_year_imports') IS NOT NULL,
    'prior_year', 'prior_year_imports exists');
  PERFORM test_support.assert_true(
    to_regclass('public.prior_year_import_items') IS NOT NULL,
    'prior_year', 'prior_year_import_items exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'prior_year_imports'
               AND column_name IN ('domain', 'source', 'data_year', 'filename',
                 'received_rows', 'imported_rows', 'updated_rows',
                 'skipped_rows', 'error_rows', 'imported_by', 'status',
                 'imported_at')
             HAVING count(*) = 12),
    'prior_year', 'imports carries the full batch column set');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'prior_year_import_items'
               AND column_name IN ('import', 'domain', 'source', 'data_year',
                 'row_number', 'natural_key', 'branch', 'zone',
                 'target_collection', 'target_id', 'status', 'error')
             HAVING count(*) = 12),
    'prior_year', 'items carries the full per-row column set');
  PERFORM test_support.assert_equals(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'prior_year_imports'
        AND column_name = 'source'),
    '''import''::text',
    'prior_year', 'batch source defaults to import');
  PERFORM test_support.assert_equals(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'prior_year_import_items'
        AND column_name = 'source'),
    '''import''::text',
    'prior_year', 'item source defaults to import');
END $$;

-- ---------------------------------------------------------------------------
-- 81.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0014_prior_year.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM prior_year_imports
      WHERE id IN ('a1000000-0000-4000-8000-000000008101',
                   'a1000000-0000-4000-8000-000000008102')) = 2,
    'prior_year', 'rerun: both fixture batches survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM branch_financial_records
      WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
        AND month = DATE '2025-10-01') = 1,
    'prior_year', 'rerun: the finance fixture is still one row');
END $$;

-- ---------------------------------------------------------------------------
-- 81.3  FINANCE RE-IMPORT. Same (branch, month) twice: zero new rows.
--        Changed figures under the same key: one row, latest values.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before integer; v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM branch_financial_records
    WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN');

  -- The re-import: identical row, DO NOTHING (the SQL half of "zero new
  -- rows"; the route reads first and reports `skipped`).
  INSERT INTO branch_financial_records (branch, month, income, currency, status)
  VALUES ((SELECT id FROM branches WHERE code = 'LEGUN'), DATE '2025-10-01', 40800.00, 'NGN', 'submitted')
  ON CONFLICT (branch, month) DO NOTHING;

  SELECT count(*) INTO v_after FROM branch_financial_records
    WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN');
  PERFORM test_support.assert_equals(
    v_after::text, v_before::text,
    'prior_year', 're-importing (LEGUN, 2025-10) inserts zero new rows');

  -- A correction under the same key converges (the route's read-then-PATCH
  -- half): one row with the latest figure, then restored.
  INSERT INTO branch_financial_records (branch, month, income, currency, status)
  VALUES ((SELECT id FROM branches WHERE code = 'LEGUN'), DATE '2025-10-01', 40900.00, 'NGN', 'submitted')
  ON CONFLICT (branch, month) DO UPDATE SET income = EXCLUDED.income;
  PERFORM test_support.assert_equals(
    (SELECT income::text FROM branch_financial_records
      WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
        AND month = DATE '2025-10-01'),
    '40900.00',
    'prior_year', 'a corrected re-import keeps the latest figure under one key');
END $$;

UPDATE branch_financial_records SET income = 40800.00
  WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
    AND month = DATE '2025-10-01';

-- ---------------------------------------------------------------------------
-- 81.4  RETURNS RE-IMPORT. Same (branch, period) twice: zero new rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rec uuid; v_before integer; v_after integer;
BEGIN
  SELECT id INTO v_rec FROM branch_financial_records
    WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
      AND month = DATE '2025-10-01';

  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES ((SELECT id FROM branches WHERE code = 'LEGUN'), v_rec, '2025-10')
  ON CONFLICT (branch, period) DO NOTHING;

  SELECT count(*) INTO v_before FROM weca_returns
    WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
      AND period = '2025-10';

  INSERT INTO weca_returns (branch, financial_record, period)
  VALUES ((SELECT id FROM branches WHERE code = 'LEGUN'), v_rec, '2025-10')
  ON CONFLICT (branch, period) DO NOTHING;

  SELECT count(*) INTO v_after FROM weca_returns
    WHERE branch = (SELECT id FROM branches WHERE code = 'LEGUN')
      AND period = '2025-10';
  PERFORM test_support.assert_equals(
    v_after::text, v_before::text,
    'prior_year', 're-importing (LEGUN, 2025-10) inserts zero new return rows');
  PERFORM test_support.assert_equals(
    v_after::text, '1',
    'prior_year', 'exactly one return row stands behind the re-import');
END $$;

-- ---------------------------------------------------------------------------
-- 81.5  ATTENDANCE RE-IMPORT. Same (session, category, sex) twice: zero new
--        rows; corrected figures converge (the import key for counts).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_before integer; v_after integer;
  v_session uuid := 'c1000000-0000-4000-8000-000000008105';
BEGIN
  -- AFC-566: 0023 created the real sessions register and closed the
  -- attendance_counts_session_fkey merge, so counts need a real session.
  -- Seeded here (idempotent), removed at the end of this section; the
  -- import-idempotency half of this suite never depended on the session
  -- being fake.
  INSERT INTO attendance_sessions (id, session_date, session_type)
    VALUES (v_session, DATE '2025-10-26', 'sunday_service')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    (v_session, 'adults', 'male', 95),
    (v_session, 'adults', 'female', 110)
  ON CONFLICT (session, category, sex) DO NOTHING;

  SELECT count(*) INTO v_before FROM attendance_counts WHERE session = v_session;

  -- The re-import: identical batch.
  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    (v_session, 'adults', 'male', 95),
    (v_session, 'adults', 'female', 110)
  ON CONFLICT (session, category, sex) DO NOTHING;

  SELECT count(*) INTO v_after FROM attendance_counts WHERE session = v_session;
  PERFORM test_support.assert_equals(
    v_after::text, v_before::text,
    'prior_year', 're-importing a counts batch inserts zero new rows');

  -- A correction converges to the latest figure under the same key.
  INSERT INTO attendance_counts (session, category, sex, count) VALUES
    (v_session, 'adults', 'male', 96),
    (v_session, 'adults', 'female', 110)
  ON CONFLICT (session, category, sex) DO UPDATE SET count = EXCLUDED.count;
  PERFORM test_support.assert_equals(
    (SELECT count::text FROM attendance_counts
      WHERE session = v_session AND category = 'adults' AND sex = 'male'),
    '96',
    'prior_year', 'a corrected re-import keeps the latest count under one key');
END $$;

UPDATE attendance_counts SET count = 95
  WHERE session = 'c1000000-0000-4000-8000-000000008105'
    AND category = 'adults' AND sex = 'male';

-- Fixture session + its counts go (AFC-566: the register stays, the rows
-- don't -- suite 88's empty-rollback proof needs empty tables, and no
-- later suite reads this throwaway session).
DELETE FROM attendance_sessions
  WHERE id = 'c1000000-0000-4000-8000-000000008105';

-- ---------------------------------------------------------------------------
-- 81.6  LEDGER IDEMPOTENCY. UNIQUE (import, natural_key): a duplicate item
--        in one batch is refused; the same key in a NEW batch is accepted
--        (a re-import is a new batch over the same domain rows). Items
--        RESTRICT their batch.
-- ---------------------------------------------------------------------------
INSERT INTO prior_year_import_items
  (id, import, domain, data_year, row_number, natural_key, branch, target_collection, status)
VALUES
  ('b1000000-0000-4000-8000-000000008106',
    'a1000000-0000-4000-8000-000000008101', 'finance', 2025, 1,
    'LEGUN|2025-10-01', (SELECT id FROM branches WHERE code = 'LEGUN'),
    'branch_financial_records', 'imported')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  -- A duplicate natural key inside the SAME batch is refused: the retry
  -- no-op rests here.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO prior_year_import_items (import, domain, row_number, natural_key) VALUES ('a1000000-0000-4000-8000-000000008101', 'finance', 1, 'LEGUN|2025-10-01')$q$,
    '23505', 'prior_year', 'a duplicate (import, natural_key) item is rejected');

  -- The same key in a NEW batch is accepted: the re-import records its own
  -- items while §§81.3-81.5 prove zero new domain rows.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO prior_year_import_items (id, import, domain, row_number, natural_key) VALUES ('b1000000-0000-4000-8000-000000008107', 'a1000000-0000-4000-8000-000000008102', 'finance', 1, 'LEGUN|2025-10-01') ON CONFLICT (id) DO NOTHING$q$,
    'prior_year', 'the same natural key in a new batch is accepted (re-import batch)');

  -- A batch with items is not deleted by accident.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM prior_year_imports WHERE id = 'a1000000-0000-4000-8000-000000008101'$q$,
    '23503', 'prior_year', 'deleting a batch with items is refused (RESTRICT)');
END $$;

-- The re-import probe row persists for the guards below to read; ON
-- CONFLICT keeps this file rerunnable.
INSERT INTO prior_year_import_items
  (id, import, domain, row_number, natural_key)
VALUES
  ('b1000000-0000-4000-8000-000000008107',
    'a1000000-0000-4000-8000-000000008102', 'finance', 1, 'LEGUN|2025-10-01')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 81.7  NO-PII. The items table carries no name/phone/email column: the
--        people key is a hash in natural_key, never raw identity. This
--        absence is what keeps the ledger migration out of the personal-data
--        approval path (see migration header).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'prior_year_import_items'
                   AND column_name IN ('full_name', 'first_name', 'last_name',
                     'phone', 'email', 'address', 'date_of_birth')),
    'prior_year', 'items carries no PII column (people keys are hashes in natural_key)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'prior_year_import_items'
               AND column_name = 'natural_key' AND data_type = 'text'),
    'prior_year', 'natural_key is text (holds branch keys and identity hashes alike)');
END $$;

-- ---------------------------------------------------------------------------
-- 81.8  GUARDS. The app ceiling: read everywhere, write operational columns,
--        delete nothing (import history is audit).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM prior_year_imports$q$,
    'prior_year', 'directus_app can read batches');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM prior_year_import_items$q$,
    'prior_year', 'directus_app can read items');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO prior_year_imports (domain, data_year, received_rows, status) VALUES ('people', 2025, 3, 'received')$q$,
    'prior_year', 'directus_app can open a batch');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO prior_year_import_items (import, domain, row_number, natural_key, status) VALUES ('a1000000-0000-4000-8000-000000008102', 'people', 9, 'probe-hash', 'skipped')$q$,
    'prior_year', 'directus_app can record items');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE prior_year_import_items SET status = 'imported' WHERE id = 'b1000000-0000-4000-8000-000000008107'$q$,
    'prior_year', 'directus_app can correct item status');

  -- source is server-set: the app cannot mark a manual row as an import.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO prior_year_imports (domain, source, received_rows) VALUES ('people', 'manual', 1)$q$,
    '42501', 'prior_year', 'directus_app cannot set batch source (server-set default)');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM prior_year_import_items WHERE id = 'b1000000-0000-4000-8000-000000008106'$q$,
    '42501', 'prior_year', 'directus_app has no DELETE on items');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM prior_year_imports WHERE id = 'a1000000-0000-4000-8000-000000008101'$q$,
    '42501', 'prior_year', 'directus_app has no DELETE on batches');
END $$;

-- ---------------------------------------------------------------------------
-- 81.9  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM prior_year_imports) > 0 OR (SELECT count(*) FROM prior_year_import_items) > 0 THEN RAISE EXCEPTION 'refusing to roll back prior_year imports: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'prior_year', 'rollback refuses while batches or items exist');
END $outer$;
