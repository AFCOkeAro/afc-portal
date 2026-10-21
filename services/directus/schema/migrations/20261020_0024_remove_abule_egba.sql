-- 20261020_0024_remove_abule_egba.sql
--
-- AFC-582 (parent AFC-581, child of AFC-578). Narrow corrective removal:
-- delete the erroneous ABULE-EGBA sample branch row ONLY. SANGO-OTA stays.
--
-- WHY: the 0002 seed planted seven Lagos North sample branches; ABULE-EGBA
-- is an erroneous sample with no user-confirmed mapping. The user confirmed
-- its removal on AFC-578/AFC-581. This file removes that one row and nothing
-- else -- no renames, no re-homing, no new seeds.
--
-- WHAT THIS FILE DOES
--   Guard: scan every FK into branches(id) (pg_constraint) and RAISE
--   EXCEPTION naming the referencing table and count if any row still
--   references the ABULE-EGBA id. No CASCADE anywhere.
--   Delete: DELETE FROM branches WHERE code = 'ABULE-EGBA' only; a no-op
--   when the row is already absent (idempotent rerun).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No SANGO-OTA change; no zone/area rename; no branch re-homing; no seed
--   of the 26 mapped branches (out of scope, AFC-581 owns that). No roles,
--   no grants (ADR-0002, scripts/migration-privilege-gate.sh).
--   No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0024_remove_abule_egba.down.sql (re-inserts
-- the exact 0002 seed row, ON CONFLICT DO NOTHING).
-- Owner: migration role (directus_migrator). Never run as directus_app.

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
-- 1. Refuse guard. Any live reference to the ABULE-EGBA row aborts the
--    migration naming the referencing table and count. Generic
--    pg_constraint scan: every FK into branches(id), present tables only
--    (to_regclass IS NOT NULL skips registers owned elsewhere that are
--    absent from this database). No CASCADE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_count integer;
  r record;
BEGIN
  SELECT id INTO v_branch FROM branches WHERE code = 'ABULE-EGBA';

  IF v_branch IS NULL THEN
    RAISE NOTICE '0024_remove_abule_egba: ABULE-EGBA already absent, nothing to guard';
    RETURN;
  END IF;

  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl,
           a.attname AS col
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.branches'::regclass
     ORDER BY 1, 2
  LOOP
    IF to_regclass(r.tbl) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %s WHERE %I = $1', r.tbl, r.col)
      USING v_branch INTO v_count;
    IF v_count > 0 THEN
      RAISE EXCEPTION
        '0024_remove_abule_egba refused: % row(s) in % (%) reference branches ABULE-EGBA (%)',
        v_count, r.tbl, r.col, v_branch
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;

  RAISE NOTICE '0024_remove_abule_egba: no live reference to ABULE-EGBA, proceeding to delete';
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Delete exactly one row. Idempotent no-op if already absent.
-- ---------------------------------------------------------------------------
DELETE FROM branches WHERE code = 'ABULE-EGBA';
