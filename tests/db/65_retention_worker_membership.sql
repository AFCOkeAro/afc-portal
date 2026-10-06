-- tests/db/65_retention_worker_membership.sql
--
-- AFC-205 / ADR-0004. THE ERASURE CAPABILITY HAS EXACTLY ONE HOLDER.
--
-- WHY THIS IS A SEPARATE SUITE FROM 63 AND 64
--   63 and 64 are both about the ACL ON retention_worker: that it can execute
--   exactly run + sync_clocks, and that PUBLIC holds nothing. Both are correct
--   and neither is sufficient, because a grant on a role nothing holds is a
--   grant no session can ever exercise.
--
--   At HEAD before this suite, retention_worker was NOLOGIN and a member of no
--   role, so the only identities that could execute retention.run were
--   directus_migrator (also NOLOGIN, and the SECURITY DEFINER owner) and a
--   cluster superuser. In the deployed configuration the retention job could
--   not be run by anybody, and the failure mode is a job that never runs
--   silently -- the only evidence being a stale retention_last_run_at.
--
-- WHY THE FIX IS A MEMBERSHIP AND NOT A LOGIN
--   The capability is the role; the identity is the login. They are separated,
--   so the thing that connects is not the thing whose grant surface matters.
--   See ADR-0004 for the alternatives, chiefly the one that was rejected:
--   granting the membership to directus_app, which would turn any
--   application-side compromise into data-erasure capability.
--
-- WHY THE SUITE REACHES THE WORKER THE HARD WAY
--   tests/db/assert.sql implements as_role() as SET LOCAL ROLE from a session
--   role captured at startup. Under PGlite that session is a superuser, and a
--   superuser may SET ROLE to ANY role regardless of membership. So 64.4's
--   "run as retention_worker actually ran" is a real assertion about the ACL
--   and is structurally unable to assert that any non-superuser can OBTAIN the
--   role. That blind spot is the entire defect.
--
--   So 65.3 drops superuser first -- SET SESSION AUTHORIZATION retention_job,
--   which is a statement only a superuser may make and which leaves the session
--   running as that ordinary LOGIN role -- and only then attempts the switch.
--
--   And 65.4 exists because that technique could pass for the wrong reason. If
--   SET ROLE were somehow unrestricted, every positive assertion here would be
--   green on a tree with no membership at all. Two negative controls pin it:
--   a LOGIN role that is NOT a member must be refused, and the member itself
--   must be refused any role it does not hold. Both must fail with 42501, and
--   if either of them ever succeeds the suite says so out loud rather than
--   reporting a green membership that means nothing.
--
-- WHAT IS ASSERTED
--   65.1  exactly one LOGIN identity can reach retention_worker, by name
--   65.1b THE NEGATIVE CONTROL for 65.1's count: the drift is manufactured and
--         the count is required to notice it. Not an optional line -- a
--         predicate that returns 1 for every input cannot be told apart from a
--         boundary that holds
--   65.1c the OTHER THREE routes to live erasure, each separately bounded
--   65.2  directus_app can neither execute the engine nor reach the role
--   65.3  NO LOGIN identity carries DELETE on any public collection, with the
--         negative control that manufactures the drift and requires the
--         predicate to notice it (AFC-259)
--   65.4  a non-superuser LOGIN session reaches the worker BY MEMBERSHIP and
--         drives retention.run through it, by the route production uses
--   65.5  the two negative controls, so 65.4 is not a superuser override
--
-- WHAT AFC-259 CHANGED IN 65.3, AND WHY IT IS NOT A WIDENING FOR ITS OWN SAKE
--   65.3 used to check two roles: retention_worker and retention_job. That is
--   the correct scope for "the erasure capability's own identities carry no
--   DELETE", and it was read as if it bounded the erasure surface. It did not.
--   A LOGIN holding the predefined role pg_write_all_data can DELETE from a
--   collection directly, with no membership of retention_worker and no EXECUTE
--   on retention.run, so 65.1, 65.1c and 65.2 all miss it while it erases
--   around the holds, the ladder and the manifest. The check now bounds the
--   predefined-role route -- no non-superuser LOGIN holds a predefined role that
--   confers blanket DELETE -- and the drift is manufactured as control E. The
--   same predicate is asserted at deploy time in bootstrap. A capability
--   predicate over every LOGIN role is not asserted here because the harness
--   grants DELETE to the v4 fixture roles to exercise the guards; that scope
--   limit is recorded in ADR-0004 Part 5.
--
-- WHAT AFC-215 CHANGED IN HERE, AND WHY IT IS NOT COSMETIC
--   The independent security review (AFC-215) falsified this suite: it went
--   green on a cluster where a second credential executed live erasure. Two
--   shapes were wrong, and both were "the query looks right":
--
--     * the holder count read pg_auth_members directly, so it counted ONE HOP.
--       PostgreSQL membership is transitive, so GRANT retention_job TO ops_admin
--       -- or a NOLOGIN group in the middle -- added an erase-capable login the
--       count never saw. It is counted here with pg_has_role(..., 'MEMBER'),
--       which is recursive.
--     * a membership ROW was treated as a capability. With WITH INHERIT FALSE,
--       SET FALSE the row is present and names exactly one identity, so the
--       count passed while retention_job could not execute anything at all.
--
--   Both are asserted below, and 65.1b carries a negative control that
--   manufactures a second holder and requires the predicate to notice, because
--   a predicate that returns 1 for every input is indistinguishable, from
--   inside the suite, from a boundary that holds.

