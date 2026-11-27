-- 20261127_0073_register_idempotency_field.sql
--
-- AFC-1256 hotfix. 0070 added `event_registrations.idempotency_key` as a DB
-- column and granted INSERT/UPDATE on it, but Directus 11 only exposes a
-- field when it has a `directus_fields` metadata row. Without that row:
--   * Directus silently ignores `idempotency_key` on create (the row lands
--     NULL), so the (event, key) unique index never fires; and
--   * filtering/reading the field answers 403 "field ... or it does not
--     exist", so the route's read-after-write and H2/H3 replay fail.
--
-- This file registers only the metadata row. It does not alter the column,
-- grants, or permissions. Idempotent: a present row is a NOTICE and return.
--
-- Directus caches its schema at boot. After this migration the deploy must
-- restart Directus (or reload its schema cache); the SQL alone is not
-- visible to the API until then. The live AFC-1256 deploy did that restart
-- as the operator step and re-tested create/replay.
--
-- Guarded skip: on a database where Directus never booted there is no
-- directus_fields table and nothing to register.

DO $$
BEGIN
  IF to_regclass('public.directus_fields') IS NULL THEN
    RAISE NOTICE
      'Skipping 20261127_0073: directus_fields not present (Directus never booted on this database).';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM directus_fields
     WHERE collection = 'event_registrations'
       AND field = 'idempotency_key'
  ) THEN
    RAISE NOTICE
      '20261127_0073 already applied: event_registrations.idempotency_key is registered.';
    RETURN;
  END IF;

  INSERT INTO directus_fields
    (collection, field, special, interface, options, display, display_options,
     readonly, hidden, sort, width, translations, note, conditions, required,
     "group", validation, validation_message, searchable)
  VALUES
    ('event_registrations', 'idempotency_key', NULL, 'input', NULL, NULL, NULL,
     false, true, 28, 'full', NULL,
     'Internal idempotency key (server-stamped; not a form field)',
     NULL, false, NULL, NULL, NULL, false);

  RAISE NOTICE
    '20261127_0073 applied: registered event_registrations.idempotency_key. Restart Directus to reload the schema cache.';
END
$$;
