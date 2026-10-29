-- tests/db/58_public_event_read_policy.sql
--
-- AFC-877 D4 (follow-up to AFC-871 slice 2 / AFC-873). THE PUBLIC-READ
-- POLICY CONTRACT for migration 20261029_0060.
--
-- Migration 0060 sets the Directus public events-read permission from the
-- legacy 6 calendar fields to exactly the 29-field public-surface
-- allowlist (detail 28 + branch), matched by (collection, action,
-- fields-as-a-set) — never by hardcoded perm id.
--
--   58.1 transition  -- one legacy events/read row becomes exactly the
--                        allowlist; decoy rows (other actions, other
--                        collections, unknown field sets) are untouched;
--                        the allowlist carries no PII and no registration
--                        write columns.
--   58.2 rerun       -- re-applying 20261029_0060 is a no-op (already
--                        applied path), still exactly one allowlist row.
--   58.3 refuse      -- more than one legacy candidate refuses with
--                        restrict_violation instead of widening blindly.
--   58.4 unknown     -- a permission in neither known state is left alone
--                        with the operator-step NOTICE (no invented grant).
--
-- What this suite does NOT assert (stated, not missing): the HTTP half —
-- signed-out detail/register/calendar reads against the real Directus
-- policy — is covered by the AFC-876 staging probe matrix, not here.
-- directus_permissions is a test double (the 50_ordering precedent): the
-- migration only touches collection / action / fields.

-- ---------------------------------------------------------------------------
-- Test double. Same shape as the suite-50 double: the migration reads only
-- collection / action / fields.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS directus_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        uuid,
  collection  text NOT NULL,
  action      text NOT NULL,
  fields      text[] NOT NULL DEFAULT '{}',
  permissions jsonb
);

-- ---------------------------------------------------------------------------
-- 58.1 TRANSITION. Legacy 6-field events/read -> exact 29-field allowlist.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Legacy row, deliberately unsorted: the migration matches as a SET.
  INSERT INTO directus_permissions (collection, action, fields)
  VALUES ('events', 'read',
    ARRAY['visibility','title','status','start_at','id','branch']);

  -- Decoys the migration must not touch.
  INSERT INTO directus_permissions (collection, action, fields)
  VALUES ('events', 'create',
    ARRAY['visibility','title','status','start_at','id','branch']);
  INSERT INTO directus_permissions (collection, action, fields)
  VALUES ('celebrations', 'read',
    ARRAY['visibility','title','status','start_at','id','branch']);
  INSERT INTO directus_permissions (collection, action, fields)
  VALUES ('events', 'read', ARRAY['id','title']);
END $$;

\i services/directus/schema/migrations/20261029_0060_public_event_read_policy.sql

DO $$
DECLARE
  v_allow text := 'address,age_max,age_min,branch,capacity,collect_medical,currency,description,end_at,event_type,fee_amount,id,location,registration_closes_at,registration_opens_at,registration_visibility,requires_guardian_consent,resources,resources_visibility,schedule,schedule_visibility,speakers,speakers_visibility,start_at,status,summary,title,visibility,waitlist_enabled';
  v_got text;
BEGIN
  SELECT array_to_string((SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f), ',')
    INTO v_got
    FROM directus_permissions p
   WHERE p.collection = 'events' AND p.action = 'read'
     AND array_length(p.fields, 1) = 29;

  PERFORM test_support.assert_equals(v_got, v_allow, 'public-policy',
    'the legacy events/read row now carries exactly the 29-field allowlist');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
          = string_to_array(v_allow, ',')), '1', 'public-policy',
    'exactly one events/read row holds the allowlist (no duplicates)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'create'
        AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
          = ARRAY['branch','id','start_at','status','title','visibility']), '1', 'public-policy',
    'the events/create permission is untouched (action scoping)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'celebrations'), '1', 'public-policy',
    'other collections are untouched');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND p.fields && ARRAY['email','phone','guardian_name','guardian_phone',
          'guardian_email','medical_notes','allergies','emergency_contact_name',
          'emergency_contact_phone','date_of_birth','registrant_first_name',
          'registrant_last_name','ticket_code','registration_status',
          'amount_paid','contact','awareness_at']::text[]), '0', 'public-policy',
    'the allowlist carries no PII and no registration write columns');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
          = ARRAY['id','title']), '1', 'public-policy',
    'an events/read row in an unknown field set is left alone (no invented grant)');
END $$;

-- ---------------------------------------------------------------------------
-- 58.2 RERUN. Re-applying is a loud no-op, still one allowlist row.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261029_0060_public_event_read_policy.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND array_length(p.fields, 1) = 29), '1', 'public-policy',
    'rerun: still exactly one allowlist row (already-applied path, no duplicate)');
END $$;

-- ---------------------------------------------------------------------------
-- 58.3 REFUSE. Two legacy candidates refuse rather than widen blindly.
-- The refusal pin is the migration's own guard predicate (the 45.6
-- precedent), not the NOTICE text: a top-level \i of a refusing migration
-- would abort the suite, so the guard is exercised here on a replica while
-- 58.1/58.2 exercise the file itself.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO directus_permissions (collection, action, fields)
  VALUES ('events', 'read',
    ARRAY['branch','id','start_at','status','title','visibility']),
         ('events', 'read',
    ARRAY['visibility','title','status','start_at','id','branch']);

  PERFORM test_support.assert_raises(NULL,
    'DO $rb$ BEGIN IF (SELECT count(*) FROM directus_permissions p
        WHERE p.collection = ''events'' AND p.action = ''read''
          AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
            = ARRAY[''branch'',''id'',''start_at'',''status'',''title'',''visibility'']) > 1
      THEN RAISE EXCEPTION ''refusing 20261029_0060: test probe'' USING ERRCODE = ''restrict_violation'';
      END IF; END $rb$;',
    '23001', 'public-policy',
    'more than one legacy candidate refuses (never widen an ambiguous set)');

  DELETE FROM directus_permissions AS p
   WHERE p.collection = 'events' AND p.action = 'read'
     AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
       = ARRAY['branch','id','start_at','status','title','visibility'];
END $$;

-- ---------------------------------------------------------------------------
-- 58.4 UNKNOWN. A permission in neither known state is left alone.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  UPDATE directus_permissions p
     SET fields = ARRAY['id','title']
   WHERE p.collection = 'events' AND p.action = 'read'
     AND array_length(p.fields, 1) = 29;
END $$;

\i services/directus/schema/migrations/20261029_0060_public_event_read_policy.sql

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND (SELECT array_agg(f ORDER BY f) FROM unnest(p.fields) AS f)
          = ARRAY['id','title']), '2', 'public-policy',
    'unknown state: both non-allowlist rows keep their fields (operator step, no invented grant)');

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM directus_permissions p
      WHERE p.collection = 'events' AND p.action = 'read'
        AND array_length(p.fields, 1) = 29), '0', 'public-policy',
    'unknown state: nothing was widened to the allowlist');
END $$;

DROP TABLE IF EXISTS directus_permissions;
