-- tests/db/72_comms_consent.sql
--
-- AFC-479 / AFC-464 (ADR-0009 decisions 1-2). THE CONSENT GATE CONTRACT.
--
-- The delivery log (communications + communication_recipients) is only as
-- honest as the rule that fills it, so this suite asserts the database half
-- of the Slice 4a promise -- the half a crafted HTTP request cannot change:
--
--   72.1  seed          -- the eleven template keys from integrations-addendum
--                         §2; every category in the v4 set is represented;
--                         everything seeds pending_provider; the memory_verse
--                         row carries rotation_key = 'memory_verse'.
--   72.2  resolver      -- comms_resolve_consent() over the exclusion matrix:
--                         opt-out first (even vouched, even consented), then
--                         validity, DNC, caps, the minor rule (no override),
--                         then channel consent; vouched satisfies the basis but
--                         never the suppressions; unknown channel raises.
--   72.3  acceptance    -- THE ISSUE ACCEPTANCE: zero recipient rows with a
--                         send status carry basis none (asserted as a query,
--                         after writing both eligible and excluded rows through
--                         the resolver); the CHECK rejects queued+none,
--                         queued+reason, excluded-without-reason, and
--                         excluded-with-a-real-basis.
--   72.4  guards        -- the app identity reads everything, inserts the
--                         resolved row, advances send state, and is refused
--                         (42501) on message_rendered/consent_basis/
--                         exclusion_reason UPDATE, on any DELETE, on consent
--                         rewrites, and on template writes.
--   72.5  rerun         -- re-applying 20261020_0004 changes nothing
--                         (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO
--                         NOTHING; template and recipient counts identical).
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- the delivery-log read surface, scope filtering and field redaction -- lives
-- in the route layer (getPortalScope + visibleFields/stripHidden, per
-- data-model-v4 §5.1) and is covered by the web contract test. A SQL suite
-- asserting HTTP status codes would be testing the wrong layer. The campaign
-- tick, Flows, and the member OTP path are tracks (c)/(d) and are not here.

-- ---------------------------------------------------------------------------
-- 72.1  SEED. Eleven keys, five new categories, all pending_provider.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_templates integer;
  v_approved  integer;
  v_cats      text[];
BEGIN
  SELECT count(*) INTO v_templates FROM message_templates;
  PERFORM test_support.assert_true(v_templates = 11, 'comms',
    'eleven seeded templates (integrations-addendum §2 key set)');

  SELECT count(*) INTO v_approved FROM message_templates
   WHERE approval_status <> 'pending_provider';
  PERFORM test_support.assert_true(v_approved = 0, 'comms',
    'every seed row is pending_provider: nothing here may send on WhatsApp yet');

  SELECT array_agg(DISTINCT category ORDER BY category) INTO v_cats
    FROM message_templates;
  PERFORM test_support.assert_true(
    v_cats = ARRAY['event_invitation','fallback','greeting','memory_verse','operational','service_reminder']::text[],
    'comms', 'the v4 category set is represented: ' || COALESCE(array_to_string(v_cats, ','), '(none)'));

  PERFORM test_support.assert_true(
    (SELECT rotation_key FROM message_templates WHERE key = 'memory_verse') = 'memory_verse',
    'comms', 'memory_verse carries rotation_key for the ISO-week rotation');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM message_templates WHERE key = 'event_invitation' AND category = 'event_invitation') = 1,
    'comms', 'event_invitation template exists in the event_invitation category');
END $$;

