-- 20261020_0021_events_registrations.sql
--
-- Events + event registrations (AFC-566, parent AFC-460).
-- Spec authority: docs/planning/data-model.md §§3.1-3.2 + §7 (FK policy),
-- packages/shared event/registration zod schemas (form fields, staff
-- payload, 50-member group cap, 64-char group code), and the portal routes
-- under apps/web/server/api/events/.
--
-- WHAT THIS FILE CREATES (tables owned by no earlier migration -- verified:
-- no CREATE TABLE for either exists in services/directus/schema/migrations/):
--   events               -- §3.1 (area-wide via null branch; slug/ticket
--                           assigned by Flow, never the client) + the 0013
--                           §9.6 deltas (overview, invite_a_friend_enabled,
--                           attendance_session) so 0013's block is a no-op.
--   event_registrations  -- §3.2 (one row per registrant; group_code is the
--                           stored idempotency ground truth, S4 lookup key).
--   event_invites.event FK -- DELIBERATELY NOT CLOSED (see choice 5):
--                           0005 created the column as a bare uuid and suite
--                           73 pins bare-uuid inserts as fixtures; enforcing
--                           the FK here would break that suite. The merge
--                           stays open for a future reviewed slice that
--                           migrates the fixtures first.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   events_departments: no portal route references it (verified by grep over
--   apps/web/server) -- left for the slice that reads it, same as 0020.
--   ticket_code / slug values: UNIQUE columns, NULL until the Flow assigns
--   them (STAFF_CREATE_FORBIDDEN_FIELDS: the ticket and status are the
--   Flow's). No seed rows: events are board/staff data, registrations are
--   personal data (including minors).
--
-- CONDITIONAL OVERLAP, stated so a re-run stays silent:
--   0005 §2 adds invite_eligible/invite_requires_approval/live_join_url/
--   reminders_enabled/reminder_offsets IF NOT EXISTS where events exists.
--   This file creates events WITH those columns, so those blocks become
--   no-ops -- same treatment, no fork.
--   0017 adds event_registrations.group_code + its CHECK + index IF NOT
--   EXISTS where the table exists. This file creates the table WITH the
--   identical column, constraint name and index name, so 0017 becomes a
--   no-op. The names below MUST stay byte-identical to 0017's.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. events.branch nullable RESTRICT (null = area-wide, §3.1; a branch
--      with events is not deleted by accident). Registrations branch is a
--      registrant denorm: SET NULL (a branch delete clears the denorm,
--      never the registration -- the event FK still scopes it).
--   2. FK policy per §7: events -> event_registrations CASCADE (a
--      registration is meaningless without its event); registration person
--      SET NULL (a person leaving never deletes the registration row);
--      event_invites.event CASCADE (an invite to a deleted event is
--      meaningless). Portal unlink/deactivate patterns are unchanged.
--   3. No DB-level guardian CHECK: whether a guardian is required depends
--      on the EVENT's requires_guardian_consent flag (cross-table), which
--      a column CHECK cannot see. The Flow + route validation own it (the
--      minor-guardian precedent in 0005 works only because invites carry
--      their own age band on the same row).
--   4. ticket_code stays writable by the app (INSERT + UPDATE grants): the Flow assigns
--      it through the app identity (0010 total_attendance precedent --
--      "copied by Flow, never hand-edited" still rides the table grants).
--      The route layer rejects client-sent tickets (STAFF_CREATE_FORBIDDEN).
--   5. event_invites.event is NOT constrained here. 0005 §5 says "the
--      owning slices add the FKs", but suite 73 inserts invites with
--      gen_random_uuid() event values as CHECK fixtures -- an enforced FK
--      would turn that suite red. A future reviewed slice migrates the
--      fixtures, then enforces; this file must not do it silently. The
--      absence is pinned in suite 86 (no event_invites_event_fkey), so the
--      merge stays visibly open instead of silently assumed.
--
-- GRANTS (expansion §10 posture: one app identity; branch scoping lives in
-- the Directus policy + portal route filters, not here). directus_app gets
-- SELECT everywhere (medical_notes/allergies included -- "restricted" is
-- enforced per-role in the route layer via visibleFields/stripHiddenMany,
-- not by grant-withholding, or the branch-admin detail view could not
-- render them at all), INSERT/UPDATE on operational columns, NO DELETE on
-- either register (events are cancelled, registrations terminal-state;
-- erasure runs as retention_worker, never through the API).
-- No durations, no awareness_at.
--
-- Rollback: rollback/20261020_0021_events_registrations.down.sql (refuses
-- while either register holds rows; drops the two §3 merge FKs first (F4),
-- then in dependency order, no CASCADE). Owner: migration role
-- (directus_migrator).
-- Never run as directus_app. Role hygiene per ADR-0002: this file provisions
-- no roles and grants no role-creation or superuser capability; only
-- GRANT/REVOKE below.

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
-- 1. events (§3.1). slug/ticket assigned by Flow; invite deltas included so
--    0005 §2 is a no-op (identical definitions).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  slug                     text UNIQUE,
  summary                  text,
  description              text,
  event_type               text NOT NULL DEFAULT 'service'
                             CHECK (event_type IN
                               ('service', 'summit', 'camp', 'training',
                                'outreach', 'social', 'other')),
  branch                   uuid REFERENCES branches(id) ON DELETE RESTRICT,
  start_at                 timestamptz NOT NULL,
  end_at                   timestamptz NOT NULL,
  location                 text,
  address                  text,
  capacity                 integer CHECK (capacity IS NULL OR capacity >= 0),
  waitlist_enabled         boolean NOT NULL DEFAULT false,
  registration_open        boolean NOT NULL DEFAULT false,
  registration_opens_at    timestamptz,
  registration_closes_at   timestamptz,
  fee_amount               numeric(12,2)
                             CHECK (fee_amount IS NULL OR fee_amount >= 0),
  currency                 text NOT NULL DEFAULT 'NGN'
                             CHECK (currency IN ('NGN', 'USD', 'GBP')),
  requires_guardian_consent boolean NOT NULL DEFAULT false,
  collect_medical          boolean NOT NULL DEFAULT false,
  age_min                  integer CHECK (age_min IS NULL OR age_min >= 0),
  age_max                  integer CHECK (age_max IS NULL OR age_max >= 0),
  visibility               text NOT NULL DEFAULT 'branch'
                             CHECK (visibility IN ('public', 'branch', 'internal')),
  status                   text NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'published', 'closed', 'cancelled')),
  created_by               uuid,
  invite_eligible          boolean NOT NULL DEFAULT true,
  invite_requires_approval boolean NOT NULL DEFAULT false,
  live_join_url            text,
  reminders_enabled        boolean NOT NULL DEFAULT true,
  reminder_offsets         jsonb NOT NULL DEFAULT '["24h","2h"]'::jsonb,
  overview                 text,
  invite_a_friend_enabled  boolean NOT NULL DEFAULT false,
  attendance_session       uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE events IS
  'Ministry events (data-model §3.1, AFC-470/AFC-566). branch null = area-wide. slug is Flow-assigned UNIQUE (never client-sent); invite_* columns close the 0005 merge contract from this side; overview/invite_a_friend_enabled/attendance_session close the 0013 §9.6 deltas (attendance_session FK lands with the sessions slice in 0023).';

