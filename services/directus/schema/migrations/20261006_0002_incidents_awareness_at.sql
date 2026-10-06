-- 20261006_0002_incidents_awareness_at.sql
--
-- awareness_at -- the NDPA s.40(2) clock origin. AFC-166 / ADR-159-2 D7.
--
-- WHAT THIS FILE OWNS, AND WHAT IT RE-ASSERTS.
--
-- This file defines FOUR triggers. Two of them are its own:
--
--   incidents_immutable_awareness  BEFORE UPDATE    -- the clock never moves
--   incidents_no_caller_clock       BEFORE INSERT    -- no caller sets the clock
--
-- and their two functions, incidents_guard_awareness() and
-- incidents_forbid_caller_set_awareness(). They are clock guards: every one of
-- them reads awareness_at or awareness_at_source, and they exist because that
-- column exists.
--
-- The other two are NOT this file's, and this file does not claim them:
--
--   incidents_no_delete            BEFORE DELETE    -- THE EVIDENCE SEAL
--   incidents_no_truncate          BEFORE TRUNCATE  -- THE EVIDENCE SEAL
--
-- Both are owned by 20261006_0001_incidents.sql, because "incidents rows are
-- never deleted" is a property of the register and predates awareness_at. They
-- are re-created here verbatim and idempotently, for one reason: every
-- currently-deployed database applied 0001 before that change and will never
-- re-run it, so on those databases this file is the only forward step that can
-- install the seal. Re-asserting is how a database whose 0001 predates the
-- change is never left unsealed by a partial deploy. It is not a second owner,
-- and 0001's down script remains the only path that removes the seal.
--
-- docs/adr/ADR-0003-register-seal-owns-its-rollback.md has the decision.
--
-- THE CONTROL IS THE TRIGGER IN THIS FILE. Not Directus permissions, not
-- application discipline. Reason (security lens): data-model-v4.md 5 gives
-- super admin CRUD on every collection, and Directus holds exactly one DB
-- identity (directus_app). A Flow `exec`, a Studio operator, or a psql session
-- as that identity all reach the table through the same connection, so a
-- permission-only control is a comment. The column privileges in 0001 are the
-- second layer.
--
-- Three timestamps, three meanings, never interchangeable:
--   detected_at  -- when engineering found it
--   awareness_at -- when the church became aware (the 72h clock starts here)
--   reported_at  -- when the DPC notified the Commission / data subjects
--
-- Order of operations matters. The BEFORE UPDATE trigger is created LAST so it
-- cannot block its own backfill. No DISABLE TRIGGER is needed: the backfill
-- is guarded by `WHERE awareness_at IS NULL`, which matches zero rows on a
-- re-run because the column is NOT NULL afterwards. That keeps the privileged
-- `ALTER TABLE ... DISABLE TRIGGER` step out of the deploy path entirely --
-- one fewer thing that needs table ownership in production.
--
-- Rollback: rollback/20261006_0002_incidents_awareness_at.down.sql
-- It drops the clock objects and the two awareness columns -- which destroys the
-- recorded clock origins -- and then RE-ASSERTS the evidence seal, so the
-- reversal cannot leave the register open. See that file's header for the full
-- list of what it removes.

-- ---------------------------------------------------------------------------
-- 1. Columns, nullable.
-- ---------------------------------------------------------------------------
ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS awareness_at       timestamptz,
  ADD COLUMN IF NOT EXISTS awareness_at_source text;

-- ---------------------------------------------------------------------------
-- 2. Defaults. This is what sets the clock origin on insert. A caller cannot
--    supply either column (no INSERT/UPDATE privilege on them, see 0001) and
--    cannot change them afterwards (trigger below).
-- ---------------------------------------------------------------------------
ALTER TABLE incidents
  ALTER COLUMN awareness_at        SET DEFAULT now(),
  ALTER COLUMN awareness_at_source SET DEFAULT 'insert_default';

