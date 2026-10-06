-- rollback/20261006_0002_incidents_awareness_at.down.sql
--
-- Reversal for 20261006_0002. Deployment & release lens: no deploy ships
-- without a rollback path, so this is part of the change, not an afterthought.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE REMOVES. THE WHOLE LIST, because the previous version of this
-- header said "Additive only; nothing is destroyed" and that sentence is why
-- nobody noticed the defect below.
--
-- Clock objects -- this migration's own, and the reason it exists:
--   incidents_immutable_awareness        trigger
--   incidents_no_caller_clock             trigger
--   incidents_guard_awareness()           function
--   incidents_forbid_caller_set_awareness()  function
--   incidents_reported_after_awareness    CHECK constraint
--   incidents_breach_clock                view
--   incidents.awareness_at                column
--   incidents.awareness_at_source         column
--
-- Evidence seal -- dropped and then RE-CREATED below, after the column drops:
--   incidents_no_delete                   trigger
--   incidents_no_truncate                 trigger
--   incidents_forbid_delete()             function  (replaced, identical body)
--   incidents_forbid_truncate()           function  (replaced, identical body)
--
-- So: the reversal removes the clock objects and the two awareness columns,
-- and it drops and re-creates the two evidence guards in passing. It does not
-- remove them.
--
-- DROP COLUMN destroys the recorded clock origins. Run it only if the
-- migration itself is being abandoned; the correct action for a WRONG
-- awareness_at value is a new incident row referencing the original, which
-- keeps both records (ADR-159-2 D7).
--
-- ---------------------------------------------------------------------------
-- THE DEFECT THIS FILE USED TO CARRY.
--
-- It used to drop incidents_no_delete and incidents_no_truncate along with the
-- clock triggers and never put them back, so reversing the clock migration
-- silently disarmed the breach register. Reproduced by execution, five rows
-- present, shipped 0001 then 0002 then this script:
--
--   directus_app            still refused, 42501 -- the GRANT layer only
--   fully-granted app role  DELETE  succeeded, rows 5 -> 4
--   fully-granted app role  TRUNCATE succeeded, rows 4 -> 0
--   directus_migrator       DELETE and TRUNCATE both succeeded
--
-- directus_app is the only DB identity Directus has, and 20_immutability.sql
-- grants every v4 role table-level ALL -- so the register was open for exactly
-- the identity that reaches it in production, while a test written against
-- directus_app alone still read green.
--
-- THE FIX, and why it is here rather than in a flag: the seal is owned by
-- 20261006_0001_incidents.sql, so 0001's down script is the place a disarm
-- belongs and this file re-asserts the seal on the way out. There is no
-- session gate on this script (ADR-0003, Alternative C): a reversal path that
-- has to be unlocked is a deploy with no rollback path. The RAISE NOTICE at the
-- bottom puts the re-assert in the deploy log instead of gating anything.
-- ---------------------------------------------------------------------------

-- 1. Clock objects, in dependency order.
DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
DROP TRIGGER IF EXISTS incidents_no_caller_clock ON incidents;

DROP FUNCTION IF EXISTS incidents_guard_awareness();
DROP FUNCTION IF EXISTS incidents_forbid_caller_set_awareness();

ALTER TABLE incidents
  DROP CONSTRAINT IF EXISTS incidents_reported_after_awareness;

DROP VIEW IF EXISTS incidents_breach_clock;

ALTER TABLE incidents
  ALTER COLUMN awareness_at_source DROP NOT NULL,
  ALTER COLUMN awareness_at        DROP DEFAULT,
  ALTER COLUMN awareness_at_source DROP DEFAULT,
  ALTER COLUMN awareness_at        DROP NOT NULL;

ALTER TABLE incidents
  DROP COLUMN IF EXISTS awareness_at_source,
  DROP COLUMN IF EXISTS awareness_at;

-- ---------------------------------------------------------------------------
-- 2. The evidence seal, RE-ASSERTED. After the column drops, and it is the
--    last thing this file does on purpose: whatever the state of the clock
--    objects above, this script cannot end with an open register.
--
--    Ordering note. The triggers are dropped before they are re-created because
--    CREATE TRIGGER has no OR REPLACE in the supported path, and DROP TRIGGER IF
--    EXISTS makes the whole block re-runnable. The functions use CREATE OR
--    REPLACE, which needs no drop and leaves no window in which the trigger
--    would have no function to call.
--
--    These two blocks are byte-for-byte the definitions in
--    20261006_0001_incidents.sql. A divergent message here would break the
--    expected 23001 in tests/db/20_immutability.sql and any runbook that greps
--    for it, which is how a guard stops being one.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
DROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;

CREATE OR REPLACE FUNCTION incidents_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'incidents rows are not deletable (breach register evidence). Set status = ''closed'' instead.'
    USING ERRCODE = 'restrict_violation';
END $$;

COMMENT ON FUNCTION incidents_forbid_delete() IS
  'Enforces the NDPA s.40(2) evidence rule for every identity including the table owner. Owned by 0001 and re-asserted by 0002 and by 0002''s down script; only rollback/0001 removes it, and only while the register is empty.';

CREATE OR REPLACE FUNCTION incidents_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'incidents cannot be truncated (breach register evidence).'
    USING ERRCODE = 'restrict_violation';
END $$;

CREATE TRIGGER incidents_no_delete
  BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();

CREATE TRIGGER incidents_no_truncate
  BEFORE TRUNCATE ON incidents
  FOR EACH STATEMENT EXECUTE FUNCTION incidents_forbid_truncate();

DO $$
BEGIN
  RAISE NOTICE
    '0002 rollback: the NDPA s.40(2) clock objects and both awareness columns are gone, and the evidence seal has been RE-ASSERTED -- incidents_no_delete and incidents_no_truncate are back on incidents. The register is still sealed. The only path that removes the seal is rollback/20261006_0001_incidents.down.sql, and that one refuses while the register holds any row.';
END
$$;