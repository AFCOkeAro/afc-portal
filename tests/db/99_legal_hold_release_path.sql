-- tests/db/99_legal_hold_release_path.sql
--
-- AFC-243. THE AUDITED LEGAL-HOLD RELEASE PATH.
--
-- WHAT SHIPPED. retention.release_hold_as(uuid, uuid), granted only to the
-- dedicated LOGIN role legal_hold_releaser, called by the portal server route
-- POST /api/legal-holds/:id/release with the session user's id. directus_app
-- holds EXECUTE on nothing in the retention schema -- that pin (64.1b) is
-- unchanged, and this suite re-pins it with the new function named.
--
-- WHY A NEW SUITE AND NOT AN APPEND TO 63/64
--   63 asserts the refusal (the application role cannot release). 64 pins the
--   empty surface. Neither asserts that the new path WORKS, that it stamps the
--   carried identity, or that the forged chain stays broken with the new
--   function in the catalog. Those are the AFC-243 acceptance criteria, and
--   they belong in one place with the issue number on it.
--
-- WHAT IS ASSERTED
--   99.10  directus_app's EXECUTE surface on the retention schema is still
--          EMPTY with release_hold_as in the catalog, on two instruments with
--          a positive control that reports the new grant on the service role.
--   99.11  exactly one LOGIN identity holds EXECUTE on release_hold_as, and it
--          is legal_hold_releaser, named rather than merely counted; PUBLIC
--          holds nothing on it.
--   99.12  the service path releases and stamps the carried identity: a first
--          hold released with user A reads released_by = A, a second hold
--          released with user B reads released_by = B. The value reaching the
--          row is the identity the trusted service carried in -- which the
--          route sets to the session user and never to caller input. NULL
--          arguments, an unknown hold, and a second release of a released hold
--          are all refused 22023.
--   99.13  the application role cannot forge a release on the new path either:
--          directus_app calling release_hold_as is refused 42501, the hold is
--          still holding, and nothing stamped a releaser onto it. Even the
--          engine owner is refused on this path (42501 from the session check,
--          not the grant list): attribution belongs to the service identity.
--   99.14  the service identity is least privilege: its EXECUTE surface on the
--          engine is exactly release_hold_as, it cannot release by updating
--          the row, and it cannot run erasure.
--
-- WHY EVERY IMPERSONATION HERE IS SET SESSION AUTHORIZATION
--   release_hold_as checks session_user, and the probe harness's SET LOCAL ROLE
--   does not change session_user -- a probe "as legal_hold_releaser" would be
--   a session that authenticated as somebody else and assumed the role
--   partway through, and the function correctly refuses to attribute to that.
--   Directus connects as directus_app and the portal server connects as
--   legal_hold_releaser; neither does SET ROLE. SET SESSION AUTHORIZATION is
--   the only faithful impersonation. Every block restores the harness session
--   identity afterwards AND ASSERTS that it is back.

-- ---------------------------------------------------------------------------
-- 99.10  THE APPLICATION ROLE'S SURFACE IS STILL EMPTY.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_app_surface text[];
  v_expect      text[];
  v_release_oid oid;
BEGIN
  SELECT p.oid INTO v_release_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention' AND p.proname = 'release_hold_as';

  PERFORM test_support.assert_true(v_release_oid IS NOT NULL, 'release',
    'release_hold_as exists, so denying it to the application role is a decision and not a typo');

  v_expect := ARRAY[]::text[];

  SELECT array_agg(p.proname ORDER BY p.proname) INTO v_app_surface
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND has_function_privilege('directus_app', p.oid, 'EXECUTE');

  PERFORM test_support.assert_equals(
    coalesce(nullif(array_to_string(v_app_surface, ','), ''), '(none)'),
    coalesce(nullif(array_to_string(v_expect, ','), ''), '(none)'),
    'release', 'directus_app EXECUTE surface on the engine is still empty with the release path in the catalog');

  -- The positive control: the identical query against the service role must
  -- report the one grant that exists. Without it, a typo reads as "empty".
  PERFORM test_support.assert_equals(
    (SELECT coalesce(array_to_string(array_agg(p.proname ORDER BY p.proname), ','), '(none)')
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'retention'
        AND has_function_privilege('legal_hold_releaser', p.oid, 'EXECUTE')),
    'release_hold_as',
    'release', 'probe control: the same query reports the service role surface in full, so the empty result above is a fact and not a lookup that matched nothing');

  PERFORM test_support.assert_true(
    has_function_privilege('directus_app', v_release_oid, 'EXECUTE') IS NOT TRUE,
    'release', 'directus_app cannot execute release_hold_as, by name');

  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT retention.release_hold_as(gen_random_uuid(), gen_random_uuid())$q$,
    '42501', 'release', 'a directus_app session is refused release_hold_as by the grant list');
