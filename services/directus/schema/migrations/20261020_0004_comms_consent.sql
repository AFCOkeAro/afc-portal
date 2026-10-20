-- 20261020_0004_comms_consent.sql
--
-- Slice 4a: comms / templates / consent schema + consent resolver (AFC-479).
-- Spec authority: docs/adr/ADR-0009 (decisions 1-2), docs/planning/data-model-v4.md
-- §4.6-§4.7 + §5.1, docs/planning/prd-addendum-v4.md §2.3 + §3, and
-- docs/planning/integrations-addendum.md §1-§2. Parent: AFC-464.
--
-- WHAT THIS FILE CREATES
--   message_templates      -- the single template registry, with the v4 category
--                             set (event_invitation, greeting, memory_verse,
--                             service_reminder, fallback alongside marketing and
--                             operational), rotation_key, approval_status
--                             (incl. pending_provider) and provider_template_id.
--   consent_records        -- the consent history for every channel, with the v4
--                             basis column (incl. inviter_vouched) and the
--                             related_invite audit link.
--   communications         -- the single delivery-log header for every message
--                             (ADR-0009 decision 2): source_kind (manual,
--                             campaign, invite, ...), campaign / campaign_step /
--                             campaign_run, event_invite, consent_policy.
--   communication_recipients -- one row per recipient: the frozen rendered
--                             text, the stored consent basis, the send status,
--                             and the exclusion reason when no send happens.
--   comms_resolve_consent() -- audience-time consent resolver (ADR-0009
--                             decision 1): pure function, no table access, so
--                             the campaign tick (track c) and the Directus Flows
--                             call the same rule. Minors resolve via guardian
--                             only; there is no staff-override parameter.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   campaigns, campaign_steps, campaign_audiences, campaign_enrollments,
--   campaign_runs, event_invites. Those belong to tracks (b) and (c); creating
--   them here would fork tables another slice owns -- the exact defect the
--   0003 attendance header exists to avoid. communications carries bare uuid
--   columns for them (campaign, campaign_step, campaign_run, event_invite) so
--   this slice's log already joins to them when they land; the owning slices
--   add the FKs and must not fork these tables (merge contract, §5 below).
--   Likewise person/branch/zone/campaign FKs are bare uuids: the Directus
--   collection spec remains the authority for the M2O fields, and a later
--   data-model migration may add REFERENCES without forking.
--
-- SEED: the eleven template keys from integrations-addendum §2, idempotent via
--   ON CONFLICT (key) DO NOTHING, all seeded approval_status = pending_provider
--   per the issue build list. No template may send on WhatsApp until a reviewed
--   step flips it to approved with a provider_template_id (template gate,
--   track c). Board edits to body text via the app are never overwritten by a
--   rerun.
--
-- ACCEPTANCE, ENCODED IN SCHEMA (§4 CHECKs, pinned by suite 72):
--   a recipient row with a send status (queued/sent/delivered/read) always
--   carries a real basis (consent_basis <> 'none'); an excluded row always
--   carries a reason and basis 'none'. The two states cannot mix.
--
-- RENDERED TEXT + BASIS ARE IMMUTABLE WITHOUT A TRIGGER: directus_app holds
--   no UPDATE on message_rendered, consent_basis or exclusion_reason -- a send
--   transitions status/provider fields only. No DELETE anywhere in this file:
--   the delivery log is audited (data-model-v4 §4.2: campaigns archived, never
--   deleted; recipient rows immutable).
--
-- Rollback: rollback/20261020_0004_comms_consent.down.sql (refuses while any
--   of the four tables holds a row; drops function + tables, additive-only
--   forward). Owner: migration role (directus_migrator). Never run as
--   directus_app. Role hygiene per ADR-0002: this file provisions no roles and
--   grants no role-creation or superuser capability; only GRANT/REVOKE below.
--   No durations, no awareness_at.

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
-- 1. message_templates (data-model-v4 §4.6).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                  text NOT NULL UNIQUE,
  channel              text NOT NULL
                         CHECK (channel IN ('whatsapp', 'sms', 'email')),
  category             text NOT NULL
                         CHECK (category IN
                           ('marketing', 'operational', 'event_invitation',
                            'greeting', 'memory_verse', 'service_reminder',
                            'fallback')),
  rotation_key         text,
  approval_status      text NOT NULL DEFAULT 'draft'
                         CHECK (approval_status IN
                           ('draft', 'submitted', 'pending_provider',
                            'approved', 'rejected')),
  provider_template_id text,
  body                 text NOT NULL,
  variables            jsonb NOT NULL DEFAULT '[]'::jsonb,
  active               boolean NOT NULL DEFAULT true,
  branch               uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_whatsapp_needs_provider_id
    CHECK (channel <> 'whatsapp'
           OR approval_status <> 'approved'
           OR (provider_template_id IS NOT NULL
               AND btrim(provider_template_id) <> ''))
);

