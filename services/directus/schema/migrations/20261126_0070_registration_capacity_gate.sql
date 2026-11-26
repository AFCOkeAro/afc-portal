-- 20261126_0070_registration_capacity_gate.sql
--
-- Serialized capacity gate + idempotency key for event_registrations
-- (AFC-1222 F3, F4).
--
-- F3 ROOT CAUSE. The portal pre-checks capacity with an aggregate read, but
-- two concurrent POSTs can both read "one seat left" and both write. The
-- route cannot serialize itself (Directus REST has no multi-row
-- transaction), so the gate lives where concurrent writers must meet: a
-- BEFORE INSERT row trigger on event_registrations that re-counts occupied
-- seats under a per-event advisory lock. The route pre-check stays (it turns
-- a full event into a 409/waitlist without writing); the trigger is the
-- layer that makes capacity+1 refused/waitlisted deterministically.
--
-- WHAT THIS FILE CREATES
--   event_registrations.idempotency_key  -- nullable text. The public route
--     stamps the client-supplied `Idempotency-Key` here once this migration
--     is applied (route wiring is a separate, sequenced step: the route must
--     NOT stamp the column before it exists, so stamping lands after).
--   event_registrations_event_idem_key   -- UNIQUE (event, idempotency_key)
--     WHERE idempotency_key IS NOT NULL. Same event + same key refuses the
--     second write (23505); the route catches it and replays the original
--     row. Different events may reuse a key; NULL keys never collide.
--   event_registrations_capacity_gate() + event_registrations_capacity_gate
--     trigger -- BEFORE INSERT, FOR EACH ROW. Takes a per-event advisory
--     transaction lock, counts rows in (pending, confirmed) for the event,
--     and refuses with `event_full` when the event is at capacity and the
--     new row would occupy a seat. Waitlisted/cancelled rows never occupy a
--     seat and always pass; NULL-capacity events always pass.
--
-- SERIALIZATION NOTE. An advisory xact lock (not SELECT ... FOR UPDATE on
-- the events row) serializes concurrent inserts per event. FOR UPDATE would
-- need an UPDATE grant for the inserting identity; the advisory lock needs
-- no table privilege, so the least-privilege grant model is untouched.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No guardian CHECK: cross-table (event flag), owned by the Flow + route
--   (0021 choice 3, unchanged).
--   No backfill: existing rows keep NULL keys; the (event, contact) replay
--   lookup in the route covers them.
--   No down script (0064 precedent): the trigger guards a surviving table,
--   so a down script that drops it would disarm a control over surviving
--   rows — the exact shape scripts/migration-rollback-gate.mjs refuses.
--   Reversal is a new forward migration, reviewed separately.
--
-- GRANTS. Extends the 0021 column lists with the new column only:
-- GRANT INSERT/UPDATE (idempotency_key) ON event_registrations TO
-- directus_app. No roles minted, no CREATEROLE, no superuser (ADR-0002,
-- scripts/migration-privilege-gate.sh).
--
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Rerunnable: IF NOT EXISTS / OR REPLACE / guarded DO blocks throughout.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file (0001/0002
--    pattern): a deploy that skipped bootstrap gets a sentence, not a
--    partial install. Only GRANT/REVOKE below — this file mints no roles.
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
-- 1. The column + the uniqueness that makes a retry a replay, not a row.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS event_registrations
  ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN event_registrations.idempotency_key IS
  'Client-supplied Idempotency-Key, scoped per event by event_registrations_event_idem_key. NULL until the route stamps it (post-apply wiring); NULL keys never collide.';

CREATE UNIQUE INDEX IF NOT EXISTS event_registrations_event_idem_key
  ON event_registrations (event, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The serialized capacity gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION event_registrations_capacity_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_capacity integer;
  v_taken integer;
BEGIN
  -- Only seat-occupying statuses pass through the gate. Waitlisted rows are
  -- the overflow by design (PRD §3.2); terminal rows never occupy a seat.
  IF NEW.registration_status NOT IN ('pending', 'confirmed') THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent inserts for this event. Advisory, transactional:
  -- held to commit/rollback, needs no table privilege, released
  -- automatically. Two writers for the same event queue here; writers for
  -- different events never meet.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.event::text));

  SELECT e.capacity INTO v_capacity
    FROM events e
   WHERE e.id = NEW.event;

  -- No event row (the FK will refuse it) or unlimited capacity: pass.
  IF NOT FOUND OR v_capacity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_taken
    FROM event_registrations r
   WHERE r.event = NEW.event
     AND r.registration_status IN ('pending', 'confirmed');

  IF v_taken >= v_capacity THEN
    RAISE EXCEPTION
      'event_full: event % holds % occupied seat(s) at capacity %; refusing % registration',
      NEW.event, v_taken, v_capacity, NEW.registration_status
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION event_registrations_capacity_gate() IS
  'AFC-1222 F3: serialized capacity gate. Counts occupied (pending/confirmed) seats under a per-event advisory lock and refuses seat-occupying inserts at capacity. The route catches event_full and answers 409 (or waitlists); it is a retry signal, not a 500.';

DROP TRIGGER IF EXISTS event_registrations_capacity_gate ON event_registrations;

CREATE TRIGGER event_registrations_capacity_gate
  BEFORE INSERT ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registrations_capacity_gate();

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling: the new column joins the 0021 lists.
--    Table-level SELECT from 0021 already covers the column for reads.
-- ---------------------------------------------------------------------------
GRANT INSERT (idempotency_key) ON event_registrations TO directus_app;
GRANT UPDATE (idempotency_key) ON event_registrations TO directus_app;
