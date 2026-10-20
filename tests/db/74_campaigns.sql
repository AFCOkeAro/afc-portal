-- tests/db/74_campaigns.sql
--
-- AFC-481 / AFC-464 (ADR-0009 decisions 3-5, 7). THE CAMPAIGN ENGINE CONTRACT.
--
-- The tick is only as honest as the rules it loops over, so this suite
-- asserts the database half of the Slice 4c promise -- the half a replayed
-- cron line or a crafted request cannot change:
--
--   74.1  seed          -- three channels (enabled, cap unset) + the nine
--                         §4.1 keys, all draft; defaults (3/week, 4h window,
--                         Africa/Lagos); quiet override only on the two
--                         operational_essential campaigns; the three FKs this
--                         slice owns under the 0004 merge contract.
--   74.2  enrollment    -- replayed enrolment collides on the UNIQUE
--                         idempotency_key (no duplicate enrollment, US-C4
--                         AC4); blank/NULL keys rejected at write.
--   74.3  send key      -- the per-recipient key builder (person xor
--                         contact, hour bucket) + the UNIQUE send-key index:
--                         a replayed tick collides instead of double-sending
--                         (US-C2 AC2: retry-once stays idempotent).
--   74.4  pause         -- THE KILL-SWITCH ACCEPTANCE: pausing a campaign
--                         (or disabling its channel) removes its enrollments
--                         from the very next due-read -- effective within one
--                         tick, rows held not deleted; resume restores them.
--   74.5  fallback      -- no SMS before the 4h window (US-C3 AC1); any
--                         activity signal cancels it (AC2); at most one per
--                         person per 24h per family (AC3).
--   74.6  template gate -- WhatsApp with approval_status != approved cannot
--                         run (US-C1 AC4, US-C3); SMS/email stay free-form.
--   74.7  quiet hours   -- 20:00-07:00 Africa/Lagos shifts to 08:00 (OQ-R6);
--                         operational_essential passes through; boundaries
--                         pinned as instants (AFC-202: no render comparison).
--   74.8  caps          -- marketing ≤3/week (US-C3 AC3 shape); the writer
--                         counts, this rule decides; bad input raises.
--   74.9  allowlist     -- audience filter keys outside the §4.3 vocabulary
--                         are rejected at write; the resolver never sees SQL.
--   74.10 guards        -- the app identity reads, inserts the resolved row,
--                         advances lifecycle state and flips the kill switch
--                         -- and is refused (42501) on deletes, on frozen-key
--                         rewrites, on contact_key reads (§5.1: area/super
--                         only), and on channel inserts.
--   74.11 acceptance    -- the issue properties as queries: zero duplicate
--                         enrollments, zero duplicate sends, zero due rows
--                         for held campaigns.
--   74.12 rerun         -- re-applying 20261020_0006 changes nothing
--                         (IF NOT EXISTS / OR REPLACE / ON CONFLICT DO
--                         NOTHING; seeds and rules identical).
--
-- What this suite does NOT assert (stated, not missing): the worker half --
-- the 1-minute cadence, the single-instance lock, the 500-chunks, the
-- Telegram anomaly alert without message content, the 5-minute SLO -- lives
-- in the tick module (apps/web/server/utils/campaign-tick.ts, stubbed
-- transports) and its contract test. A SQL suite asserting tick durations
-- would be testing the wrong layer. Flows own triggers/enrolment only, and
-- procurement (BSP, templates, Termii) is out of scope -- the engine runs
-- with stubbed transports.

-- ---------------------------------------------------------------------------
-- 74.1  SEED. Three channels, nine keys, all draft, reviewed-gate defaults.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_channels integer;
  v_unset_caps integer;
  v_campaigns integer;
  v_live integer;
  v_overrides integer;
