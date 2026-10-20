-- 20261020_0013_office.sql
--
-- Office bundle (Slice 3f). AFC-477 / AFC-463f, spec authority
-- docs/planning/data-model-expansion.md §§9.1–9.7 and docs/planning/prd-expansion.md
-- §§9.3/US-U3, 10/US-E3/US-E4.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no transfers / marriage_matters / office_minutes / minutes_attendees /
-- tasks / announcements / event_referrals table exists in
-- services/directus/schema/migrations/):
--   transfers            -- §9.1: person, from/to branch, reason, dates, status,
--                           requested/approved by, notes + zone denorm.
--   marriage_matters     -- §9.2: person, partner, type, wedding_date, status,
--                           notes + branch/zone scope.
--   office_minutes       -- §9.3: title, meeting_date, body, file, status +
--                           branch/zone scope.
--   minutes_attendees    -- §9.3 M2M junction (minute → person/user).
--   tasks                -- §9.4: title, description, assignee_user/person,
--                           due_date, status, priority, polymorphic related +
--                           branch/zone scope.
--   announcements        -- §9.5: title, body, publish window, channels/audience
--                           json, status + branch/zone scope (null = area-wide).
--   event_referrals      -- §9.7: event, inviter, invitee, invite_date, status
--                           + branch/zone scope copy.
--   *_events (x5)        -- explicit per-domain audit (transfer_events,
--                           marriage_matter_events, office_minute_events,
--                           task_events, announcement_events), following the
--                           welfare_case_events (§6.3) and blessing_events
--                           (0011) precedent -- never silent reliance on the
--                           Directus activity log.
--
-- CHOICE, STATED (issue: "audit trail"; spec §9 names no audit table): one
-- audit table per domain, same shape as welfare_case_events and
-- blessing_events. A generic audit table shared across domains would couple
-- slices; per-domain tables keep the rollback boundary clean (the down
-- script drops exactly what this file creates).
--
-- CHOICE, STATED (issue: "branch/zone scope columns not in §9 for marriage,
-- minutes, referrals"): added as the smallest defensible scoping. §10
-- demands zone/own-branch isolation for every operational record
-- ("Each operational record carries the deepest scope field it needs");
-- a scopeless marriage matter or referral would be invisible fail-closed.
--   transfers: scope derives from from_branch/to_branch (no extra branch
--     column); zone is denorm via from_branch (Flow-maintained, §10 pattern).
--   marriage_matters / office_minutes / tasks: branch required + zone denorm
--     (same posture as blessings 0011: a record with no branch has no scope).
--   announcements / event_referrals: branch nullable (null = area-wide
--     announcement; referral copies its event's branch) + zone denorm.
-- Portal routes set these from the caller's scope; the Flow keeps the denorm.
--
-- CHOICE, STATED (issue: "event_sessions optional — document include/defer"):
-- DEFERRED. §9.6 marks event_sessions optional (Summit agenda). Creating it
-- here would fork the events-owning slice and widen this rollback boundary
-- for a table US-U3/US-E2 do not need (the calendar combines services +
-- events + programmes + celebrations; agenda detail is a Summit-slice
-- concern). The calendar feed helper skips absent tables loudly instead of
-- forking them. A Summit slice creates event_sessions when it needs it.
--
-- CHOICE, STATED (issue: "blessings_total (§9.6 derived)"): NOT a column.
-- It is derived (an event's blessings sum), written by the documented Flow
-- like attendance.total (attendance-flows.md §2) and services.total (0010),
-- never hand-edited. No trigger or function is installed here (denorm via
-- Flow, §13 posture, same as 0003/0010/0011).
--
-- CHOICE, STATED (issue: "announcement approval + publish window
-- enforcement"): the publish window order (publish_to >= publish_from) is a
-- CHECK; the draft → scheduled → published lifecycle and the approved_by
-- requirement are route rules (US-E3 AC3), not CHECKs -- a CHECK cannot know
-- the actor, and the matrix gives non-admins read-only access to minutes.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   people / branches / zones / events / attendance_sessions /
--   bible_study_centres / directus_users / directus_files themselves. Parent
--   tables are referenced only where they exist (§conditional FKs under FIXED
--   constraint names, the 0003 merge-contract pattern). A missing parent
--   skips loudly rather than forking a table another slice owns. Rerunning
--   this file after the parents land completes the FKs.
--   events itself is NOT created here (no earlier migration creates it; the
--   events-owning slice owns the Directus collection). §9.6 deltas land
--   CONDITIONALLY (§8): added where the host table exists, skipped loudly
--   where it does not.
--
-- GRANTS (expansion §10, matrix §11 rows transfers / marriage_matters /
-- office_minutes / tasks / announcements / event_referrals): Postgres sees
-- one app identity, so branch/zone scoping and the dept-head/assignee/household
-- reads live in the Directus policy + portal route filters, not here. This
-- layer states the ceiling only: directus_app gets SELECT everywhere,
-- INSERT/UPDATE on operational columns, NO DELETE on any table in this file
-- (office records are audited ministry facts; corrections are UPDATEs and
-- removals are a reviewed migrator step). tasks.description and
-- marriage/transfer notes are restricted reads (§11.1 + welfare precedent);
-- the Directus policy withholds them and the portal strips them (same as
-- welfare 0009) -- this layer withholds no column from directus_app because
-- Postgres sees one app identity (0005 §7 pattern).
--
-- Rollback: rollback/20261020_0013_office.down.sql (refuses while any table
-- holds rows; drops in dependency order, no CASCADE).
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
-- 1. transfers (§9.1). Scope = from_branch OR to_branch (no extra branch
--    column); zone denorm via from_branch. Status lifecycle
--    requested → approved → completed, or rejected (US-E4 AC1: approving a
--    transfer updates the person's home branch -- audited; the route does
--    the person update, this layer only records the fact).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person          uuid NOT NULL,
  from_branch     uuid NOT NULL,
  to_branch       uuid NOT NULL,
  zone            uuid,
  reason          text,
  request_date    date NOT NULL DEFAULT CURRENT_DATE,
  effective_date  date,
  status          text NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested', 'approved', 'completed', 'rejected')),
  requested_by    uuid,
  approved_by     uuid,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transfers_branches_differ CHECK (from_branch <> to_branch)
);

COMMENT ON TABLE transfers IS
  'Branch transfers (data-model-expansion §9.1, AFC-477). One row per move; scope is from_branch OR to_branch (zone denorm via from_branch, Flow-maintained). US-E4 AC1: approval moves the home branch via the portal route (audited), never by editing this row.';

CREATE INDEX IF NOT EXISTS transfers_person_status_idx
  ON transfers (person, status);
CREATE INDEX IF NOT EXISTS transfers_from_branch_idx
  ON transfers (from_branch);
CREATE INDEX IF NOT EXISTS transfers_to_branch_idx
  ON transfers (to_branch);
CREATE INDEX IF NOT EXISTS transfers_zone_idx
  ON transfers (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfers_status_idx
  ON transfers (status);

-- ---------------------------------------------------------------------------
-- 2. marriage_matters (§9.2). branch required (scopeless record invisible),
--    zone denorm. partner_person nullable (banns/counselling may name one
--    party). status lifecycle per issue list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marriage_matters (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person          uuid NOT NULL,
  partner_person  uuid,
  branch          uuid NOT NULL,
  zone            uuid,
  matter_type     text NOT NULL
                    CHECK (matter_type IN ('banns', 'wedding', 'counselling', 'other')),
  wedding_date    date,
  status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'in_progress', 'completed', 'closed')),
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE marriage_matters IS
  'Marriage matters (data-model-expansion §9.2, AFC-477). Branch required for §10 scoping; partner nullable; welfare-R readers see dept rows only via policy.';

CREATE INDEX IF NOT EXISTS marriage_matters_person_status_idx
  ON marriage_matters (person, status);
CREATE INDEX IF NOT EXISTS marriage_matters_branch_idx
  ON marriage_matters (branch);
CREATE INDEX IF NOT EXISTS marriage_matters_zone_idx
  ON marriage_matters (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS marriage_matters_status_idx
  ON marriage_matters (status);

-- ---------------------------------------------------------------------------
-- 3. office_minutes (§9.3) + minutes_attendees M2M. branch required, zone
--    denorm. file is a bare uuid (Directus file, owned elsewhere). status
--    per issue list (draft/final/published).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS office_minutes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (btrim(title) <> ''),
  meeting_date    date NOT NULL,
  body            text,
  file            uuid,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'final', 'published')),
  branch          uuid NOT NULL,
  zone            uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE office_minutes IS
  'Meeting minutes (data-model-expansion §9.3, AFC-477). Attendees via minutes_attendees M2M; file is a Directus file id (owned elsewhere). Matrix §11: CRUD area/super only, R elsewhere.';

CREATE INDEX IF NOT EXISTS office_minutes_meeting_date_idx
  ON office_minutes (meeting_date);
CREATE INDEX IF NOT EXISTS office_minutes_branch_idx
  ON office_minutes (branch);
CREATE INDEX IF NOT EXISTS office_minutes_zone_idx
  ON office_minutes (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS office_minutes_branch_date_idx
  ON office_minutes (branch, meeting_date);

CREATE TABLE IF NOT EXISTS minutes_attendees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute          uuid NOT NULL REFERENCES office_minutes(id) ON DELETE CASCADE,
  person          uuid,
  attendee_user   uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT minutes_attendees_someone_present
    CHECK (person IS NOT NULL OR attendee_user IS NOT NULL)
);

COMMENT ON TABLE minutes_attendees IS
  'Minutes attendees M2M (§9.3): each row links a minute to a person and/or a Directus user; at least one side is present. Follows the person-present CHECK shape.';

CREATE INDEX IF NOT EXISTS minutes_attendees_minute_idx
  ON minutes_attendees (minute);
CREATE INDEX IF NOT EXISTS minutes_attendees_person_idx
  ON minutes_attendees (person) WHERE person IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. tasks (§9.4). assignee_user (Directus user) + nullable assignee_person;
--    at least one assignee. related_type/related_id polymorphic light
--    (text + uuid, no FK -- the referent lives in any domain). branch
--    required + zone denorm. priority per issue list.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (btrim(title) <> ''),
  description     text,
  assignee_user   uuid,
  assignee_person uuid,
  branch          uuid NOT NULL,
  zone            uuid,
  due_date        date,
  status          text NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority        text NOT NULL DEFAULT 'normal'
                    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  related_type    text CHECK (related_type IS NULL OR btrim(related_type) <> ''),
  related_id      uuid,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_someone_assigned
    CHECK (assignee_user IS NOT NULL OR assignee_person IS NOT NULL)
);

COMMENT ON TABLE tasks IS
  'Office tasks (data-model-expansion §9.4, AFC-477). Assignee-scoped views in the portal; description is a restricted read (§11.1: assignee + scoped admin, enforced in policy, stripped in routes). related_* is polymorphic light (no FK).';

CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx
  ON tasks (assignee_user, status);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx
  ON tasks (due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_branch_idx
  ON tasks (branch);
CREATE INDEX IF NOT EXISTS tasks_zone_idx
  ON tasks (zone) WHERE zone IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_status_idx
  ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_related_idx
  ON tasks (related_type, related_id) WHERE related_type IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. announcements (§9.5). branch nullable (null = area-wide). publish
--    window ordered where both ends present. channels/audience are jsonb
--    (audience may later become M2O communication_audiences -- the owning
--    slice adds the FK and must not fork this table, 0003 merge pattern).
--    status lifecycle draft → scheduled → published, or cancelled (US-E3
--    AC3: the route writes the audit row on every transition).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (btrim(title) <> ''),
  body            text,
  publish_from    timestamptz,
  publish_to      timestamptz,
  channels        jsonb NOT NULL DEFAULT '[]'::jsonb,
  audience        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'scheduled', 'published', 'cancelled')),
  branch          uuid,
  zone            uuid,
  created_by      uuid,
  approved_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT announcements_window_ordered
    CHECK (publish_from IS NULL OR publish_to IS NULL OR publish_to >= publish_from)
);

