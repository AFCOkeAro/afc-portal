-- 20261020_0010_sunday_services.sql
--
-- Sunday services + rosters (Slice 3). AFC-473 / AFC-463b, spec authority
-- docs/planning/data-model.md §§4.1/4.3/4.4 and docs/planning/data-model-expansion.md §§3/10.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no sunday_services / service_assignments / sunday_service_events table
-- exists in services/directus/schema/migrations/):
--   sunday_services      -- §4.3 + zone denorm (Flow-maintained, §10 scope model).
--   service_assignments  -- §4.4 roster (service, person, role, status) + branch denorm.
--   sunday_service_events -- explicit service audit (created/assigned/status_changed/note).
--
-- CHOICE, STATED (issue: "audit trail on create/assign/status"; spec §4 names
-- no audit table): a parallel events table following the welfare_case_events
-- precedent (§6.3, migration 0009), not a second notes column and not silent
-- reliance on the Directus activity log. One audit table stays the single
-- trail: every service create, roster assign and roster/service status change
-- writes a row here via the portal route. A generic audit table shared across
-- domains would couple slices; a per-domain table keeps the rollback boundary
-- clean (this down script drops exactly what this file creates).
--
-- CHOICE, STATED (issue: "Flow or trigger total_headcount = sum(count)
-- (document choice)"): Flow. The writer stays `attendance.total`
-- (docs/planning/attendance-flows.md §2): SUM(count) over the session's split
-- rows where split rows exist, else the legacy headcount_total. This file
-- installs no trigger and no function (denorm via Flow, §13) -- the same
-- posture as 0002 (hierarchy denorm) and 0003 (split tables).
-- Likewise sunday_services.total_attendance is copied from the linked
-- attendance_sessions row by the documented Flow `services.total`
-- (trigger: session with service = this service created/updated;
-- effect: total_attendance <- session total_headcount); no trigger here.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   attendance_sessions. No earlier file in this history creates it, and the
--   session header belongs to the capture slice that owns the Directus
--   collection (same reasoning as 0003's header). The denorm columns this
--   slice needs (zone, bsc, service_type_def) land CONDITIONALLY (§2): added
--   where the host table exists, skipped loudly where it does not.
--   headcount_* columns are untouched (back-compat, per issue).
--   The attendance_counts.session FK lands CONDITIONALLY (§3) under the fixed
--   name 0003's merge contract reserves (attendance_counts_session_fkey).
--
-- FK POLICY: hierarchy/branch parents RESTRICT (a branch with services is not
-- deleted by accident); roster children CASCADE (assignments/events are
-- meaningless without their service); person links RESTRICT on assignments
-- (a rostered person is not deleted by accident) and SET NULL on services
-- (a preacher leaving does not delete the service); denorm zone/branch
-- SET NULL (a zone delete clears the denorm, never the row). No other CASCADE.
--
-- GRANTS (expansion §10, matrix §10): Postgres sees one app identity, so
-- branch/zone scoping and the dept-head other-department 403 live in the
-- Directus policy + portal route filters, not here. This layer states the
-- ceiling only: directus_app gets SELECT everywhere, INSERT/UPDATE on
-- operational columns, NO DELETE on any of the three tables (services are
-- audited ministry facts; corrections are UPDATEs/status changes and removals
-- are a reviewed migrator step).
--
-- Rollback: rollback/20261020_0010_sunday_services.down.sql (refuses while
-- any of the three tables holds rows; drops in dependency order, no CASCADE).
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
-- 1. sunday_services (§4.3 + zone denorm for §10 scoping).
--    service_type is the §4.3 set (sunday, midweek, special, camp): the
--    eleven-key service_type_definitions set (§3.1) classifies attendance
--    sessions, not services; conflating them would corrupt the capture form's
--    category resolution. status planned/completed per §4.3.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sunday_services (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch             uuid NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  zone               uuid REFERENCES zones(id) ON DELETE SET NULL,
  service_date       date NOT NULL,
  service_time       time,
  service_type       text NOT NULL DEFAULT 'sunday'
                      CHECK (service_type IN ('sunday', 'midweek', 'special', 'camp')),
  theme              text,
  preacher           uuid REFERENCES people(id) ON DELETE SET NULL,
  expected_attendance integer CHECK (expected_attendance IS NULL OR expected_attendance >= 0),
  total_attendance   integer CHECK (total_attendance IS NULL OR total_attendance >= 0),
  status             text NOT NULL DEFAULT 'planned'
                      CHECK (status IN ('planned', 'completed')),
  notes              text,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sunday_services IS
  'Sunday/midweek/special/camp services (data-model §4.3, AFC-473). zone is denorm via branch (Flow services.denorm, expansion §13 pattern). total_attendance is copied from the linked attendance session by Flow services.total, never hand-edited.';

CREATE INDEX IF NOT EXISTS sunday_services_branch_date_time_idx
  ON sunday_services (branch, service_date, service_time);
CREATE INDEX IF NOT EXISTS sunday_services_status_idx
  ON sunday_services (status);
CREATE INDEX IF NOT EXISTS sunday_services_zone_idx
  ON sunday_services (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS sunday_services_branch_idx
  ON sunday_services (branch);

-- Backfill the denorm where the branch parent is known. Rerunnable: only
-- rows whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.sunday_services') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE sunday_services s
       SET zone = b.zone
      FROM branches b
     WHERE s.zone IS NULL AND s.branch = b.id AND b.zone IS NOT NULL;
    RAISE NOTICE 'sunday_services zone denorm backfilled from branches.';
  ELSE
    RAISE NOTICE 'sunday_services zone backfill skipped: table or branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Conditional denorm + merge-contract FK on attendance_sessions.
--    Runs only where the host table exists; otherwise a NOTICE names the
--    Directus field spec that remains the authority
--    (docs/planning/attendance-flows.md §1, hierarchy-flows.md §2).
--    headcount_* columns are never touched (back-compat, per issue).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping attendance_sessions alters: table not present. Directus fields zone (M2O zones), bsc (M2O bible_study_centres, nullable), service_type_def (M2O service_type_definitions, nullable) per attendance-flows.md §1; the sessions-owning slice adds them with the table.';
  ELSE
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS zone uuid REFERENCES zones(id) ON DELETE SET NULL;
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS bsc uuid REFERENCES bible_study_centres(id) ON DELETE SET NULL;
    ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS service_type_def uuid REFERENCES service_type_definitions(id) ON DELETE SET NULL;
    RAISE NOTICE 'attendance_sessions denorm columns ensured (zone, bsc, service_type_def).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. The 0003 merge contract: attendance_counts.session ->
--    attendance_sessions(id) ON DELETE CASCADE (a count is a fact about its
--    session). Fixed constraint name so the contract test and this file agree.
--    Only where both tables exist and the constraint is absent; a missing
--    sessions table skips loudly (the owning slice re-runs this file).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'Skipping attendance_counts_session_fkey: attendance_sessions not present (the sessions-owning slice re-runs this migration when the table lands).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_session_fkey') THEN
    ALTER TABLE attendance_counts ADD CONSTRAINT attendance_counts_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE CASCADE;
    RAISE NOTICE 'attendance_counts_session_fkey ensured (merge contract 0003).';
  ELSE
    RAISE NOTICE 'attendance_counts_session_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. service_assignments (§4.4 roster + branch denorm for §10 scoping).
--    role is exactly the §4.4 ten-value set; status invited/confirmed/
--    declined per §4.4. person RESTRICT (rostered people are not deleted by
--    accident); branch denorm SET NULL (a branch delete clears the denorm,
--    never the roster row -- the service FK still scopes it).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service     uuid NOT NULL REFERENCES sunday_services(id) ON DELETE CASCADE,
  person      uuid NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
  role        text NOT NULL
                CHECK (role IN
                  ('worship_leader', 'preacher', 'usher', 'media', 'sound',
                   'children', 'welcome', 'prayer', 'offering', 'communion')),
  branch      uuid REFERENCES branches(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'invited'
                CHECK (status IN ('invited', 'confirmed', 'declined')),
  notes       text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE service_assignments IS
  'Service roster (data-model §4.4, AFC-473). One row per (service, person, role) in practice; branch is denorm from the service (Flow services.denorm) for §10 scoping. person RESTRICT: a rostered person is not deleted by accident.';

CREATE INDEX IF NOT EXISTS service_assignments_service_idx
  ON service_assignments (service);
CREATE INDEX IF NOT EXISTS service_assignments_person_idx
  ON service_assignments (person);
CREATE INDEX IF NOT EXISTS service_assignments_service_role_idx
  ON service_assignments (service, role);
CREATE INDEX IF NOT EXISTS service_assignments_branch_idx
  ON service_assignments (branch) WHERE branch IS NOT NULL;

-- Backfill the denorm from the parent service. Rerunnable (NULL-only move).
DO $$
BEGIN
  UPDATE service_assignments a
     SET branch = s.branch
    FROM sunday_services s
   WHERE a.branch IS NULL AND a.service = s.id;
  RAISE NOTICE 'service_assignments branch denorm backfilled from sunday_services.';
END
$$;

-- ---------------------------------------------------------------------------
-- 5. sunday_service_events (explicit service audit; see header choice).
--    event_type: created (service created), assigned (roster row added),
--    status_changed (service or assignment status moved), note (freeform).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sunday_service_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service     uuid NOT NULL REFERENCES sunday_services(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'assigned', 'status_changed', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sunday_service_events IS
  'Explicit service audit (AFC-473; welfare_case_events precedent §6.3). Portal routes write created on service create, assigned on roster add, status_changed on any status move.';

CREATE INDEX IF NOT EXISTS sunday_service_events_service_created_idx
  ON sunday_service_events (service, created_at);
CREATE INDEX IF NOT EXISTS sunday_service_events_service_idx
  ON sunday_service_events (service);

-- ---------------------------------------------------------------------------
-- 6. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--    services are audited ministry facts; the events table is the audit
--    trail; erasure runs as retention_worker, never through the API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON sunday_services TO directus_app;
GRANT INSERT (branch, zone, service_date, service_time, service_type, theme,
  preacher, expected_attendance, total_attendance, status, notes, created_by)
  ON sunday_services TO directus_app;
GRANT UPDATE (branch, zone, service_date, service_time, service_type, theme,
  preacher, expected_attendance, total_attendance, status, notes)
  ON sunday_services TO directus_app;

GRANT SELECT ON service_assignments TO directus_app;
GRANT INSERT (service, person, role, branch, status, notes, created_by)
  ON service_assignments TO directus_app;
GRANT UPDATE (person, role, branch, status, notes)
  ON service_assignments TO directus_app;

GRANT SELECT ON sunday_service_events TO directus_app;
GRANT INSERT (service, event_type, detail, actor_user)
  ON sunday_service_events TO directus_app;
GRANT UPDATE (detail) ON sunday_service_events TO directus_app;

REVOKE ALL ON sunday_services FROM PUBLIC;
REVOKE ALL ON service_assignments FROM PUBLIC;
REVOKE ALL ON sunday_service_events FROM PUBLIC;