COMMENT ON TABLE message_templates IS
  'Template registry (data-model-v4 §4.6, AFC-479). A WhatsApp step may only run on approval_status = approved with a provider_template_id; the gate lives in track (c). rotation_key groups rotating verses (e.g. memory_verse). branch is a bare uuid: the Directus collection spec owns the M2O field.';

CREATE INDEX IF NOT EXISTS message_templates_category_idx
  ON message_templates (category);
CREATE INDEX IF NOT EXISTS message_templates_rotation_key_idx
  ON message_templates (rotation_key) WHERE rotation_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_templates_approval_idx
  ON message_templates (approval_status);

-- ---------------------------------------------------------------------------
-- 2. consent_records (data-model-v4 §4.7).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consent_records (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person         uuid,
  contact_hash   text,
  channel        text NOT NULL
                   CHECK (channel IN ('whatsapp', 'sms', 'email')),
  granted        boolean NOT NULL,
  consent_type   text NOT NULL DEFAULT 'channel'
                   CHECK (consent_type IN ('channel', 'marketing_invite')),
  basis          text NOT NULL DEFAULT 'not_applicable'
                   CHECK (basis IN
                     ('explicit_opt_in', 'guardian', 'legitimate_interest',
                      'inviter_vouched', 'not_applicable')),
  related_invite uuid,
  method         text
                   CHECK (method IN ('paper', 'digital', 'verbal_recorded')),
  expires_at     timestamptz,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE consent_records IS
  'Consent history for every channel (data-model-v4 §4.7, AFC-479). basis records WHY this row may be contacted; related_invite ties an inviter_vouched basis to its auditable invite row (track b owns event_invites; the column is a bare uuid until that slice adds the FK).';

CREATE INDEX IF NOT EXISTS consent_records_basis_idx
  ON consent_records (basis);
CREATE INDEX IF NOT EXISTS consent_records_related_invite_idx
  ON consent_records (related_invite) WHERE related_invite IS NOT NULL;
CREATE INDEX IF NOT EXISTS consent_records_channel_granted_idx
  ON consent_records (channel, granted);

-- ---------------------------------------------------------------------------
-- 3. communications -- the single delivery-log header (ADR-0009 decision 2).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind    text NOT NULL
                   CHECK (source_kind IN
                     ('manual', 'campaign', 'invite', 'welcome_form',
                      'birthday_webhook')),
  campaign       uuid,
  campaign_step  uuid,
  campaign_run   uuid,
  event_invite   uuid,
  consent_policy text
                   CHECK (consent_policy IN
                     ('marketing_only', 'operational_essential', 'mixed')),
  branch         uuid,
  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN
                     ('queued', 'sending', 'sent', 'partial', 'failed',
                      'cancelled')),
  estimated_cost numeric(12,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_campaign_needs_kind
    CHECK ((campaign IS NULL AND campaign_step IS NULL AND campaign_run IS NULL)
           OR source_kind = 'campaign'),
  CONSTRAINT communications_invite_needs_kind
    CHECK (event_invite IS NULL OR source_kind = 'invite')
);

COMMENT ON TABLE communications IS
  'The single delivery log header for every message (ADR-0009 decision 2, AFC-479). campaign/campaign_step/campaign_run/event_invite are bare uuids under the §5 merge contract: the owning slices add the FKs and must not fork this table.';

CREATE INDEX IF NOT EXISTS communications_source_kind_idx
  ON communications (source_kind);
CREATE INDEX IF NOT EXISTS communications_campaign_idx
  ON communications (campaign) WHERE campaign IS NOT NULL;
CREATE INDEX IF NOT EXISTS communications_campaign_step_idx
  ON communications (campaign_step) WHERE campaign_step IS NOT NULL;
CREATE INDEX IF NOT EXISTS communications_event_invite_idx
  ON communications (event_invite) WHERE event_invite IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. communication_recipients -- one row per recipient.