COMMENT ON TABLE announcements IS
  'Announcements (data-model-expansion §9.5, AFC-477). Publish window + approval lifecycle (US-E3 AC3); branch null = area-wide. Matrix §11: public_only reads for household/public on published rows (policy-enforced).';

CREATE INDEX IF NOT EXISTS announcements_status_idx
  ON announcements (status);
CREATE INDEX IF NOT EXISTS announcements_publish_from_idx
  ON announcements (publish_from) WHERE publish_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS announcements_branch_idx
  ON announcements (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS announcements_zone_idx
  ON announcements (zone) WHERE zone IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. event_referrals (§9.7). branch/zone scope copy (of the event at create
--    time, set by the route). invitee link is light: name required, person
--    nullable (public-reg referrals name someone not yet in people).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event           uuid NOT NULL,
  inviter         uuid,
  invitee_name    text NOT NULL CHECK (btrim(invitee_name) <> ''),
  invitee_person  uuid,
  branch          uuid,
  zone            uuid,
  invite_date     date NOT NULL DEFAULT CURRENT_DATE,
  status          text NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'contacted', 'registered', 'attended', 'declined')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_referrals_inviter_or_person
    CHECK (inviter IS NOT NULL OR invitee_person IS NOT NULL OR btrim(invitee_name) <> '')
);