BEGIN
  SELECT count(*) INTO v_channels FROM communication_channels;
  PERFORM test_support.assert_true(v_channels = 3, 'campaigns',
    'three seeded channels (whatsapp/sms/email)');

  SELECT count(*) INTO v_unset_caps FROM communication_channels
   WHERE enabled AND daily_cap IS NULL;
  PERFORM test_support.assert_true(v_unset_caps = 3, 'campaigns',
    'every channel seeded enabled with daily_cap NULL (unset until procurement I4, never zero)');

  SELECT count(*) INTO v_campaigns FROM campaigns;
  PERFORM test_support.assert_true(v_campaigns = 9, 'campaigns',
    'nine seeded campaign keys (data-model-v4 §4.1: fallback + eight families)');

  SELECT count(*) INTO v_live FROM campaigns WHERE status <> 'draft';
  PERFORM test_support.assert_true(v_live = 0, 'campaigns',
    'every seed row is draft: nothing sends until a reviewed activation flips the status');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaigns
      WHERE key IN ('whatsapp_sms_fallback', 'newcomer_weekly_checkin',
        'birthday_anniversary_greeting', 'new_visitor_welcome_drip',
        'new_convert_drip', 'weekly_memory_verse', 'service_reminder',
        'meeting_reminder', 'event_invitation')) = 9, 'campaigns',
    'the §4.1 key set is exactly the seed set');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaigns
      WHERE max_sends_per_person_per_week = 3
        AND fallback_sms_after_hours = 4
        AND timezone = 'Africa/Lagos') = 9, 'campaigns',
    'reviewed-gate defaults on every seed: 3/week, 4h window, Africa/Lagos');

  SELECT count(*) INTO v_overrides FROM campaigns WHERE quiet_hours_override;
  PERFORM test_support.assert_true(v_overrides = 2, 'campaigns',
    'quiet-hours override only on the two operational_essential campaigns (found ' || v_overrides::text || ')');

  PERFORM test_support.assert_true(
    (SELECT consent_policy FROM campaigns WHERE key = 'whatsapp_sms_fallback') = 'mixed', 'campaigns',
    'fallback policy is mixed (stated choice 2: honours whichever channel consent exists)');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_step_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_run_fkey'), 'campaigns',
    'the three FKs this slice owns under the 0004 merge contract are present');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'communication_recipients_send_key_uidx'), 'campaigns',
    'the send-key dedupe index exists on the delivery log (additive: no 0004 column redefined)');
END $$;

-- ---------------------------------------------------------------------------
-- 74.2  ENROLMENT IDEMPOTENCY. A replayed enrolment is a no-op (US-C4 AC4).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_campaign uuid;
BEGIN
  SELECT id INTO v_campaign FROM campaigns WHERE key = 'weekly_memory_verse';

  INSERT INTO campaign_enrollments
    (campaign, person, source_event, state, next_step_at, idempotency_key)
  VALUES
    (v_campaign, gen_random_uuid(), 'suite 74.2 seed',
     'active', now(), 'enroll:74-2:person:seed:2026-10-20T12');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO campaign_enrollments (campaign, person, source_event, state, idempotency_key) VALUES ('$q$ || v_campaign::text || $q$', gen_random_uuid(), 'suite 74.2 replay', 'active', 'enroll:74-2:person:seed:2026-10-20T12')$q$,
    '23505', 'campaigns', 'ACCEPTANCE: replayed enrolment collides on the UNIQUE idempotency_key (no duplicate enrollment)');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO campaign_enrollments (campaign, person, source_event, state, idempotency_key) VALUES ('$q$ || v_campaign::text || $q$', gen_random_uuid(), 'suite 74.2 blank', 'active', '  ')$q$,
    '23514', 'campaigns', 'a blank idempotency key is rejected at write');

  DELETE FROM campaign_enrollments WHERE idempotency_key LIKE 'enroll:74-2:%';
END $$;

