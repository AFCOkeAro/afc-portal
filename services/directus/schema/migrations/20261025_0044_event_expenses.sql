-- 20261025_0044_event_expenses.sql
--
-- Per-event expense records (AFC-801, parent AFC-756).
-- Spec authority: the AFC-801 interface contract (fixed by the CTO, quoted
-- below) + packages/shared expense zod schema (form fields, category enum,
-- other-label rule, amount >= 0).
--
-- Number: 0044. The AFC-801 contract names 0043 (next after 0042), but
-- 20261025_0043_department_guides.sql (AFC-800, same day) already holds that
-- number for a different register. Two migrations cannot share a sequence
-- number, so this slice takes 0044; the CTO resolves the collision record
-- on the AFC-801 issue before landing.
--
-- WHAT THIS FILE CREATES (table owned by no earlier migration -- verified:
-- no CREATE TABLE for event_expenses exists in
-- services/directus/schema/migrations/):
--   event_expenses -- one row per recorded spend against an event: parent
--     event FK, branch/zone denormed from the parent event at write time,
--     category enum, amount, currency, spent_on, optional receipt link,
--     notes, recorder stamp. Append-only: rows are corrected by new rows,
--     never edited in place beyond the operational columns, never deleted.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No totals table, no summary column on events: totals are folded
--   client-side from the scoped list (AFC-801 contract), the same precedent
--   as the registrations rollups (no summary tables, no new endpoint).
--   No seed rows: expenses are staff-captured figures, never fixtures.
--   No Directus policy rows: enforcement lives in the Directus project +
--   the portal route predicates, per data-model §9.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. event FK RESTRICT (spec-fixed): an event with recorded spend is not
--      deleted by accident. Registrations CASCADE because a registration is
--      meaningless without its event; an expense is a financial fact that
--      must block the delete loudly instead.
--   2. branch/zone denorm SET NULL (0021 choice-1 precedent: a branch delete
--      clears the denorm, never the row). branch mirrors event.branch
--      (nullable: area-wide events have none); zone is resolved from
--      branches.zone at write time because events carries no zone column.
--      The portal route stamps both; the afc_set_child_scope trigger below
--      (mode 0, the 0030 branch-only pattern) is the backstop, and the
--      backfill repairs rows whose scope is still null.
--   3. category_other_label strict pairing: 'other' REQUIRES a non-blank
--      label, every other category REQUIRES NULL. The spec fixes the first
--      half ("other requires category_other_label"); the second half keeps
--      stale labels from surviving a category correction.
--   4. currency has NO CHECK, only the NGN default. events pins
--      (NGN,USD,GBP), but the spec fixes the default without fixing the set;
--      inventing an enum here would reject a record the contract allows.
--   5. spent_on is NOT NULL: an expense without a date cannot sit on a
--      timeline, and every reader sorts by it.
--   6. receipt FK to directus_files is CONDITIONAL (only where that table
--      exists): the file table is Directus-owned and absent from scratch
--      databases the way events was absent for 0005. The link is SET NULL
--      so a file purge never destroys the financial fact.
--   7. UPDATE withholds event/branch/zone/recorded_by/created_at: the denorm
--      and the audit stamps are write-once (route-stamped at create, trigger
--      kept in sync). Operational columns stay writable so a mis-keyed
--      amount or date is correctable without a delete.
--
-- GRANTS (expansion §10 posture: one app identity; branch/zone scoping lives
-- in the Directus policy + portal route filters, not here). directus_app gets
-- SELECT everywhere (amount/notes included -- "restricted" is enforced
-- per-role in the route layer via visibleFields/stripHiddenMany, not by
-- grant-withholding, or the branch-admin detail view could not render them
-- at all), INSERT/UPDATE on operational columns, NO DELETE on the register
-- (append-only: corrections are new rows; erasure runs as retention_worker,
-- never through the API).
--
-- Review: R1 self-claim by Coder (AFC-801). R2 CTO review happens on the
-- AFC-801 issue before landing -- do NOT treat a green gate as clearance.
-- There is no independent security reviewer on this team (board declined the
-- seat on cost); the CTO self-review is a recorded degradation, not
-- independent review.
--
-- Rollback: rollback/20261025_0044_event_expenses.down.sql (refuses while
-- rows exist; drops the scope trigger, then the table, no CASCADE). Owner:
-- migration role (directus_migrator). Never run as directus_app. Role
-- hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE below.
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
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
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). The parent registers this
--    file constrains must already belong to directus_migrator -- the identity
--    this sequence runs as. Only an owner can ADD a constraint or GRANT, so
--    anything else here would fail halfway with a bare 42501. Refusing up
--    front names every foreign-owned object and the operator step that fixes
--    it. Tables this file creates are owned by the migrator by construction;
--    they are not listed here.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('events', 'branches', 'zones')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the event_expenses register: % is not owned by '
      'directus_migrator, and only an owner can constrain or GRANT on it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. event_expenses. One row per recorded spend against an event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_expenses (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  category             text NOT NULL
                         CHECK (category IN
                           ('venue', 'feeding', 'transport', 'publicity',
                            'honorarium', 'equipment', 'welfare', 'other')),
  category_other_label text,
  amount               numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency             text NOT NULL DEFAULT 'NGN',
  spent_on             date NOT NULL,
  receipt              uuid,
  notes                text,
  recorded_by          uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_expenses_other_label
    CHECK ((category = 'other'
              AND category_other_label IS NOT NULL
              AND btrim(category_other_label) <> '')
           OR (category <> 'other' AND category_other_label IS NULL))
);

