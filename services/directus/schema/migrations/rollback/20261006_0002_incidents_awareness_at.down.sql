-- rollback/20261006_0002_incidents_awareness_at.down.sql
--
-- Reversal for 20261006_0002. Deployment & release lens: no deploy ships
-- without a rollback path, so this is part of the change, not an afterthought.
--
-- DROP COLUMN destroys the recorded clock origins. Run it only if the
-- migration itself is being abandoned; the correct action for a WRONG
-- awareness_at value is a new incident row referencing the original, which
-- keeps both records (ADR-159-2 D7).

DROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;
DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
DROP TRIGGER IF EXISTS incidents_immutable_awareness ON incidents;
DROP TRIGGER IF EXISTS incidents_no_caller_clock ON incidents;

DROP FUNCTION IF EXISTS incidents_forbid_truncate();
DROP FUNCTION IF EXISTS incidents_forbid_delete();
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