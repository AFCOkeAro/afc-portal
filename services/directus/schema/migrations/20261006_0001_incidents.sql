-- 20261006_0001_incidents.sql
--
-- The NDPA s.40(2) breach register substrate. AFC-166 / ADR-159-2 D7.
--
-- This file is deliberately the *base* table only: it is the state of the
-- world before awareness_at exists, which is what the backfill in
-- 20261006_0002 has to cope with. Splitting them keeps the backfill honest --
-- see docs/adr/ADR-0001-incidents-awareness-clock-origin.md.
--
-- The base table is not, however, "the table and nothing else". It also owns
-- the evidence seal, because the seal is a property of the register rather than
-- of any column on it. See "THE EVIDENCE SEAL" below and
-- docs/adr/ADR-0003-register-seal-owns-its-rollback.md.
--
-- Owner: migration role (directus_migrator). Never run as the Directus
-- runtime role -- see ADR-0001 "credential split".

CREATE TABLE IF NOT EXISTS incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               text NOT NULL UNIQUE,
  summary           text NOT NULL,
  severity          text NOT NULL DEFAULT 'minor'
                      CHECK (severity IN ('minor', 'major', 'critical')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'investigating', 'contained', 'reported', 'closed')),
  branch_id         uuid,
  -- When engineering found it. May be AFTER awareness_at: staff can tell the
  -- board before engineering notices. Never constrain their order.
  detected_at       timestamptz,
  -- When the DPC notified the Commission / data subjects. Ordered after
  -- awareness_at by definition (enforced in 20261006_0002).
  reported_at       timestamptz,
  detected_by       text,
  acknowledged_at   timestamptz,
  contained_at      timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE incidents IS
  'NDPA s.40(2) breach register. Rows are evidence: they transition to closed, they are never deleted.';

CREATE INDEX IF NOT EXISTS incidents_status_idx ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_reported_at_idx ON incidents (reported_at)
  WHERE reported_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- THE EVIDENCE SEAL. 0001 OWNS IT -- ADR-0003.
--
-- WHY IT LIVES HERE AND NOT IN 0002.
--
-- These two guards are properties of "`incidents` is evidence". They are not
-- properties of "`awareness_at` exists": neither function reads a single column,
-- and neither trigger has a WHEN clause. The COMMENT ON TABLE above states the
-- rule in the product's own words -- "Rows are evidence: they transition to
-- closed, they are never deleted" -- and this file is where the table is
-- created, so this is where the enforcement of that sentence belongs. They
-- predate awareness_at by construction: a register that could be truncated was
-- never a register, and awareness_at added an obligation to it rather than
-- creating one.
--
-- WHY THE LAYERING WAS A DEFECT, AND THIS IS THE FIX.
--
-- The guards used to live only in 20261006_0002, and
-- rollback/20261006_0002_incidents_awareness_at.down.sql dropped them along with
-- the clock objects. Reversing the clock migration therefore disarmed the
-- register: after that script, DELETE and TRUNCATE both succeeded for the table
-- owner and for any session holding table-level DELETE and TRUNCATE -- which is
-- what 20_immutability.sql hands every v4 role, and the only identity Directus
-- has is directus_app. Reproduced by execution; the tables are on AFC-253.
--
-- directus_app still saw 42501 afterwards, because the column-grant layer below
-- survives independently, so a check on that one identity read green over a
-- register that was no longer sealed. That is why the acceptance criterion is
-- the owner and a fully-granted app-style role, never directus_app alone.
--
-- Three things make the seal safe to keep here:
--   * it is re-asserted by 0002, so a database whose 0001 predates this change
--     is repaired rather than stranded;
--   * rollback/20261006_0002_incidents_awareness_at.down.sql re-asserts it after
--     its own drops, so that reversal can no longer end in an unsealed register;
--   * the only path that removes it is rollback/20261006_0001_incidents.down.sql,
--     which refuses while the register holds any row.
--
-- IDEMPOTENT BY CONSTRUCTION: CREATE OR REPLACE on both functions,
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER on both guards. Safe to re-run
-- this file over a register that is already sealed.
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

