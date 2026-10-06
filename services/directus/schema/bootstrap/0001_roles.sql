-- 0001_roles.sql -- the bootstrap roles.
--
-- Run as the CLUSTER OWNER, BEFORE the migration sequence. This is the only
-- step in the deploy path that requires cluster-level authority, and it is a
-- step rather than a migration precisely so that its privilege is visible.
--
--   psql "$CLUSTER_ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f services/directus/schema/bootstrap/0001_roles.sql
--
-- ADR-0002: a migration may GRANT and REVOKE, never CREATE ROLE. Migrations run
-- as directus_migrator, which holds no CREATEROLE. Granting it that attribute
-- would let the migration identity promote itself to directus_app and escalate
-- to full read/write on the application database -- a green suite over a
-- fictional privilege boundary. This file is therefore the ONLY place a role is
-- ever created, and it grants no role attribute to anything.
--
-- Idempotent for ROLE CREATION: re-running against a cluster that already has
-- these roles creates nothing. Nothing here is ever dropped.
--
-- It is NOT a no-op, and it was described as one until AFC-268 measured it. The
-- retention membership GRANT below CONVERGES: re-running it overwrites the
-- existing row's inherit_option, set_option and admin_option with the values
-- declared here. The same is true of the schema USAGE grant in the engine file.
-- That is deliberate -- these files are the declaration of the deployed
-- capability -- but a privilege that changes on every deploy must say so in the
-- deploy log, which is what the NOTICEs below and in the engine are for.

-- No durations appear in this file, so it is safe under the retention-literal
-- gate; it is scanned, not exempt.

DO $$
DECLARE
  v_rec record;
BEGIN
  -- Neither role is a superuser, neither holds CREATEROLE, and this file grants
  -- no role attribute to anything -- so the one place roles are born cannot also
  -- be the place the privilege boundary breaks.
  FOR v_rec IN
    SELECT * FROM (VALUES
      ('directus_migrator', 'NOLOGIN'),  -- owns every table; SET ROLE only
      ('directus_app',      'LOGIN'),    -- the one identity Directus uses
      ('retention_worker',  'NOLOGIN'),  -- sole erasure executor; holds no DELETE
      ('retention_job',     'LOGIN')     -- the one login that may reach the worker
    ) AS t(name, login)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_rec.name) THEN
      EXECUTE format('CREATE ROLE %I %s', v_rec.name, v_rec.login);
      RAISE NOTICE 'bootstrap: created role % %', v_rec.name, v_rec.login;
    ELSE
      RAISE NOTICE 'bootstrap: role % already exists, left alone', v_rec.name;
    END IF;
  END LOOP;
END
$$;

-- The application role reads and writes and creates nothing. PostgreSQL 15+
-- already gives PUBLIC no CREATE on the public schema; the migrator is granted
-- it explicitly because it is the object owner, and the app role is granted
-- USAGE only. This is the asymmetry that makes the split visible in `psql
-- \dp` rather than buried in a migration.
GRANT USAGE, CREATE ON SCHEMA public TO directus_migrator;
GRANT USAGE ON SCHEMA public TO directus_app;
GRANT USAGE ON SCHEMA public TO retention_worker;

