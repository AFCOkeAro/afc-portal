-- 20261020_0011_blessings.sql
--
-- Blessings records (Slice 3c). AFC-474 / AFC-463c, spec authority
-- docs/planning/data-model-expansion.md §3.4 and docs/planning/prd-expansion.md
-- §3 (US-B1/US-B2).
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no blessings / blessing_events table exists in
-- services/directus/schema/migrations/):
--   blessings        -- §3.4: one row per (service/program, blessing_type)
--                       with male/female counts.
--   blessing_events  -- explicit blessing audit (created/updated/note).
--
-- CHOICE, STATED (issue: "total=male+female via generated column or Flow --
-- document choice"): GENERATED column. total_count is a pure function of two
-- columns in the SAME row, so a STORED generated column is exact and
-- synchronous with no writer to drift: it cannot be hand-edited (Postgres
-- refuses with 428C9) and it needs no cross-table recompute. That is the
-- opposite shape from attendance.total (docs/planning/attendance-flows.md
-- §2), which sums CHILD rows and therefore stays a Flow. The documented Flow
-- `blessings.total` (expansion §13) remains the named backfill guard for rows
-- predating this column, but on this schema it is a no-op: there is nothing
-- for it to write. No trigger and no function is installed here (denorm via
-- Flow, §13 posture, same as 0003/0010).
--
-- CHOICE, STATED (issue: "audit trail"; spec §3.4 names no audit table): a
-- parallel blessing_events table following the welfare_case_events precedent
-- (§6.3, migration 0009) and the sunday_service_events precedent (0010), not
-- silent reliance on the Directus activity log. Every blessing create and
-- update writes a row here via the portal route. A generic audit table shared
-- across domains would couple slices; a per-domain table keeps the rollback
-- boundary clean (this down script drops exactly what this file creates).
--
-- CHOICE, STATED (program-link delete behaviour): session/event/
-- sunday_service links are ON DELETE SET NULL. A blessing count is a ministry
-- fact about a dated service at a branch; removing the program row (a
-- correction by a reviewed migrator step) must not destroy the fact, and the
-- branch + service_date scoping survives without the link. Branch itself is
-- RESTRICT (a branch with blessings is not deleted by accident); denorm
-- zone/bsc are SET NULL (a zone delete clears the denorm, never the row).
-- recorded_by is a bare uuid with no FK: the Directus system users table is
-- owned elsewhere (same posture as 0010's created_by/actor_user).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   attendance_sessions / events / sunday_services / bible_study_centres /
--   branches / zones themselves. Parent tables are referenced only where they
--   exist (§2: each FK lands conditionally under a FIXED constraint name, so
--   the owning slice and this file agree; a missing parent skips loudly
--   rather than forking a table another slice owns -- the 0003 merge-contract
--   pattern). Rerunning this file after the parents land completes the FKs.
--
-- GRANTS (expansion §10, matrix §11 row `blessings`): Postgres sees one app
-- identity, so branch/zone scoping and the dept-head 403 live in the Directus
-- policy + portal route filters, not here. This layer states the ceiling
-- only: directus_app gets SELECT everywhere, INSERT/UPDATE on operational
-- columns, NO DELETE on either table (blessings are audited ministry facts;
-- corrections are UPDATEs and removals are a reviewed migrator step).
-- total_count is GENERATED: it is deliberately absent from the INSERT/UPDATE
-- column lists, so the app cannot name it (Postgres would refuse with 428C9).
--
-- Rollback: rollback/20261020_0011_blessings.down.sql (refuses while either
-- table holds rows; drops in dependency order, no CASCADE).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below -- this file mints no roles (ADR-0002,
--    scripts/migration-privilege-gate.sh).
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
-- 1. blessings (§3.4).
--    blessing_type is exactly the §3.4 six-value set; other_label is required
--    exactly when blessing_type = other (mirrors the
--    attendance_counts_other_needs_label CHECK in 0003). male/female default
--    0 and reject negatives; total_count is GENERATED (see header choice).
--    Branch is required (a scopeless blessing would be invisible);
--    service_date is required (the bucket reports group by it).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blessings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blessing_type      text NOT NULL
                       CHECK (blessing_type IN
                         ('salvation', 'sanctification', 'baptism_holy_ghost',
                          'reanointing', 'healing', 'other')),
  other_label        text,
  male_count         integer NOT NULL DEFAULT 0 CHECK (male_count >= 0),
  female_count       integer NOT NULL DEFAULT 0 CHECK (female_count >= 0),
  total_count        integer GENERATED ALWAYS AS (male_count + female_count) STORED,
  branch             uuid NOT NULL,
  zone               uuid,
  bsc                uuid,
  session            uuid,
  event              uuid,
  sunday_service     uuid,
  service_date       date NOT NULL,
  recorded_by        uuid,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blessings_other_needs_label
    CHECK (blessing_type <> 'other'
           OR (other_label IS NOT NULL
               AND btrim(other_label) <> ''))
);

COMMENT ON TABLE blessings IS
  'Blessings per service/program (data-model-expansion §3.4, AFC-474). One row per (program, blessing_type); multi-type per program is the norm. total_count is GENERATED (male+female), never hand-edited. zone/bsc are denorm via branch (Flow blessings.denorm, expansion §13 pattern); program links (session/event/sunday_service) are SET NULL so a program correction never destroys the fact.';

CREATE INDEX IF NOT EXISTS blessings_branch_idx
  ON blessings (branch);
CREATE INDEX IF NOT EXISTS blessings_zone_idx
  ON blessings (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS blessings_service_date_idx
  ON blessings (service_date);
CREATE INDEX IF NOT EXISTS blessings_branch_date_idx
  ON blessings (branch, service_date);
CREATE INDEX IF NOT EXISTS blessings_zone_date_idx
  ON blessings (zone, service_date);
CREATE INDEX IF NOT EXISTS blessings_type_idx
  ON blessings (blessing_type);
CREATE INDEX IF NOT EXISTS blessings_session_idx
  ON blessings (session) WHERE session IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Conditional FKs onto parent tables owned elsewhere (the 0003
--    merge-contract pattern). Each lands only where the parent exists, under
--    a FIXED name so reruns and the contract test agree; a missing parent
--    skips loudly (the owning slice re-runs this file when the table lands).
--    Branch RESTRICT / denorm SET NULL / program-link SET NULL (see header).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_branch_fkey: branches not present (the hierarchy-owning slice re-runs this migration when the table lands).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_branch_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'blessings_branch_fkey ensured (RESTRICT: a branch with blessings is not deleted by accident).';
  ELSE
    RAISE NOTICE 'blessings_branch_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_zone_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessings_zone_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'blessings_zone_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.bible_study_centres') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_bsc_fkey: bible_study_centres not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_bsc_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_bsc_fkey
      FOREIGN KEY (bsc) REFERENCES bible_study_centres(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessings_bsc_fkey ensured (denorm SET NULL).';
  ELSE
    RAISE NOTICE 'blessings_bsc_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_session_fkey: attendance_sessions not present (the sessions-owning slice re-runs this migration when the table lands).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_session_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessings_session_fkey ensured (program link SET NULL: the fact survives a program correction).';
  ELSE
    RAISE NOTICE 'blessings_session_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_event_fkey: events not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_event_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_event_fkey
      FOREIGN KEY (event) REFERENCES events(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessings_event_fkey ensured (program link SET NULL).';
  ELSE
    RAISE NOTICE 'blessings_event_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.sunday_services') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_sunday_service_fkey: sunday_services not present (the services slice re-runs this migration when the table lands).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_sunday_service_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_sunday_service_fkey
      FOREIGN KEY (sunday_service) REFERENCES sunday_services(id) ON DELETE SET NULL;
    RAISE NOTICE 'blessings_sunday_service_fkey ensured (program link SET NULL).';
  ELSE
    RAISE NOTICE 'blessings_sunday_service_fkey already present, left alone.';
  END IF;
END
$$;

-- Backfill the denorm where the branch parent is known. Rerunnable: only
-- rows whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.blessings') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE blessings b
       SET zone = br.zone
      FROM branches br
     WHERE b.zone IS NULL AND b.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'blessings zone denorm backfilled from branches.';
  ELSE
    RAISE NOTICE 'blessings zone backfill skipped: table or branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. blessing_events (explicit blessing audit; see header choice).
--    event_type: created (blessing recorded), updated (counts/link edited),
--    note (freeform). A blessing's rows are meaningless without it: CASCADE.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blessing_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blessing    uuid NOT NULL REFERENCES blessings(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'updated', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE blessing_events IS
  'Explicit blessing audit (AFC-474; welfare_case_events precedent §6.3). Portal routes write created on record, updated on any edit.';

CREATE INDEX IF NOT EXISTS blessing_events_blessing_created_idx
  ON blessing_events (blessing, created_at);
CREATE INDEX IF NOT EXISTS blessing_events_blessing_idx
  ON blessing_events (blessing);

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    blessings are audited ministry facts; the events table is the audit
--    trail; erasure runs as retention_worker, never through the API.
--    total_count is GENERATED and is absent from both column lists on purpose.
-- ---------------------------------------------------------------------------
GRANT SELECT ON blessings TO directus_app;
GRANT INSERT (blessing_type, other_label, male_count, female_count,
  branch, zone, bsc, session, event, sunday_service, service_date,
  recorded_by, notes)
  ON blessings TO directus_app;
GRANT UPDATE (blessing_type, other_label, male_count, female_count,
  branch, zone, bsc, session, event, sunday_service, service_date,
  recorded_by, notes)
  ON blessings TO directus_app;

GRANT SELECT ON blessing_events TO directus_app;
GRANT INSERT (blessing, event_type, detail, actor_user)
  ON blessing_events TO directus_app;
GRANT UPDATE (detail) ON blessing_events TO directus_app;

REVOKE ALL ON blessings FROM PUBLIC;
REVOKE ALL ON blessing_events FROM PUBLIC;
