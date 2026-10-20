-- rollback/20261020_0017_event_group_code.down.sql
--
-- Reversal for 20261020_0017_event_group_code.sql. AFC-519 (AFC-493).
--
-- What it destroys, stated plainly:
--   event_registrations.group_code -- every stored group submission code
--     (the idempotency ground truth and the S4 page key). Re-applying the
--     forward file recreates the column, but no code value survives a
--     rollback.
--   event_registrations_event_group_code_idx and the
--     event_registrations_group_code_len CHECK -- created by the forward
--     file for this column, dropped with it.
--
-- What it does NOT destroy: event_registrations rows (owned by the
-- registrations-owning slice; only this migration's column goes), or any
-- other column, index, or constraint on that table. No CASCADE: a hidden
-- dependency must fail loudly, not vanish silently. No DROP TRIGGER /
-- DROP FUNCTION / DROP RULE statement appears anywhere in this file --
-- the forward file creates none, so the rollback-control gate has nothing
-- to reconcile. No GRANT/REVOKE: the forward file issues none.
--
-- Absence is not failure: where the host table is missing (the forward
-- migration skipped loudly too) every statement is IF EXISTS and the
-- script is a no-op with a NOTICE.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a column that holds values.
--
-- A non-null group_code is the stored ground truth for group idempotency
-- and the S4 lookup key. Empty-or-all-NULL tables roll back; anything
-- else needs a verified copy first and a reviewed step, not this script.
-- (Rows that predate the column are all NULL, so they never block.)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_coded integer := 0;
BEGIN
  IF to_regclass('public.event_registrations') IS NULL THEN
    RAISE NOTICE 'event_registrations absent: nothing this migration added can exist. Rollback is a no-op.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'event_registrations'
                AND column_name = 'group_code') THEN
    SELECT count(*) INTO v_coded FROM event_registrations
     WHERE group_code IS NOT NULL;
  END IF;

  IF v_coded > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event group_code: event_registrations holds % row(s) with a non-null group_code. These are the stored idempotency ground truth and S4 lookup keys. Take a verified copy before proceeding; empty or all-NULL tables roll back, coded ones do not.',
      v_coded
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'event group_code rollback proceeding: no stored codes. Re-apply 20261020_0017 to get the column back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The index, the CHECK, and the column this migration added -- and
--    nothing else.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS event_registrations_event_group_code_idx;

ALTER TABLE IF EXISTS event_registrations DROP CONSTRAINT IF EXISTS event_registrations_group_code_len;

ALTER TABLE IF EXISTS event_registrations DROP COLUMN IF EXISTS group_code;
