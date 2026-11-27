-- 20261127_0071_registration_capacity_gate_definer.sql
--
-- AFC-1226 G1 (critical): make the capacity gate run as its owner.
--
-- ROOT CAUSE. Migration 0070 installs `event_registrations_capacity_gate()`
-- as a SECURITY INVOKER function: the BEFORE INSERT trigger executes the
-- body with the privileges of the INSERTING identity. When that identity
-- can read the table (directus_app with SELECT, the session role in suite
-- 103.6) the gate counts occupied seats and refuses capacity+1 with the
-- named `event_full` signal. When the identity CANNOT read the table — the
-- read-less writer/public identity the public surface now writes through,
-- or any future least-privilege writer — the body's own
-- `SELECT count(*) FROM event_registrations` fails first with 42501
-- (insufficient_privilege). The insert still refuses, but with the wrong
-- signal: the route's `isEventFullRefusal` matches `event_full`, so a 42501
-- escapes as a 502 instead of the 409/waitlist the product promises. The
-- suite never saw it because every 103.6 probe ran as an identity that
-- could read (the gap M3 closes).
--
-- FIX. Run the function as its owner: SECURITY DEFINER, owned by
-- directus_migrator (the migration role that created it in 0070), with a
-- fixed `search_path = public, pg_temp`. The count then runs with the
-- owner's rights whatever the inserting identity holds, and at capacity the
-- gate raises `event_full` (restrict_violation) deterministically. The body
-- is otherwise byte-identical to 0070: same advisory lock, same seat
-- definition (pending/confirmed), same waitlisted/cancelled/NULL-capacity
-- passes.
--
-- WHY DEFINER IS SAFE HERE. The function takes no arguments, reads only the
-- two registers the trigger guards, returns no data (NEW or raise), and is
-- reachable in practice only as the trigger. A definer that cannot be
-- steered by its caller cannot be used as a confused deputy. The fixed
-- search_path closes the search_path-hijack shape (a caller-owned table
-- shadowing `events`/`event_registrations`); pg_temp is kept so an
-- explicit `SET LOCAL search_path` in a caller session cannot break the
-- body's resolution either.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No GRANT/REVOKE, no new roles, no CREATEROLE, no superuser (ADR-0002,
--   scripts/migration-privilege-gate.sh). The trigger keeps firing with no
--   EXECUTE grant: triggers do not check it.
--   No down script (0064 precedent): the trigger guards a surviving table,
--   so a down script that drops the definer would disarm a control over
--   surviving rows — the exact shape
--   scripts/migration-rollback-gate.mjs refuses. Reversal is a new forward
--   migration, reviewed separately.
--   No row creation, no permission edits: identity grants are G3's file
--   (0072). This file changes execution context only.
--
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Rerunnable: CREATE OR REPLACE + guarded trigger re-affirmation.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file (0001/0002
--    pattern): a deploy that skipped bootstrap gets a sentence, not a
--    partial install. Only DDL below — this file mints no roles.
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
-- 1. The same gate, running as its owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION event_registrations_capacity_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  'AFC-1226 G1: serialized capacity gate, SECURITY DEFINER owned by directus_migrator with fixed search_path. Counts occupied (pending/confirmed) seats under a per-event advisory lock and refuses seat-occupying inserts at capacity. A read-less inserting identity gets event_full (restrict_violation), not 42501 — the route maps that onto 409/waitlist.';

-- The trigger survives CREATE OR REPLACE (same OID, same name), but
-- re-affirming it keeps a partially-applied 0070 (function without trigger)
-- from passing this file silently.
DROP TRIGGER IF EXISTS event_registrations_capacity_gate ON event_registrations;

CREATE TRIGGER event_registrations_capacity_gate
  BEFORE INSERT ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registrations_capacity_gate();