-- ---------------------------------------------------------------------------
-- 74.3  SEND-KEY IDEMPOTENCY. A replayed tick collides (US-C2 AC2).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_campaign uuid;
  v_step uuid;
  v_person uuid := gen_random_uuid();
  v_comms uuid;
  v_key_same text;
  v_key_other_hour text;
BEGIN
  SELECT id INTO v_campaign FROM campaigns WHERE key = 'weekly_memory_verse';
  -- No steps are seeded (stated choice 5): the step below stands in for one.
  v_step := gen_random_uuid();

  -- Same (step, person, window-hour) builds the same key: the replay case.
  v_key_same := campaign_send_key(
    v_campaign, v_step, v_person, NULL, '2026-10-20 12:14:00+00'::timestamptz);
  PERFORM test_support.assert_true(
    v_key_same = campaign_send_key(
      v_campaign, v_step, v_person, NULL, '2026-10-20 12:47:00+00'::timestamptz),
    'campaigns', 'two ticks in the same window-hour build the same key (replay is a no-op)');

  -- A different hour is a different send: no cross-window suppression.
  v_key_other_hour := campaign_send_key(
    v_campaign, v_step, v_person, NULL, '2026-10-20 13:05:00+00'::timestamptz);
  PERFORM test_support.assert_true(
    v_key_same <> v_key_other_hour, 'campaigns',
    'a later window-hour builds a different key (the next send is not suppressed)');

  -- Visitor-only recipients key on the contact hash, never a NULL person.
  PERFORM test_support.assert_true(
    campaign_send_key(v_campaign, v_step, NULL, 'hash:74-visitor',
      '2026-10-20 12:00:00+00'::timestamptz)
    LIKE 'campaign:%:person:contact:hash:74-visitor:%', 'campaigns',
    'contact-keyed recipients build a contact-scoped key');

  -- Exactly one identity: neither zero nor two.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_send_key('$q$ || v_campaign::text || $q$'::uuid, '$q$ || v_step::text || $q$'::uuid, NULL, NULL, now())$q$,
    '23514', 'campaigns', 'a send key with no recipient identity raises');
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_send_key('$q$ || v_campaign::text || $q$'::uuid, '$q$ || v_step::text || $q$'::uuid, '$q$ || v_person::text || $q$'::uuid, 'hash:both', now())$q$,
    '23514', 'campaigns', 'a send key with two recipient identities raises');

  -- The index, directly: the second recipient row with the same key dies.
  INSERT INTO communications (source_kind, consent_policy, status)
  VALUES ('campaign', 'marketing_only', 'queued') RETURNING id INTO v_comms;
  INSERT INTO communication_recipients
    (communication, contact_hash, channel, consent_basis, message_rendered,
     status, campaign_send_key)
  VALUES (v_comms, 'hash:74-replay', 'sms', 'explicit_opt_in', 'frozen text',
    'queued', v_key_same);

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO communication_recipients (communication, contact_hash, channel, consent_basis, message_rendered, status, campaign_send_key) VALUES ('$q$ || v_comms::text || $q$', 'hash:74-replay', 'sms', 'explicit_opt_in', 'frozen text', 'queued', '$q$ || v_key_same || $q$')$q$,
    '23505', 'campaigns', 'ACCEPTANCE: replayed tick collides on the UNIQUE send key (zero duplicate sends)');

  DELETE FROM communication_recipients WHERE contact_hash = 'hash:74-replay';
  DELETE FROM communications WHERE id = v_comms;
END $$;

-- ---------------------------------------------------------------------------
-- 74.4  PAUSE. Effective within one tick: the next due-read already holds.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_now timestamptz := '2026-10-20 12:00:00+00'::timestamptz;
  v_campaign uuid;
  v_channel uuid;
  v_step uuid;
  v_due integer;
