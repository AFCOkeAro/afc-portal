-- 20261020_0023_attendance_sessions.sql
--
-- Attendance sessions + name-level records (AFC-566, parent AFC-460).
-- Spec authority: docs/planning/data-model.md §§4.1-4.2 + §7 (FK policy),
-- docs/planning/data-model-expansion §3 + attendance-flows.md §§1-3,
-- packages/shared attendance zod schemas (11-key session_type, men/women/
-- children + computed total, record person-or-name), and the portal routes
-- under apps/web/server/api/attendance/ (+ the shared report collector in
-- apps/web/server/utils/attendance-report.ts).
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no CREATE TABLE for either exists in services/directus/schema/migrations/):
--   attendance_sessions -- §4.1 header (area-wide via null branch) WITH the
--                           0002/0010 denorm columns (zone, bsc,
--                           service_type_def), the 0003-backfill legacy
--                           headcounts, the capture idempotency_key, and
--                           the 0013 §9.6 attendance_session back-reference
--                           target (the column lives on events; the FK lands
--                           in §3).
--   attendance_records  -- name-level check-ins (route-canonical columns
--                           attendee_name/attendance_category, NOT the §4.2
--                           draft names -- choice 4).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No status/notes columns on sessions: 71's retired fixture carried a
--   `status` default and a `notes` column, but no route reads or writes
--   either (capture/patch set the fields above; corrections are UPDATEs).
--   Sessions are facts; adding lifecycle no reader needs would invent
--   state the portal cannot move.
--   No events FK on sessions.event: a session may shadow an event without
--   belonging to it (calendar/report read events and sessions separately).
--   The link stays a bare uuid, stated not silent.
--
-- CONDITIONAL OVERLAP, stated so a re-run stays silent:
--   0002 hierarchy §10 adds zone + bsc IF NOT EXISTS where sessions exists;
--   0003 §2 adds service_type_def IF NOT EXISTS. This file creates the
--   table WITH all three, so those blocks become no-ops -- same treatment,
--   no fork. 0010 §3 names the attendance_counts_session_fkey merge
--   contract; this file closes it from the sessions side under the FIXED
--   name (0010 precedent: parent-landing slice closes it), so 0010's own
--   block (and 77's re-apply of 0010) is a no-op.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. sessions.branch nullable RESTRICT (null = area-wide, same posture
--      as events/departments: capture resolves null for area staff without
--      an explicit branch).
--   2. session_type CHECK is the 11-key SERVICE_TYPE_KEYS set (capture
--      writes 11 keys; the 5-key SESSION_TYPES form set is a subset).
--      Fixture-era `service_type` is renamed to the route-canonical
--      `session_type`; suite 71's retired fixture is rewritten to match.
--   3. FK policy per §7 + 0010 precedent: sessions.service SET NULL (a
--      service correction never destroys the session); records.session
--      CASCADE; record person SET NULL; 0003-merge counts.session CASCADE;
--      0011-merge blessings.session SET NULL; 0013-merge
--      events.attendance_session SET NULL. Person links RESTRICT nowhere
--      here: a rostered/recorded person is protected by the junction and
--      welfare guards, and deleting a person is retention-managed anyway.
--   4. Records use attendee_name + attendance_category (member/visitor/
--      child/other, route default 'member'), not the §4.2 draft names
--      (name_if_unnamed/category/present/check_in_at). The routes, the zod
--      schema and the CSV/detail reads all agree on the former; the data-
--      model draft names never shipped in any migration. Partial UNIQUE
--      (session, person) WHERE person IS NOT NULL (§4.2): the same person
--      is not checked into one session twice.
--   5. No DB-level total = sum(counts) trigger: the capture/patch routes
--      write headcount_total server-side (headcountTotal), and 0010
--      documents the Flow posture for derived totals (Flow, not trigger).
--      A trigger here would double-own what the routes already compute.
--
-- GRANTS (expansion §10 posture: one app identity; branch/zone scoping lives
-- in the Directus policy + portal route filters, not here). directus_app gets
-- SELECT everywhere, INSERT/UPDATE on operational columns (legacy headcounts
-- included -- back-compat writers still fill them), NO DELETE on either
-- table (0010 precedent: attendance facts are audited; corrections are
-- UPDATEs; erasure runs as retention_worker). No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0023_attendance_sessions.down.sql (refuses
-- while either table holds rows; drops the three §3 merge FKs first (F4),
-- then in dependency order, no CASCADE). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per ADR-0002:
-- this file provisions no roles and grants no role-creation or superuser
-- capability; only GRANT/REVOKE below.

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
-- 1. attendance_sessions (§4.1). 0002/0010 denorm columns included so their
--    blocks are no-ops; legacy five headcounts included so 0003's backfill
--    fires on the real table (71's tripwire retires here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch            uuid REFERENCES branches(id) ON DELETE RESTRICT,
  zone              uuid REFERENCES zones(id) ON DELETE SET NULL,
  bsc               uuid REFERENCES bible_study_centres(id) ON DELETE SET NULL,
  session_date      date NOT NULL,
  session_type      text NOT NULL
                      CHECK (session_type IN
                        ('sunday_school', 'elementary', 'devotional',
                         'youth_service', 'revival_service', 'sunday_service',
                         'midweek', 'event', 'camp', 'department', 'special')),
  session_name      text,
  service           uuid REFERENCES sunday_services(id) ON DELETE SET NULL,
  event             uuid,
  service_type_def  uuid REFERENCES service_type_definitions(id) ON DELETE SET NULL,
  headcount_total   integer CHECK (headcount_total IS NULL OR headcount_total >= 0),
  headcount_men     integer CHECK (headcount_men IS NULL OR headcount_men >= 0),
  headcount_women   integer CHECK (headcount_women IS NULL OR headcount_women >= 0),
  headcount_children integer CHECK (headcount_children IS NULL OR headcount_children >= 0),
  headcount_adults  integer CHECK (headcount_adults IS NULL OR headcount_adults >= 0),
  headcount_youth   integer CHECK (headcount_youth IS NULL OR headcount_youth >= 0),
  headcount_teens   integer CHECK (headcount_teens IS NULL OR headcount_teens >= 0),
  headcount_visitors integer CHECK (headcount_visitors IS NULL OR headcount_visitors >= 0),
  idempotency_key   text UNIQUE,
  recorded_by       uuid,
  recorded_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE attendance_sessions IS
  'Attendance session headers (data-model §4.1, AFC-468/AFC-566). branch null = area-wide. session_type is the 11-key SERVICE_TYPE_KEYS set; idempotency_key turns a double-submitted capture into a 409, not a twin. Legacy headcounts stay readable for back-compat (0003 backfill reads them); only men/women/children + computed total are route-written.';

CREATE INDEX IF NOT EXISTS attendance_sessions_branch_date_idx
  ON attendance_sessions (branch, session_date);
CREATE INDEX IF NOT EXISTS attendance_sessions_service_idx
  ON attendance_sessions (service) WHERE service IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_sessions_event_idx
  ON attendance_sessions (event) WHERE event IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_sessions_session_type_idx
  ON attendance_sessions (session_type);
CREATE INDEX IF NOT EXISTS attendance_sessions_zone_idx
  ON attendance_sessions (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS attendance_sessions_idempotency_idx
  ON attendance_sessions (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 0002-pattern zone backfill, NULL-only and rerunnable: the denorm lands
-- even though 0002 ran before this table existed.
DO $$
BEGIN
  IF to_regclass('public.branches') IS NOT NULL THEN
    UPDATE attendance_sessions s
       SET zone = b.zone
      FROM branches b
     WHERE s.zone IS NULL AND s.branch = b.id AND b.zone IS NOT NULL;
    RAISE NOTICE 'attendance_sessions zone denorm backfilled from branches (rerunnable, NULL-only).';
  ELSE
    RAISE NOTICE 'attendance_sessions zone backfill skipped: branches absent.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. attendance_records (name-level check-ins, route-canonical columns).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session             uuid NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  person              uuid REFERENCES people(id) ON DELETE SET NULL,
  attendee_name       text,
  attendance_category text
                        CHECK (attendance_category IS NULL OR attendance_category IN
                          ('member', 'visitor', 'child', 'other')),
  recorded_by         uuid,
  recorded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE attendance_records IS
  'Name-level session check-ins (AFC-470 §US-8/AFC-566). One row per check-in: a person id, a typed name, or both. Uniqueness is a PARTIAL index below (session, person) WHERE person IS NOT NULL -- the §4.2 draft unique restated so the same person is not checked into one session twice, while fully-anonymous visitor rows stay insertable.';

-- Partial, not table-level: a UNIQUE NULLS NOT DISTINCT (session, person)
-- constraint would treat (s, NULL) as equal and allow only ONE anonymous
-- row per session. The route always sends attendee_name and/or person, but
-- two fully-anonymous rows must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_session_person_uidx
  ON attendance_records (session, person) WHERE person IS NOT NULL;

CREATE INDEX IF NOT EXISTS attendance_records_session_idx
  ON attendance_records (session);
CREATE INDEX IF NOT EXISTS attendance_records_person_idx
  ON attendance_records (person) WHERE person IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Merge close-outs from the sessions side (0010 §3 precedent: the slice
--    that lands the parent table closes the conditional FKs under their
--    FIXED names, so reruns and contract tests agree).
--    (a) attendance_counts_session_fkey (0003 contract) CASCADE.
--    (b) blessings_session_fkey (0011) SET NULL.
--    (c) events_attendance_session_fkey (0013 §9.6) SET NULL on
--        events.attendance_session.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.attendance_counts') IS NULL THEN
    RAISE NOTICE 'Skipping attendance_counts_session_fkey: table not present. The FK lands when attendance_counts exists; until then split rows stay bare uuids under the 0003 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_counts_session_fkey') THEN
    ALTER TABLE attendance_counts ADD CONSTRAINT attendance_counts_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE CASCADE;
    RAISE NOTICE 'FK added: attendance_counts.session -> attendance_sessions(id) CASCADE (closes 0003 merge contract).';
  ELSE
    RAISE NOTICE 'attendance_counts_session_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.blessings') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_session_fkey: table not present. The FK lands when blessings exists; until then blessing session links stay bare uuids under the 0011 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_session_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_session_fkey
      FOREIGN KEY (session) REFERENCES attendance_sessions(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: blessings.session -> attendance_sessions(id) SET NULL (closes 0011 merge contract).';
  ELSE
    RAISE NOTICE 'blessings_session_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping events_attendance_session_fkey: events not present. The FK lands when events exists; until then the session back-reference stays a bare uuid under the 0013 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'events'
                       AND column_name = 'attendance_session') THEN
    RAISE NOTICE 'Skipping events_attendance_session_fkey: events.attendance_session column not present (0021 owns the column; its down script refuses while rows reference it).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_session_fkey') THEN
    ALTER TABLE events ADD CONSTRAINT events_attendance_session_fkey
      FOREIGN KEY (attendance_session) REFERENCES attendance_sessions(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: events.attendance_session -> attendance_sessions(id) SET NULL (closes 0013 §9.6 merge contract).';
  ELSE
    RAISE NOTICE 'events_attendance_session_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. No DELETE on either table.
-- ---------------------------------------------------------------------------
GRANT SELECT ON attendance_sessions TO directus_app;
GRANT INSERT (branch, zone, bsc, session_date, session_type, session_name,
  service, event, service_type_def, headcount_total, headcount_men,
  headcount_women, headcount_children, headcount_adults, headcount_youth,
  headcount_teens, headcount_visitors, idempotency_key, recorded_by,
  recorded_at)
  ON attendance_sessions TO directus_app;
GRANT UPDATE (branch, zone, bsc, session_date, session_type, session_name,
  service, event, service_type_def, headcount_total, headcount_men,
  headcount_women, headcount_children, headcount_adults, headcount_youth,
  headcount_teens, headcount_visitors, idempotency_key, recorded_by,
  recorded_at)
  ON attendance_sessions TO directus_app;

GRANT SELECT ON attendance_records TO directus_app;
GRANT INSERT (session, person, attendee_name, attendance_category,
  recorded_by, recorded_at)
  ON attendance_records TO directus_app;
GRANT UPDATE (session, person, attendee_name, attendance_category,
  recorded_by, recorded_at)
  ON attendance_records TO directus_app;

REVOKE ALL ON attendance_sessions FROM PUBLIC;
REVOKE ALL ON attendance_records FROM PUBLIC;
