-- rollback/20261028_0045_event_budgets.down.sql
--
-- Reversal for 20261028_0045_event_budgets.sql (AFC-825).
--
-- What it destroys, stated plainly:
--   event_budgets -- every row (planned lines; latest-wins history cannot
--     be re-derived once dropped).
--   expense_categories -- the register, seeds included.
--   The event_expenses.category FK (dropped before the register it points
--     to; the static eight-way CHECK is restored so 0044 reads as before).
--
-- What it does NOT destroy: events rows (only referenced), or any grant on
-- any other table. Where the tables are absent (forward never applied)
-- every statement is IF EXISTS and the script is a no-op with a NOTICE.
--
-- Refusals (all restrict_violation): budgets hold rows; non-seed
-- categories exist; expenses use a non-seed category (the restored CHECK
-- would reject them).

DO $$
DECLARE
  v_budgets integer := 0;
  v_custom integer := 0;
  v_stray integer := 0;
BEGIN
  IF to_regclass('public.event_budgets') IS NOT NULL THEN
    SELECT count(*) INTO v_budgets FROM event_budgets;
  END IF;
  IF v_budgets > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event_budgets: the table holds % row(s). Take a verified copy first. Empty tables roll back; anything else does not.',
      v_budgets
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF to_regclass('public.expense_categories') IS NOT NULL THEN
    SELECT count(*) INTO v_custom FROM expense_categories
     WHERE key NOT IN
       ('venue', 'feeding', 'transport', 'publicity', 'honorarium', 'equipment', 'welfare', 'other');
  END IF;
  IF v_custom > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back expense_categories: % non-seed categor(ies) exist. Reassign or record them first; the register cannot shrink under live keys.',
      v_custom
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF to_regclass('public.event_expenses') IS NOT NULL THEN
    SELECT count(*) INTO v_stray FROM event_expenses
     WHERE category NOT IN
       ('venue', 'feeding', 'transport', 'publicity', 'honorarium', 'equipment', 'welfare', 'other');
  END IF;
  IF v_stray > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event_budgets: % expense row(s) use a non-seed category, which the restored eight-way CHECK would reject. Reassign them first.',
      v_stray
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'event_budgets rollback proceeding: no rows, no custom categories, no stray expenses.';
END
$$;

ALTER TABLE IF EXISTS event_expenses DROP CONSTRAINT IF EXISTS event_expenses_category_fkey;

DO $$
BEGIN
  IF to_regclass('public.event_expenses') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_expenses_category_check') THEN
    ALTER TABLE event_expenses ADD CONSTRAINT event_expenses_category_check
      CHECK (category IN
        ('venue', 'feeding', 'transport', 'publicity',
         'honorarium', 'equipment', 'welfare', 'other'));
    RAISE NOTICE 'CHECK event_expenses_category_check restored.';
  ELSE
    RAISE NOTICE 'event_expenses_category_check already present (or no expenses table), left alone.';
  END IF;
END
$$;

DROP TABLE IF EXISTS event_budgets;
DROP TABLE IF EXISTS expense_categories;