BEGIN
  INSERT INTO campaigns (key, name, purpose, campaign_type, consent_policy, status, paused_at)
  VALUES ('test-74-pause', 'Suite 74 pause probe', 'scheduled', 'scheduled',
    'marketing_only', 'active', now())
  RETURNING id INTO v_campaign;

  SELECT id INTO v_channel FROM communication_channels WHERE key = 'sms';

  INSERT INTO campaign_steps
    (campaign, sequence, name, delay_type, channel, active)
  VALUES (v_campaign, 1, 'suite step', 'immediate', v_channel, true)
  RETURNING id INTO v_step;

  INSERT INTO campaign_enrollments
    (campaign, person, source_event, state, current_step, next_step_at,
     idempotency_key)
  VALUES (v_campaign, gen_random_uuid(), 'suite 74.4', 'active', v_step,
    v_now - INTERVAL '1 minute', 'enroll:74-4:pause:probe');

  SELECT count(*) INTO v_due FROM campaign_due_enrollments(v_now)
   WHERE campaign = v_campaign;
  PERFORM test_support.assert_true(v_due = 1, 'campaigns',
    'a due enrollment on an active campaign is returned by the tick read');

  -- Pause: the VERY NEXT read -- the next tick -- already holds. No deploy,
  -- no restart, no deleted rows.
  UPDATE campaigns
     SET status = 'paused', paused_at = now(),
         paused_by = gen_random_uuid(), pause_reason = 'suite 74.4: bad message stop'
   WHERE id = v_campaign;

  SELECT count(*) INTO v_due FROM campaign_due_enrollments(v_now)
   WHERE campaign = v_campaign;
  PERFORM test_support.assert_true(v_due = 0, 'campaigns',
    'ACCEPTANCE: pause is effective within one tick (next due-read holds the enrollment)');

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaign_enrollments WHERE campaign = v_campaign) = 1, 'campaigns',
    'held enrollments are kept, never deleted (queued sends survive the pause)');

  -- Resume restores without re-enrolment.
  UPDATE campaigns
     SET status = 'active', paused_at = NULL, paused_by = NULL, pause_reason = NULL
   WHERE id = v_campaign;

  SELECT count(*) INTO v_due FROM campaign_due_enrollments(v_now)
   WHERE campaign = v_campaign;
  PERFORM test_support.assert_true(v_due = 1, 'campaigns',
    'resume restores the enrollment without re-enrolment');

  -- The channel switch holds the same way.
  UPDATE communication_channels SET enabled = false WHERE id = v_channel;

  SELECT count(*) INTO v_due FROM campaign_due_enrollments(v_now)
   WHERE campaign = v_campaign;
  PERFORM test_support.assert_true(v_due = 0, 'campaigns',
    'ACCEPTANCE: disabling the channel holds enrollments within one tick');

  UPDATE communication_channels
     SET enabled = true, updated_at = now() WHERE id = v_channel;

  -- The predicate, directly: paused beats everything, disabled beats active.
  PERFORM test_support.assert_true(
    (SELECT held FROM campaign_tick_hold('paused', true) LIMIT 1)
    AND (SELECT reason FROM campaign_tick_hold('paused', true) LIMIT 1) = 'campaign_paused',
    'campaigns', 'paused campaign holds with reason campaign_paused');
  PERFORM test_support.assert_true(
    (SELECT held FROM campaign_tick_hold('active', false) LIMIT 1)
    AND (SELECT reason FROM campaign_tick_hold('active', false) LIMIT 1) = 'channel_disabled',
    'campaigns', 'disabled channel holds an active campaign with reason channel_disabled');
  PERFORM test_support.assert_true(
    (SELECT NOT held FROM campaign_tick_hold('active', true) LIMIT 1),
    'campaigns', 'active campaign on an enabled channel is not held');
  PERFORM test_support.assert_true(
    (SELECT NOT held FROM campaign_tick_hold('draft', true) LIMIT 1),
    'campaigns', 'draft campaigns are not held -- they simply never enter the due-read');

  DELETE FROM campaign_enrollments WHERE campaign = v_campaign;
  DELETE FROM campaign_steps WHERE campaign = v_campaign;
  DELETE FROM campaigns WHERE id = v_campaign;