COMMENT ON TABLE event_referrals IS
  'Invite-a-friend referrals (data-model-expansion §9.7, AFC-477; prd-expansion §10.1). US-E2: referral links inviter → invitee + event; counts appear on the event; duplicates de-duplicated by the route (no uniqueness here: a re-invite after decline is a new row).';

CREATE INDEX IF NOT EXISTS event_referrals_event_inviter_idx
  ON event_referrals (event, inviter);
CREATE INDEX IF NOT EXISTS event_referrals_event_idx
  ON event_referrals (event);
CREATE INDEX IF NOT EXISTS event_referrals_branch_idx
  ON event_referrals (branch) WHERE branch IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Per-domain audit tables (see header choice). Same shape as
--    welfare_case_events / blessing_events: parent CASCADE, event_type,
--    detail, actor_user, created_at. The portal route writes created on
--    record, status_changed on every lifecycle move, note for freeform.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transfer_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer    uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'updated', 'status_changed', 'approved', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS marriage_matter_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marriage_matter uuid NOT NULL REFERENCES marriage_matters(id) ON DELETE CASCADE,
  event_type      text NOT NULL DEFAULT 'note'
                    CHECK (event_type IN ('created', 'updated', 'status_changed', 'note')),
  detail          text,
  actor_user      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS office_minute_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minute      uuid NOT NULL REFERENCES office_minutes(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'updated', 'status_changed', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type  text NOT NULL DEFAULT 'note'
                CHECK (event_type IN ('created', 'updated', 'status_changed', 'assigned', 'note')),
  detail      text,
  actor_user  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcement_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  event_type    text NOT NULL DEFAULT 'note'
                  CHECK (event_type IN ('created', 'updated', 'status_changed', 'approved', 'note')),
  detail        text,
  actor_user    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE transfer_events IS
  'Explicit transfer audit (AFC-477; welfare_case_events precedent). Portal routes write created/approved/status_changed; approving a transfer also writes the person home-branch move elsewhere.';
COMMENT ON TABLE task_events IS
  'Explicit task audit (AFC-477). assigned on every assignee change; overdue highlighting is a read (due_date < today AND status NOT IN done/cancelled), never stored.';

CREATE INDEX IF NOT EXISTS transfer_events_transfer_created_idx
  ON transfer_events (transfer, created_at);
CREATE INDEX IF NOT EXISTS marriage_matter_events_parent_created_idx
  ON marriage_matter_events (marriage_matter, created_at);
CREATE INDEX IF NOT EXISTS office_minute_events_minute_created_idx
  ON office_minute_events (minute, created_at);
CREATE INDEX IF NOT EXISTS task_events_task_created_idx
  ON task_events (task, created_at);
CREATE INDEX IF NOT EXISTS announcement_events_announcement_created_idx
  ON announcement_events (announcement, created_at);

-- ---------------------------------------------------------------------------
-- 8. events deltas (§9.6). CONDITIONAL (the events-owning slice owns the
--    table): added where the host exists, skipped loudly where it does not.
--    overview (text), invite_a_friend_enabled (boolean), attendance_session
--    (M2O nullable, FK completed where attendance_sessions exists).
--    blessings_total is derived via Flow (see header), NOT a column.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping events §9.6 deltas: events not present (the events-owning slice adds overview/invite_a_friend_enabled/attendance_session when the table lands; rerun this file then).';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'events'
                      AND column_name = 'overview') THEN
      ALTER TABLE events ADD COLUMN overview text;
      RAISE NOTICE 'events.overview ensured (§9.6).';
    ELSE
      RAISE NOTICE 'events.overview already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'events'
                      AND column_name = 'invite_a_friend_enabled') THEN
      ALTER TABLE events ADD COLUMN invite_a_friend_enabled boolean NOT NULL DEFAULT false;
      RAISE NOTICE 'events.invite_a_friend_enabled ensured (§9.6, default false).';
    ELSE
      RAISE NOTICE 'events.invite_a_friend_enabled already present, left alone.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'events'
                      AND column_name = 'attendance_session') THEN
      ALTER TABLE events ADD COLUMN attendance_session uuid;
      RAISE NOTICE 'events.attendance_session ensured (§9.6, M2O nullable).';
    ELSE
      RAISE NOTICE 'events.attendance_session already present, left alone.';
    END IF;

    IF to_regclass('public.attendance_sessions') IS NULL THEN
      RAISE NOTICE 'Skipping events_attendance_session_fkey: attendance_sessions not present.';
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_attendance_session_fkey') THEN
      ALTER TABLE events ADD CONSTRAINT events_attendance_session_fkey
        FOREIGN KEY (attendance_session) REFERENCES attendance_sessions(id) ON DELETE SET NULL;
      RAISE NOTICE 'events_attendance_session_fkey ensured (SET NULL: a session correction never destroys the event).';
    ELSE
      RAISE NOTICE 'events_attendance_session_fkey already present, left alone.';
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 9. Conditional FKs onto parent tables owned elsewhere (the 0003
--    merge-contract pattern). Each lands only where the parent exists, under
--    a FIXED name so reruns and the contract test agree; a missing parent
--    skips loudly rather than forking a table another slice owns.
--    Branch parents RESTRICT (a branch with office rows is not deleted by
--    accident); person links RESTRICT (a transferred/marrying person is not
--    deleted by accident); denorm zone SET NULL; program/event links SET
--    NULL; audit children CASCADE (see §7, real FKs -- referent created here).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- transfers.person / from / to
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping transfers_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_person_fkey') THEN
    ALTER TABLE transfers ADD CONSTRAINT transfers_person_fkey
      FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
    RAISE NOTICE 'transfers_person_fkey ensured (RESTRICT).';
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping transfers branch FKs: branches not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_from_branch_fkey') THEN
      ALTER TABLE transfers ADD CONSTRAINT transfers_from_branch_fkey
        FOREIGN KEY (from_branch) REFERENCES branches(id) ON DELETE RESTRICT;
      RAISE NOTICE 'transfers_from_branch_fkey ensured (RESTRICT).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_to_branch_fkey') THEN
      ALTER TABLE transfers ADD CONSTRAINT transfers_to_branch_fkey
        FOREIGN KEY (to_branch) REFERENCES branches(id) ON DELETE RESTRICT;
      RAISE NOTICE 'transfers_to_branch_fkey ensured (RESTRICT).';
    END IF;
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping transfers_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transfers_zone_fkey') THEN
    ALTER TABLE transfers ADD CONSTRAINT transfers_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'transfers_zone_fkey ensured (denorm SET NULL).';
  END IF;

  -- marriage_matters.person / partner / branch / zone
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_matters person FKs: people not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_matters_person_fkey') THEN
      ALTER TABLE marriage_matters ADD CONSTRAINT marriage_matters_person_fkey
        FOREIGN KEY (person) REFERENCES people(id) ON DELETE RESTRICT;
      RAISE NOTICE 'marriage_matters_person_fkey ensured (RESTRICT).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_matters_partner_fkey') THEN
      ALTER TABLE marriage_matters ADD CONSTRAINT marriage_matters_partner_fkey
        FOREIGN KEY (partner_person) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'marriage_matters_partner_fkey ensured (SET NULL).';
    END IF;
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_matters_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_matters_branch_fkey') THEN
    ALTER TABLE marriage_matters ADD CONSTRAINT marriage_matters_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'marriage_matters_branch_fkey ensured (RESTRICT).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping marriage_matters_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marriage_matters_zone_fkey') THEN
    ALTER TABLE marriage_matters ADD CONSTRAINT marriage_matters_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'marriage_matters_zone_fkey ensured (denorm SET NULL).';
  END IF;

  -- office_minutes.branch / zone
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping office_minutes_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_minutes_branch_fkey') THEN
    ALTER TABLE office_minutes ADD CONSTRAINT office_minutes_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'office_minutes_branch_fkey ensured (RESTRICT).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping office_minutes_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_minutes_zone_fkey') THEN
    ALTER TABLE office_minutes ADD CONSTRAINT office_minutes_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'office_minutes_zone_fkey ensured (denorm SET NULL).';
  END IF;

  -- minutes_attendees.person (branch-less junction; user is Directus-owned, bare uuid)
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping minutes_attendees_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'minutes_attendees_person_fkey') THEN
    ALTER TABLE minutes_attendees ADD CONSTRAINT minutes_attendees_person_fkey
      FOREIGN KEY (person) REFERENCES people(id) ON DELETE CASCADE;
    RAISE NOTICE 'minutes_attendees_person_fkey ensured (CASCADE: removing a person removes their attendance rows, not the minutes).';
  END IF;

  -- tasks.assignee_person / branch / zone (assignee_user is Directus-owned, bare uuid)
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping tasks_assignee_person_fkey: people not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_assignee_person_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_person_fkey
      FOREIGN KEY (assignee_person) REFERENCES people(id) ON DELETE SET NULL;
    RAISE NOTICE 'tasks_assignee_person_fkey ensured (SET NULL).';
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping tasks_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_branch_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'tasks_branch_fkey ensured (RESTRICT).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping tasks_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_zone_fkey') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'tasks_zone_fkey ensured (denorm SET NULL).';
  END IF;

  -- announcements.branch / zone
  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping announcements_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_branch_fkey') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE RESTRICT;
    RAISE NOTICE 'announcements_branch_fkey ensured (RESTRICT; null = area-wide).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping announcements_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcements_zone_fkey') THEN
    ALTER TABLE announcements ADD CONSTRAINT announcements_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'announcements_zone_fkey ensured (denorm SET NULL).';
  END IF;

  -- event_referrals.event / inviter / invitee_person / branch / zone
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping event_referrals_event_fkey: events not present (the events slice re-runs this migration when the table lands).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_event_fkey') THEN
    ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_event_fkey
      FOREIGN KEY (event) REFERENCES events(id) ON DELETE CASCADE;
    RAISE NOTICE 'event_referrals_event_fkey ensured (CASCADE: referrals are meaningless without their event).';
  END IF;

  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping event_referrals person FKs: people not present.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_inviter_fkey') THEN
      ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_inviter_fkey
        FOREIGN KEY (inviter) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'event_referrals_inviter_fkey ensured (SET NULL).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_invitee_person_fkey') THEN
      ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_invitee_person_fkey
        FOREIGN KEY (invitee_person) REFERENCES people(id) ON DELETE SET NULL;
      RAISE NOTICE 'event_referrals_invitee_person_fkey ensured (SET NULL).';
    END IF;
  END IF;

  IF to_regclass('public.branches') IS NULL THEN
    RAISE NOTICE 'Skipping event_referrals_branch_fkey: branches not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_branch_fkey') THEN
    ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_branch_fkey
      FOREIGN KEY (branch) REFERENCES branches(id) ON DELETE SET NULL;
    RAISE NOTICE 'event_referrals_branch_fkey ensured (scope copy SET NULL).';
  END IF;

  IF to_regclass('public.zones') IS NULL THEN
    RAISE NOTICE 'Skipping event_referrals_zone_fkey: zones not present.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_zone_fkey') THEN
    ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_zone_fkey
      FOREIGN KEY (zone) REFERENCES zones(id) ON DELETE SET NULL;
    RAISE NOTICE 'event_referrals_zone_fkey ensured (denorm SET NULL).';
  END IF;
