-- 20261024_0042_directus_runtime_matrix.sql
--
-- Directus 11 runtime grant matrix on directus_* (AFC-783, follow-up to AFC-749).
--
-- ROOT CAUSE (operator report 2026-10-23, staging): switching Directus to the
-- least-privilege identity failed at boot -- permission denied for table
-- directus_migrations on SELECT. directus_app held zero grants on any
-- directus_* system table, and Directus 11 cannot start or serve without
-- reading its migrations/activity/revision tables. Every earlier migration's
-- grant scope covers application tables only. Staging stays on owner wiring
-- until this matrix lands (board decision, AFC-749 What next).
--
-- DECISION (spec-silent, smallest defensible, named for review): Option A, a
-- grant matrix to directus_app. No dedicated runtime role. Directus exposes a
-- single DB_USER, so a second role cannot be wired without forking the one
-- connection Directus holds -- a dedicated role would either sit unused or
-- require application-level connection splitting that does not exist. The
-- matrix below is the whole fix.
--
-- THE MATRIX (uniform by construction, not by omission):
--
--   Group                        Tables (Directus 11, directus/directus:11)         Grant
--   ----                         ------------------------------------------         -----
--   Boot / schema versioning     directus_migrations                              SELECT, INSERT, UPDATE, DELETE
--   Schema introspection         directus_collections, directus_fields,            SELECT, INSERT, UPDATE, DELETE
--                                directus_relations
--   AuthN / sessions             directus_users, directus_roles,                   SELECT, INSERT, UPDATE, DELETE
--                                directus_sessions (+ refresh/session rows)
--   Access control               directus_permissions, directus_policies,          SELECT, INSERT, UPDATE, DELETE
--                                directus_access, directus_presets, directus_shares
--   Content history              directus_activity, directus_revisions,            SELECT, INSERT, UPDATE, DELETE
--                                directus_versions
--   Files                        directus_files, directus_folders                 SELECT, INSERT, UPDATE, DELETE
--   Automation                   directus_flows, directus_operations,              SELECT, INSERT, UPDATE, DELETE
--                                directus_webhooks
--   Admin / collaboration        directus_settings, directus_dashboards,           SELECT, INSERT, UPDATE, DELETE
--                                directus_panels, directus_notifications,
--                                directus_comments, directus_translations
--   Serial backing sequences     directus_*_id_seq et al.                         USAGE, SELECT
--
-- Every group carries the same four table verbs. That uniformity is the
-- ruling, not a missed refinement: Directus is the sole reader and writer of
-- its own system tables, and per-table carve-outs (migrations read-only,
-- sessions write-only) break on minor-version table additions and turn every
-- Directus upgrade into a staging outage shaped exactly like the one this
-- file fixes. The boundary this repository defends -- the column-level
-- ceiling on application tables holding children's and family data -- lives
-- in the per-collection grants and is untouched by this file: no GRANT here
-- names an application table, and suite 42 asserts that ceiling still holds.
--
-- STATED NON-GRANTS (what uniform DML does not imply):
--   No TRUNCATE, no REFERENCES, no TRIGGER on any directus_* table.
--   No DDL anywhere: no CREATE on schema public (bootstrap grants USAGE
--     only), no ALTER/DROP. Directus must never be its own migrator: version
--     upgrades apply through this sequence as directus_migrator, and a boot
--     with pending system migrations under directus_app fails loudly rather
--     than half-applying.
--   No default privileges: a blanket grant on future tables would also catch
--     future APPLICATION tables and silently widen the column-level model.
--     A Directus version that adds a directus_* table needs a follow-up
--     migration granting on it -- the loop below already covers whatever
--     matches the prefix at apply time.
--   No ownership change and no role provisioning: ownership transfer is an
--     operator step (needs cluster authority, ADR-0002), and this file
--     provisions no roles and grants no role-creation capability -- only
--     GRANT/REVOKE below.
--
-- ORDERING (read before applying anywhere but a fresh test database):
--   1. On a database where Directus has never booted there are no directus_*
--      tables and this file is a NOTICE-only no-op. That is correct, not a
--      gap: there is nothing to grant on yet. Initialise the system schema
--      first (runbook section 8: one-time owner-capable Directus init on a
--      fresh database), transfer ownership, then re-run this file.
--   2. On a database where Directus ran as another identity (staging today:
--      superuser-owned directus_*), the operator transfers ownership of every
--      directus_* table AND sequence to directus_migrator FIRST (runbook
--      section 8.3, pg_dump before). This file then grants on what the
--      migrator owns.
--   3. Section 1 below refuses while any directus_* table or sequence is owned
--      by anyone else, naming each object. A red gate with the operator step
--      in the message is worth more than a green run that granted nothing.
--
-- SECURITY NOTE: this migration touches the permission layer (it grants DML,
-- including DELETE, on tables whose activity/revision rows can snapshot
-- application row content). There is no independent security reviewer on this
-- team (board declined the seat on cost); the CTO self-review of this
-- migration is a recorded degradation, not independent review. Do not treat
-- a green gate as clearance. Staging-first per the runbook re-try procedure.
--
-- Rollback: rollback/20261024_0042_directus_runtime_matrix.down.sql
-- (revokes exactly the grants below, best-effort so rollback never strands).
-- Owner: migration role (directus_migrator). Never run as directus_app.
--
-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0041
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file provisions no roles.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(r, ', ') INTO v_missing
     FROM unnest(ARRAY['directus_migrator', 'directus_app']) AS r
     WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'bootstrap role(s) % are missing. They are provisioned by the cluster-owner '
      'bootstrap step BEFORE the migration sequence (ADR-0002), not by a migration. '
      'See services/directus/schema/bootstrap/README.md.',
      v_missing
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP PRECONDITION. Every directus_* table and sequence must already
--    belong to directus_migrator -- the identity this sequence runs as. Only
--    an owner (or a superuser) can GRANT, so anything else here would fail
--    halfway with a bare 42501. Refusing up front names every foreign-owned
--    object and the operator step that fixes it (runbook section 8.3).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname LIKE 'directus\_%' ESCAPE '\'
         AND c.relowner <> 'directus_migrator'::regrole
      UNION ALL
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'S'
         AND c.relname LIKE 'directus\_%' ESCAPE '\'
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the Directus runtime grant matrix: % is not owned by '
      'directus_migrator, and only an owner can GRANT. As the cluster owner, '
      'transfer every directus_* table and sequence to directus_migrator '
      'first (runbook services/staging/README.md section 8.3, pg_dump before), '
      'then re-run this migration. Never widen the migration identity to make '
      'this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. THE MATRIX. Loop over the directus_* prefix rather than a frozen table