END $$;

-- ---------------------------------------------------------------------------
-- 74.5  FALLBACK. Never before 4h; any activity cancels; max 1 per 24h.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_now timestamptz := '2026-10-20 12:00:00+00'::timestamptz;
BEGIN
  PERFORM test_support.assert_true(
    campaign_fallback_due(v_now - INTERVAL '5 hours', NULL, NULL, NULL, 4, v_now),
    'campaigns', 'ACCEPTANCE: 5h after send with no activity, the fallback is due');

  PERFORM test_support.assert_true(
    NOT campaign_fallback_due(v_now - INTERVAL '3 hours' - INTERVAL '59 minutes', NULL, NULL, NULL, 4, v_now),
    'campaigns', 'ACCEPTANCE: no fallback before the 4h window (3h59m is not due)');

  PERFORM test_support.assert_true(
    NOT campaign_fallback_due(v_now - INTERVAL '5 hours', v_now - INTERVAL '4 hours', NULL, NULL, 4, v_now),
    'campaigns', 'delivered_at cancels the fallback (the OQ-R5 proxy counts as activity)');
  PERFORM test_support.assert_true(
    NOT campaign_fallback_due(v_now - INTERVAL '5 hours', NULL, v_now - INTERVAL '4 hours', NULL, 4, v_now),
    'campaigns', 'read_at cancels the fallback');
  PERFORM test_support.assert_true(
    NOT campaign_fallback_due(v_now - INTERVAL '5 hours', NULL, NULL, v_now - INTERVAL '4 hours', 4, v_now),
    'campaigns', 'an inbound reply cancels the fallback (and is a follow-up opportunity)');

  PERFORM test_support.assert_true(
    campaign_has_activity(v_now, NULL, NULL)
    AND campaign_has_activity(NULL, v_now, NULL)
    AND campaign_has_activity(NULL, NULL, v_now)
    AND NOT campaign_has_activity(NULL, NULL, NULL),
    'campaigns', 'has_activity is delivered OR read OR inbound, false only when all are absent');

  PERFORM test_support.assert_true(
    NOT campaign_fallback_due(NULL, NULL, NULL, NULL, 4, v_now),
    'campaigns', 'a missing sent_at is never due (the timer starts at sent_at, not queued_at)');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_fallback_due(now(), NULL, NULL, NULL, NULL, now())$q$,
    '23514', 'campaigns', 'a NULL fallback window raises (the campaign default of 4 is passed in, never guessed)');

  PERFORM test_support.assert_true(
    campaign_fallback_allowed(NULL, v_now),
    'campaigns', 'no previous fallback means allowed');
  PERFORM test_support.assert_true(
    campaign_fallback_allowed(v_now - INTERVAL '25 hours', v_now),
    'campaigns', 'a fallback 25h ago allows the next one');
  PERFORM test_support.assert_true(
    NOT campaign_fallback_allowed(v_now - INTERVAL '23 hours', v_now),
    'campaigns', 'ACCEPTANCE: at most one fallback per person per 24h (23h ago blocks)');
  PERFORM test_support.assert_true(
    NOT campaign_fallback_allowed(v_now - INTERVAL '25 hours', NULL),
    'campaigns', 'a NULL tick time allows nothing');
END $$;

