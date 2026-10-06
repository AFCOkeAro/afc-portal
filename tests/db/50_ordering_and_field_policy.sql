-- tests/db/50_ordering_and_field_policy.sql
--
-- Two smaller guarantees from AFC-166 that would otherwise be asserted nowhere:
--
--   1. reported_at can never precede the clock origin, and detected_at is
--      deliberately NOT ordered against awareness_at.
--   2. The Directus field-policy migration strips awareness_at from every
--      create/update policy, including the super admin one.

DO $$
DECLARE
  v_id uuid;
BEGIN
  SET LOCAL ROLE directus_app;
  INSERT INTO incidents (ref, summary, severity, status, detected_at)
  VALUES ('ORDER-FIXTURE', 'Ordering fixture', 'major', 'open', now());
  RESET ROLE;

  SELECT id INTO v_id FROM incidents WHERE ref = 'ORDER-FIXTURE';

  -- Reported after the clock origin: the normal case, accepted.
  PERFORM test_support.assert_not_raises('directus_app',
    format('UPDATE incidents SET reported_at = now() WHERE id = %L', v_id),
    'ordering', 'reported_at at or after the clock origin is accepted');

  -- Reported before the clock origin is a contradiction. Cheap guard, loud.
  PERFORM test_support.assert_raises('directus_app',
    format('UPDATE incidents SET reported_at = awareness_at - interval ''1 second'' WHERE id = %L', v_id),
    '23514', 'ordering', 'reported_at before the clock origin is rejected');

  -- detected_at AFTER awareness_at is legal and must stay legal: staff can tell
  -- the board before engineering notices. A constraint here would force
  -- operators to fudge one of the two fields, which is worse than the ambiguity
  -- it removes.
  PERFORM test_support.assert_not_raises('directus_app',
    format('UPDATE incidents SET detected_at = now() WHERE id = %L', v_id),
    'ordering', 'detected_at later than awareness_at is accepted -- no order constraint on it');
END
$$;

-- ---------------------------------------------------------------------------
-- Directus field-level permissions, second layer.
--
-- directus_permissions is a test double here: the migration only touches
-- collection / action / fields, and the test asserts the effect on those. What
-- this does NOT prove is that a Directus role cannot reach the column some
-- other way -- that is what the trigger in 20_immutability.sql is for.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directus_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        uuid,
  collection  text NOT NULL,
  action      text NOT NULL,
  fields      text[] NOT NULL DEFAULT '{}',
  permissions jsonb
);

-- One role per v4 matrix entry, including super admin, each with a create and
-- an update policy that names every writable field -- including the two it must
-- not have.
INSERT INTO directus_permissions (role, collection, action, fields)
SELECT gen_random_uuid(), 'incidents', a.action,
       ARRAY['ref','summary','severity','status','detected_at','reported_at',
             'awareness_at','awareness_at_source']
  FROM unnest(ARRAY['super_admin','area_admin','branch_admin','welfare_officer',
                    'staff_volunteer','member','public']) AS r(role)
  CROSS JOIN unnest(ARRAY['create','update','read','delete']) AS a(action);

\i services/directus/schema/migrations/20261006_0003_incidents_awareness_field_policy.sql

DO $$
DECLARE
  v_leaks int;
BEGIN
  SELECT count(*) INTO v_leaks
    FROM directus_permissions
   WHERE collection = 'incidents'
     AND action IN ('create', 'update')
     AND (fields && ARRAY['awareness_at','awareness_at_source']::text[]);

  PERFORM test_support.assert_equals(v_leaks::text, '0', 'field-policy',
    'no create/update policy on incidents names awareness_at after the migration');

  -- The migration must not have damaged the policies it did not target.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM directus_permissions
      WHERE collection = 'incidents' AND action = 'read'
        AND (fields && ARRAY['awareness_at','awareness_at_source']::text[])) > 0,
    'field-policy', 'read policies still expose the clock origin -- the register has to be readable');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM directus_permissions
      WHERE collection = 'incidents' AND action = 'read'
        AND fields @> ARRAY['ref','summary']::text[]) > 0,
    'field-policy', 'untouched fields survive the strip');

  -- Idempotent: a second run finds nothing left to do.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM directus_permissions
      WHERE collection = 'incidents' AND action IN ('create','update')
        AND array_length(fields, 1) > 0) > 0,
    'field-policy', 'create/update policies keep their permitted fields');
END
$$;

DROP TABLE IF EXISTS directus_permissions;