--
-- The acceptance criterion lives in comms_recipient_basis_matches_status:
-- send states (queued/sent/delivered/read) always carry a real basis;
-- excluded rows always carry basis 'none' plus a reason. The resolver below
-- is the only writer contract the tick and Flows share.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_recipients (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  communication    uuid NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
  contact_value    text,
  contact_hash     text,
  channel          text NOT NULL
                     CHECK (channel IN ('whatsapp', 'sms', 'email')),
  consent_basis    text NOT NULL
                     CHECK (consent_basis IN
                       ('explicit_opt_in', 'guardian', 'legitimate_interest',
                        'inviter_vouched', 'none')),
  message_rendered text,
  status           text NOT NULL DEFAULT 'queued'
                     CHECK (status IN
                       ('queued', 'sent', 'delivered', 'read', 'failed',
                        'excluded')),
  exclusion_reason text
                     CHECK (exclusion_reason IN
                       ('no_consent', 'minor_no_guardian_consent', 'opted_out',
                        'invalid_contact', 'dnc', 'over_cap')),
  provider_message_id text,
  error_detail     text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_recipient_basis_matches_status
    CHECK (((status IN ('queued', 'sent', 'delivered', 'read'))
            AND consent_basis <> 'none'
            AND exclusion_reason IS NULL)
           OR ((status IN ('failed', 'excluded'))
            AND ((status = 'excluded'
                  AND consent_basis = 'none'
                  AND exclusion_reason IS NOT NULL)
                 OR (status = 'failed' AND consent_basis <> 'none'
                     AND exclusion_reason IS NULL))))
);

COMMENT ON TABLE communication_recipients IS
  'Per-recipient delivery rows (AFC-479). queued/sent/delivered/read rows always carry a real consent_basis; excluded rows carry basis none plus an exclusion_reason. message_rendered/consent_basis/exclusion_reason are immutable via grants (no UPDATE): a correction is a new send, not an edit.';

CREATE INDEX IF NOT EXISTS communication_recipients_communication_idx
  ON communication_recipients (communication);
CREATE INDEX IF NOT EXISTS communication_recipients_status_idx
  ON communication_recipients (status);
CREATE INDEX IF NOT EXISTS communication_recipients_contact_hash_idx
  ON communication_recipients (contact_hash) WHERE contact_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. MERGE CONTRACT (the 0001->0002 WECA pattern, stated for tracks b and c).