END $$;

-- ---------------------------------------------------------------------------
-- 99.11  EXACTLY ONE LOGIN HOLDS THE NEW FUNCTION, AND IT IS NAMED.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holders text;
  v_oid     oid;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention' AND p.proname = 'release_hold_as';

  SELECT coalesce(string_agg(r.rolname, ', ' ORDER BY r.rolname), '(none)') INTO v_holders
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND has_function_privilege(r.oid, v_oid, 'EXECUTE');

  PERFORM test_support.assert_equals(v_holders, 'legal_hold_releaser',
    'release', 'exactly one LOGIN identity holds EXECUTE on release_hold_as, and it is the dedicated release identity');

  PERFORM test_support.assert_true(
    NOT has_function_privilege('public', v_oid, 'EXECUTE'),
    'release', 'PUBLIC holds EXECUTE on no release path');
END $$;

-- ---------------------------------------------------------------------------
-- 99.12  THE SERVICE PATH RELEASES AND STAMPS THE CARRIED IDENTITY.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_hold_a uuid;
  v_hold_b uuid;
  v_user_a uuid := '00000000-0000-0000-0000-00000000a243';
  v_user_b uuid := '00000000-0000-0000-0000-00000000b243';
  v_got    text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  -- Placing is an ordinary app action (63.4 proves it); the two holds below
  -- are this suite's own, selected by their distinct reason.
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('retention_class', 'fixture_orphan', 'afc243: release path fixture A',
               gen_random_uuid())$q$);
  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('retention_class', 'fixture_orphan', 'afc243: release path fixture B',
               gen_random_uuid())$q$);

  SELECT id INTO v_hold_a FROM legal_holds
   WHERE reason = 'afc243: release path fixture A' AND released_at IS NULL LIMIT 1;
  SELECT id INTO v_hold_b FROM legal_holds
   WHERE reason = 'afc243: release path fixture B' AND released_at IS NULL LIMIT 1;

  PERFORM test_support.assert_true(v_hold_a IS NOT NULL AND v_hold_b IS NOT NULL, 'release',
    'precondition: both fixture holds are standing');

  -- Release A as the service identity, carrying user A.
  SET SESSION AUTHORIZATION legal_hold_releaser;
  v_got := '(never attempted)';
  BEGIN
    PERFORM retention.release_hold_as(v_hold_a, v_user_a);
    v_got := 'released';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'released', 'release',
    'the service identity releases a standing hold');
  PERFORM test_support.assert_equals(current_user, v_holder, 'release',
    'the harness session identity is restored after the service release');
  PERFORM test_support.assert_equals(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold_a), v_user_a::text,
    'release', 'the carried identity is what reaches released_by: user A is stamped on hold A');
  PERFORM test_support.assert_true(
    (SELECT released_at IS NOT NULL FROM legal_holds WHERE id = v_hold_a),
    'release', 'and the database stamped the time, not the caller');

  -- Release B carrying user B: the row reflects the carried identity, so a
  -- different authenticated user is recorded as themselves and cannot be
  -- recorded as someone else by this path.
  SET SESSION AUTHORIZATION legal_hold_releaser;
  v_got := '(never attempted)';
  BEGIN
    PERFORM retention.release_hold_as(v_hold_b, v_user_b);
    v_got := 'released';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, 'released', 'release',
    'the service identity releases the second hold');
  PERFORM test_support.assert_equals(current_user, v_holder, 'release',
    'the harness session identity is restored after the second release');
  PERFORM test_support.assert_equals(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold_b), v_user_b::text,
    'release', 'user B is stamped on hold B: the audit trail names who was carried in');
  PERFORM test_support.assert_true(
    (SELECT released_by::text FROM legal_holds WHERE id = v_hold_b) <> v_user_a::text,
    'release', 'and it is not user A: one authenticated user cannot release on another behalf');

  -- The argument checks, driven where they are decided.
  SET SESSION AUTHORIZATION legal_hold_releaser;
  BEGIN
    PERFORM retention.release_hold_as(NULL, v_user_a);
    v_got := 'released with NULL hold';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.assert_equals(v_got, '22023', 'release',
    'a NULL hold is refused invalid_parameter_value');
  BEGIN
    PERFORM retention.release_hold_as(v_hold_b, NULL);
    v_got := 'released with NULL releaser';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.assert_equals(v_got, '22023', 'release',
    'a NULL releaser is refused invalid_parameter_value: a release with nobody attributed is not recorded');
  BEGIN
    PERFORM retention.release_hold_as('00000000-0000-0000-0000-00000000beef'::uuid, v_user_a);
    v_got := 'released an unknown hold';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.assert_equals(v_got, '22023', 'release',
    'an unknown hold is refused invalid_parameter_value');
  BEGIN
    PERFORM retention.release_hold_as(v_hold_a, v_user_a);
    v_got := 'released twice';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  PERFORM test_support.assert_equals(v_got, '22023', 'release',
    'a released hold cannot be released again: a release is history, not a state to re-enter');
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(current_user, v_holder, 'release',
    'the harness session identity is restored after the refusal probes');