-- ---------------------------------------------------------------------------
-- 74.6  TEMPLATE GATE. Unapproved WhatsApp cannot run (US-C1 AC4).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM campaign_template_allowed('whatsapp', 'pending_provider', NULL);
  PERFORM test_support.assert_true(
    r.allowed = false AND r.reason IS NOT NULL, 'campaigns',
    'ACCEPTANCE: WhatsApp with approval_status != approved cannot run');

  SELECT * INTO r FROM campaign_template_allowed('whatsapp', 'approved', NULL);
  PERFORM test_support.assert_true(
    r.allowed = false, 'campaigns',
    'approved without a provider_template_id still cannot run');

  SELECT * INTO r FROM campaign_template_allowed('whatsapp', 'approved', 'meta-tpl-1');
  PERFORM test_support.assert_true(
    r.allowed = true AND r.reason IS NULL, 'campaigns',
    'approved WhatsApp with a provider id runs');

  SELECT * INTO r FROM campaign_template_allowed('sms', 'draft', NULL);
  PERFORM test_support.assert_true(r.allowed = true, 'campaigns',
    'SMS is free-form: no approval gate');
  SELECT * INTO r FROM campaign_template_allowed('email', 'draft', NULL);
  PERFORM test_support.assert_true(r.allowed = true, 'campaigns',
    'email is free-form: no approval gate');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM campaign_template_allowed('pigeon', 'approved', 'x')$q$,
    '23514', 'campaigns', 'unknown channel raises check_violation');

  -- The seed honours the gate: nothing seeded may send on WhatsApp yet.
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM message_templates
      WHERE channel = 'whatsapp' AND approval_status = 'approved') = 0, 'campaigns',
    'no seeded WhatsApp template is approved: the gate has something to hold');
END $$;

-- ---------------------------------------------------------------------------
-- 74.7  QUIET HOURS. 20:00-07:00 Africa/Lagos shifts to 08:00 (OQ-R6).
-- Lagos in October is UTC+1 (no DST): pinned as instants, not renderings.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 21:30:00+01'::timestamptz, 'Africa/Lagos', false),
    '2026-10-21 08:00:00+01'::timestamptz, 'campaigns',
    '21:30 Lagos moves to 08:00 the next morning');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 20:00:00+01'::timestamptz, 'Africa/Lagos', false),
    '2026-10-21 08:00:00+01'::timestamptz, 'campaigns',
    'the 20:00 boundary is quiet (moves to next-morning 08:00)');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 03:00:00+01'::timestamptz, 'Africa/Lagos', false),
    '2026-10-20 08:00:00+01'::timestamptz, 'campaigns',
    '03:00 Lagos moves to 08:00 the same morning');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 07:00:00+01'::timestamptz, 'Africa/Lagos', false),
    '2026-10-20 07:00:00+01'::timestamptz, 'campaigns',
    'the 07:00 boundary is already sendable (quiet ends at 07:00)');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 12:00:00+01'::timestamptz, 'Africa/Lagos', false),
    '2026-10-20 12:00:00+01'::timestamptz, 'campaigns',
    'midday passes through untouched');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 21:30:00+01'::timestamptz, 'Africa/Lagos', true),
    '2026-10-20 21:30:00+01'::timestamptz, 'campaigns',
    'operational_essential passes through quiet hours (service/meeting reminders)');

  PERFORM test_support.assert_instant(
    campaign_shift_quiet_hours('2026-10-20 21:30:00+01'::timestamptz, '', false),
    '2026-10-21 08:00:00+01'::timestamptz, 'campaigns',
    'an empty timezone falls back to Africa/Lagos, never to UTC');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_shift_quiet_hours(NULL, 'Africa/Lagos', false)$q$,
    '23514', 'campaigns', 'a NULL scheduled time raises');
END $$;

-- ---------------------------------------------------------------------------
-- 74.8  CAPS. Marketing ≤3/week; the writer counts, this rule decides.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    campaign_within_cap(0, 3) AND campaign_within_cap(2, 3), 'campaigns',
    'below the weekly cap sends');
  PERFORM test_support.assert_true(
    NOT campaign_within_cap(3, 3), 'campaigns',
    'ACCEPTANCE: at the cap (3/3) the next marketing send is held as over_cap');
  PERFORM test_support.assert_true(
    campaign_within_cap(0, 0) = false, 'campaigns',
    'a zero cap holds everything (a paused-by-budget campaign)');

  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_within_cap(NULL, 3)$q$,
    '23514', 'campaigns', 'NULL window counts raise');
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT campaign_within_cap(0, -1)$q$,
    '23514', 'campaigns', 'negative caps raise');