-- ---------------------------------------------------------------------
-- WHO IS ALLOWED TO REACH THE ERASURE PATH. ADR-0004.
--
-- retention_worker is NOLOGIN, so it can never connect by itself, and a role
-- that nothing holds can never be reached either. That was the state of this
-- tree: the sole executor of live erasure had no holder, so
-- retention.run(p_actor,'live',now()) could not be called by anyone who logs
-- in -- only by a cluster superuser, and only by accident.
--
-- So the capability and the identity are separated. retention_worker keeps
-- the grant surface and stays NOLOGIN. retention_job is the LOGIN identity
-- the scheduler connects as, and this GRANT is the only thing it holds: no
-- table privilege, no DELETE, no EXECUTE of its own. Everything it can do, it
-- can do because it is a member of the role that owns the surface.
--
-- NOT directus_app. That is the broad application identity, and granting it
-- this membership would make any application-side compromise into a
-- data-erasure capability, which is the boundary AFC-193 exists to hold. The
-- job and the application do not share a trust level.
--
-- The grant is PINNED, not left to the server default, because a membership
-- that exists and a capability that is conferred are two different properties
-- and only one of them makes the job runnable. WITH INHERIT FALSE or SET FALSE
-- are both valid PostgreSQL 16, both leave a pg_auth_members row that reads
-- exactly like a working grant, and both produce a cluster where retention_job
-- holds membership it cannot use -- a deploy that passes every check and a job
-- that silently never runs. Named explicitly so the deployed capability is a
-- decision in this file rather than a version-dependent default.
--
-- ADMIN FALSE is stated for the same reason from the other direction: retention_job
-- must not be able to pass the erasure capability onward. A later GRANT by a
-- cluster owner is still possible, and the assertion below is what catches that.
--
-- REPORT, THEN CONVERGE.
--
-- The grant below overwrites the existing row's options. This file is the
-- declaration of what the deployed capability is, so converging on it is its
-- job -- refusing here would leave the cluster holding a membership that cannot
-- confer, which is the defect this whole assertion was added to catch.
--
-- But every other drift in this file raises loudly, and this was the one place
-- in the repository that changed a privilege with nothing in the deploy log,
-- while four notices above told the operator the roles were "already exists, left
-- alone". An operator who set INHERIT FALSE on purpose after an incident had it
-- undone silently.
--
-- AFC-268 measured the first version of this block and found the ABSENT case was
-- not covered at all -- the row being gone is the most consequential change of
-- the three, because bootstrap CREATED the membership rather than adjusting it,
-- and `IF FOUND` skipped it. That case is now reported separately, and all three
-- drift cases are asserted by measurement; divergent-case coverage lives in
-- tests/db/65.
--
-- The NOTICE below IS observable on PGlite: it is delivered when `onNotice` is
-- passed per call. Omitting it, or passing it to the constructor, yields a
-- silently empty stream -- the same failure mode as AFC-203's ledger. The trap is
-- documented in scripts/run-db-tests.mjs.
DO $$
DECLARE
  v_old record;
  v_absent boolean;
BEGIN
  SELECT inherit_option, set_option, admin_option INTO v_old
    FROM pg_auth_members
   WHERE roleid = 'retention_worker'::regrole
     AND member  = 'retention_job'::regrole;
  v_absent := NOT FOUND;

  IF v_absent THEN
    RAISE NOTICE
      'bootstrap: CREATED retention_job -> retention_worker. The membership was '
      'absent and this file granted it WITH INHERIT TRUE, SET TRUE, ADMIN FALSE. '
      'If it was removed deliberately, the next deploy put it back.';
  ELSIF (v_old.inherit_option IS DISTINCT FROM true
     OR v_old.set_option    IS DISTINCT FROM true
     OR v_old.admin_option  IS DISTINCT FROM false) THEN
    -- ADMIN TRUE is the one an operator would want named loudly: it means
    -- retention_job could pass the erasure capability onward to anyone it was
    -- asked to.
    RAISE NOTICE
      'bootstrap: CONVERGED retention_job -> retention_worker (inherit %->true, '
      'set %->true, admin %->false). The deployed capability is declared in this '
      'file; if you set those options deliberately, the GRANT below overwrote '
      'them.', v_old.inherit_option, v_old.set_option, v_old.admin_option;
  END IF;
END
$$;

-- GRANT membership is additive in WHO it reaches, and CONVERGING in its options:
-- the options below overwrite an existing row rather than being no-ops on it.
-- The NOTICE above reports that before it happens.
GRANT retention_worker TO retention_job WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;

-- The engine schema. Also bootstrap, for the same reason the roles are: the
-- engine installs as directus_migrator, which has CREATE on schema public but
-- not on the database, so the engine cannot create its own schema. Migration
-- 0004 and the engine both assert this schema exists and fail with a message
-- naming this file, which is the correct outcome for a deploy that skipped
-- bootstrap.
--
-- PUBLIC is revoked immediately. PostgreSQL grants USAGE on a new schema to
-- PUBLIC by default, and on the schema that holds the deletion path that default
-- is not acceptable. REVOKE ALL, not REVOKE USAGE: nothing on this schema should
-- be reachable by an unlisted role.
CREATE SCHEMA IF NOT EXISTS retention AUTHORIZATION directus_migrator;
REVOKE ALL ON SCHEMA retention FROM PUBLIC;