-- ---------------------------------------------------------------------------
-- 65.1  EXACTLY ONE REACHABLE IDENTITY, COUNTED TRANSITIVELY.
--
-- The count is asserted as a number so that zero and two both fail, and the
-- name is asserted separately so that a count of one cannot be satisfied by the
-- wrong role. bootstrap/0001_roles.sql refuses the same two counts at deploy
-- time with the same query, so the fixture and the deploy agree on what
-- "reachable" means -- which is the property the CEO's evidence question turns
-- on: how many credentials can delete a record.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_holders text[];
  v_n       text;
BEGIN
  -- pg_has_role(..., 'MEMBER') is recursive, which is the whole point. It also
  -- answers true for a superuser against every role, so superusers are excluded:
  -- the runner is one, and leaving it in would make the expected count 2.
  SELECT array_agg(r.rolname ORDER BY r.rolname), count(*)::text
    INTO v_holders, v_n
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'retention_worker', 'MEMBER');

  PERFORM test_support.assert_equals(coalesce(v_n, '0'), '1',
    'membership', 'exactly one LOGIN identity can reach retention_worker, counted through every hop: 0 means the job cannot run. Scope note -- this bounds REACHABILITY OF retention_worker, not the erasure surface; 65.1c bounds the other three routes');

  PERFORM test_support.assert_equals(coalesce(array_to_string(v_holders, ','), '(none)'), 'retention_job',
    'membership', 'and that one identity is retention_job, named rather than merely counted');

  -- The worker itself must remain NOLOGIN. A login on the capability is the
  -- other way this could have been solved, and it merges the identity into the
  -- grant surface, so it is refused by name.
  PERFORM test_support.assert_true(
    (SELECT rolcanlogin IS FALSE FROM pg_roles WHERE rolname = 'retention_worker'),
    'membership', 'retention_worker is still NOLOGIN: the login is the identity, the role is the capability');

  -- A membership that EXISTS is not a capability. inherit_option and
  -- set_option decide whether retention_job can do anything with it, and both
  -- false produces a cluster where the job runs and fails on the first row --
  -- the silent-never-runs failure this whole file exists to catch. admin_option
  -- decides whether it can pass the capability onward, which is the transitive
  -- drift arriving from the other direction.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_auth_members m
              JOIN pg_roles g   ON g.oid   = m.roleid
              JOIN pg_roles mem ON mem.oid = m.member
             WHERE g.rolname   = 'retention_worker'
               AND mem.rolname = 'retention_job'
               AND m.inherit_option
               AND m.set_option
               AND NOT m.admin_option),
    'membership', 'the membership CONFEERS the capability: WITH INHERIT TRUE, SET TRUE, ADMIN FALSE, so retention_job can act and cannot pass it on');

  -- Positive control on the lookup itself: the same query must find the
  -- membership that this file's fix created. Without it, a typo in the role
  -- name reads as "no members" and the count assertion fails with a message
  -- that points at the wrong thing.
  PERFORM test_support.assert_true(
    (SELECT count(*) > 0 FROM pg_auth_members am
       JOIN pg_roles g ON g.oid = am.roleid
       JOIN pg_roles m ON m.oid = am.member
      WHERE g.rolname = 'retention_worker' AND m.rolname = 'retention_job'),
    'membership', 'probe control: the membership query does find retention_worker -> retention_job, so the count above is not a lookup that silently matches nothing');
