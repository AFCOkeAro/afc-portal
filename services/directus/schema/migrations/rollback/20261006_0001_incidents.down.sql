-- rollback/20261006_0001_incidents.down.sql
--
-- Reversal for 20261006_0001_incidents.sql. Deployment & release lens: no deploy
-- ships without a rollback path, so this is part of the change.
--
-- NOT SAFE TO RUN WHILE THE REGISTER HOLDS A ROW. It refuses.
--
-- What it destroys, stated plainly, because that is the whole question when
-- deciding whether to run it:
--
--   incidents              -- THE NDPA s.40(2) BREACH REGISTER, in full. Every
--                            filed, contained, reported and closed breach, the
--                            clock origin of each, and the provenance of each
--                            clock origin. A data subject or the NDPC can ask
--                            for this.
--   incidents_no_delete    -- the evidence seal. This is the trigger that
--   incidents_no_truncate    refuses DELETE and TRUNCATE for every identity
--                            including the table owner. Dropping it does not
--                            merely remove a control: it leaves a register that
--                            accepts DELETE from any session holding table-level
--                            grants, which is what 20_immutability.sql hands
--                            every v4 role.
--   incidents_forbid_delete()    -- the two guard functions
--   incidents_forbid_truncate()
--
-- There is exactly ONE path to that outcome and it is this file.
-- rollback/20261006_0002_incidents_awareness_at.down.sql drops and re-creates
-- the seal rather than removing it, and no other reversal touches it.
-- docs/adr/ADR-0003-register-seal-owns-its-rollback.md, decision 4: the loud
-- disarm belongs on the down script of the migration that OWNS the guard.
--
-- WHY THE REFUSAL IS HERE AND NOT IN AN OPERATOR NOTE. An NDPA s.40(2) register
-- has no drop path while it holds evidence. The count is checked by this file
-- rather than trusted to the operator, for the same reason
-- rollback/20261006_0004_retention.down.sql checks its own stop conditions
-- instead of asking: a deploy step that depends on someone having remembered is
-- a step that fails open exactly once, on the worst possible day.
--
-- What to do instead, which is what the refusal message says:
--   * take a VERIFIED copy of the register before anything else, and
--   * record where it went, in the change record, because a copy nobody can
--     find is not a copy.
-- Then run 0001's down against a register that is genuinely empty -- which
-- means the rows were never here, or they were migrated somewhere with a record
-- of that destination.
--
-- ORDER MATTERS: the guard below runs first, so this file cannot begin to
-- dismantle a register that holds evidence.

-- ---------------------------------------------------------------------------
-- 0. Refuse while the register holds any row.
--
-- Modelled on rollback/20261006_0004_retention.down.sql: a DO block, a count, a
-- restrict_violation that names the count, and an instruction the operator can
-- act on. Not a WARNING -- a warning scrolls past in a deploy log and a
-- transcript that is supposed to exist in a legal-hold system is not evidence
-- because it was never destroyed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_rows FROM incidents;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to drop the NDPA s.40(2) breach register: it holds % row(s), and every one of them is evidence. This rollback removes the evidence seal as well as the table, so there is no way back from a partial run. If the migration is being abandoned, take a VERIFIED copy of incidents first and record where it went. If a single value is wrong, the answer is a new incident row referencing the original, not a drop -- see ADR-159-2 D7.', v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    '0001 rollback proceeding: the breach register is empty, so the evidence seal and the table itself are being removed. Confirm a verified copy of anything that was ever filed here exists somewhere you can point to.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The evidence seal. Dropped explicitly rather than left to the DROP TABLE,
--    so the log shows the control being removed by name and not as a side effect
--    of dropping the table it was attached to.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
DROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;

DROP FUNCTION IF EXISTS incidents_forbid_delete();
DROP FUNCTION IF EXISTS incidents_forbid_truncate();

-- ---------------------------------------------------------------------------
-- 2. The register.
--
-- CASCADE is deliberately NOT used. A silent cascade through a table this shape
-- is exactly how a rollback destroys something the operator did not know was
-- there; if this statement fails because a dependency exists, that failure is
-- the signal. The indexes and the COMMENT go with the table. The awareness
-- columns and the clock objects belong to 0002 and are removed by
-- rollback/20261006_0002_incidents_awareness_at.down.sql -- run that first, or
-- this file will refuse on the NOT NULL columns, which is the correct outcome
-- and not a bug to work around.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS incidents;

-- ---------------------------------------------------------------------------
-- 3. Note for the operator.
--
-- directus_migrator and directus_app are bootstrap roles and are not dropped
-- here; a fresh deploy gets them from
-- services/directus/schema/bootstrap/0001_roles.sql. If a backup holds the
-- register, note that a record erased from the primary store persists in backup
-- media -- so "the backup has it" is true, and it is also the reason this
-- rollback does not restore anything (see AFC-169).
-- ---------------------------------------------------------------------------