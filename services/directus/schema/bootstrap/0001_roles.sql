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
-- Idempotent: re-running against a cluster that already has these roles is a
-- no-op. Nothing here is ever dropped.
--
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
-- GRANT membership is additive, so this line is already a no-op on re-run.
GRANT retention_worker TO retention_job;

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
  v_holders text;
  v_n       integer;
BEGIN
  SELECT count(*), coalesce(string_agg(member.rolname, ', ' ORDER BY member.rolname), '(none)')
    INTO v_n, v_holders
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member  ON member.oid  = m.member
   WHERE granted.rolname = 'retention_worker'
     AND member.rolcanlogin;

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'retention_worker has % LOGIN members (%), and it must have exactly one. '
      'Zero means the retention job cannot run at all and nothing will report it; '
      'more than one means the credential that can execute live erasure is not a '
      'single accountable name. Grant it to exactly one LOGIN role -- retention_job '
      'by default -- and remove every other membership.',
      v_n, v_holders
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;