END $$;

-- ---------------------------------------------------------------------------
-- 65.1b  NEGATIVE CONTROL FOR THE COUNT ITSELF.
--
-- A predicate that answers "one holder" for every input cannot be told apart,
-- from inside the suite, from a boundary that holds. So the drift is manufactured
-- here -- a second LOGIN identity, then a NOLOGIN group in the middle, which is
-- the shape that actually occurs in practice -- and the same predicate is
-- required to NOTICE both, before the scenario is torn down again.
--
-- This is the case AFC-215 proved the previous version missed: with the one-hop
-- query this block reported 19 of 19 while a second identity executed live
-- erasure.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_direct    text;
  v_viagroup  text;
BEGIN
  CREATE ROLE afc65_second_holder LOGIN;

  -- Hop 1: a direct second member.
  GRANT retention_job TO afc65_second_holder;
  SELECT count(*)::text INTO v_direct
    FROM pg_roles r
   WHERE r.rolcanlogin AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'retention_worker', 'MEMBER');
  PERFORM test_support.assert_equals(v_direct, '2',
    'membership', 'control C: a second direct LOGIN member is counted, so "exactly one" above is a measurement and not a constant');

  -- Hop 2: a NOLOGIN group in the middle. One grant, two roles, and the login
  -- at the end can still erase -- the case a pg_auth_members join cannot see.
  CREATE ROLE afc65_group NOLOGIN;
  GRANT retention_job TO afc65_group;
  GRANT afc65_group TO afc65_second_holder;
  SELECT count(*)::text INTO v_viagroup
    FROM pg_roles r
   WHERE r.rolcanlogin AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'retention_worker', 'MEMBER');
  PERFORM test_support.assert_equals(v_viagroup, '2',
    'membership', 'control D: a LOGIN identity two hops away, through a NOLOGIN group, is still counted -- membership is transitive');

  -- Tear down. The suite must leave the cluster as it found it, or the deploy
  -- assertion starts failing for anything that runs after this.
  REVOKE afc65_group FROM afc65_second_holder;
  DROP ROLE afc65_group;
  REVOKE retention_job FROM afc65_second_holder;
  DROP ROLE afc65_second_holder;

  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM pg_roles r
      WHERE r.rolcanlogin AND NOT r.rolsuper
        AND pg_has_role(r.oid, 'retention_worker', 'MEMBER')),
    '1',
    'membership', 'control C/D cleanup: the manufactured holders are gone and the count is back to exactly one');
END $$;