END $$;

-- ---------------------------------------------------------------------------
-- 74.9  ALLOWLIST. Predicate vocabulary in, raw SQL never.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_audience uuid;
BEGIN
  -- Every allowlisted key together is accepted.
  INSERT INTO campaign_audiences (name, audience_type, filter)
  VALUES ('suite 74.9 full vocabulary', 'query',
    '{"consent_sms": true, "consent_whatsapp": true, "status": "active", "is_minor": false, "date_of_birth_range": ["2000-01-01", "2010-01-01"], "wedding_date_range": ["2020-01-01", "2026-01-01"], "last_contact_at_before": "2026-09-01", "days_in_stage": 14}')
  RETURNING id INTO v_audience;

  PERFORM test_support.assert_true(
    campaign_filter_keys_valid('{}'::jsonb), 'campaigns',
    'an empty filter is valid (no predicate, no risk)');
  PERFORM test_support.assert_true(
    NOT campaign_filter_keys_valid('["consent_sms"]'::jsonb), 'campaigns',
    'a non-object filter is invalid');

  -- One smuggled key rejects the whole row at write.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO campaign_audiences (name, audience_type, filter) VALUES ('suite 74.9 smuggle', 'query', '{"consent_sms": true, "branch": "ikeja"}')$q$,
    '23514', 'campaigns', 'ACCEPTANCE: a non-allowlist filter key is rejected at write (no raw SQL reaches the resolver)');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO campaign_audiences (name, audience_type, filter) VALUES ('suite 74.9 order-by', 'query', '{"order_by": "phone"}')$q$,
    '23514', 'campaigns', 'an ordering smuggle is rejected the same way');

  DELETE FROM campaign_audiences WHERE id = v_audience;
END $$;

-- ---------------------------------------------------------------------------
-- 74.10 GUARDS. The app identity runs the lifecycle -- and nothing else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_campaign uuid;
BEGIN
  SELECT id INTO v_campaign FROM campaigns WHERE key = 'weekly_memory_verse';

  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campaigns$q$,
    'campaigns', 'directus_app reads campaigns');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campaign_steps$q$,
    'campaigns', 'directus_app reads steps');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campaign_audiences$q$,
    'campaigns', 'directus_app reads audiences');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM campaign_runs$q$,
    'campaigns', 'directus_app reads runs');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM communication_channels$q$,
    'campaigns', 'directus_app reads channels');

  -- Lifecycle reads use explicit columns: contact_key is area/super only.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT id, campaign, state, next_step_at FROM campaign_enrollments$q$,
    'campaigns', 'directus_app reads enrollments without the contact hash');
  PERFORM test_support.assert_raises('directus_app',
    $q$SELECT contact_key FROM campaign_enrollments$q$,
    '42501', 'campaigns', 'directus_app cannot read contact_key (§5.1: it is a hash of contact data)');

  -- The kill switch is flippable without a deploy: the one channel write.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE communication_channels SET enabled = enabled WHERE key = 'sms'$q$,
    'campaigns', 'directus_app flips the channel kill switch (no deploy needed)');
  PERFORM test_support.assert_raises('directus_app',
    $q$INSERT INTO communication_channels (key, name) VALUES ('rogue', 'Rogue')$q$,
    '42501', 'campaigns', 'directus_app cannot mint a channel around the review path');

  -- Enrolment advance is allowed: state machine columns only. The probe
  -- harness discards its own writes, so the row below is written persistently
  -- first and every probe after it operates on a real row.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO campaign_enrollments (campaign, person, source_event, state, idempotency_key) VALUES ('$q$ || v_campaign::text || $q$', gen_random_uuid(), 'suite 74.10', 'active', 'enroll:74-10:guard')$q$,
    'campaigns', 'directus_app inserts the resolved enrolment row');

  INSERT INTO campaign_enrollments
    (campaign, person, source_event, state, idempotency_key)
  VALUES
    (v_campaign, gen_random_uuid(), 'suite 74.10 row', 'active',
     'enroll:74-10:guard-row');

  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE campaign_enrollments SET state = 'paused' WHERE idempotency_key = 'enroll:74-10:guard-row'$q$,
    'campaigns', 'directus_app advances enrolment state (pause holds the row)');

  -- Frozen keys are not rewritable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE campaign_enrollments SET idempotency_key = 'enroll:edited' WHERE idempotency_key = 'enroll:74-10:guard-row'$q$,
    '42501', 'campaigns', 'directus_app cannot rewrite an idempotency key');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE campaign_enrollments SET contact_key = 'hash:edited' WHERE idempotency_key = 'enroll:74-10:guard-row'$q$,
    '42501', 'campaigns', 'directus_app cannot rewrite a contact hash');

  -- Nothing here is deletable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campaign_enrollments WHERE idempotency_key = 'enroll:74-10:guard-row'$q$,
    '42501', 'campaigns', 'directus_app cannot delete enrolments');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campaign_runs WHERE status = 'running'$q$,
    '42501', 'campaigns', 'directus_app cannot delete runs');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM campaigns WHERE key = 'weekly_memory_verse'$q$,
    '42501', 'campaigns', 'directus_app cannot delete campaigns (archived, never deleted)');

  DELETE FROM campaign_enrollments
   WHERE idempotency_key IN ('enroll:74-10:guard-row');