-- ---------------------------------------------------------------------------
-- 72.2  RESOLVER. One row back, always: (basis, reason); NULL reason means
-- eligible. Each branch is pinned so a future edit that reorders the
-- suppressions goes red rather than silently reprioritising.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- Consented adult, WhatsApp consent: eligible, explicit basis.
  SELECT * INTO r FROM comms_resolve_consent('whatsapp', true, true, false, false, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'explicit_opt_in' AND r.exclusion_reason IS NULL, 'comms',
    'consented adult on WhatsApp resolves explicit_opt_in');

  -- No channel consent: excluded, never queued.
  SELECT * INTO r FROM comms_resolve_consent('whatsapp', false, true, false, false, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'no_consent', 'comms',
    'WhatsApp without WhatsApp consent resolves no_consent');

  -- SMS consent does not authorise WhatsApp.
  SELECT * INTO r FROM comms_resolve_consent('sms', false, true, false, false, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'explicit_opt_in' AND r.exclusion_reason IS NULL, 'comms',
    'SMS with SMS consent resolves explicit_opt_in');

  -- STOP suppresses everything, even a consented vouched invite.
  SELECT * INTO r FROM comms_resolve_consent('sms', true, true, false, false, true, true, false, false, true);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'opted_out', 'comms',
    'opt-out beats consent and the vouched basis alike');

  -- Bad number: excluded before any consent question.
  SELECT * INTO r FROM comms_resolve_consent('sms', true, true, false, false, false, false, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'invalid_contact', 'comms',
    'invalid contact resolves invalid_contact');

  -- DNC list: its own reason, distinct from opted_out.
  SELECT * INTO r FROM comms_resolve_consent('sms', true, true, false, false, false, true, false, true, false);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'dnc', 'comms',
    'do-not-contact resolves dnc');

  -- Caps: excluded even when fully consented.
  SELECT * INTO r FROM comms_resolve_consent('whatsapp', true, true, false, false, false, true, true, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'over_cap', 'comms',
    'over-cap resolves over_cap');

  -- Minor without guardian consent: excluded, even with channel consent.
  -- There is no staff-override parameter to try -- the function has none.
  SELECT * INTO r FROM comms_resolve_consent('whatsapp', true, true, true, false, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'minor_no_guardian_consent', 'comms',
    'minor without guardian consent is excluded despite channel consent');

  -- Minor WITH guardian consent: eligible, guardian is the basis and holder.
  SELECT * INTO r FROM comms_resolve_consent('whatsapp', true, true, true, true, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'guardian' AND r.exclusion_reason IS NULL, 'comms',
    'minor with guardian consent resolves guardian');

  -- Vouched invite: satisfies the basis, one message, no drip.
  SELECT * INTO r FROM comms_resolve_consent('sms', false, false, false, false, false, true, false, false, true);
  PERFORM test_support.assert_true(r.consent_basis = 'inviter_vouched' AND r.exclusion_reason IS NULL, 'comms',
    'vouched invite resolves inviter_vouched without channel consent');

  -- Vouched does not survive the minor rule: a minor invitee needs the
  -- guardian number (prd-addendum-v4 §3.3), not the minor's.
  SELECT * INTO r FROM comms_resolve_consent('sms', false, false, true, false, false, true, false, false, true);
  PERFORM test_support.assert_true(r.consent_basis = 'none' AND r.exclusion_reason = 'minor_no_guardian_consent', 'comms',
    'vouched minor without guardian consent is still excluded');

  -- Email falls back on the consented-messaging flag (US-C7 AC2).
  SELECT * INTO r FROM comms_resolve_consent('email', false, true, false, false, false, true, false, false, false);
  PERFORM test_support.assert_true(r.consent_basis = 'explicit_opt_in' AND r.exclusion_reason IS NULL, 'comms',
    'email with messaging consent resolves explicit_opt_in');

  -- Unknown channel: a loud error, not a silent exclusion.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM comms_resolve_consent('pigeon', true, true, false, false, false, true, false, false, false)$q$,
    '23514', 'comms', 'unknown channel raises check_violation');
END $$;

-- ---------------------------------------------------------------------------
-- 72.3  ACCEPTANCE. Write eligible + excluded rows through the resolver the
-- way the tick and Flows must, then assert the property the issue demands:
-- zero recipients with a send status carry basis none. Then prove the CHECK
-- holds each boundary directly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_comms uuid;
  v_basis text;
  v_reason text;
  v_none_queued integer;
