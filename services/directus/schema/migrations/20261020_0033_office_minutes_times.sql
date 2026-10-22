-- Migration 0033: meeting times + location on office_minutes (AFC-670).
--
-- Parent slice AFC-477 (0013_office) created office_minutes with
-- title/meeting_date/body/file/status (+ branch/zone denorm). AFC-670 adds
-- the create-page fields: start_time/end_time (nullable time, end > start
-- where both present) and location (nullable text). All three are nullable
-- so existing rows backfill to NULL with no data migration; the
-- end-after-start rule is a CHECK, enforced at the database, mirrored in
-- the shared zod minutesFormSchema (HH:MM, end > start).
--
-- Least privilege (ADR-0002): 0013 grants directus_app column-level
-- INSERT/UPDATE lists. New columns are NOT covered by those lists, so this
-- file extends both lists with exactly the three new columns. No new role,
-- no CREATEROLE, no DELETE grant anywhere (office rows are audited
-- ministry facts; erasure runs as retention_worker, never the API).
-- SELECT already covers the whole row; REVOKE ALL FROM PUBLIC is
-- re-asserted for the table.
--
-- Idempotent: columns are ADD COLUMN IF NOT EXISTS and the CHECK is
-- drop-then-add of the identical definition, so re-applying this file
-- changes nothing (asserted by tests/db/95).

-- 1. Columns. Nullable: backfill-safe, existing rows read NULL.
ALTER TABLE office_minutes ADD COLUMN IF NOT EXISTS start_time time;
ALTER TABLE office_minutes ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE office_minutes ADD COLUMN IF NOT EXISTS location text;

COMMENT ON COLUMN office_minutes.start_time IS
  'Meeting start time, HH:MM on the create page (AFC-670). Nullable: pre-670 rows read NULL.';
COMMENT ON COLUMN office_minutes.end_time IS
  'Meeting end time, HH:MM on the create page (AFC-670). Nullable; where both times are present end_time must be after start_time.';
COMMENT ON COLUMN office_minutes.location IS
  'Meeting venue as free text, e.g. Anthony Village Tabernacle, Main Hall (AFC-670). Nullable.';

-- 2. Ordering rule. Both-null and one-null rows pass; equal or inverted
--    times are rejected at the database, not just in the form. Postgres has
--    no ADD CONSTRAINT IF NOT EXISTS, so re-applying drops and re-adds the
--    identical CHECK: the shape after any number of applies is exactly one
--    CHECK, and existing rows are unaffected (the CHECK already held).
--    Top-level statements, not a DO block, so the rollback-control gate can
--    see the creation the down script reverses (F1 second form).
ALTER TABLE office_minutes DROP CONSTRAINT IF EXISTS office_minutes_time_order;
ALTER TABLE office_minutes ADD CONSTRAINT office_minutes_time_order
  CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time);

-- 3. Least-privilege ceiling: extend the 0013 column lists with exactly the
--    three new columns. GRANT is idempotent; repeating it changes nothing.
GRANT INSERT (start_time, end_time, location) ON office_minutes TO directus_app;
GRANT UPDATE (start_time, end_time, location) ON office_minutes TO directus_app;

REVOKE ALL ON office_minutes FROM PUBLIC;
