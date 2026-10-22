-- 20261020_0029_remove_sango_ota_and_satellite.sql
--
-- Corrective removal: delete the SANGO-OTA and OKE-ARO-SAT-1 sample branch
-- rows ONLY. The owner has confirmed neither is a branch. This file removes
-- those two rows and nothing else -- no renames, no re-homing, no new seeds.
--
-- WHAT THIS FILE DOES
--   Guard: scan every FK into branches(id) (pg_constraint) and RAISE
--   EXCEPTION naming the referencing table and count if any row still
--   references either id. No CASCADE anywhere.
--   Delete: DELETE FROM branches WHERE code IN ('SANGO-OTA',
--   'OKE-ARO-SAT-1') only; a no-op when the rows are already absent
--   (idempotent rerun).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No zone/area rename; no branch re-homing; no seed of any branch. No
--   roles, no grants (ADR-0002, scripts/migration-privilege-gate.sh).
--
-- Rollback: rollback/20261020_0029_remove_sango_ota_and_satellite.down.sql
-- (re-inserts the exact 0002 seed rows, ON CONFLICT DO NOTHING).
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
-- 1. Refuse guard. Any live reference to either row aborts the migration
--    naming the referencing table and count. Generic pg_constraint scan:
--    every FK into branches(id), present tables only (to_regclass IS NOT NULL
--    skips registers owned elsewhere that are absent from this database).
--    No CASCADE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_code text;
  v_branch uuid;
  v_count integer;
  r record;
BEGIN
  FOREACH v_code IN ARRAY ARRAY['SANGO-OTA', 'OKE-ARO-SAT-1']
  LOOP
    SELECT id INTO v_branch FROM branches WHERE code = v_code;

    IF v_branch IS NULL THEN
      RAISE NOTICE '0029_remove_sango_ota_and_satellite: % already absent, nothing to guard', v_code;
      CONTINUE;
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
          '0029_remove_sango_ota_and_satellite refused: % row(s) in % (%) reference branches % (%)',
          v_count, r.tbl, r.col, v_code, v_branch
          USING ERRCODE = 'restrict_violation';
      END IF;
    END LOOP;

    RAISE NOTICE '0029_remove_sango_ota_and_satellite: no live reference to %, proceeding to delete', v_code;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Delete exactly two rows. Idempotent no-op if already absent.
-- ---------------------------------------------------------------------------
DELETE FROM branches WHERE code IN ('SANGO-OTA', 'OKE-ARO-SAT-1');