-- Belt and braces: assert the boundary this directory exists to protect. If any
-- of these four has picked up cluster-level authority, this file fails rather
-- than proceeding, because every migration runs under one of them.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('directus_migrator', 'directus_app', 'retention_worker', 'retention_job')
     AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'privilege boundary already broken: % carries a cluster-level attribute '
      '(SUPERUSER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS). Remove it before '
      'migrating -- a migration runs under one of these identities.',
      v_bad
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- F3. Neither erase-capable role may be able to log in on its own. It is a
  -- separate clause rather than another term in the predicate above, because the
  -- invariant is different in kind: that check is about cluster authority, this
  -- is about identity. ADR-0004 rejected "make retention_worker itself LOGIN" as
  -- the fix, and an ALTER ROLE run by anyone with the authority ships a second
  -- erase-capable login that this file would otherwise pass.
  --
  -- directus_migrator is in the same clause because it is the OTHER route to
  -- live erasure: it is the SECURITY DEFINER owner of retention.run, so it
  -- erases holding no membership of anything. And unlike the others, making it
  -- log in is an ordinary debugging step -- an operator hits "permission denied
  -- for schema public" on a migration and runs ALTER ROLE directus_migrator LOGIN.
  -- That one line ships a second erase-capable credential past a check that only
  -- ever looked at retention_worker. Asserting NOLOGIN on retention_worker alone
  -- would have been a boundary with a hole the shape of the most likely mistake.
  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname = 'retention_worker' AND rolcanlogin) THEN
    RAISE EXCEPTION
      'retention_worker has LOGIN. The login is the identity and the role is the '
      'capability; they are deliberately separate. A LOGIN here adds a second '
      'credential that can execute live erasure, which is not the single '
      'accountable name the boundary is built on. Run: ALTER ROLE retention_worker NOLOGIN'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles
              WHERE rolname = 'directus_migrator' AND rolcanlogin) THEN
    RAISE EXCEPTION
      'directus_migrator has LOGIN. It is the SECURITY DEFINER owner of every '
      'engine function, so it erases with no membership of anything -- it is the '
      'second route to live erasure, not a third copy of the first. Migrations '
      'SET ROLE to it; they do not connect as it, and diagnosing a migration '
      'permission failure must not be done by giving it a login. Run: '
      'ALTER ROLE directus_migrator NOLOGIN'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- NO LOGIN HOLDS A PREDEFINED ROLE THAT CONFERS BLANKET DELETE. AFC-259.
--
-- The four routes in ADR-0004 Part 3 all reach the deletion path THROUGH the
-- retention engine. This is the route that does not: a LOGIN holding the
-- predefined role pg_write_all_data can DELETE from a collection directly, with
-- no membership of retention_worker and no EXECUTE on retention.run. It
-- therefore bypasses the legal holds, the retention ladder and the
-- retention_runs manifest -- the NDPA s.40(2) controls -- and every check in
-- this file and in the engine passes it, because the membership count and the
-- EXECUTE-surface check look at retention_worker and retention.run, not at the
-- table privilege.
--
-- The route to the DELETE privilege does not change what the credential can
-- destroy, so it is bounded here with the other routes. Measured, not inferred:
-- CREATE ROLE ops_login LOGIN; GRANT pg_write_all_data TO ops_login; then
-- DELETE FROM people removes a row.
--
-- SCOPE, STATED BECAUSE A SUBSET IS NOT A BOUND. This clause bounds the
-- PREDEFINED-ROLE route only. Bootstrap runs before the migrations, so the
-- collections do not exist yet and has_table_privilege has nothing to ask. The
-- same predefined-role bound, with the negative control that proves it can fail,
-- is asserted in tests/db/65_retention_worker_membership.sql 65.3. The wider
-- DELETE capability (a custom group role or a direct table grant) is NOT
-- asserted in the suite, because the harness grants DELETE to its own v4 fixture
-- roles. Its only production guard is that directus_app's DELETE is revoked by
-- migration 0004 -- a grant-layer control on one identity, not a per-table
-- guard. Measured by the AFC-291 review: people, retention_clocks and
-- retention_policies carry no DELETE trigger, so a credential that receives
-- DELETE by another route can erase them. That route is recorded as an open gap
-- owned in ADR-0004 Part 5 and tracked in AFC-295, not implied away here.
--
-- The predefined set is one role today. It is named as a set so that a server
-- that adds another write role is a one-line edit here rather than a silently
-- unbounded gap. pg_read_all_data is read-only and is deliberately not in it.
-- Guarded on to_regrole so a server predating the role cannot fail the deploy
-- for a reason that has nothing to do with the boundary.
DO $$
DECLARE
  v_write_roles text[] := ARRAY['pg_write_all_data'];
  v_bad         text;
  v_role        text;