-- ---------------------------------------------------------------------------
-- 65.1c  THE OTHER THREE ROUTES TO LIVE ERASURE.
--
-- 65.1 bounds REACHABILITY OF retention_worker. That is not the erasure surface,
-- and AFC-247 proved by execution that it was being read as if it were: three
-- mutations each left the count at "1", left bootstrap passing, left this suite
-- green, and left a second credential that executed live erasure.
--
--   ALTER ROLE directus_migrator LOGIN           -- the SECURITY DEFINER owner
--   GRANT EXECUTE ON FUNCTION retention.run ...  -- a direct grant, no membership
--   GRANT directus_migrator TO someone          -- owner membership
--
-- So the invariant is expressed as the negative properties that make "exactly
-- one identity can erase" true, each auditable on its own, rather than as one
-- cleverer predicate. The count in 65.1 stays, relabelled to what it measures.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad text;
BEGIN
  -- ROUTE 1. directus_migrator is the SECURITY DEFINER owner of every engine
  -- function, so it erases holding no membership of anything. It is the second
  -- route to live erasure, not a third copy of the first -- and unlike the rest,
  -- giving it a login is an ordinary debugging step: an operator hits "permission
  -- denied for schema public" on a migration and runs ALTER ROLE
  -- directus_migrator LOGIN. F3 checked only retention_worker, so that one-liner
  -- shipped a second erase-capable credential past a green deploy.
  PERFORM test_support.assert_true(
    (SELECT rolcanlogin IS FALSE FROM pg_roles WHERE rolname = 'directus_migrator'),
    'membership', 'directus_migrator is NOLOGIN: it is the SECURITY DEFINER owner and erases with no membership of anything, so a login here is a second erase credential');

  -- ROUTE 2. A direct EXECUTE grant reaches the deletion path with no membership
  -- at all. has_function_privilege, not proacl, for the reason 64.1 gives: the
  -- ACL is the grant list and the effective privilege is what is enforced, and
  -- only the latter catches a grant that arrived through a group role.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_bad
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND has_function_privilege(r.oid,
           (SELECT min(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'retention' AND p.proname = 'run' AND p.pronargs = 3),
           'EXECUTE');

  PERFORM test_support.assert_equals(coalesce(v_bad, '(none)'), 'retention_job',
    'membership', 'exactly one LOGIN identity holds EXECUTE on retention.run: a direct grant erases with no membership of anything, which the membership count cannot see');

  -- ROUTE 3. Membership of the owner. directus_migrator is the SECURITY DEFINER
  -- owner, so anything that is a member of it executes the erasure path with the
  -- owner's rights and no grant of its own.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_bad
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'directus_migrator', 'MEMBER');

  PERFORM test_support.assert_equals(coalesce(v_bad, '(none)'), '(none)',
    'membership', 'no LOGIN role is a member of directus_migrator: owner membership erases live records with nothing held directly');

  -- PROBE CONTROL on route 2, the assertion most likely to be a query that
  -- matches nothing for an unrelated reason. Asked of a role that genuinely holds
  -- it: the table owner. Without this, "exactly retention_job" would also be
  -- satisfied by a broken predicate.
  PERFORM test_support.assert_true(
    has_function_privilege('directus_migrator',
      (SELECT min(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'retention' AND p.proname = 'run' AND p.pronargs = 3),
      'EXECUTE'),
    'membership', 'probe control: the EXECUTE-surface predicate does report a holder that exists, so the assertion above is not a query that silently matches nothing');
END $$;

-- ---------------------------------------------------------------------------

-- 65.2  THE APPLICATION IDENTITY CANNOT ERASE.
--
-- Both halves, because either one alone is a way in. A direct EXECUTE grant is
-- the obvious mistake; a membership in the worker is the subtle one, because
-- it produces the erase capability without ever naming retention.run.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_run_oid oid;
BEGIN
  SELECT p.oid INTO v_run_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'retention' AND p.proname = 'run';

  PERFORM test_support.assert_true(v_run_oid IS NOT NULL,
    'membership', 'retention.run exists, so the denial below is a decision and not a typo');

  PERFORM test_support.assert_true(
    has_function_privilege('directus_app', v_run_oid, 'EXECUTE') IS NOT TRUE,
    'membership', 'directus_app holds no EXECUTE on retention.run: the application cannot erase');

  PERFORM test_support.assert_true(
    (SELECT NOT EXISTS (
       SELECT 1 FROM pg_auth_members am
         JOIN pg_roles g ON g.oid = am.roleid
         JOIN pg_roles m ON m.oid = am.member
        WHERE g.rolname = 'retention_worker' AND m.rolname = 'directus_app')),
    'membership', 'directus_app is not a member of retention_worker: it was not given the capability by the back door');

  -- And the way it would have been done by mistake, stated as a control: the
  -- app role must not be able to reach the worker's grants transitively.
  PERFORM test_support.assert_true(
    pg_has_role('directus_app', 'retention_worker', 'MEMBER') IS NOT TRUE,
    'membership', 'pg_has_role agrees directus_app holds no membership, so the check above is not an artefact of one query shape');
END $$;

-- ---------------------------------------------------------------------------
-- 65.3  NO LOGIN IDENTITY HOLDS A PREDEFINED ROLE THAT CONFERS BLANKET DELETE.
--
-- The worker's design is that erasure happens inside SECURITY DEFINER as the
-- owner, so the role holding the capability needs no DELETE of its own. If a
-- LOGIN identity picks one up by another route, the erasure path has a second
-- way to the data that does not go through the engine -- and therefore does not
-- go through the holds, the ladder, or the manifest.
--
-- AFC-259 found the route the old version of this block could not see. It
-- checked retention_worker and retention_job, which bounds the erasure
-- capability's OWN identities, and it was read as if it bounded the surface. A
-- LOGIN holding the predefined role pg_write_all_data -- an ordinary operator
-- login, granted by a cluster owner -- holds DELETE on every collection and is
-- invisible to 65.1 (it cannot reach retention_worker), 65.1c (it holds no
-- EXECUTE on retention.run) and 65.2 (that is about directus_app). Measured on
-- the pristine fixture: CREATE ROLE ops_login LOGIN; GRANT pg_write_all_data TO
-- ops_login; then DELETE FROM people removes a row, around the holds, the ladder
-- and the manifest.
--
-- WHY THE PREDICATE IS PREDEFINED-ROLE MEMBERSHIP AND NOT "DELETE ON A TABLE".
-- The harness deliberately grants DELETE to the v4 fixture roles (tests/db/20
-- grants it on incidents; tests/db/63 on fixture_medical_notes) to exercise the
-- guards, so a capability predicate over all LOGIN roles is red on the clean
-- tree for reasons that are test scaffolding, not the boundary. The production
-- identity is a single directus_app whose DELETE migration 0004 revokes, so the
-- deploy-time capability is asserted where it exists before the fixtures --
-- bootstrap's pg_write_all_data clause -- and this suite asserts the route that
-- is a credential rather than scaffolding: membership of a predefined write
-- role. The bound is stated as exactly that, and it is not labelled as the whole
-- DELETE surface.
--
-- pg_has_role(..., 'MEMBER') is recursive, so a LOGIN two hops away through a
-- group is still counted. The set is one role today and is named as a set so a
-- server that adds another write role is a one-line edit, not a silent gap.
-- pg_read_all_data is read-only and is deliberately not in it.
--
-- PLACED BEFORE THE IMPERSONATION BLOCKS, DELIBERATELY. See the note in 65.4.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_write_roles text[] := ARRAY['pg_write_all_data'];
  v_holders     text;
  v_before      text;
  v_after       text;
BEGIN
  -- Probe control: the named predefined roles exist on this server, so the bound
  -- below is not a query that silently matches nothing because the role is
  -- absent. A missing role would otherwise skip the check and read as a pass.
  SELECT string_agg(w, ', ') INTO v_holders
    FROM unnest(v_write_roles) AS w
   WHERE to_regrole(w) IS NULL;
  PERFORM test_support.assert_equals(coalesce(v_holders, '(none)'), '(none)',
    'membership', 'probe control: every predefined write role named in this bound exists, so the check below is not skipped for a missing role');

  -- THE BOUND. No non-superuser LOGIN may hold any predefined role that confers
  -- blanket table write access.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_holders
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND EXISTS (SELECT 1 FROM unnest(v_write_roles) AS w
                  WHERE pg_has_role(r.oid, w, 'MEMBER'));

  -- No row is the PASSING case, so the aggregate is NULL; coalesce turns "no
  -- row" into the asserted value rather than a NULL that reads as a pass.
  PERFORM test_support.assert_equals(coalesce(v_holders, '(none)'), '(none)',
    'membership', 'no non-superuser LOGIN role holds a predefined role that confers blanket DELETE (pg_write_all_data): such a credential erases around the holds, the ladder and the manifest without reaching retention_worker or retention.run, so 65.1, 65.1c and 65.2 cannot see it');

  -- Probe control, asked of the table OWNER rather than of a LOGIN role: the
  -- owner holds DELETE on everything, so has_table_privilege must report it. A
  -- predicate that reports nothing for any role cannot distinguish "no DELETE
  -- exists" from "the query matches nothing". This probes the CAPABILITY the
  -- predefined role confers, which is why the bound above matters.
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relkind = 'r'
               AND has_table_privilege('directus_migrator', c.oid, 'DELETE')),
    'membership', 'probe control: a role that holds DELETE on a collection is reported by has_table_privilege, so the capability the predefined role confers is real and not a catalog fiction');

  -- NEGATIVE CONTROL E. The bound is a predicate over a role set, and a
  -- predicate that answers "none" for every input cannot be told apart, from
  -- inside the suite, from a boundary that holds. So the AFC-259 drift is
  -- manufactured here -- a LOGIN holding the predefined write role, exactly as
  -- the issue measured it -- and the same predicate is required to NOTICE it,
  -- and the capability is required to be REAL, before the scenario is torn down.
  CREATE ROLE afc65_delete_login LOGIN;
  GRANT pg_write_all_data TO afc65_delete_login;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_before
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND EXISTS (SELECT 1 FROM unnest(v_write_roles) AS w
                  WHERE pg_has_role(r.oid, w, 'MEMBER'));

  PERFORM test_support.assert_equals(coalesce(v_before, '(none)'), 'afc65_delete_login',
    'membership', 'control E: a LOGIN holding pg_write_all_data is reported by the predicate, so "no LOGIN holds it" above is a measurement and not a constant');

  -- The privilege is not merely catalogued: the statement is accepted. A
  -- throwaway table with no constraints is used rather than an existing
  -- collection, because a real collection can refuse the DELETE on a foreign key
  -- (23503) and a refusal for a reason that is not privilege would prove nothing
  -- either way. pg_write_all_data confers DELETE on tables created after the
  -- grant, so this measures the credential and not the fixture. The statement
  -- runs in a discarded subtransaction (probe), so nothing is erased.
  CREATE TABLE afc65_delete_probe (id integer);
  PERFORM test_support.assert_not_raises('afc65_delete_login', 'DELETE FROM afc65_delete_probe',
    'membership', 'control E: and the credential can actually issue DELETE on a collection, so the predicate is not reporting a privilege the engine refuses');
  DROP TABLE afc65_delete_probe;

  -- Tear down. The suite must leave the cluster as it found it, or the deploy
  -- assertion starts failing for anything that runs after this.
  REVOKE pg_write_all_data FROM afc65_delete_login;
  DROP ROLE afc65_delete_login;

  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_after
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND EXISTS (SELECT 1 FROM unnest(v_write_roles) AS w
                  WHERE pg_has_role(r.oid, w, 'MEMBER'));

  PERFORM test_support.assert_equals(coalesce(v_after, '(none)'), '(none)',
    'membership', 'control E cleanup: the manufactured holder is gone and the bound is back to none');