END
$$;

-- Backfill denorms where the branch parent is known. Rerunnable: only rows
-- whose zone is still NULL and whose branch has a zone move.
DO $$
BEGIN
  IF to_regclass('public.transfers') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE transfers t SET zone = br.zone
      FROM branches br WHERE t.zone IS NULL AND t.from_branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'transfers zone denorm backfilled from from_branch.';
  END IF;
  IF to_regclass('public.marriage_matters') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE marriage_matters m SET zone = br.zone
      FROM branches br WHERE m.zone IS NULL AND m.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'marriage_matters zone denorm backfilled from branch.';
  END IF;
  IF to_regclass('public.office_minutes') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE office_minutes o SET zone = br.zone
      FROM branches br WHERE o.zone IS NULL AND o.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'office_minutes zone denorm backfilled from branch.';
  END IF;
  IF to_regclass('public.tasks') IS NOT NULL
     AND to_regclass('public.branches') IS NOT NULL THEN
    UPDATE tasks t SET zone = br.zone
      FROM branches br WHERE t.zone IS NULL AND t.branch = br.id AND br.zone IS NOT NULL;
    RAISE NOTICE 'tasks zone denorm backfilled from branch.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 10. Least-privilege ceiling (see header). No DELETE anywhere in this file:
--     office rows are audited ministry facts; erasure runs as
--     retention_worker, never through the API.
-- ---------------------------------------------------------------------------
GRANT SELECT ON transfers TO directus_app;
GRANT INSERT (person, from_branch, to_branch, zone, reason, request_date, effective_date, status, requested_by, approved_by, notes)
  ON transfers TO directus_app;