BEGIN
  FOREACH v_role IN ARRAY v_write_roles LOOP
    IF to_regrole(v_role) IS NULL THEN
      CONTINUE;
    END IF;

    SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_bad
      FROM pg_roles r
     WHERE r.rolcanlogin
       AND NOT r.rolsuper
       AND pg_has_role(r.oid, v_role, 'MEMBER');

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION
        'LOGIN role(s) % hold %, the predefined role that grants DELETE on '
        'every table. That is a credential that erases records while bypassing '
        'the retention engine -- and therefore the legal holds, the retention '
        'ladder and the retention_runs manifest. Revoke it: REVOKE % FROM '
        '<role>. The same bound is asserted in tests/db/65.',
        v_bad, v_role, v_role
        USING ERRCODE = 'restrict_violation';
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- EXACTLY ONE REACHABLE IDENTITY. ADR-0004.
--
-- The grant above is necessary and not sufficient. A capability nobody holds
-- is an inoperable control, and a capability several identities hold is a
-- wider one -- and this is the single most destructive function in the
-- system, so "how many credentials can delete a record?" has to have an
-- answer that is a name, produced by the step that provisions it.
--
-- So the deploy fails on both wrong counts rather than on neither:
--
--   0  the retention job can never run, and the only evidence is a stale
--      retention_last_run_at in retention_metrics. That is the silent
--      unbounded-liability case the metrics view exists to catch.
--   >1 the erasure surface is wider than the single identity it is designed
--      around, which is a privilege drift this file is the right place to
--      refuse.
--
-- Counted over roles that can LOGIN, because a NOLOGIN holder is not
-- reachable and is not a credential anybody can steal.
DO $$
DECLARE
  v_holders   text;
  v_n         integer;
  v_confer    boolean;
  v_run_oid   oid;