END $$;

-- ---------------------------------------------------------------------------
-- 65.4  A NON-SUPERUSER SESSION REACHES THE WORKER, AND THE JOB RUNS.
--
-- TWO TECHNIQUES ARE AVAILABLE AND ONLY ONE OF THEM MEANS ANYTHING.
--
-- SET ROLE from the runner's superuser session does NOT work, and the reason is
-- the whole point of this suite. PostgreSQL checks SET ROLE against the SESSION
-- user, so after SET ROLE retention_job a superuser session can still set any
-- role at all. Measured on this tree against PGlite / PostgreSQL 16:
--
--     SET ROLE other_app;  SET LOCAL ROLE retention_worker;   -> ALLOWED
--
-- other_app is not a member of retention_worker and is not a superuser, and it
-- reaches the erasure role anyway. A suite written that way asserts nothing --
-- which is the blind spot this file exists to close.
--
-- SET SESSION AUTHORIZATION does drop the session user, so the switch is then
-- decided by membership and only by membership:
--
--     SET SESSION AUTHORIZATION other_app;  SET LOCAL ROLE retention_worker;
--       -> DENIED 42501
--
-- So every impersonation below is a SET SESSION AUTHORIZATION, and the
-- assertions are made inside it -- where current_user is the ordinary LOGIN role
-- and rolsuper is false, both of which are asserted rather than assumed.
--
-- AN ENGINE NOTE, RECORDED RATHER THAN PAPERED OVER. This harness runs on PGlite
-- in-process locally and on a real postgres:16 service in CI, and the two
-- differ in one respect that matters here: after SET SESSION AUTHORIZATION,
-- PGlite does not restore current_user, on RESET SESSION AUTHORIZATION or on a
-- subtransaction abort, because it does not track the originally-authenticated
-- user the way a server build does. It DOES still permit a subsequent SET
-- SESSION AUTHORIZATION, so more than one impersonation per session works.
--
-- Two consequences, both of which are design rather than luck:
--   * every catalog assertion in this file runs BEFORE the first impersonation
--     (65.1, 65.2, 65.3), so none of them is made by an identity the fixture did
--     not intend;
--   * nothing here asserts that the identity was restored, because on PGlite it
--     is not. Asserting it would be a red suite on the local engine for a
--     behaviour of the harness rather than of the privilege boundary.
--
-- test_support is granted to PUBLIC for exactly this reason: assertions made
-- from inside an impersonated role keep working.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_who      text;
  v_super    text;
  v_as       text := '(never attempted)';
  v_direct   text := '(not reached)';
  v_run      text := '(not reached)';
  v_recorded integer := -1;