CREATE INDEX IF NOT EXISTS events_branch_idx ON events (branch);
CREATE INDEX IF NOT EXISTS events_status_idx ON events (status);
CREATE INDEX IF NOT EXISTS events_start_at_idx ON events (start_at);
CREATE INDEX IF NOT EXISTS events_event_type_idx ON events (event_type);

-- ---------------------------------------------------------------------------
-- 2. event_registrations (§3.2). group_code/CHECK/index byte-identical to
--    0017 (constraint + index names MUST match so 0017 is a no-op).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                 uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person                uuid REFERENCES people(id) ON DELETE SET NULL,
  registrant_first_name text NOT NULL,
  registrant_last_name  text NOT NULL,
  email                 text,
  phone                 text,
  date_of_birth         date,
  age_group             text
                          CHECK (age_group IS NULL OR age_group IN
                            ('adult', 'youth', 'teen', 'child', 'unknown')),
  branch                uuid REFERENCES branches(id) ON DELETE SET NULL,
  guardian_name         text,
  guardian_phone        text,
  guardian_email        text,
  guardian_consent      boolean,
  consent_signed_at     timestamptz,
  medical_notes         text,
  allergies             text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  amount_expected       numeric(12,2)
                          CHECK (amount_expected IS NULL OR amount_expected >= 0),
  amount_paid           numeric(12,2)
                          CHECK (amount_paid IS NULL OR amount_paid >= 0),
  payment_status        text NOT NULL DEFAULT 'not_required'
                          CHECK (payment_status IN
                            ('not_required', 'pending', 'paid', 'refunded')),
  payment_reference     text,
  ticket_code           text UNIQUE,
  group_code            text,
  registration_status   text NOT NULL DEFAULT 'pending'
                          CHECK (registration_status IN
                            ('pending', 'confirmed', 'waitlisted',
                             'cancelled', 'attended', 'no_show')),
  source                text NOT NULL DEFAULT 'public_form'
                          CHECK (source IN ('public_form', 'staff')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_registrations_group_code_len
    CHECK (char_length(group_code) <= 64)
);

COMMENT ON TABLE event_registrations IS
  'Event registrations (data-model §3.2, AFC-470/AFC-566). One row per registrant; group_code is the stored group-submission ground truth (S4 key, idempotency); ticket_code is Flow-assigned UNIQUE. Guardian requirement is Flow/route-validated (cross-table, see header choice 3).';

CREATE INDEX IF NOT EXISTS event_registrations_event_status_idx
  ON event_registrations (event, registration_status);
CREATE INDEX IF NOT EXISTS event_registrations_event_group_code_idx
  ON event_registrations (event, group_code);
