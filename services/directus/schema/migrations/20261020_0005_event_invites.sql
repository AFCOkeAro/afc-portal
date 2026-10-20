-- 20261020_0005_event_invites.sql
--
-- Slice 4b: member event invitations with rate limits and opt-out (AFC-480).
-- Spec authority: docs/adr/ADR-0009 (decisions 1-2),
-- docs/planning/data-model-v4.md §3 + §5 + §6,
-- docs/planning/prd-addendum-v4.md §3 (full flow + US-E1..E4).
-- Parent: AFC-464.
--
-- WHAT THIS FILE CREATES
--   event_invites -- one row per invite request from one member to one
--     person (§3.1): all §3.1 fields incl. invitee_contact_hash (sha256 of
--     the normalised phone, for dedupe/opt-out checks without storing a
--     lookup table of numbers we can read back), message_rendered +
--     variables_snapshot (frozen snapshot of the exact text), status enum
--     (pending_approval/queued/sent/delivered/failed/blocked_optout/
--     blocked_rate_limit/withdrawn/registered), approval fields
--     (approval_required/computed from limits, approved_by/approved_at),
--     blocked_reason, retry_of (self-reference for a single idempotent
--     retry). One row = one recipient, so no header/line pair.
--   invite_rate_gate() -- pure rolling-limit check (10/day + 50/week
--     defaults from prd-addendum-v4 §3.2, per-member columns below): over
--     the limit -> blocked_rate_limit + branch-admin approval. No table
--     access, no clock reads; the writer counts the windows and passes
--     the counts in, so the Directus Flow and the route share this rule.
--   invite_eligibility() -- pure creation-time gate: invite_eligible flag,
--     branch-private rule (branch-private events need a same-branch
--     inviter), guardian-number gate for child/teen invitees. No table
--     access, no clock reads.
--   invite_contact_suppressed() -- STOP/opt-out read: true when
--     consent_records holds a granted = false row for the contact hash on
--     a messaging channel. A suppressed number is never re-queued, and
--     staff cannot override (no override parameter exists, mirroring
--     comms_resolve_consent in 0004). Returns false when the consent
--     table is not present, so a partial history fails closed to
--     "not suppressed" only where suppression cannot be recorded.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   events, people, branches/zones, directus_users -- owned elsewhere.
--   event/branch/zone/inviter_person/inviter_user/message_template/
--   communication/recipient/approved_by are bare uuids under the §5 merge
--   contract: the owning slices add the FKs and must not fork this table.
--   retry_of IS a real self-FK: the referent (this table) is created here,
--   so there is no cross-slice ownership to violate.
--   event_registrations (the DRAFT a positive reply creates for staff
--   confirm, prd-addendum-v4 §3.2 step 6) -- the registrations-owning
--   slice creates that table; the Flow spec (invite.reply_confirm) names
--   the registration contract instead of forking it here.
--   campaigns tables -- track (c) owns them.
--
-- MINOR-GUARDIAN DESIGN NOTE (stated choice, data-model-v4 §3.1 silent):
--   §3.1 lists no guardian column on event_invites, but the issue build
--   list requires "guardian-number gate for child/teen invitees" and
--   "minor-without-guardian rejected at creation (test)". The smallest
--   defensible column is a nullable guardian_phone: child/teen rows must
--   carry it (CHECK invite_minor_needs_guardian), adult/unknown rows may
--   leave it null. The invite itself is still sent to invitee_phone; for
--   child/teen rows that number MUST be the guardian's (prd-addendum-v4
--   §3.3: minors are invited via their guardian's number, never the
--   minor's). The schema cannot prove whose number a string is -- that is
--   a capture-time assertion the Flow/route records -- but it can prove a
--   guardian number was captured, which is what the CHECK pins.
--
-- RATE-LIMIT DEFAULTS (10/day, 50/week) live on directus_users, not here:
--   invite_daily_limit / invite_weekly_limit, configurable per member
--   without a code change (data-model-v4 §3.2). Where directus_users is
--   absent (scratch DB), the columns are skipped loudly and the Directus
--   collection spec remains the authority (0002 §10 pattern). Same for
--   the events deltas (invite_eligible/invite_requires_approval/
--   live_join_url/reminders_enabled/reminder_offsets): conditional ALTER,
--   NOTICE-loud when the host table is absent.
--
-- ACCEPTANCE, ENCODED IN SCHEMA (§4 CHECKs, pinned by suite 73):
--   a minor (child/teen) row without a guardian number is rejected at
--   creation; over-limit rows land in blocked_rate_limit with
--   approval_required, never queued; an opted-out number is never
--   re-queued (invite_contact_suppressed + the send path, which shares
--   the 0004 resolver where a delivery row is written).
--
-- RENDERED TEXT + CONTACT HASH ARE IMMUTABLE WITHOUT A TRIGGER: the
-- preview-then-confirm flow (prd-addendum-v4 §3.2 steps 2-3) writes the
-- row WITH the rendered message, so no UPDATE path is needed afterwards.
-- directus_app holds no UPDATE on message_rendered, variables_snapshot,
-- invitee_phone, invitee_contact_hash, invitee_name or consent_basis -- a
-- correction is a new invite (retry_of), not an edit. No DELETE anywhere
-- in this file: the invite log is audited (data-model-v4 §4.2 pattern).
--
-- Rollback: rollback/20261020_0005_event_invites.down.sql (refuses while
-- event_invites holds a row; drops the FKs added here, then functions,
-- then the table, conditional columns last). Owner: migration role
-- (directus_migrator). Never run as directus_app. Role hygiene per
-- ADR-0002: this file provisions no roles and grants no role-creation
-- or superuser capability; only GRANT/REVOKE below.
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
-- 1. event_invites (data-model-v4 §3.1).
--
-- MERGE CONTRACT (the 0001->0002 WECA pattern, stated for the owning slices):
--   event, branch, zone, inviter_person, inviter_user, message_template,
--   communication, recipient, approved_by are bare uuids. The owning slices
--   must
--     ALTER TABLE event_invites ADD CONSTRAINT ... FOREIGN KEY (<col>)
--       REFERENCES <table>(id) [ON DELETE SET NULL for person links,
--       RESTRICT for branch/zone],
--   and they must not CREATE a table named event_invites and must not
--   redefine the columns created here. Constraint names are fixed by the
--   owning slices. If a bare column already holds a value with no referent
--   row, the owning migration must fail loudly (restrict_violation), not
--   skip the FK.
--   consent_records.related_invite and communications.event_invite are bare
--   uuids created by 0004 under the same contract; §3 below closes that
--   contract from this side (the FKs this slice owns).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_invites (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL,
  branch               uuid,
  zone                 uuid,
  inviter_person       uuid NOT NULL,
  inviter_user         uuid NOT NULL,
  invitee_name         text NOT NULL
                         CHECK (btrim(invitee_name) <> ''),
  invitee_phone        text NOT NULL
                         CHECK (btrim(invitee_phone) <> ''),
  invitee_contact_hash text NOT NULL
                         CHECK (btrim(invitee_contact_hash) <> ''),
  invitee_relationship text
                         CHECK (invitee_relationship IS NULL
                                OR invitee_relationship IN
                                  ('friend', 'family', 'coworker',
                                   'neighbour', 'invited_by_guest', 'other')),
  invitee_age_band     text NOT NULL DEFAULT 'unknown'
                         CHECK (invitee_age_band IN
                           ('adult', 'youth', 'teen', 'child', 'unknown')),
  guardian_phone       text,
  channel_choice       text NOT NULL DEFAULT 'auto'
                         CHECK (channel_choice IN ('whatsapp', 'sms', 'auto')),
  consent_basis        text NOT NULL DEFAULT 'inviter_vouched'
                         CHECK (consent_basis = 'inviter_vouched'),
  message_template     uuid,
  message_rendered     text,
  variables_snapshot   jsonb NOT NULL DEFAULT '{}'::jsonb,
  communication        uuid,
  recipient            uuid,
  status               text NOT NULL DEFAULT 'queued'
                         CHECK (status IN
                           ('pending_approval', 'queued', 'sent',
                            'delivered', 'failed', 'blocked_optout',
                            'blocked_rate_limit', 'withdrawn', 'registered')),
  approval_required    boolean NOT NULL DEFAULT false,
  approved_by          uuid,
  approved_at          timestamptz,
  blocked_reason       text,
  retry_of             uuid REFERENCES event_invites(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_minor_needs_guardian
    CHECK (invitee_age_band NOT IN ('child', 'teen')
           OR (guardian_phone IS NOT NULL
               AND btrim(guardian_phone) <> '')),
  CONSTRAINT invite_approval_state_matches_status
    CHECK (status <> 'pending_approval' OR approval_required),
  CONSTRAINT invite_approver_paired
    CHECK ((approved_by IS NULL AND approved_at IS NULL)
           OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT invite_blocked_needs_reason
    CHECK (status NOT IN ('blocked_optout', 'blocked_rate_limit', 'failed')
           OR (blocked_reason IS NOT NULL
               AND btrim(blocked_reason) <> ''))
);

COMMENT ON TABLE event_invites IS
  'Member event invitations (data-model-v4 §3.1, AFC-480). One row = one invite request from one member to one person; delivery status for the send lives on communications/communication_recipients (bare uuids here). A minor (child/teen) row without a guardian number is rejected at creation. M2O columns are bare uuids under the §5 merge contract; the owning slices add the FKs.';

CREATE INDEX IF NOT EXISTS event_invites_event_idx
  ON event_invites (event);
CREATE INDEX IF NOT EXISTS event_invites_branch_idx
  ON event_invites (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS event_invites_inviter_person_idx
  ON event_invites (inviter_person);
CREATE INDEX IF NOT EXISTS event_invites_inviter_user_idx
  ON event_invites (inviter_user);
CREATE INDEX IF NOT EXISTS event_invites_status_idx
  ON event_invites (status);
CREATE INDEX IF NOT EXISTS event_invites_contact_hash_created_idx
  ON event_invites (invitee_contact_hash, created_at);
CREATE INDEX IF NOT EXISTS event_invites_inviter_user_created_idx
  ON event_invites (inviter_user, created_at);

-- ---------------------------------------------------------------------------
-- 2. Conditional deltas on tables owned elsewhere (0002 §10 pattern).
--    Each block runs only where the host table exists; otherwise a NOTICE
--    names the Directus field spec that remains the authority. No table is
--    created here that another slice owns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- directus_users: a Directus system table; the scratch DB never has it.
  -- Member invite scaffolding per data-model-v4 §3.2 (member_person link,
  -- per-member rolling limits defaulting to 10/day + 50/week, time-boxed
  -- access). Identity for the member role stays phone OTP; full OTP
  -- enablement waits for the SecurityEngineer verdict (ADR-0009 decision
  -- 6, track d) -- these columns are scaffolding, not enablement.
  IF to_regclass('public.directus_users') IS NULL THEN
    RAISE NOTICE 'Skipping directus_users invite deltas: system table not present. Directus fields member_person (M2O people), invite_daily_limit (integer, default 10), invite_weekly_limit (integer, default 50), member_access_expires_at (datetime, nullable) per data-model-v4 §3.2.';
  ELSE
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS member_person uuid;
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS invite_daily_limit integer NOT NULL DEFAULT 10;
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS invite_weekly_limit integer NOT NULL DEFAULT 50;
    ALTER TABLE directus_users ADD COLUMN IF NOT EXISTS member_access_expires_at timestamptz;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'directus_users_invite_limits_nonnegative') THEN
      ALTER TABLE directus_users
        ADD CONSTRAINT directus_users_invite_limits_nonnegative
        CHECK (invite_daily_limit >= 0 AND invite_weekly_limit >= 0);
    END IF;
    RAISE NOTICE 'directus_users invite deltas ensured (member_person, invite_daily_limit, invite_weekly_limit, member_access_expires_at).';
  END IF;

  -- events: the v4 events table is not in schema history yet. The invite
  -- eligibility flags land with it; if a project database already has the
  -- Directus collection, add them now.
  IF to_regclass('public.events') IS NULL THEN
    RAISE NOTICE 'Skipping events invite deltas: table not present. Directus fields invite_eligible (boolean, default true), invite_requires_approval (boolean, default false), live_join_url (string), reminders_enabled (boolean, default true), reminder_offsets (json, default ["24h","2h"]) per data-model-v4 §3.3.';
  ELSE
    ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_eligible boolean NOT NULL DEFAULT true;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_requires_approval boolean NOT NULL DEFAULT false;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS live_join_url text;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true;
    ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_offsets jsonb NOT NULL DEFAULT '["24h","2h"]'::jsonb;
    RAISE NOTICE 'events invite deltas ensured (invite_eligible, invite_requires_approval, live_join_url, reminders_enabled, reminder_offsets).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. FKs this slice owns under the 0004 merge contract (§5 of that file):
--   consent_records.related_invite -> event_invites(id),
--   communications.event_invite   -> event_invites(id).
--   Added where the host table exists; a bare value with no referent row
--   fails loudly (restrict_violation), never silently skipped -- an invite
--   row that cannot be joined to its send is a broken audit trail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_consent integer := 0;
  v_orphan_comms   integer := 0;
BEGIN
  IF to_regclass('public.consent_records') IS NULL THEN
    RAISE NOTICE 'Skipping consent_records.related_invite FK: table not present (apply 20261020_0004 first).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_related_invite_fkey') THEN
    SELECT count(*) INTO v_orphan_consent FROM consent_records
     WHERE related_invite IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event_invites WHERE event_invites.id = consent_records.related_invite);
    IF v_orphan_consent > 0 THEN
      RAISE EXCEPTION
        'consent_records holds % related_invite value(s) with no event_invites row. The FK cannot be added without stranding them; resolve the orphans first.',
        v_orphan_consent
        USING ERRCODE = 'restrict_violation';
    END IF;
    ALTER TABLE consent_records
      ADD CONSTRAINT consent_records_related_invite_fkey
      FOREIGN KEY (related_invite) REFERENCES event_invites(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: consent_records.related_invite -> event_invites(id) SET NULL.';
  ELSE
    RAISE NOTICE 'FK already present on consent_records.related_invite, left alone.';
  END IF;

  IF to_regclass('public.communications') IS NULL THEN
    RAISE NOTICE 'Skipping communications.event_invite FK: table not present (apply 20261020_0004 first).';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_event_invite_fkey') THEN
    SELECT count(*) INTO v_orphan_comms FROM communications
     WHERE event_invite IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event_invites WHERE event_invites.id = communications.event_invite);
    IF v_orphan_comms > 0 THEN
      RAISE EXCEPTION
        'communications holds % event_invite value(s) with no event_invites row. The FK cannot be added without stranding them; resolve the orphans first.',
        v_orphan_comms
        USING ERRCODE = 'restrict_violation';
    END IF;
    ALTER TABLE communications
      ADD CONSTRAINT communications_event_invite_fkey
      FOREIGN KEY (event_invite) REFERENCES event_invites(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: communications.event_invite -> event_invites(id) SET NULL.';
  ELSE
    RAISE NOTICE 'FK already present on communications.event_invite, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. invite_rate_gate -- pure rolling-limit check.
--
-- The writer (Directus Flow invite.create, route layer) counts the member's
-- sends in the rolling windows and passes the counts in; this function
-- applies the per-member limits. Pure: no table access, no clock reads, so
-- the Flow and the route share one rule. Over the limit -> the invite is
-- created as blocked_rate_limit with approval_required, visible to the
-- branch admin for approval (prd-addendum-v4 US-E1 AC4, US-E3 AC4) -- never
-- silently dropped, never queued past the limit.
--
-- Returns exactly one row: (requires_approval, blocked_status,
-- blocked_reason), where a NULL blocked_status means within limits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invite_rate_gate(
  p_sent_24h integer,
  p_sent_7d integer,
  p_daily_limit integer,
  p_weekly_limit integer
)
RETURNS TABLE (requires_approval boolean, blocked_status text, blocked_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_sent_24h IS NULL OR p_sent_7d IS NULL
     OR p_daily_limit IS NULL OR p_weekly_limit IS NULL THEN
    RAISE EXCEPTION
      'invite_rate_gate: window counts and limits are all required (got 24h=%, 7d=%, daily=%, weekly=%)',
      p_sent_24h, p_sent_7d, p_daily_limit, p_weekly_limit
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_24h < 0 OR p_sent_7d < 0
     OR p_daily_limit < 0 OR p_weekly_limit < 0 THEN
    RAISE EXCEPTION
      'invite_rate_gate: counts and limits must be non-negative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_24h >= p_daily_limit OR p_sent_7d >= p_weekly_limit THEN
    RETURN QUERY SELECT true, 'blocked_rate_limit'::text,
      'member invite limit reached: sent ' || p_sent_24h::text
      || ' in the last 24h (limit ' || p_daily_limit::text || '), '
      || p_sent_7d::text || ' in the last 7 days (limit '
      || p_weekly_limit::text || '); branch-admin approval required'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text, NULL::text;
END
$$;

COMMENT ON FUNCTION invite_rate_gate(integer, integer, integer, integer) IS
  'Rolling member invite limit check (data-model-v4 §3.2, AFC-480). Pure function: the writer counts the windows, this rule decides blocked_rate_limit + approval. Over-limit invites are created blocked, never queued past the limit.';

-- ---------------------------------------------------------------------------
-- 5. invite_eligibility -- pure creation-time gate.
--
-- Order: the minor rule first (a minor without a guardian number is
-- rejected at creation no matter what the event says), then the event
-- flags. There is deliberately no staff-override argument: no override
-- path exists (data-model-v4 §5 explicit denials).
--
-- p_event_visibility: 'public' | 'branch' | 'internal'. Branch-private
-- ('branch') events need a same-branch inviter (prd-addendum-v4 OQ-R11);
-- public and member-visible events are open to any member.
--
-- Returns exactly one row: (eligible, blocked_reason), where a NULL
-- blocked_reason means eligible.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invite_eligibility(
  p_invite_eligible boolean,
  p_inviter_branch uuid,
  p_event_branch uuid,
  p_event_visibility text,
  p_invitee_age_band text,
  p_guardian_present boolean
)
RETURNS TABLE (eligible boolean, blocked_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_band text;
BEGIN
  v_band := COALESCE(p_invitee_age_band, 'unknown');
  IF v_band NOT IN ('adult', 'youth', 'teen', 'child', 'unknown') THEN
    RAISE EXCEPTION
      'invite_eligibility: unknown age band %, expected adult/youth/teen/child/unknown',
      p_invitee_age_band
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_band IN ('child', 'teen') AND NOT COALESCE(p_guardian_present, false) THEN
    RETURN QUERY SELECT false, 'minor_no_guardian_consent'::text;
    RETURN;
  END IF;

  IF NOT COALESCE(p_invite_eligible, false) THEN
    RETURN QUERY SELECT false, 'event_not_invite_eligible'::text;
    RETURN;
  END IF;

  IF COALESCE(p_event_visibility, 'public') = 'branch'
     AND (p_inviter_branch IS NULL OR p_event_branch IS NULL
          OR p_inviter_branch <> p_event_branch) THEN
    RETURN QUERY SELECT false, 'branch_private_requires_same_branch_inviter'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END
$$;

COMMENT ON FUNCTION invite_eligibility(boolean, uuid, uuid, text, text, boolean) IS
  'Creation-time invite gate (data-model-v4 §3.1, AFC-480). Pure function: minor-without-guardian rejected first, then the invite_eligible flag, then the branch-private same-branch rule. No staff override path.';

-- ---------------------------------------------------------------------------
-- 6. invite_contact_suppressed -- STOP/opt-out read.
--
-- True when consent_records holds a granted = false row for the contact
-- hash on a messaging channel (whatsapp/sms). A suppressed number is
-- never re-queued: not for invitations, not for campaigns, not for
-- reminders (prd-addendum-v4 §3.2 step 6, US-N3 AC3, data-model-v4 §8).
-- Staff cannot re-override an opt-out (data-model-v4 §5): the function
-- takes no override argument.
--
-- STABLE (reads consent_records), not IMMUTABLE. When the consent table
-- is absent the answer is false: suppression cannot be recorded, so none
-- is claimed -- and the 0004 resolver remains the send-time enforcement.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invite_contact_suppressed(p_contact_hash text)
RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_contact_hash IS NULL OR btrim(p_contact_hash) = '' THEN
    RETURN false;
  END IF;

  IF to_regclass('public.consent_records') IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM consent_records
     WHERE contact_hash = p_contact_hash
       AND channel IN ('whatsapp', 'sms')
       AND granted = false
  );
END
$$;

COMMENT ON FUNCTION invite_contact_suppressed(text) IS
  'STOP/opt-out read (AFC-480). True when a granted=false consent row exists for the contact hash on a messaging channel; suppressed numbers are never re-queued and staff cannot override.';

-- ---------------------------------------------------------------------------
-- 7. Least privilege (data-model-expansion §10 pattern, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- branch/zone scoping and the member-vs-staff read split live in the
-- Directus policy + portal route filters, not here. This layer states the
-- ceiling:
--   event_invites: the app inserts the resolved row (preview-then-confirm
--     writes the row WITH the rendered message, so no later UPDATE of the
--     frozen columns is needed) and advances send state
--     (status/approval/blocked_reason/communication/recipient links) only.
--     message_rendered, variables_snapshot, invitee_phone,
--     invitee_contact_hash, invitee_name and consent_basis are immutable
--     (no UPDATE grant): a correction is a new invite via retry_of, not
--     an edit. Nothing is deletable: the invite log is audited.
--   directus_users/events deltas: granted only where the host table exists
--     (EXECUTE in §2); the scratch DB has neither table.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_invites TO directus_app;
GRANT INSERT (event, branch, zone, inviter_person, inviter_user,
  invitee_name, invitee_phone, invitee_contact_hash, invitee_relationship,
  invitee_age_band, guardian_phone, channel_choice, consent_basis,
  message_template, message_rendered, variables_snapshot, communication,
  recipient, status, approval_required, approved_by, approved_at,
  blocked_reason, retry_of) ON event_invites TO directus_app;
GRANT UPDATE (status, approval_required, approved_by, approved_at,
  blocked_reason, communication, recipient, updated_at) ON event_invites TO directus_app;

REVOKE ALL ON event_invites FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('public.directus_users') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT (member_person, invite_daily_limit, invite_weekly_limit, member_access_expires_at) ON directus_users TO directus_app';
    EXECUTE 'GRANT UPDATE (invite_daily_limit, invite_weekly_limit, member_access_expires_at) ON directus_users TO directus_app';
    RAISE NOTICE 'directus_users invite-delta grants ensured.';
  ELSE
    RAISE NOTICE 'Skipping directus_users invite-delta grants: system table not present.';
  END IF;

  IF to_regclass('public.events') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT (invite_eligible, invite_requires_approval, live_join_url, reminders_enabled, reminder_offsets) ON events TO directus_app';
    EXECUTE 'GRANT UPDATE (invite_eligible, invite_requires_approval, live_join_url, reminders_enabled, reminder_offsets) ON events TO directus_app';
    RAISE NOTICE 'events invite-delta grants ensured.';
  ELSE
    RAISE NOTICE 'Skipping events invite-delta grants: table not present.';
  END IF;
END
$$;