BEGIN
  SET SESSION AUTHORIZATION retention_job;
  SELECT current_user, (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)
    INTO v_who, v_super;

  -- FIRST, THE ROUTE PRODUCTION ACTUALLY USES: no SET ROLE at all.
  --
  -- The job connects as retention_job and calls retention.run. It does not
  -- switch role first, and it cannot -- it has no reason to. The capability
  -- arrives through inherit_option, which is exactly the option F2 switches
  -- off. Asserting only the SET ROLE route would leave the route the scheduler
  -- will actually take unmeasured, which is how a cluster passes every check and
  -- the job still fails on its first row.
  BEGIN
    PERFORM retention.run('test:membership:inherited', 'dry_run');
    v_direct := 'succeeded';
  EXCEPTION WHEN OTHERS THEN
    v_direct := 'raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  BEGIN
    SET LOCAL ROLE retention_worker;
    v_as := current_user;
  EXCEPTION WHEN OTHERS THEN
    v_as := '(refused) ' || SQLSTATE;
  END;

  IF v_as = 'retention_worker' THEN
    -- The same capability, reached by switching, for completeness: it is the
    -- route the negative controls below are about.
    BEGIN
      PERFORM retention.run('test:membership:worker', 'dry_run');
      v_run := 'succeeded';
      -- The manifest row, read from inside the membership. A grant that cannot
      -- be exercised is a broken control, and this is what F2 looked like before
      -- it was fixed.
      SELECT count(*) INTO v_recorded FROM retention_runs
       WHERE actor_label = 'test:membership:worker' AND status = 'succeeded';
    EXCEPTION WHEN OTHERS THEN
      v_run := 'raised ' || SQLSTATE || ' ' || SQLERRM;
    END;
  END IF;

  -- The precondition the whole technique rests on, stated as an assertion
  -- rather than trusted: the session really is an ordinary login, not the
  -- runner's superuser wearing a hat.
  PERFORM test_support.assert_equals(v_who, 'retention_job',
    'membership', 'precondition: the session is the ordinary LOGIN identity the job connects as');

  PERFORM test_support.assert_equals(v_super, 'false',
    'membership', 'precondition: that identity is NOT a superuser, so reaching the worker cannot be a superuser override');

  PERFORM test_support.assert_equals(v_direct, 'succeeded',
    'membership', 'retention_job calls retention.run directly, with no SET ROLE at all: the route the scheduler actually takes');

  PERFORM test_support.assert_equals(v_as, 'retention_worker',
    'membership', 'and it can also SET ROLE retention_worker by membership');

  PERFORM test_support.assert_equals(v_run, 'succeeded',
    'membership', 'and retention.run executes through that membership: the erasure path is reachable, not merely granted');

  PERFORM test_support.assert_equals(v_recorded::text, '1',
    'membership', 'and the run is recorded against the worker, so the job is observable from where it runs');

  -- A NOTE ON WHO IS ASSERTING WHAT HERE, because a future reader will reason
  -- from it. The two precondition assertions are made as retention_job, before
  -- any SET LOCAL ROLE. Every assertion after the switch is made as
  -- retention_worker, because SET LOCAL ROLE holds to the end of the transaction
  -- once it succeeds. Neither depends on the runner's superuser session:
  -- test_support is USAGE-granted to PUBLIC and its functions keep PUBLIC
  -- EXECUTE, and the retention_runs read works because retention_worker holds
  -- SELECT. This was flagged as a misleading comment by AFC-215 and it was
  -- correct to flag it; the claim is now accurate rather than reassuring.