GRANT UPDATE (to_branch, zone, reason, effective_date, status, approved_by, notes)
  ON transfers TO directus_app;

GRANT SELECT ON marriage_matters TO directus_app;
GRANT INSERT (person, partner_person, branch, zone, matter_type, wedding_date, status, notes, created_by)
  ON marriage_matters TO directus_app;
GRANT UPDATE (partner_person, zone, matter_type, wedding_date, status, notes)
  ON marriage_matters TO directus_app;

GRANT SELECT ON office_minutes TO directus_app;
GRANT INSERT (title, meeting_date, body, file, status, branch, zone, created_by)
  ON office_minutes TO directus_app;
GRANT UPDATE (title, meeting_date, body, file, status, zone)
  ON office_minutes TO directus_app;

GRANT SELECT, INSERT (minute, person, attendee_user), UPDATE (person, attendee_user)
  ON minutes_attendees TO directus_app;

GRANT SELECT ON tasks TO directus_app;
GRANT INSERT (title, description, assignee_user, assignee_person, branch, zone, due_date, status, priority, related_type, related_id, created_by)
  ON tasks TO directus_app;
GRANT UPDATE (title, description, assignee_user, assignee_person, zone, due_date, status, priority, related_type, related_id)
  ON tasks TO directus_app;

GRANT SELECT ON announcements TO directus_app;
GRANT INSERT (title, body, publish_from, publish_to, channels, audience, status, branch, zone, created_by, approved_by)
  ON announcements TO directus_app;
