-- 20261020_0016_invite_quota_slots.sql
--
-- Slice 4d: atomic invite quota via ledger-slot claim (AFC-516, AFC-518).
-- Spec authority: docs/adr/ADR-0011-invite-quota-ledger-slots.md (the
-- authority for every judgment call below),
-- docs/planning/data-model-v4.md §3.2,
-- 20261020_0005_event_invites.sql (header/style conventions),
-- apps/web/server/api/invites/index.post.ts (F3 TOCTOU gap this closes).
-- Parent: AFC-464.
--
-- WHAT THIS FILE CREATES
--   invite_quota_slots -- one row per claimed quota slot for one member in
--     one calendar window (ADR-0011): writers claim a slot by INSERT and let
--     the UNIQUE serialize them. Exactly D day-winners / W week-winners
--     regardless of interleaving. Two grains: period = 'day' with
--     period_start = the Africa/Lagos calendar date, period = 'week' with
--     period_start = the Monday of the Africa/Lagos week (calendar Mon-Sun).
--     Slots are never mutated (no UPDATE grant ever): a claim is an INSERT,
--     a release is a DELETE of the rows this attempt claimed. Orphan slots
--     (crash between claim and invite write) waste quota -- the fail-safe
--     direction (blocks more, never queues past the limit).
--   Surrogate id uuid PRIMARY KEY (Directus collections need a single-column
--     PK for /items/:id; the repo has no checked-in collection config, tables
--     become collections the same way event_invites did). Atomicity rests on
--     UNIQUE (inviter_user, period, period_start, slot_no), which is the
--     exact equivalent of ADR-0011's composite-PK wording for serialisation
--     purposes (stated deviation: ADR says "PK on all four columns"; the
--     UNIQUE enforces the same single-winner-per-slot invariant while keeping
--     the Directus single-column PK shape).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No trigger, no function returning trigger, no rule, no constraint on any
--   other table (ADR-0011: the rollback-control gate has nothing to reconcile
--   and the grandfather file stays at zero entries). event_invites,
--   directus_users, events are owned elsewhere and untouched here -- no ALTER,
--   no GRANT touched on any sibling table.
--   invite_rate_gate() stays unchanged as the UX pre-check; the claim is
--   authoritative.
--
-- LEAST PRIVILEGE, CEILING STATED (data-model-expansion §10 pattern):
--   directus_app: SELECT + INSERT + DELETE on invite_quota_slots only.
--   DELETE = release of this attempt's own claimed slots only (route-layer
--   discipline: DELETE by id of the rows just claimed); no UPDATE grant ever.
--   Nothing else in this file grants anything to anyone.
--
-- Rollback: rollback/20261020_0016_invite_quota_slots.down.sql (refuses while
-- the ledger holds a row; drops only the table created here). Owner: migration
-- role (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation or
-- superuser capability; only GRANT/REVOKE below.
-- No durations, no awareness_at.

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
-- 1. invite_quota_slots (ADR-0011 §1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invite_quota_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_user uuid NOT NULL,
  period       text NOT NULL CHECK (period IN ('day', 'week')),
  period_start date NOT NULL,
  slot_no      integer NOT NULL CHECK (slot_no >= 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_quota_slots_one_winner_per_slot
    UNIQUE (inviter_user, period, period_start, slot_no)
);

COMMENT ON TABLE invite_quota_slots IS
  'Atomic invite quota ledger (ADR-0011, AFC-516). One row = one claimed slot for one member in one calendar window; writers claim by INSERT and the UNIQUE serializes them. day = Africa/Lagos calendar date, week = Monday of the Africa/Lagos week. Slots are never updated; release is DELETE of the rows this attempt claimed.';
COMMENT ON COLUMN invite_quota_slots.inviter_user IS
  'The member whose quota this slot consumes (session user id).';
COMMENT ON COLUMN invite_quota_slots.period IS
  'Quota grain: day (Lagos calendar date) or week (Monday of the Lagos week).';
COMMENT ON COLUMN invite_quota_slots.period_start IS
  'Window key: Lagos calendar date for day, Lagos Monday for week.';
COMMENT ON COLUMN invite_quota_slots.slot_no IS
  'Slot index within the window, 0-based. The writer tries 0..limit-1; the UNIQUE is the atomicity.';

CREATE INDEX IF NOT EXISTS invite_quota_slots_window_idx
  ON invite_quota_slots (inviter_user, period, period_start);

-- ---------------------------------------------------------------------------
-- 2. Least privilege: the app claims (INSERT), reads (SELECT) and releases
--    its own attempt's rows (DELETE by id). No UPDATE ever.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON invite_quota_slots TO directus_app;

REVOKE ALL ON invite_quota_slots FROM PUBLIC;