CREATE INDEX IF NOT EXISTS event_registrations_ticket_code_idx
  ON event_registrations (ticket_code) WHERE ticket_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_registrations_person_idx
  ON event_registrations (person) WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_registrations_branch_idx
  ON event_registrations (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_registrations_email_idx
  ON event_registrations (email) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Merge close-outs from the events side (0010 §3 precedent: the slice
--    that lands the parent table closes the conditional FKs under their
--    FIXED names, so reruns and contract tests agree).
--    (a) 0013 event_referrals_event_fkey -> events(id) CASCADE (referrals
--        are meaningless without their event). CONDITIONAL: only where
--        event_referrals exists; 0013's own re-apply becomes a no-op.
--        0011 blessings_event_fkey -> events(id) SET NULL (the fact
--        survives its event). CONDITIONAL: only where blessings exists;
--        0011's own re-apply becomes a no-op. Both use the FIXED names the
--        owning migrations reserve, so reruns agree.
--    (b) 0005 §5 event_invites.event is DELIBERATELY left bare (choice 5).
--        Suite 73 pins bare-uuid inserts as fixtures; enforcing the FK here
--        would turn that suite red. A future reviewed slice migrates the
--        fixtures, then enforces. This block only records the open merge.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.event_referrals') IS NULL THEN
    RAISE NOTICE 'Skipping event_referrals_event_fkey: table not present. The FK lands when event_referrals exists; until then referral event links stay bare uuids under the 0013 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_referrals_event_fkey') THEN
    ALTER TABLE event_referrals ADD CONSTRAINT event_referrals_event_fkey
      FOREIGN KEY (event) REFERENCES events(id) ON DELETE CASCADE;
    RAISE NOTICE 'FK added: event_referrals.event -> events(id) CASCADE (closes 0013 merge contract).';
  ELSE
    RAISE NOTICE 'event_referrals_event_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.blessings') IS NULL THEN
    RAISE NOTICE 'Skipping blessings_event_fkey: table not present. The FK lands when blessings exists; until then blessing event links stay bare uuids under the 0011 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'blessings_event_fkey') THEN
    ALTER TABLE blessings ADD CONSTRAINT blessings_event_fkey
      FOREIGN KEY (event) REFERENCES events(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: blessings.event -> events(id) SET NULL (closes 0011 merge contract).';
  ELSE
    RAISE NOTICE 'blessings_event_fkey already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_invites_event_fkey') THEN
    RAISE NOTICE 'event_invites.event stays a bare uuid (choice 6): suite 73 fixtures depend on it. The 0005 merge contract stays open for a future reviewed slice.';
  ELSE
    RAISE NOTICE 'event_invites_event_fkey present (a later slice enforced it); 0021 claims nothing over it.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. No DELETE on either register.
-- ---------------------------------------------------------------------------
GRANT SELECT ON events TO directus_app;
GRANT INSERT (title, slug, summary, description, event_type, branch,
  start_at, end_at, location, address, capacity, waitlist_enabled,
  registration_open, registration_opens_at, registration_closes_at,
  fee_amount, currency, overview, invite_a_friend_enabled,
  attendance_session, requires_guardian_consent, collect_medical,
  age_min, age_max, visibility, status, created_by, invite_eligible,
  invite_requires_approval, live_join_url, reminders_enabled,
  reminder_offsets)
  ON events TO directus_app;
GRANT UPDATE (title, slug, summary, description, event_type, branch,
  start_at, end_at, location, address, capacity, waitlist_enabled,
  registration_open, registration_opens_at, registration_closes_at,
  fee_amount, currency, overview, invite_a_friend_enabled,
  attendance_session, requires_guardian_consent, collect_medical,
  age_min, age_max, visibility, status, invite_eligible,
  invite_requires_approval, live_join_url, reminders_enabled,
  reminder_offsets)
  ON events TO directus_app;

GRANT SELECT ON event_registrations TO directus_app;
GRANT INSERT (event, person, registrant_first_name, registrant_last_name,
  email, phone, date_of_birth, age_group, branch, guardian_name,
  guardian_phone, guardian_email, guardian_consent, consent_signed_at,
  medical_notes, allergies, emergency_contact_name, emergency_contact_phone,
  amount_expected, amount_paid, payment_status, payment_reference,
  ticket_code, group_code, registration_status, source)
  ON event_registrations TO directus_app;
GRANT UPDATE (person, registrant_first_name, registrant_last_name, email,
  phone, date_of_birth, age_group, branch, guardian_name, guardian_phone,
  guardian_email, guardian_consent, consent_signed_at, medical_notes,
  allergies, emergency_contact_name, emergency_contact_phone,
  amount_expected, amount_paid, payment_status, payment_reference,
  ticket_code, group_code, registration_status, source)
  ON event_registrations TO directus_app;

REVOKE ALL ON events FROM PUBLIC;
REVOKE ALL ON event_registrations FROM PUBLIC;
