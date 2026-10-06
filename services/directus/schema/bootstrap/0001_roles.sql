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
      ('retention_worker',  'NOLOGIN')   -- sole erasure executor; holds no DELETE
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

-- Belt and braces: assert the boundary this directory exists to protect. If any
-- of these three has picked up cluster-level authority, this file fails rather
-- than proceeding, because every migration runs under one of them.
DO $$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(rolname, ', ') INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('directus_migrator', 'directus_app', 'retention_worker')
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