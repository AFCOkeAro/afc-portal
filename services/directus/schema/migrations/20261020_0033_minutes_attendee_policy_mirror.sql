-- 20261020_0033_minutes_attendee_policy_mirror.sql
--
-- F1 policy mirror for the ADR-0012 creator-may-attach-to-own-draft exception
-- (AFC-701 verdict B, AFC-702 F1, AFC-704 scope item 1).
--
-- PROBLEM. The portal route
-- (apps/web/server/api/minutes/[id].attendees.post.ts) lets a caller holding
-- office_minutes:create attach attendees only to their OWN DRAFT minutes in
-- their own branch scope (created_by = session user, status = draft, scoped
-- row load). In a policy-installed environment the Directus API is reachable
-- with the user's own token, so a minutes_attendees:create grant WITHOUT the
-- same three conditions lets the holder bypass the portal and attach to ANY
-- minutes (other authors' drafts, published minutes, other branches). The
-- portal gate alone is then a UI contract, not a control.
--
-- WHY DENORM COLUMNS AND NOT A directus_permissions UPDATE. Staging's
-- directus_relations metadata is empty, so relational filters fail closed
-- (0030 header). A relational mirror such as {"minute": {"status": ...}}
-- cannot be expressed as a flat working filter. Following the 0030/0032
-- precedent, this migration denormalises the two parent facts the flat
-- filter needs onto the child row, maintained at write time:
--   minute_status     -- copy of office_minutes.status at attach time
--   minute_created_by -- copy of office_minutes.created_by at attach time
-- (branch/zone already ride along via 0030's afc_set_scope on the same
-- table.) The canonical flat filter both layers must enforce is:
--   {"_and": [
--     {"branch": {"_in": "$CURRENT_USER.branch_ids"}},
--     {"minute_status": {"_eq": "draft"}},
--     {"minute_created_by": {"_eq": "$CURRENT_USER"}}]}
-- The single source of truth for that JSON is
-- apps/web/server/utils/minutes-policy.ts (MINUTES_ATTENDEE_CREATE_FILTER);
-- the admin grant endpoint defaults it for minutes_attendees:create, and
-- tests/web/office.contract.mjs pins portal-allow IFF policy-allow. This
-- file deliberately creates NO directus_permissions rows and updates none:
-- there is no policy seed in this repo to update, ALL-holders (area/super)
-- must keep their unrestricted grants, and inventing role UUIDs here would
-- be a second source of truth. The permission rows themselves are created
-- through the admin API, which now carries the default.
--
-- SEMANTICS, STATED. These two columns are CREATE-TIME policy inputs, not a
-- read model. The trigger refreshes them only when the attendee's `minute`
-- link is written; a later draft -> final/published transition on the parent
-- does NOT rewrite existing attendee rows (suite 95.4 pins this). That drift
-- is expected and harmless: the attach was legal when made, and nothing may
-- filter reads on these columns. A NULL in either column (legacy parent with
-- NULL created_by, or a parent row that vanished mid-write) fails closed:
-- NULL never satisfies the policy's _eq comparisons.
--
-- GRANTS, STATED. No GRANT/REVOKE in this file beyond the file-level
-- posture: directus_app's column INSERT list (0013) deliberately EXCLUDES
-- these two columns, exactly like 0030's branch/zone posture -- the trigger
-- owns them, so no client (portal or Studio) can spoof a draft/author claim
-- past the policy. SELECT already covers the table, so filtered reads work.
--
-- Rollback: rollback/20261020_0033_minutes_attendee_policy_mirror.down.sql
-- drops the trigger, the function, the index and both columns (all created
-- here, so the rollback-control gate reconciles them as F1 reversals of
-- their own referents). The columns are derived and recomputable, so the
-- down script need not refuse on populated tables -- re-applying this file
-- restores them. Only run the rollback after the Directus permissions
-- generated from these columns have been replaced (same caveat as 0030).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables (none
-- needed here -- see above).
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
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
-- 1. Denorm columns (rerunnable). No CHECK on minute_status: the status
--    domain is owned by 0013's office_minutes CHECK, and a second CHECK here
--    would fork the domain (a future 0013 status would reject here first).
-- ---------------------------------------------------------------------------
ALTER TABLE minutes_attendees
  ADD COLUMN IF NOT EXISTS minute_status text;
ALTER TABLE minutes_attendees
  ADD COLUMN IF NOT EXISTS minute_created_by uuid;

COMMENT ON COLUMN minutes_attendees.minute_status IS
  'F1 policy-mirror denorm (0033, ADR-0012): copy of the parent office_minutes.status at attach time. Create-time Directus filter input only -- never filter reads on this column (it does not track later draft->final transitions). NULL fails closed.';
COMMENT ON COLUMN minutes_attendees.minute_created_by IS
  'F1 policy-mirror denorm (0033, ADR-0012): copy of the parent office_minutes.created_by at attach time. Create-time Directus filter input only. NULL (legacy parent) fails closed.';

CREATE INDEX IF NOT EXISTS minutes_attendees_minute_attach_idx
  ON minutes_attendees (minute_status, minute_created_by);

-- ---------------------------------------------------------------------------
-- 2. Trigger function (owned by THIS migration -- the down script drops it
--    together with the columns it maintains). BEFORE INSERT OR UPDATE OF
--    minute: copies the parent facts onto the row being written, so the
--    flat Directus filter reads values the trigger, not the client, supplied.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afc_set_minute_attach_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p_status text;
  p_created_by uuid;
BEGIN
  IF NEW.minute IS NULL THEN
    NEW.minute_status := NULL;
    NEW.minute_created_by := NULL;
    RETURN NEW;
  END IF;
  SELECT status, created_by INTO p_status, p_created_by
    FROM office_minutes WHERE id = NEW.minute;
  -- No parent row (FK will reject the write afterwards) or NULL parent
  -- facts (legacy rows): leave NULLs. NULL never satisfies the policy's
  -- _eq comparisons, so the row fails closed, never open.
  NEW.minute_status := p_status;
  NEW.minute_created_by := p_created_by;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION afc_set_minute_attach_scope() IS
  'F1 policy-mirror writer (0033): maintains minutes_attendees.minute_status/minute_created_by from the parent minute. Owned by 0033; the down script drops it with the columns.';

DROP TRIGGER IF EXISTS afc_set_minute_attach_scope ON minutes_attendees;
CREATE TRIGGER afc_set_minute_attach_scope
  BEFORE INSERT OR UPDATE OF minute ON minutes_attendees
  FOR EACH ROW EXECUTE FUNCTION afc_set_minute_attach_scope();

-- ---------------------------------------------------------------------------
-- 3. Backfill (rerunnable: only rows whose denorm is still null move).
-- ---------------------------------------------------------------------------
UPDATE minutes_attendees c
   SET minute_status = p.status,
       minute_created_by = p.created_by
  FROM office_minutes p
 WHERE c.minute = p.id
   AND (c.minute_status IS NULL OR c.minute_created_by IS NULL);

DO $$
BEGIN
  RAISE NOTICE '0033 minutes_attendees policy-mirror denorm ensured (minute_status/minute_created_by + trigger + backfill). Canonical filter: MINUTES_ATTENDEE_CREATE_FILTER in apps/web/server/utils/minutes-policy.ts.';
END
$$;
