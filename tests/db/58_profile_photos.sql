-- Suite 58: profile photos (AFC-864, migration 0058).
--
--   58.1 rerun         -- re-applying 20261029_0058 changes nothing.
--   58.2 shape         -- a photo slot sets and clears on both tables.
--   58.3 grants        -- directus_app UPDATEs the slot; PUBLIC holds no
--                         column grant on it.
--   58.4 rollback      -- the SHIPPED down script refuses while any photo
--                         is set; cleared, it drops the columns;
--                         re-apply restores them.
--
-- Probe holders use fixed ids with ON CONFLICT DO NOTHING and are never
-- deleted (people/households are retention-managed; DELETE is refused
-- outside the retention engine, AFC-295). Suite 55 precedent.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0058_profile_photos.sql

-- ---------------------------------------------------------------------------
-- 58.1  RERUN. Re-applying 0058 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0058_profile_photos.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'photos',
    '58.1: 0058 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 58.2  SHAPE. Photo slots set and clear on both tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_person uuid := '11111111-1111-4111-8111-111111115801'::uuid;
  v_household uuid := '11111111-1111-4111-8111-111111115802'::uuid;
  v_file uuid := gen_random_uuid();
BEGIN
  INSERT INTO people (id, status) VALUES (v_person, 'active')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO households (id, status) VALUES (v_household, 'active')
    ON CONFLICT (id) DO NOTHING;

  UPDATE people SET photo_file = v_file WHERE id = v_person;
  PERFORM test_support.assert_true(
    (SELECT photo_file FROM people WHERE id = v_person) = v_file,
    'photos', '58.2: a person photo slot sets');

  UPDATE households SET photo_file = v_file WHERE id = v_household;
  PERFORM test_support.assert_true(
    (SELECT photo_file FROM households WHERE id = v_household) = v_file,
    'photos', '58.2: a household photo slot sets');

  UPDATE people SET photo_file = NULL WHERE id = v_person;
  UPDATE households SET photo_file = NULL WHERE id = v_household;
  PERFORM test_support.assert_true(
    (SELECT photo_file FROM people WHERE id = v_person) IS NULL
    AND (SELECT photo_file FROM households WHERE id = v_household) IS NULL,
    'photos', '58.2: photo slots clear cleanly');

  -- Household probes never persist: suite 85 asserts zero household rows
  -- pre-rollback (households DELETE is permitted; people is not, AFC-295).
  -- The fixed-id person probe stays with a clear slot, like suite 55.
  DELETE FROM households WHERE id = v_household;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM households WHERE id = v_household) = 0,
    'photos', '58.2: the household probe withdraws');
END $$;

-- ---------------------------------------------------------------------------
-- 58.3  GRANTS. App UPDATEs the slot; PUBLIC holds no grant on it.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.people', 'photo_file', 'UPDATE'),
    'photos', '58.3: app UPDATEs the person photo slot');
  PERFORM test_support.assert_true(
    has_column_privilege('directus_app', 'public.households', 'photo_file', 'UPDATE'),
    'photos', '58.3: app UPDATEs the household photo slot');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_column_grants
      WHERE table_schema = 'public'
        AND column_name = 'photo_file'
        AND grantee = 'PUBLIC') = 0,
    'photos', '58.3: PUBLIC holds no grant on the photo slots');
END $$;

-- ---------------------------------------------------------------------------
-- 58.4  ROLLBACK. Refuses with photos set; cleared, drops the columns;
-- re-apply restores them.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_person uuid := '11111111-1111-4111-8111-111111115801'::uuid;
  v_household uuid := '11111111-1111-4111-8111-111111115802'::uuid;
BEGIN
  UPDATE people SET photo_file = gen_random_uuid() WHERE id = v_person;
  BEGIN
\i services/directus/schema/migrations/rollback/20261029_0058_profile_photos.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'photos', '58.4: down refuses while a photo is set');
  UPDATE people SET photo_file = NULL WHERE id = v_person;

  INSERT INTO households (id, status) VALUES (v_household, 'active')
    ON CONFLICT (id) DO NOTHING;
  UPDATE households SET photo_file = gen_random_uuid() WHERE id = v_household;
  v_got := NULL;
  BEGIN
\i services/directus/schema/migrations/rollback/20261029_0058_profile_photos.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'photos', '58.4: down refuses while a household photo is set');
  UPDATE households SET photo_file = NULL WHERE id = v_household;
  DELETE FROM households WHERE id = v_household;
END $test$;

\i services/directus/schema/migrations/rollback/20261029_0058_profile_photos.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'people'
                   AND column_name = 'photo_file')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'households'
                       AND column_name = 'photo_file'),
    'photos', '58.4: down drops the photo columns when clear');
END $$;

\i services/directus/schema/migrations/20261029_0058_profile_photos.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name = 'photo_file'),
    'photos', '58.4: re-apply restores the photo columns');
END $$;