COMMENT ON COLUMN incidents.awareness_at IS
  'NDPA s.40(2) clock origin. Set by the column default on insert, immutable afterwards. Do not expose as writable anywhere.';
COMMENT ON COLUMN incidents.awareness_at_source IS
  'Provenance of awareness_at: insert_default | backfill:earliest_of_detected_reported_created. Evidence in its own right -- NDPC asks whether a value is real or inferred.';

-- ---------------------------------------------------------------------------
-- 3. Backfill pre-existing rows. awareness_at_source marks these as inferred,
--    which is the honest answer for a value no one recorded at the time.
--    All three inputs nullable -> if all are NULL the LEAST collapses to
--    infinity, so NULLIF then COALESCE falls back to now().
-- ---------------------------------------------------------------------------
UPDATE incidents
   SET awareness_at = COALESCE(
         NULLIF(
           LEAST(
             COALESCE(detected_at,  'infinity'::timestamptz),
             COALESCE(reported_at,  'infinity'::timestamptz),
             COALESCE(created_at,  'infinity'::timestamptz)
           ),
           'infinity'::timestamptz
         ),
         now()
       ),
       awareness_at_source = 'backfill:earliest_of_detected_reported_created'
 WHERE awareness_at IS NULL;

-- ---------------------------------------------------------------------------
-- 4. NOT NULL. If any row is still NULL the migration fails loudly, which is
--    the correct outcome: a clock origin we cannot prove is a broken migration.
-- ---------------------------------------------------------------------------
ALTER TABLE incidents
  ALTER COLUMN awareness_at        SET NOT NULL,
  ALTER COLUMN awareness_at_source SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Guard: awareness_at and awareness_at_source never change.
--
--    IS DISTINCT FROM, not <>: an UPDATE that leaves the value alone is
--    legitimate (Directus sends only the fields in the patch) and must not
--    trip the guard. Changing it to an identical value is not a change and
--    carries no risk, so rejecting it would only teach operators to disable
--    the trigger.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION incidents_guard_awareness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.awareness_at IS DISTINCT FROM NEW.awareness_at
     OR OLD.awareness_at_source IS DISTINCT FROM NEW.awareness_at_source THEN
    RAISE EXCEPTION
      'incidents.awareness_at is immutable (NDPA s.40(2) clock origin). Remediation is a new incident row referencing this one, not an edit.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION incidents_guard_awareness() IS
  'Enforces ADR-159-2 D7. Runs for every identity including the table owner; only a superuser can disable it, and directus_app is not an owner.';

-- ---------------------------------------------------------------------------
-- 5b. Guard: no caller may supply the clock origin on INSERT.
--
-- Column-level privileges stop directus_app, but the table owner implicitly
-- holds every privilege on its own table, and column grants do not restrict the
-- owner. Without this trigger the owner could file an incident with a
-- backdated clock origin, which is the same hole one privilege level up.
--
-- The check is exact rather than heuristic: the default is now(), and now() is
-- stable for the whole transaction, so NEW.awareness_at equals now() if and only
-- if the column was defaulted. A caller that explicitly passes now() passes the
-- same value the default would have produced, so nothing is lost.
--
-- awareness_at_source is checked the same way for the same reason.
--
-- Consequence, on purpose: importing a legacy register cannot go through plain
-- INSERT. It goes through the backfill in this file, which stamps provenance as
-- inferred. An import that could assert its own clock origins would defeat the
-- provenance record.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION incidents_forbid_caller_set_awareness() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.awareness_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION
      'incidents.awareness_at is set by the database on insert, never by a caller (NDPA s.40(2) clock origin). Import through the migration backfill, which records inferred provenance.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.awareness_at_source IS DISTINCT FROM 'insert_default' THEN
    RAISE EXCEPTION
      'incidents.awareness_at_source is set by the database on insert, never by a caller.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION incidents_forbid_caller_set_awareness() IS
  'Closes the owner-supplies-the-clock-origin hole that column-level privileges cannot reach.';