END $$;

-- ---------------------------------------------------------------------------
-- 65.5  THE REACHABILITY IS NOT A SUPERUSER OVERRIDE.
--
-- Two controls, and both are load-bearing. A LOGIN role that is not a member
-- must be refused the worker, which is the claim this suite exists to establish;
-- and the member itself must be refused a role it does not hold, which is what
-- proves the assertion above was decided by membership rather than by the
-- session's authority. Without the second one the first could be satisfied by a
-- PostgreSQL that permitted SET ROLE freely, and the suite would be green on a
-- tree with no membership in it at all.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_state text := '(never attempted)';
  v_who   text;
  v_super text;
BEGIN
  SET SESSION AUTHORIZATION directus_app;
  SELECT current_user, (SELECT rolsuper::text FROM pg_roles WHERE rolname = current_user)
    INTO v_who, v_super;

  BEGIN
    SET LOCAL ROLE retention_worker;
    v_state := 'ALLOWED as ' || current_user;
  EXCEPTION WHEN OTHERS THEN
    v_state := 'DENIED ' || SQLSTATE;
  END;

  PERFORM test_support.assert_equals(v_who || '/superuser=' || v_super, 'directus_app/superuser=false',
    'membership', 'control A precondition: the refused session really is a non-superuser LOGIN identity');

  PERFORM test_support.assert_equals(v_state, 'DENIED 42501',
    'membership', 'control A: a LOGIN role that is not a member of retention_worker is refused it, so the positive case above was membership and not session authority');
END $$;

DO $$
DECLARE
  v_state text := '(never attempted)';
BEGIN
  SET SESSION AUTHORIZATION retention_job;

  BEGIN
    SET LOCAL ROLE directus_app;
    v_state := 'ALLOWED as ' || current_user;
  EXCEPTION WHEN OTHERS THEN
    v_state := 'DENIED ' || SQLSTATE;
  END;

  PERFORM test_support.assert_equals(v_state, 'DENIED 42501',
    'membership', 'control B: the member is refused every role it does not hold, so the positive case was not a general SET ROLE permission');
END $$;