-- TRUNCATE bypasses row-level DELETE triggers entirely, so a table-level
-- statement trigger is the only thing that closes it. Without this,
-- `TRUNCATE incidents` is a full register wipe.
CREATE OR REPLACE FUNCTION incidents_forbid_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'incidents cannot be truncated (breach register evidence).'
    USING ERRCODE = 'restrict_violation';
END $$;

COMMENT ON FUNCTION incidents_forbid_truncate() IS
  'Closes the TRUNCATE hole, which no row-level guard can reach. Owned by 0001 and re-asserted by 0002 and by 0002''s down script.';

DROP TRIGGER IF EXISTS incidents_no_delete ON incidents;
CREATE TRIGGER incidents_no_delete
  BEFORE DELETE ON incidents
  FOR EACH ROW EXECUTE FUNCTION incidents_forbid_delete();

DROP TRIGGER IF EXISTS incidents_no_truncate ON incidents;
CREATE TRIGGER incidents_no_truncate
  BEFORE TRUNCATE ON incidents
  FOR EACH STATEMENT EXECUTE FUNCTION incidents_forbid_truncate();

-- ---------------------------------------------------------------------------
-- Roles and privileges.
--
-- Credential split (security lens, least privilege, default deny):
--   directus_migrator -- owns every table, runs migrations, never used by the app.
--   directus_app      -- the single DB identity Directus uses for EVERY API role.
--                        Because there is only one identity, the awareness_at
--                        control must be enforced by trigger, not by role
--                        permissions. These column grants are defence in depth.
-- ---------------------------------------------------------------------------
--
-- Both identities are BOOTSTRAP roles, provisioned by the cluster-owner
-- bootstrap step that runs BEFORE the migration sequence. This file asserts they
-- exist and then only ever GRANTs and REVOKEs against them.
--
-- ADR-0002. This block used to CREATE both roles. That is the defect
-- 20261006_0004_retention.sql exposed: because the sequence was privileged for
-- 0001 and unprivileged from 0002 onward, 0001 could mint a role and no later
-- migration could. The first migration that needed a NEW role failed with
-- 42501, and the obvious fix -- granting CREATEROLE to the migrator -- would
-- have let the migration identity promote itself to directus_app.
--
-- Roles are infrastructure. Migrations are history. See
-- services/directus/schema/bootstrap/README.md and scripts/migration-privilege-gate.sh,
-- which fails the build if any migration creates or escalates a role.
--
-- The assertion is fail-closed and names the missing role: a deploy that skips
-- bootstrap gets a sentence it can act on, not a silent partial install.
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
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration: '
      'migrations run as directus_migrator, which holds no CREATEROLE. Run the '
      'bootstrap before migrating -- see services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- Column-level grants on purpose: a table-level INSERT/UPDATE grant cannot be
-- narrowed at column level in PostgreSQL, so the safe form is to grant each
-- writable column explicitly and never name awareness_at / awareness_at_source.
-- Directus always emits explicit column lists, so this is transparent to it.
GRANT SELECT ON incidents TO directus_app;
GRANT INSERT (
  ref, summary, severity, status, branch_id,
  detected_at, reported_at, detected_by,
  acknowledged_at, contained_at, closed_at
) ON incidents TO directus_app;
GRANT UPDATE (
  ref, summary, severity, status, branch_id,
  detected_at, reported_at, detected_by,
  acknowledged_at, contained_at, closed_at
) ON incidents TO directus_app;
-- No DELETE grant, and the evidence seal above adds a trigger that forbids
-- DELETE anyway. Two layers, both required to be removed before a row can
-- disappear -- and they are owned by different files on purpose: this layer is
-- a property of the grants below, the seal is a property of the table, so
-- rolling back the grants is not a path to an unsealed register.

REVOKE ALL ON incidents FROM PUBLIC;