DROP TRIGGER IF EXISTS incidents_no_caller_clock ON incidents;
CREATE TRIGGER incidents_no_caller_clock
  BEFORE INSERT ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_caller_set_awareness();

-- ---------------------------------------------------------------------------
-- 6. EVIDENCE SEAL, RE-ASSERTED. NOT OWNED BY THIS FILE.
--
-- 0001 owns both of these. They are repeated here verbatim, bodies and error
-- strings byte for byte, because a different message would break the expected
-- 23001 in tests/db/20_immutability.sql and any operator runbook that greps for
-- it. The re-assert is what makes ADR-0003 work on databases that were
-- migrated before 0001 grew the seal: those databases will never re-run 0001,
-- so this file is the only forward step that can install it.
--
-- Consequence worth stating plainly: this file is not a second owner. If a
-- future change edits these definitions it must edit 0001 as well, or the two
-- will drift and one of them will win depending on which migration ran last.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION incidents_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'incidents rows are not deletable (breach register evidence). Set status = ''closed'' instead.'
    USING ERRCODE = 'restrict_violation';
END $$;

COMMENT ON FUNCTION incidents_forbid_delete() IS
  'Enforces the NDPA s.40(2) evidence rule for every identity including the table owner. Owned by 0001 and re-asserted by 0002 and by 0002''s down script; only rollback/0001 removes it, and only while the register is empty.';

-- ---------------------------------------------------------------------------
-- 7. EVIDENCE SEAL, RE-ASSERTED. NOT OWNED BY THIS FILE. Same reason as 6.
--
--    TRUNCATE bypasses row-level DELETE triggers entirely, so a table-level
--    statement trigger is the only thing that closes it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION incidents_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'incidents cannot be truncated (breach register evidence).'
    USING ERRCODE = 'restrict_violation';
END $$;

DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
CREATE TRIGGER incidents_immutable_awareness
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_guard_awareness();

DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
CREATE TRIGGER incidents_no_delete
  BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();

DROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;
CREATE TRIGGER incidents_no_truncate
  BEFORE TRUNCATE ON incidents
  FOR EACH STATEMENT EXECUTE FUNCTION incidents_forbid_truncate();

-- ---------------------------------------------------------------------------
-- 8. Ordering guarantee. Only reported_at is ordered by definition; detected_at
--    is deliberately NOT constrained (staff can tell the board first).
-- ---------------------------------------------------------------------------
ALTER TABLE incidents
  DROP CONSTRAINT IF EXISTS incidents_reported_after_awareness;
ALTER TABLE incidents
  ADD CONSTRAINT incidents_reported_after_awareness
  CHECK (reported_at IS NULL OR reported_at >= awareness_at);

-- ---------------------------------------------------------------------------
-- 9. The clock. Derived from awareness_at and never from detected_at -- a
--    gauge off detected_at is a gauge that under-reports the deadline.
--    Monitoring rules: services/directus/monitoring/ndpa_breach_clock.rules.yml
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW incidents_breach_clock AS
SELECT
  i.id,
  i.ref,
  i.status,
  i.severity,
  i.detected_at,
  i.awareness_at,
  i.awareness_at_source,
  i.reported_at,
  (i.awareness_at + interval '72 hours')                     AS notification_due_at,
  round((72 - EXTRACT(EPOCH FROM (now() - i.awareness_at)) / 3600)::numeric, 2)
                                                             AS remaining_hours,
  -- Two invariants the monitoring rules assert. A non-zero count here is a
  -- broken migration, not a data condition to investigate.
  (i.awareness_at IS NULL)                                    AS clock_origin_missing,
  (i.awareness_at IS NULL OR i.awareness_at_source IS NULL)   AS provenance_missing
FROM incidents i
WHERE i.status NOT IN ('reported', 'closed');

COMMENT ON VIEW incidents_breach_clock IS
  'Open breaches and their NDPA s.40(2) remaining hours. Source of ndpa_breach_clock_remaining_hours.';

GRANT SELECT ON incidents_breach_clock TO directus_app;