BEGIN
  INSERT INTO communications (source_kind, consent_policy, status)
  VALUES ('campaign', 'marketing_only', 'queued') RETURNING id INTO v_comms;

  -- Eligible adult: queue with the stored basis.
  SELECT consent_basis, exclusion_reason INTO v_basis, v_reason
    FROM comms_resolve_consent('whatsapp', true, false, false, false, false, true, false, false, false);
  INSERT INTO communication_recipients
    (communication, contact_hash, channel, consent_basis, message_rendered, status)
  VALUES (v_comms, 'hash:eligible-adult', 'whatsapp', v_basis, 'frozen text', 'queued');

  -- No-consent adult: excluded with the reason, basis none.
  SELECT consent_basis, exclusion_reason INTO v_basis, v_reason
    FROM comms_resolve_consent('whatsapp', false, false, false, false, false, true, false, false, false);
  INSERT INTO communication_recipients
    (communication, contact_hash, channel, consent_basis, status, exclusion_reason)
  VALUES (v_comms, 'hash:no-consent', 'whatsapp', v_basis, 'excluded', v_reason);

  -- Opted-out adult: excluded, basis none.
  SELECT consent_basis, exclusion_reason INTO v_basis, v_reason
    FROM comms_resolve_consent('sms', true, true, false, false, true, true, false, false, false);
  INSERT INTO communication_recipients
    (communication, contact_hash, channel, consent_basis, status, exclusion_reason)
  VALUES (v_comms, 'hash:opted-out', 'sms', v_basis, 'excluded', v_reason);

  -- Minor without guardian: excluded, basis none.
  SELECT consent_basis, exclusion_reason INTO v_basis, v_reason
    FROM comms_resolve_consent('sms', true, true, true, false, false, true, false, false, false);
  INSERT INTO communication_recipients
    (communication, contact_hash, channel, consent_basis, status, exclusion_reason)
  VALUES (v_comms, 'hash:minor', 'sms', v_basis, 'excluded', v_reason);

  SELECT count(*) INTO v_none_queued FROM communication_recipients
   WHERE status IN ('queued', 'sent', 'delivered', 'read') AND consent_basis = 'none';
  PERFORM test_support.assert_true(v_none_queued = 0, 'comms',
    'ACCEPTANCE: zero recipients with a send status carry basis none');

  -- The CHECK, directly: each forbidden shape raises 23514.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, channel, consent_basis, status) VALUES ('$q$ || v_comms::text || $q$', 'sms', 'none', 'queued')$q$,
    '23514', 'comms', 'queued with basis none is rejected');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, channel, consent_basis, status, exclusion_reason) VALUES ('$q$ || v_comms::text || $q$', 'sms', 'explicit_opt_in', 'queued', 'no_consent')$q$,
    '23514', 'comms', 'queued with an exclusion reason is rejected');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, channel, consent_basis, status) VALUES ('$q$ || v_comms::text || $q$', 'sms', 'none', 'excluded')$q$,
    '23514', 'comms', 'excluded without a reason is rejected');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, channel, consent_basis, status, exclusion_reason) VALUES ('$q$ || v_comms::text || $q$', 'sms', 'explicit_opt_in', 'excluded', 'no_consent')$q$,
    '23514', 'comms', 'excluded with a real basis is rejected');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, channel, consent_basis, status, exclusion_reason) VALUES ('$q$ || v_comms::text || $q$', 'sms', 'explicit_opt_in', 'failed', 'no_consent')$q$,
    '23514', 'comms', 'failed with an exclusion reason is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 72.4  GUARDS. The app identity reads, inserts the resolved row, advances
-- send state -- and nothing else.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM message_templates$q$,
    'comms', 'directus_app reads the template registry');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM consent_records$q$,
    'comms', 'directus_app reads consent history');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM communications$q$,
    'comms', 'directus_app reads the delivery log header');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM communication_recipients$q$,
    'comms', 'directus_app reads the recipient rows');

  -- Send-state advance is allowed: status + provider fields + timestamps.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE communication_recipients SET status = 'sent', sent_at = now() WHERE status = 'queued'$q$,
    'comms', 'directus_app advances queued rows to sent');

  -- The frozen columns are not updatable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE communication_recipients SET message_rendered = 'edited' WHERE status = 'sent'$q$,
    '42501', 'comms', 'directus_app cannot rewrite rendered text');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE communication_recipients SET consent_basis = 'explicit_opt_in' WHERE status = 'excluded'$q$,
    '42501', 'comms', 'directus_app cannot rewrite a stored basis');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE communication_recipients SET exclusion_reason = 'dnc' WHERE status = 'excluded'$q$,
    '42501', 'comms', 'directus_app cannot rewrite an exclusion reason');

  -- Nothing in the log is deletable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM communication_recipients WHERE status = 'excluded'$q$,
    '42501', 'comms', 'directus_app cannot delete recipient rows');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM communications WHERE status = 'queued'$q$,
    '42501', 'comms', 'directus_app cannot delete the log header');

  -- Consent history is append-only: no UPDATE, no DELETE.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE consent_records SET granted = true WHERE granted = false$q$,
    '42501', 'comms', 'directus_app cannot flip a withdrawal (withdrawal is a new row)');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM consent_records WHERE granted = false$q$,
    '42501', 'comms', 'directus_app cannot delete consent history');

  -- Templates are board config: the app reads, only reviewed migrations write.
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO message_templates (key, channel, category, body) VALUES ('rogue', 'sms', 'marketing', 'x')$q$,
    '42501', 'comms', 'directus_app cannot insert a template around the review path');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE message_templates SET approval_status = 'approved' WHERE key = 'visitor_welcome_wa'$q$,
    '42501', 'comms', 'directus_app cannot approve a template around the review path');
END $$;

-- ---------------------------------------------------------------------------
-- 72.5  RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0004_comms_consent.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM message_templates) = 11, 'comms',
    'rerun: still eleven templates (ON CONFLICT DO NOTHING, board edits intact)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM message_templates WHERE approval_status <> 'pending_provider') = 0, 'comms',
    'rerun: reseeding does not approve anything');
END $$;