END $$;

-- ---------------------------------------------------------------------------
-- 99.13  THE APPLICATION ROLE CANNOT FORGE ON THE NEW PATH EITHER.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holder text;
  v_hold   uuid;
  v_forged uuid := '00000000-0000-0000-0000-00000000f243';
  v_got    text;
BEGIN
  SELECT c.v INTO v_holder FROM test_support.config c WHERE c.k = 'session_role';

  PERFORM test_support.as_role('directus_app',
    $q$INSERT INTO legal_holds (scope_type, scope_id, reason, placed_by)
       VALUES ('retention_class', 'fixture_orphan', 'afc243: forgery fixture',
               gen_random_uuid())$q$);

  SELECT id INTO v_hold FROM legal_holds
   WHERE reason = 'afc243: forgery fixture' AND released_at IS NULL LIMIT 1;
  PERFORM test_support.assert_true(v_hold IS NOT NULL, 'release',
    'precondition: the forgery-target hold is standing');

  -- The forged release, driven as the application role itself.
  SET SESSION AUTHORIZATION directus_app;
  v_got := '(never attempted)';
  BEGIN
    PERFORM retention.release_hold_as(v_hold, v_forged);
    v_got := 'released';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, '42501', 'release',
    'the grant list refuses the forged release: an application-side compromise still cannot make a record erasable');
  PERFORM test_support.assert_equals(current_user, v_holder, 'release',
    'the harness session identity is restored after the forgery attempt');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE id = v_hold AND released_at IS NULL), '1',
    'release', 'and the hold it refused to release is still holding');
  PERFORM test_support.assert_true(
    (SELECT released_by IS NULL FROM legal_holds WHERE id = v_hold),
    'release', 'and nothing stamped a releaser onto it');

  -- Even the engine owner is refused on this path -- by the session check
  -- inside the function (42501), not by the grant list. Attribution belongs
  -- to the service identity; ownership of the function is not a second way
  -- to be attributed.
  SET SESSION AUTHORIZATION directus_migrator;
  v_got := '(never attempted)';
  BEGIN
    PERFORM retention.release_hold_as(v_hold, v_forged);
    v_got := 'released';
  EXCEPTION WHEN OTHERS THEN
    v_got := SQLSTATE;
  END;
  EXECUTE 'SET SESSION AUTHORIZATION ' || quote_ident(v_holder);

  PERFORM test_support.assert_equals(v_got, '42501', 'release',
    'even the owner is refused on the service path: owning the function is not a way to be attributed');
  PERFORM test_support.assert_equals(current_user, v_holder, 'release',
    'the harness session identity is restored after the owner probe');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM legal_holds WHERE id = v_hold AND released_at IS NULL), '1',
    'release', 'and the hold is still holding after the owner probe');
END $$;

-- ---------------------------------------------------------------------------
-- 99.14  THE SERVICE IDENTITY IS LEAST PRIVILEGE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_surface text;
BEGIN
  -- Its EXECUTE surface on the engine is exactly the one function.
  SELECT coalesce(array_to_string(array_agg(p.proname ORDER BY p.proname), ','), '(none)') INTO v_surface
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention'
     AND has_function_privilege('legal_hold_releaser', p.oid, 'EXECUTE');

  PERFORM test_support.assert_equals(v_surface, 'release_hold_as',
    'release', 'the service identity reaches exactly one engine function: the release it exists for');

  -- It cannot release by updating the row: the function is the path because
  -- the function is what stamps both fields together.
  PERFORM test_support.assert_raises('legal_hold_releaser',
    $q$UPDATE legal_holds SET released_by = gen_random_uuid(), released_at = now()
        WHERE released_at IS NULL$q$,
    '42501', 'release', 'the service identity cannot release a hold by updating the row: refused by the grant list');

  -- And it cannot run erasure: the release identity is not a second erasure
  -- credential.
  PERFORM test_support.assert_raises('legal_hold_releaser',
    $q$SELECT retention.run('test:release:service', 'dry_run')$q$,
    '42501', 'release', 'the service identity cannot run the erasure job');

  -- Operability: it resolves the engine at all (USAGE), or the grant above
  -- is decorative.
  PERFORM test_support.assert_true(
    has_schema_privilege('legal_hold_releaser', 'retention', 'USAGE'),
    'release', 'the service identity resolves the engine schema, so the granted call is live and not merely listed');
END $$;