--
-- communications.campaign / .campaign_step / .campaign_run belong to the
-- campaign-engine slice (track c); communications.event_invite and
-- consent_records.related_invite belong to the invitation slice (track b).
-- Those slices must
--   ALTER TABLE communications ADD CONSTRAINT ... FOREIGN KEY (campaign)
--     REFERENCES campaigns(id) [etc., one per bare column], and
--   ALTER TABLE consent_records ADD CONSTRAINT ... FOREIGN KEY
--     (related_invite) REFERENCES event_invites(id),
-- and they must not CREATE a table named communications,
-- communication_recipients, message_templates or consent_records, and must
-- not redefine the columns created here. The constraint names are fixed by
-- the owning slices. If a bare column already holds a value with no referent
-- row, the owning migration must fail loudly (restrict_violation), not skip
-- the FK.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. comms_resolve_consent -- audience-time consent resolver.
--
-- ADR-0009 decision 1: consent is resolved at audience time, the basis is
-- stored on the recipient row, and a send with no resolvable basis is
-- excluded with a reason -- never queued. This function is the single rule
-- both the campaign tick (track c) and the Directus Flows call, so the rule
-- cannot drift between writers. Pure: no table access, no clock reads.
--
-- Argument order mirrors the exclusion-reason priority in prd-addendum-v4
-- §4.3: opt-out first (a STOP suppresses everything including invitations),
-- then contact validity, then caps, then the minor rule, then channel
-- consent. There is deliberately no staff-override argument: no override
-- path exists (data-model-v4 §5 explicit denials).
--
-- p_channel: 'whatsapp' | 'sms' | 'email'. Channel consent is the matching
--   p_consent_* flag; 'email' reuses p_consent_sms as the consented-messaging
--   flag (email is the fallback channel for people without a consented
--   messaging channel, prd-addendum-v4 US-C7 AC2: operational_essential only
--   -- the caller passes the campaign policy, this function does not invent
--   one). p_vouched covers the single inviter_vouched invite message
--   (prd-addendum-v4 §3.3): it satisfies the basis requirement but never
--   satisfies opt-out, validity, DNC, cap, or the minor rule.
--
-- Returns exactly one row: (consent_basis, exclusion_reason), where a NULL
--   exclusion_reason means eligible and a non-NULL one means excluded with
--   basis 'none'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION comms_resolve_consent(
  p_channel text,
  p_consent_whatsapp boolean,
  p_consent_sms boolean,
  p_is_minor boolean,
  p_guardian_consent boolean,
  p_opted_out boolean,
  p_contact_valid boolean,
  p_over_cap boolean,
  p_dnc boolean,
  p_vouched boolean
)
RETURNS TABLE (consent_basis text, exclusion_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_channel IS NULL
     OR p_channel NOT IN ('whatsapp', 'sms', 'email') THEN
    RAISE EXCEPTION
      'comms_resolve_consent: unknown channel %, expected whatsapp/sms/email',
      p_channel
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(p_opted_out, false) THEN
    RETURN QUERY SELECT 'none'::text, 'opted_out'::text;
    RETURN;
  END IF;

  IF NOT COALESCE(p_contact_valid, false) THEN
    RETURN QUERY SELECT 'none'::text, 'invalid_contact'::text;
    RETURN;
  END IF;

  IF COALESCE(p_dnc, false) THEN
    RETURN QUERY SELECT 'none'::text, 'dnc'::text;
    RETURN;
  END IF;

  IF COALESCE(p_over_cap, false) THEN
    RETURN QUERY SELECT 'none'::text, 'over_cap'::text;
    RETURN;
  END IF;

  IF COALESCE(p_is_minor, false) AND NOT COALESCE(p_guardian_consent, false) THEN
    RETURN QUERY SELECT 'none'::text, 'minor_no_guardian_consent'::text;
    RETURN;
  END IF;

  IF COALESCE(p_vouched, false) THEN
    RETURN QUERY SELECT 'inviter_vouched'::text, NULL::text;
    RETURN;
  END IF;

  IF COALESCE(p_is_minor, false) THEN
    -- Minors are messaged via their guardian only (prd-addendum-v4 §2.3):
    -- the guardian holds the consent, so the basis is guardian.
    RETURN QUERY SELECT 'guardian'::text, NULL::text;
    RETURN;
  END IF;

  IF p_channel = 'whatsapp' AND COALESCE(p_consent_whatsapp, false) THEN
    RETURN QUERY SELECT 'explicit_opt_in'::text, NULL::text;
    RETURN;
  END IF;

  IF p_channel IN ('sms', 'email') AND COALESCE(p_consent_sms, false) THEN
    RETURN QUERY SELECT 'explicit_opt_in'::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'none'::text, 'no_consent'::text;
END
$$;

COMMENT ON FUNCTION comms_resolve_consent(text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean) IS
  'Audience-time consent resolver (ADR-0009 decision 1, AFC-479). Pure function: the campaign tick and Flows share this rule. Excluded recipients get basis none plus a reason; eligible recipients get a real basis. No staff override path.';

-- ---------------------------------------------------------------------------
-- 7. SEED -- the eleven template keys from integrations-addendum §2
--    (idempotent; ON CONFLICT (key) DO NOTHING, so board edits to body text
--    via the app are never overwritten by a rerun). All seeded
--    approval_status = pending_provider per the issue build list: nothing
--    here may send on WhatsApp until a reviewed step approves it.
-- ---------------------------------------------------------------------------
INSERT INTO message_templates (key, channel, category, approval_status, body, variables) VALUES
  ('visitor_welcome_wa', 'whatsapp', 'greeting', 'pending_provider',
   'Welcome to {{branch_name}}! Join us {{event_datetime}}. Watch live: {{live_join_url}}',
   '["invitee_name","branch_name","event_datetime","live_join_url"]'),
  ('visitor_welcome_sms', 'sms', 'greeting', 'pending_provider',
   'Welcome to {{branch_name}}! Join us {{event_datetime}}.',
   '["invitee_name","branch_name","event_datetime"]'),
  ('visitor_weekly_checkin', 'whatsapp', 'operational', 'pending_provider',
   'Hello {{invitee_name}}, how are you doing? Do you need anything? Reply STOP to opt out.',
   '["invitee_name","branch_name"]'),
  ('visitor_service_reminder', 'whatsapp', 'service_reminder', 'pending_provider',
   'Reminder: service {{event_datetime}} at {{branch_name}}. Watch live: {{live_join_url}}',
   '["invitee_name","event_datetime","branch_name","live_join_url"]'),
  ('dropoff_appointment', 'sms', 'operational', 'pending_provider',
   'Hello {{invitee_name}}, we will visit {{visit_window}}. Please confirm your address: {{branch_name}}.',
   '["invitee_name","visit_window","branch_name"]'),
  ('event_invitation', 'whatsapp', 'event_invitation', 'pending_provider',
   'Dear {{invitee_name}}, {{inviter_name}} invites you to {{event_name}} {{event_datetime}} at {{branch_name}}. {{inviter_note}} Details: {{rsvp_link}}',
   '["invitee_name","inviter_name","event_name","event_datetime","event_location","branch_name","inviter_note","rsvp_link"]'),
  ('birthday_greeting', 'whatsapp', 'greeting', 'pending_provider',
   'Happy birthday {{invitee_name}}! {{branch_name}} celebrates with you today.',
   '["invitee_name","branch_name"]'),
  ('memory_verse', 'whatsapp', 'memory_verse', 'pending_provider',
   '{{verse_text}} ({{verse_ref}}) - your memory verse for the week.',
   '["verse_text","verse_ref"]'),
  ('service_reminder', 'whatsapp', 'service_reminder', 'pending_provider',
   'Reminder: {{event_name}} {{event_datetime}} at {{branch_name}}. Watch live: {{live_join_url}}',
   '["event_name","event_datetime","branch_name","live_join_url"]'),
  ('meeting_reminder', 'email', 'service_reminder', 'pending_provider',
   'Reminder: {{event_name}} {{event_datetime}}. Join: {{live_join_url}}',
   '["event_name","event_datetime","live_join_url"]'),
  ('whatsapp_fallback_sms', 'sms', 'fallback', 'pending_provider',
   'From {{branch_name}}: {{fallback_text}}',
   '["branch_name","fallback_text"]')
ON CONFLICT (key) DO NOTHING;

-- The weekly memory-verse rotation picks deterministically by ISO week
-- (integrations-addendum §2): rotation_key marks the pool. Seeded verse rows
-- are board content, not code -- one starter row proves the rotation_key
-- index; the board adds the rest via the app.
UPDATE message_templates SET rotation_key = 'memory_verse' WHERE key = 'memory_verse';

-- ---------------------------------------------------------------------------
-- 8. Least privilege (data-model-expansion §10 pattern, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- branch/zone scoping lives in the Directus policy + portal route filters,
-- not here. This layer states the ceiling:
--   message_templates: board config -- the app reads; writes go through the
--     reviewed template flow only (no direct INSERT/UPDATE/DELETE grant, so
--     a template cannot be silently approved or edited around the gate).
--   consent_records: consent history is written by the consent Flows only
--     (INSERT of the captured grant + SELECT for reads); no UPDATE/DELETE --
--     a withdrawal is a new row with granted = false, not an edit.
--   communications: the header is written by the send path (INSERT + status
--     transitions); no DELETE -- the log is audited.
--   communication_recipients: the app inserts the resolved row and advances
--     send state (status/provider ids/timestamps/contact identifiers only);
--     message_rendered, consent_basis and exclusion_reason are immutable
--     (no UPDATE grant) and nothing is deletable.
-- ---------------------------------------------------------------------------
GRANT SELECT ON message_templates TO directus_app;
GRANT SELECT ON consent_records TO directus_app;
GRANT INSERT (person, contact_hash, channel, granted, consent_type, basis,
  related_invite, method, expires_at, captured_at) ON consent_records TO directus_app;

GRANT SELECT ON communications TO directus_app;
GRANT INSERT (source_kind, campaign, campaign_step, campaign_run, event_invite,
  consent_policy, branch, status, estimated_cost, created_by) ON communications TO directus_app;
GRANT UPDATE (status, estimated_cost) ON communications TO directus_app;

GRANT SELECT ON communication_recipients TO directus_app;
GRANT INSERT (communication, contact_value, contact_hash, channel, consent_basis,
  message_rendered, status, exclusion_reason, provider_message_id, error_detail,
  sent_at, delivered_at, read_at) ON communication_recipients TO directus_app;
GRANT UPDATE (status, provider_message_id, error_detail,
  sent_at, delivered_at, read_at) ON communication_recipients TO directus_app;

REVOKE ALL ON message_templates FROM PUBLIC;
REVOKE ALL ON consent_records FROM PUBLIC;
REVOKE ALL ON communications FROM PUBLIC;
REVOKE ALL ON communication_recipients FROM PUBLIC;
