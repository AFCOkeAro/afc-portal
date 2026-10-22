-- Rollback for 20261020_0033_office_minutes_times (AFC-670).
--
-- Removes only what 0033 added: the time-order CHECK and the three
-- columns. Never touched: the 0013 office tables, their rows, the 0013
-- grant lists (GRANTs on dropped columns disappear with the columns; the
-- surviving 0013 column lists are left exactly as 0013 stated them), and
-- PUBLIC revocation (re-asserted, so the table cannot end world-readable).
-- Re-runnable: every statement is drop-if-exists guarded.

ALTER TABLE office_minutes DROP CONSTRAINT IF EXISTS office_minutes_time_order;
ALTER TABLE office_minutes DROP COLUMN IF EXISTS end_time;
ALTER TABLE office_minutes DROP COLUMN IF EXISTS start_time;
ALTER TABLE office_minutes DROP COLUMN IF EXISTS location;

REVOKE ALL ON office_minutes FROM PUBLIC;