END $$;

-- ---------------------------------------------------------------------------
-- 74.11 ACCEPTANCE, as queries over the suite's own rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_enroll integer;
  v_dup_sends integer;
BEGIN
  SELECT count(*) INTO v_dup_enroll
    FROM (SELECT idempotency_key FROM campaign_enrollments
           GROUP BY idempotency_key HAVING count(*) > 1) d;
  PERFORM test_support.assert_true(v_dup_enroll = 0, 'campaigns',
    'ACCEPTANCE: zero duplicate enrollments per idempotency key');

  SELECT count(*) INTO v_dup_sends
    FROM (SELECT campaign_send_key FROM communication_recipients
           WHERE campaign_send_key IS NOT NULL
           GROUP BY campaign_send_key HAVING count(*) > 1) d;
  PERFORM test_support.assert_true(v_dup_sends = 0, 'campaigns',
    'ACCEPTANCE: zero duplicate sends per recipient key (replayed ticks create nothing)');
END $$;

-- ---------------------------------------------------------------------------
-- 74.12 RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0006_campaigns.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaigns) = 9, 'campaigns',
    'rerun: still nine campaigns (ON CONFLICT DO NOTHING, board edits intact)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM communication_channels) = 3, 'campaigns',
    'rerun: still three channels');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaigns WHERE status <> 'draft') = 0, 'campaigns',
    'rerun: reseeding approves and activates nothing');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_proc
      WHERE proname IN ('campaign_send_key', 'campaign_has_activity',
        'campaign_fallback_due', 'campaign_fallback_allowed',
        'campaign_template_allowed', 'campaign_tick_hold',
        'campaign_within_cap', 'campaign_shift_quiet_hours',
        'campaign_filter_keys_valid', 'campaign_due_enrollments')) = 10, 'campaigns',
    'rerun: all ten tick rules still present (OR REPLACE is a no-op)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM campaign_enrollments WHERE idempotency_key LIKE 'enroll:74-%') = 0
    AND (SELECT count(*) FROM campaigns WHERE key LIKE 'test-74-%') = 0, 'campaigns',
    'rerun: the suite cleaned its rows and the migration seeds no test rows');
END $$;
