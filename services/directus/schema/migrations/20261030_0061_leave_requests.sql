-- 20261030_0061_leave_requests.sql
--
-- Time Off leave register (AFC-930, follow-up to AFC-926 ruling A).
-- Spec authority: docs/adr/ADR-0012-leave-requests-register.md.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no leave_requests / leave_request_events table exists in
-- services/directus/schema/migrations/):
--   leave_requests       -- §Dec.1: requester_user (required) + nullable
--                           requester_person, leave_type enum, start/end
--                           dates (end >= start), reason (required,
--                           non-blank), status pending/approved/rejected,
--                           decided_by/decided_at (set on decision, NULL
--                           while pending) + branch required / zone denorm.
--   leave_request_events -- §Dec.1: explicit audit trail
--                           (created/updated/status_changed/note),
--                           following the welfare_case_events (§6.3) and
--                           transfer_events (0013) precedent -- never silent
--                           reliance on the Directus activity log.
--
-- CHOICE, STATED (new tables vs transfers reuse): new per-domain tables.
-- Forcing leave rows into `transfers` (from/to branch + branches_differ)
-- carries dead columns and a meaningless invariant (ADR-0012 Alt.1).
-- Per-domain tables keep the rollback boundary clean (the down script drops
-- exactly what this file creates).
--
-- CHOICE, STATED (edits are route rules, not CHECKs): only pending rows are
-- editable and only by the requester; approve/reject stamps decided_by/at
-- and writes the audit row. A CHECK cannot know the actor (the 0013
-- announcement-approval precedent, Dec.2).
--
-- CHOICE, STATED (staging reconciliation): staging already holds unowned
-- leave_requests / leave_balances tables (AFC-925) created outside this
-- sequence. This file uses CREATE TABLE IF NOT EXISTS + FIXED constraint
-- names (the 0013/0003 merge-contract pattern) plus a fail-closed §2b block
-- (AFC-934 F1): if the table exists but any audited CHECK is absent, the
-- migration refuses (restrict_violation) rather than silently adopting the
-- unaudited shape. It does NOT create leave_balances: accrual rules are
-- unspecced and that table stays unowned until its slice specs it
-- (ADR-0012, out of scope).
--
-- CHOICE, STATED (no Directus policy rows): this file sets the Postgres
-- ceiling only. Seeding directus_permissions rows is AFC-925's
-- backfill-vs-Roles-UI decision, not this migration's.
--
-- GRANTS (Dec.3): Postgres sees one app identity, so branch/zone scoping and
-- the own-row/deciding-officer reads live in the Directus policy + portal
-- route filters, not here. This layer states the ceiling only:
-- directus_app gets SELECT everywhere, INSERT/UPDATE on operational
-- columns, NO DELETE on either table (leave rows are audited ministry
-- facts; corrections are UPDATEs and removals are a reviewed migrator
-- step). reason may hold health-adjacent free text: the Directus policy
-- withholds it from non-deciding roles and the portal strips it (same as
-- tasks.description, 0013 §10 posture) -- this layer withholds no column
-- from directus_app because Postgres sees one app identity (0005 §7 pattern).
--
-- Rollback: rollback/20261030_0061_leave_requests.down.sql (refuses while
-- either table holds rows; drops in dependency order, no CASCADE).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
--
-- CTO APPROVAL (personal-data gate, ADR-0012): this register stores personal
-- data (requester identity, dates, free-text reason). Approved for
-- implementation by CTO (MediaTech) 2026-10-30. Recorded degradation: there
-- is no independent security reviewer on this team (board declined the seat
-- on cost), so CTO self-review is not independent review -- same
-- degradation as recorded in 0037. SecurityEngineer review is required
-- before this migration applies to staging.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
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
-- 1. leave_requests (§Dec.1). requester_user is the Directus user id
--    (Directus-owned, bare uuid, no FK -- the 0037 precedent: the audit must
--    survive the auth store's lifecycle). requester_person links the person
--    register where resolvable. branch required (scopeless record
--    invisible, §10); zone denorm Flow-maintained. decided_* NULL while
--    pending; the route stamps them on approve/reject (Dec.2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user  uuid NOT NULL,
  requester_person uuid,
  branch          uuid NOT NULL,
  zone            uuid,
  leave_type      text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  decided_by      uuid,
  decided_at      timestamptz,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_dates_ordered
    CHECK (end_date >= start_date),
  CONSTRAINT leave_requests_decision_stamped_together
    CHECK ((decided_by IS NULL AND decided_at IS NULL)
        OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT leave_requests_type_allowed
    CHECK (leave_type IN ('annual', 'sick', 'compassionate', 'study', 'unpaid', 'other')),
  CONSTRAINT leave_requests_status_allowed
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT leave_requests_reason_nonblank
    CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE leave_requests IS
  'Time Off leave register (AFC-930, ADR-0012). One row per request: requester_user required (+ requester_person where resolvable), type enum, ordered start/end dates, non-blank reason, pending/approved/rejected lifecycle; decided_by/at stamped together on decision by the route. Branch required for §10 scoping; reason is a restricted read (deciding officers + area via policy, stripped in routes).';

CREATE INDEX IF NOT EXISTS leave_requests_requester_status_idx
  ON leave_requests (requester_user, status);
CREATE INDEX IF NOT EXISTS leave_requests_branch_idx
  ON leave_requests (branch);
CREATE INDEX IF NOT EXISTS leave_requests_zone_idx
  ON leave_requests (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS leave_requests_status_idx
  ON leave_requests (status);
CREATE INDEX IF NOT EXISTS leave_requests_start_date_idx
  ON leave_requests (start_date);

-- ---------------------------------------------------------------------------
-- 2. leave_request_events (explicit audit, transfer_events precedent).
--    The portal route writes created on request, status_changed on every
--    approve/reject/edit-of-pending, note for freeform. Append-only in
--    spirit: no UPDATE/DELETE grants below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_request_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  event_type    text NOT NULL DEFAULT 'note',
  detail        text,
  actor_user    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_request_events_type_allowed
    CHECK (event_type IN ('created', 'updated', 'status_changed', 'note'))
);

COMMENT ON TABLE leave_request_events IS
  'Explicit leave-request audit (AFC-930; welfare_case_events precedent). Portal routes write created/status_changed/note; corrections are new rows.';

CREATE INDEX IF NOT EXISTS leave_request_events_request_created_idx
  ON leave_request_events (leave_request, created_at);

-- ---------------------------------------------------------------------------
-- 2b. Fail-closed staging reconciliation (AFC-934 F1, blocking).
--     Staging already holds an unowned leave_requests table of unknown
--     definition (AFC-925). CREATE TABLE IF NOT EXISTS above is a no-op
--     there, so without this block a divergent staging shape would silently
--     survive while every downstream reader believes the audited definition
--     holds -- on a personal-data register. Require every CHECK by its FIXED
--     name; if the table exists but any audited CHECK is absent, refuse with
--     a sentence (restrict_violation) instead of adopting the unaudited
--     shape. Fresh installs pass (the names were just created above).
--     Remedy: reconcile staging to ADR-0012 out of band, then re-run; or
--     record a pg_constraint pre-flight on AFC-930 before apply.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY[
      'leave_requests_dates_ordered',
      'leave_requests_decision_stamped_together',
      'leave_requests_type_allowed',
      'leave_requests_status_allowed',
      'leave_requests_reason_nonblank',
      'leave_request_events_type_allowed'
    ]) AS c
   WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = c);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'leave_requests 0061 refuses to adopt staging shape: required CHECK constraint(s) % absent. Staging holds an unowned leave_requests table (AFC-925) whose definition diverges from ADR-0012. Reconcile the table to the audited definition out of band, or paste a pg_constraint pre-flight on AFC-930, then re-run.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'leave_requests 0061 CHECK reconciliation: all 6 audited CHECKs present.';
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Conditional FKs onto parent tables owned elsewhere (the 0003
--    merge-contract pattern). Each lands only where the parent exists, under
--    a FIXED name so reruns and the contract test agree; a missing parent
--    skips loudly rather than forking a table another slice owns.
--    Branch/person parents RESTRICT (a requested leave never deletes its
--    branch or person by accident); denorm zone SET NULL; audit children
--    CASCADE (see §2, real FK -- referent created here). requester_user,
--    decided_by, created_by, actor_user are Directus-owned: bare uuid, no
--    FK (0037 precedent).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_person_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_person_fkey
      FOREIGN KEY (requester_person) REFERENCES people(id) ON DELETE RESTRICT;
    RAISE NOTICE 'leave_requests_person_fkey ensured (RESTRICT).';
  ELSE
    RAISE NOTICE 'leave_requests_person_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_branch_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'leave_requests_branch_fkey ensured (RESTRICT).';
  ELSE
    RAISE NOTICE 'leave_requests_branch_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping leave_requests_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_zone_fkey') THEN
    ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'leave_requests_zone_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'leave_requests_zone_fkey already present, left alone.';
  END IF;
END
$$;

-- Backfill denorm where the branch parent is known. Rerunnable: only rows
-- whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.leave_requests') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE leave_requests l SET zone = br.zone
      FROM branches br WHERE l.zone IS NULL AND l.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'leave_requests zone denorm backfilled from branch.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    leave rows are audited ministry facts; erasure runs as
--    retention_worker, never through the API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON leave_requests TO directus_app;
GRANT INSERT (requester_user, requester_person, branch, zone, leave_type, start_date, end_date, reason, status, decided_by, decided_at, created_by)
  ON leave_requests TO directus_app;
GRANT UPDATE (requester_person, zone, leave_type, start_date, end_date, reason, status, decided_by, decided_at)
  ON leave_requests TO directus_app;

GRANT SELECT ON leave_request_events TO directus_app;
GRANT INSERT (leave_request, event_type, detail, actor_user)
  ON leave_request_events TO directus_app;
GRANT UPDATE (detail) ON leave_request_events TO directus_app;

REVOKE ALL ON leave_requests FROM PUBLIC;
REVOKE ALL ON leave_request_events FROM PUBLIC;