BEGIN
  -- TRANSITIVE, AND NOT ONE HOP.
  --
  -- The first version of this assertion read pg_auth_members directly and so
  -- counted only DIRECT members. PostgreSQL membership is transitive, so that
  -- version passed a deploy in which a second, unrelated credential could
  -- execute live erasure -- proven, not inferred: GRANT retention_job TO
  -- ops_admin leaves this assertion green and leaves the suite green, and
  -- ops_admin then runs retention.run. A NOLOGIN group in the middle does the
  -- same thing, which is how this drift actually happens in practice.
  --
  -- pg_has_role(..., 'MEMBER') is recursive, so it counts every LOGIN identity
  -- that can reach the worker however many hops away it is. Superusers are
  -- excluded because pg_has_role answers true for them against every role, and
  -- the cluster owner is running this file -- without the exclusion the clean
  -- case counts 2 and the assertion would be unsatisfiable.
  SELECT count(*), coalesce(string_agg(rolname, ', ' ORDER BY rolname), '(none)')
    INTO v_n, v_holders
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'retention_worker', 'MEMBER');

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'retention_worker is reachable by % LOGIN identities (%), and it must be '
      'reachable by exactly one. Zero means the retention job cannot run at all '
      'and nothing will report it; more than one means the credential that can '
      'execute live erasure is not a single accountable name. Membership is '
      'transitive, so this count includes identities that reach the worker '
      'through another role -- check for a group in the middle. Grant it to '
      'exactly one LOGIN role -- retention_job by default -- and remove every '
      'other membership.',
      v_n, v_holders
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- WHAT THIS COUNT IS NOT, STATED HERE RATHER THAN IN A COMMENT SOMEONE SKIPS.
  --
  -- The count above bounds REACHABILITY OF retention_worker. It does not bound
  -- the erasure surface. There are four routes to retention.run and this is one
  -- of them; the other three are asserted separately, above and below. Measured
  -- on this engine, each of the following leaves the count at 1, leaves this
  -- file passing, and leaves a second credential that executes live erasure:
  --
  --   GRANT EXECUTE ON FUNCTION retention.run(...) TO someone
  --   GRANT directus_migrator TO someone            (owner membership)
  --   ALTER ROLE directus_migrator LOGIN           (asserted above)
  --
  -- And there is a FIFTH route that does not go through retention.run at all:
  -- a LOGIN holding a predefined write role (pg_write_all_data) can DELETE a
  -- collection directly. It is bounded in the DO block above (the
  -- predefined-role route) and, as a capability over every route, in
  -- tests/db/65_retention_worker_membership.sql 65.3. It is named here because
  -- a reader who takes this comment as the whole erasure surface would be wrong
  -- in exactly the way AFC-247 and AFC-259 were raised about.
  --
  -- And it can also over-count: pg_has_role answers pure graph reachability and
  -- ignores inherit_option, so a holder two hops out behind a membership with
  -- INHERIT FALSE is counted and cannot erase. Erring toward refusing is the
  -- safe direction, but "safe direction" is not "correct set", and a count that
  -- is neither a lower nor an upper bound must not be labelled as one.
  --
  -- So: the honest invariant is not "exactly one holder". It is the three
  -- negative properties asserted here and in the DO block above, each of which
  -- can be audited on its own.

  -- ROUTE 2 OF 4, THE DIRECT EXECUTE GRANT, IS NOT ASSERTED HERE -- AND THAT
  -- IS AN ORDERING CONSTRAINT, NOT AN OMISSION.
  --
  -- Bootstrap runs BEFORE the migrations and before the engine is installed, so
  -- at the moment this file executes, retention.run does not exist. There is
  -- nothing to ask has_function_privilege about. An assertion written here would
  -- either resolve nothing and pass, or fail every deploy, and both are wrong;
  -- the one-line version of this that did exactly that was caught by its own
  -- guard clause while this fix was being written.
  --
  -- So the check lives where the surface is created: engine/0001_retention_engine.sql,
  -- immediately after the grants above create it, where the function exists and
  -- this is the step that just granted EXECUTE on it. Bootstrap asserts what it
  -- can see -- reachability of retention_worker, and that the membership confers
  -- -- and the engine asserts the entrypoint's own EXECUTE surface.

  -- ROUTE 3 OF 4. Membership of the engine owner.
  --
  -- directus_migrator is the SECURITY DEFINER owner of retention.run, so anything
  -- that is a member of it executes the erasure path with the owner's rights and
  -- no grant of its own.
  SELECT string_agg(r.rolname, ', ' ORDER BY r.rolname) INTO v_holders
    FROM pg_roles r
   WHERE r.rolcanlogin
     AND NOT r.rolsuper
     AND pg_has_role(r.oid, 'directus_migrator', 'MEMBER');

  IF v_holders IS NOT NULL THEN
    RAISE EXCEPTION
      '% LOGIN role(s) are members of directus_migrator (%), which is the '
      'SECURITY DEFINER owner of the retention engine. Membership of the owner '
      'executes live erasure without holding anything itself, so this is a second '
      'credential the membership count above cannot see. Revoke it: REVOKE '
      'directus_migrator FROM <role>',
      array_length(string_to_array(v_holders, ', '), 1), v_holders
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- ...AND THE ONE THAT HOLDS IT CAN ACTUALLY USE IT.
  --
  -- A membership row is not a capability. With inherit_option or set_option
  -- switched off, the row above still exists and still names exactly one LOGIN
  -- identity, so the count above passes, and retention_job then fails with
  -- "permission denied for schema retention" the first time the job runs. That
  -- is the silent-never-runs failure this assertion was added to catch, so the
  -- options are asserted rather than assumed.
  SELECT EXISTS (
           SELECT 1 FROM pg_auth_members m
             JOIN pg_roles g   ON g.oid   = m.roleid
             JOIN pg_roles mem ON mem.oid = m.member
            WHERE g.rolname   = 'retention_worker'
              AND mem.rolname = 'retention_job'
              AND m.inherit_option
              AND m.set_option
              AND NOT m.admin_option)
    INTO v_confer;

  IF NOT v_confer THEN
    RAISE EXCEPTION
      'retention_job is a member of retention_worker but cannot use it: the '
      'membership must be WITH INHERIT TRUE, SET TRUE, ADMIN FALSE. A membership '
      'that does not confer the capability leaves the retention job unable to '
      'run while every catalog check reads healthy.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;