GRANT UPDATE (title, body, publish_from, publish_to, channels, audience, status, zone, approved_by)
  ON announcements TO directus_app;

GRANT SELECT ON event_referrals TO directus_app;
GRANT INSERT (event, inviter, invitee_name, invitee_person, branch, zone, invite_date, status)
  ON event_referrals TO directus_app;
GRANT UPDATE (invitee_person, zone, status)
  ON event_referrals TO directus_app;

GRANT SELECT ON transfer_events TO directus_app;
GRANT INSERT (transfer, event_type, detail, actor_user)
  ON transfer_events TO directus_app;
GRANT UPDATE (detail) ON transfer_events TO directus_app;

GRANT SELECT ON marriage_matter_events TO directus_app;
GRANT INSERT (marriage_matter, event_type, detail, actor_user)
  ON marriage_matter_events TO directus_app;
GRANT UPDATE (detail) ON marriage_matter_events TO directus_app;

GRANT SELECT ON office_minute_events TO directus_app;
GRANT INSERT (minute, event_type, detail, actor_user)
  ON office_minute_events TO directus_app;
GRANT UPDATE (detail) ON office_minute_events TO directus_app;

GRANT SELECT ON task_events TO directus_app;
GRANT INSERT (task, event_type, detail, actor_user)
  ON task_events TO directus_app;
GRANT UPDATE (detail) ON task_events TO directus_app;

GRANT SELECT ON announcement_events TO directus_app;
GRANT INSERT (announcement, event_type, detail, actor_user)
  ON announcement_events TO directus_app;
GRANT UPDATE (detail) ON announcement_events TO directus_app;

REVOKE ALL ON transfers FROM PUBLIC;
REVOKE ALL ON marriage_matters FROM PUBLIC;
REVOKE ALL ON office_minutes FROM PUBLIC;
REVOKE ALL ON minutes_attendees FROM PUBLIC;
REVOKE ALL ON tasks FROM PUBLIC;
REVOKE ALL ON announcements FROM PUBLIC;
REVOKE ALL ON event_referrals FROM PUBLIC;
REVOKE ALL ON transfer_events FROM PUBLIC;
REVOKE ALL ON marriage_matter_events FROM PUBLIC;
REVOKE ALL ON office_minute_events FROM PUBLIC;
REVOKE ALL ON task_events FROM PUBLIC;
REVOKE ALL ON announcement_events FROM PUBLIC;