--    list, so a Directus minor version that adds a system table is covered at
--    the next apply instead of failing boot. The prefix is Directus-owned by
--    convention: no application migration in this repository creates a
--    directus_* table, so the loop cannot reach application data. Tables get
--    the four DML verbs; PUBLIC is revoked for defence in depth (the 0040
--    precedent) on tables AND their backing sequences, symmetrically, so the
--    next editor copies one pattern, not an asymmetry; backing sequences get
--    USAGE + SELECT so serial inserts work.
--    Fresh database (Directus never booted): no tables match, NOTICE, no-op.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_seq text;
  v_tables integer := 0;
  v_seqs integer := 0;
BEGIN
  FOR v_table IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname LIKE 'directus\_%' ESCAPE '\'
     ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO directus_app', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', v_table);
    v_tables := v_tables + 1;
  END LOOP;

  FOR v_seq IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND c.relname LIKE 'directus\_%' ESCAPE '\'
     ORDER BY c.relname
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO directus_app', v_seq);
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', v_seq);
    v_seqs := v_seqs + 1;
  END LOOP;

  IF v_tables = 0 THEN
    RAISE NOTICE '0042 no directus_* tables present: nothing granted. On a fresh database this is expected -- initialise the Directus system schema, transfer ownership to directus_migrator, then re-run this migration (runbook section 8).';
  ELSE
    RAISE NOTICE '0042 Directus runtime matrix applied: % table(s) granted SELECT/INSERT/UPDATE/DELETE to directus_app with PUBLIC revoked, % sequence(s) granted USAGE/SELECT with PUBLIC revoked.', v_tables, v_seqs;
  END IF;
END
$$;
