-- rollback/20261029_0062_funerals.down.sql
--
-- Reversal for 20261029_0062_funerals.sql (AFC-884).
--
-- What it destroys, stated plainly:
--   funeral_cases -- every funeral record. Refuses while rows exist: a
--     rolled-back register silently drops the family's funeral record,
--     so a non-empty table does not roll back.
--   people_status_lifecycle_check -- the widened status set. Restored to
--     the original two-value people_status_check, and ONLY when no
--     deceased row exists: widening back over a deceased person would
--     strand a value the CHECK forbids.
--
-- What it does NOT destroy: people/branches/zones rows (only referenced),
-- Directus file rows behind the uploads, roles, policies, permissions, or
-- any grant on any other table. Where the table is absent (forward never
-- applied) the script is a no-op with a NOTICE.

DO $$
DECLARE
  v_rows integer := 0;
  v_deceased integer := 0;
BEGIN
  IF to_regclass('public.funeral_cases') IS NOT NULL THEN
    SELECT count(*) INTO v_rows FROM funeral_cases;
  END IF;

  IF v_rows > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back funerals: the table holds % row(s). Remove the records first; an empty table rolls back, anything else does not.',
      v_rows
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF to_regclass('public.people') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'people'
                    AND column_name = 'status') THEN
    SELECT count(*) INTO v_deceased FROM people WHERE status = 'deceased';
  END IF;

  IF v_deceased > 0 THEN
    RAISE EXCEPTION
      'refusing to narrow people.status: % row(s) are marked deceased. Re-home those records first; only then does the CHECK narrow.',
      v_deceased
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE 'funerals rollback proceeding: no rows, no deceased.';
END $$;

DROP TABLE IF EXISTS funeral_cases;

DO $$
BEGIN
  IF to_regclass('public.people') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_status_lifecycle_check') THEN
      ALTER TABLE people DROP CONSTRAINT people_status_lifecycle_check;
      RAISE NOTICE 'people_status_lifecycle_check dropped (widening reversed).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'people_status_check')
       AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'people'
                      AND column_name = 'status') THEN
      ALTER TABLE people ADD CONSTRAINT people_status_check
        CHECK (status IN ('active', 'archived'));
    END IF;
  END IF;
END
$$;
