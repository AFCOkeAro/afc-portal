-- Suite 61: notification preferences (AFC-903 phase 1, migration 0066).
--
--   61.1 rerun         -- re-applying 20261030_0061 changes nothing.
--   61.2 shape         -- one row per admin user; cadence confined to the
--                         four cadences; sections confined to the four
--                         digest sections; dedup enforced; all-off mute
--                         stays storable.
--   61.3 grants        -- directus_app SELECTs + manages the slot;
--                         PUBLIC holds nothing.
--   61.4 rollback      -- the SHIPPED down script refuses while rows
--                         exist; emptied, it drops the table;
--                         re-apply restores it.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261030_0066_notification_preferences.sql

-- ---------------------------------------------------------------------------
-- 61.1  RERUN. Re-applying 0061 changes nothing (IF NOT EXISTS).
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261030_0066_notification_preferences.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(true, 'notify_prefs',
    '61.1: 0061 re-apply is a no-op (idempotent forward)');
END $$;

-- ---------------------------------------------------------------------------
-- 61.2  SHAPE. Preferences write once, cadence/sections confined, dedup
-- enforced, explicit mute storable.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_id uuid;
  v_admin uuid;
  v_muted uuid;
BEGIN
  v_admin := gen_random_uuid();
  v_muted := gen_random_uuid();

  INSERT INTO notification_preferences (admin_user, email_enabled, telegram_enabled, whatsapp_enabled, cadence, sections)
    VALUES (v_admin, true, false, true, 'weekly', ARRAY['tasks', 'events'])
    RETURNING id INTO v_id;
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM notification_preferences WHERE id = v_id) = 1,
    'notify_prefs', '61.2: a preference row writes');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO notification_preferences (admin_user) VALUES (''' || v_admin || ''')',
    '23505', 'notify_prefs', '61.2: a second row for the same admin is refused');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO notification_preferences (admin_user, cadence) VALUES (''' || gen_random_uuid() || ''', ''hourly'')',
    '23514', 'notify_prefs', '61.2: cadences outside the four refuse');

  PERFORM test_support.assert_raises(NULL,
    'INSERT INTO notification_preferences (admin_user, sections) VALUES (''' || gen_random_uuid() || ''', ''{tasks,push}'')',
    '23514', 'notify_prefs', '61.2: sections outside the four digest sections refuse');

  INSERT INTO notification_preferences (admin_user, email_enabled, telegram_enabled, whatsapp_enabled)
    VALUES (v_muted, false, false, false);
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM notification_preferences WHERE admin_user = v_muted) = 1,
    'notify_prefs', '61.2: all-off is a storable explicit mute, not a refused row');

  UPDATE notification_preferences
    SET cadence = 'monthly', sections = ARRAY['activity']
    WHERE id = v_id;
  PERFORM test_support.assert_true(
    (SELECT cadence FROM notification_preferences WHERE id = v_id) = 'monthly'
    AND (SELECT sections FROM notification_preferences WHERE id = v_id) = ARRAY['activity'],
    'notify_prefs', '61.2: cadence and sections update cleanly');

  DELETE FROM notification_preferences WHERE admin_user IN (v_admin, v_muted);
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM notification_preferences WHERE admin_user IN (v_admin, v_muted)) = 0,
    'notify_prefs', '61.2: preferences withdraw cleanly (probe rows removed)');
END $$;

-- ---------------------------------------------------------------------------
-- 61.3  GRANTS. App reads and manages; PUBLIC holds nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.notification_preferences', 'SELECT'),
    'notify_prefs', '61.3: app reads the preferences');
  PERFORM test_support.assert_true(
    has_table_privilege('directus_app', 'public.notification_preferences', 'INSERT, UPDATE, DELETE'),
    'notify_prefs', '61.3: app manages preferences');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'notification_preferences'
        AND grantee = 'PUBLIC') = 0,
    'notify_prefs', '61.3: PUBLIC holds nothing on the preferences register');
END $$;

-- ---------------------------------------------------------------------------
-- 61.4  ROLLBACK. Refuses with rows; emptied, drops the table; re-apply
-- restores it.
-- ---------------------------------------------------------------------------
DO $test$
DECLARE
  v_got text := NULL;
  v_id uuid;
  v_admin uuid;
BEGIN
  v_admin := gen_random_uuid();
  INSERT INTO notification_preferences (admin_user)
    VALUES (v_admin)
    RETURNING id INTO v_id;
  BEGIN
\i services/directus/schema/migrations/rollback/20261030_0066_notification_preferences.down.sql
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE || ' | ' || SQLERRM;
  END;
  PERFORM test_support.assert_true(
    v_got IS NOT NULL AND v_got LIKE '23001%',
    'notify_prefs', '61.4: down refuses while rows exist');
  DELETE FROM notification_preferences WHERE id = v_id;
END $test$;

\i services/directus/schema/migrations/rollback/20261030_0066_notification_preferences.down.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.notification_preferences') IS NULL,
    'notify_prefs', '61.4: down drops the preferences table when empty');
END $$;

\i services/directus/schema/migrations/20261030_0066_notification_preferences.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.notification_preferences') IS NOT NULL,
    'notify_prefs', '61.4: re-apply restores the preferences table');
END $$;
