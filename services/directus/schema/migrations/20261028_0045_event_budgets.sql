-- Migration 0045: event budgets + admin-managed expense categories (AFC-825,
-- parent AFC-756 scope follow-up per chairman direction 2026-10-27).
--
-- Budgets are per expense category so reporting and charts read category by
-- category; an admin can add new categories (expense_categories register)
-- instead of the fixed eight living only in code.
--
-- What this file does:
--   1. expense_categories register (key PK, label, sort, active; seeded
--      with the eight 0044 categories + other). Lists are portal-read;
--      only area admins write (route-enforced; grants below match).
--   2. event_budgets register: one row per planned line (event + category
--      + amount). Append-only like expenses (no UPDATE, no DELETE):
--      a revised plan is a new row and the latest row per category wins
--      (resolved in the route, pinned by suite 45). Variance is computed
--      client-side against summed event_expenses.
--   3. event_expenses.category stops being a static eight-way CHECK and
--      becomes a FOREIGN KEY into the register, so admin-added categories
--      are spendable. The CHECK it replaces enforced exactly the seeded
--      set, and the register is seeded in the same transaction, so no
--      existing row can violate the new constraint. The other-label
--      pairing CHECK is untouched.
--
-- GRANTS (0044 §5 posture). directus_app gets SELECT on both registers;
-- event_budgets INSERT on operational columns only (event, category_key,
-- amount, notes, recorded_by), NO UPDATE, NO DELETE; expense_categories
-- INSERT (key, label, sort, active) + UPDATE (label, sort, active),
-- NO DELETE (deactivate instead). REVOKE PUBLIC on both.
--
-- Review: R1 self-claim by the operator run (AFC-825). R2 CTO review on
-- the AFC-825 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0045_event_budgets.down.sql (refuses while
-- budgets hold rows, while non-seed categories exist, or while expenses
-- use a non-seed category; restores the static CHECK; drops the tables).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
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
-- 1. OWNERSHIP PRECONDITION (0042 §1 pattern). Parents plus the register
--    this file alters must already belong to directus_migrator.
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
         AND c.relname IN ('events', 'branches', 'zones', 'event_expenses')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the event_budgets register: % is not owned by '
      'directus_migrator, and only an owner can constrain or GRANT on it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. expense_categories. The spend taxonomy, admin-managed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  key                  text PRIMARY KEY,
  label                text NOT NULL,
  sort                 integer NOT NULL DEFAULT 100,
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE expense_categories IS
  'Spend taxonomy for event budgets and expenses (AFC-825). Seeded with the eight 0044 categories + other; area admins add new keys (portal route, no DELETE — deactivate instead). event_expenses.category references this register.';

INSERT INTO expense_categories (key, label, sort) VALUES
  ('venue',      'Venue',       10),
  ('feeding',    'Feeding',     20),
  ('transport',  'Transport',   30),
  ('publicity',  'Publicity',   40),
  ('honorarium', 'Honorarium',  50),
  ('equipment',  'Equipment',   60),
  ('welfare',    'Welfare',     70),
  ('other',      'Other',       80)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. event_budgets. One row per planned line; latest row per category wins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_budgets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
  category_key         text NOT NULL REFERENCES expense_categories(key),
  amount               numeric(12,2) NOT NULL CHECK (amount >= 0),
  notes                text,
  recorded_by          uuid,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE event_budgets IS
  'Per-event budget lines (AFC-825). Append-only like expenses: no UPDATE, no DELETE anywhere; a revised plan is a new row and the route reads the latest row per (event, category). Variance is computed against summed event_expenses.';

CREATE INDEX IF NOT EXISTS event_budgets_event_idx ON event_budgets (event);
CREATE INDEX IF NOT EXISTS event_budgets_event_category_idx
  ON event_budgets (event, category_key, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. event_expenses.category becomes a register FK. The dropped CHECK
--    enforced exactly the seeded set, seeded above in the same transaction,
--    so no existing row can violate the new constraint. The other-label
--    pairing CHECK is untouched.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_category_check') THEN
    ALTER TABLE event_expenses DROP CONSTRAINT event_expenses_category_check;
    RAISE NOTICE 'CHECK event_expenses_category_check dropped: the category set now lives in expense_categories.';
  ELSE
    RAISE NOTICE 'event_expenses_category_check already absent, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_category_fkey') THEN
    ALTER TABLE event_expenses ADD CONSTRAINT event_expenses_category_fkey
      FOREIGN KEY (category) REFERENCES expense_categories(key);
    RAISE NOTICE 'FK added: event_expenses.category -> expense_categories(key).';
  ELSE
    RAISE NOTICE 'event_expenses_category_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 5. Least-privilege ceiling. SELECT on both registers; budgets INSERT on
--    operational columns only, NO UPDATE, NO DELETE (latest-wins revision);
--    categories INSERT + UPDATE(label, sort, active) for the area-admin
--    route, NO DELETE (deactivate instead).
-- ---------------------------------------------------------------------------
GRANT SELECT ON expense_categories TO directus_app;
GRANT INSERT (key, label, sort, active) ON expense_categories TO directus_app;
GRANT UPDATE (label, sort, active) ON expense_categories TO directus_app;

GRANT SELECT ON event_budgets TO directus_app;
GRANT INSERT (event, category_key, amount, notes, recorded_by)
  ON event_budgets TO directus_app;

REVOKE ALL ON expense_categories FROM PUBLIC;
REVOKE ALL ON event_budgets FROM PUBLIC;