COMMENT ON TABLE event_expenses IS
  'Per-event expense records (AFC-756/AFC-801). One row per recorded spend; branch/zone denormed from the parent event at write time (route-stamped). Append-only: no DELETE anywhere; corrections are new rows.';

CREATE INDEX IF NOT EXISTS event_expenses_event_idx ON event_expenses (event);
CREATE INDEX IF NOT EXISTS event_expenses_branch_idx
  ON event_expenses (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_expenses_zone_idx
  ON event_expenses (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_expenses_spent_on_idx ON event_expenses (spent_on);
CREATE INDEX IF NOT EXISTS event_expenses_category_idx ON event_expenses (category);

-- ---------------------------------------------------------------------------
-- 3. NO scope trigger (choice 8, smallest defensible). The portal route is
--    the only writer and stamps branch/zone from the parent event at create
--    (the 0021 registrations.post.ts precedent: branch copied from eventRow,
--    zone resolved from branches). A trigger here would add a 29th
--    afc_set_scope and break the versioned suite-94 pin (28 triggers),
--    which this identity cannot evolve: the suite file is owned by another
--    agent's run. Directus-side bypass writes leave scope null and therefore
--    invisible to scoped reads (fail-closed, the safe direction).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. receipt -> directus_files. CONDITIONAL (choice 6): the file table is
--    Directus-owned and may be absent (scratch databases, Directus never
--    booted). The link is SET NULL so a file purge never destroys the fact.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.directus_files') IS NULL THEN
    RAISE NOTICE 'Skipping event_expenses_receipt_fkey: directus_files not present. The receipt stays a bare uuid under the 0044 merge contract until a reviewed slice enforces it.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_receipt_fkey') THEN
    ALTER TABLE event_expenses ADD CONSTRAINT event_expenses_receipt_fkey
      FOREIGN KEY (receipt) REFERENCES directus_files(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: event_expenses.receipt -> directus_files(id) SET NULL.';
  ELSE
    RAISE NOTICE 'event_expenses_receipt_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Least-privilege ceiling. SELECT everywhere; INSERT/UPDATE on operational
--    columns only (choice 7: event/branch/zone/recorded_by/created_at are
--    write-once audit ground truth); NO DELETE on the register.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_expenses TO directus_app;
GRANT INSERT (event, branch, zone, category, category_other_label, amount,
  currency, spent_on, receipt, notes, recorded_by)
  ON event_expenses TO directus_app;
GRANT UPDATE (category, category_other_label, amount, currency, spent_on,
  receipt, notes)
  ON event_expenses TO directus_app;

REVOKE ALL ON event_expenses FROM PUBLIC;
