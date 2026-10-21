-- tests/db/73_event_invites.sql
--
-- AFC-480 / AFC-464 (ADR-0009 decisions 1-2). THE INVITATION GATE CONTRACT.
--
-- Member event invitations (data-model-v4 §3, prd-addendum-v4 §3 + US-E1..E4):
--
--   73.1  schema         -- event_invites with every §3.1 field and the §6
--                         indexes; the status enum; the three pure gates; the
--                         two FKs this slice owns under the 0004 merge
--                         contract (consent_records.related_invite,
--                         communications.event_invite); directus_users/events
--                         deltas skipped loudly in the scratch DB (neither
--                         host table exists there -- the Directus collection
--                         spec stays the authority, 0002 §10 pattern).
--   73.2  rate gate      -- invite_rate_gate() over the limit matrix: within
--                         limits -> no approval; at/over daily or weekly ->
--                         blocked_rate_limit + approval; NULL or negative
--                         inputs raise (a gate that guesses on bad input is
--                         not a gate).
--   73.3  eligibility    -- invite_eligibility(): minor without guardian
--                         rejected first (even on an eligible event), then
--                         the invite_eligible flag, then the branch-private
--                         same-branch rule; unknown age band raises.
--   73.4  suppression    -- invite_contact_suppressed(): a STOP denial on
--                         ANY messaging channel suppresses ALL sends to the
--                         number; a granted row or an unknown hash does not
--                         suppress; staff cannot override (no parameter).
--   73.5  acceptance     -- THE ISSUE ACCEPTANCE, as queries: a minor
--                         without a guardian number is rejected AT CREATION;
--                         an over-limit invite is created blocked_rate_limit
--                         with approval_required, never queued; a suppressed
--                         number is excluded from every re-queue query.
--   73.6  guards         -- the app identity inserts the resolved row and
--                         advances send state, and is refused (42501) on
--                         frozen-column UPDATEs, on any DELETE, and on
--                         frozen-column rewrites.
--   73.7  rerun          -- re-applying 20261020_0005 changes nothing
--                         (IF NOT EXISTS / OR REPLACE / conditional FKs;
--                         invite and function counts identical).
--
-- What this suite does NOT assert (stated, not missing): the HTTP half --
-- the member-vs-staff read split, phone redaction, preview-before-queue
-- and retry-once-idempotent -- lives in the route layer (redacted phone,
-- status-only for members; filter/export/retry for staff, per
-- data-model-v4 §5.1) and is covered by the web contract test. A SQL suite
-- asserting HTTP status codes would be testing the wrong layer. The
-- campaign tick, Flows and the member OTP path are tracks (c)/(d).

-- ---------------------------------------------------------------------------
-- 73.1  SCHEMA. The table, the enum, the gates, the owned FKs.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_idx integer;
BEGIN
  -- The CHECK is the enum: every §3.1 status inserts, anything else does not.
  -- Pinned directly below instead of via a catalog enum.
  PERFORM test_support.assert_true(
    to_regclass('public.event_invites') IS NOT NULL, 'invites',
    'event_invites exists');

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'event_invites';
  PERFORM test_support.assert_true(v_idx >= 7, 'invites',
    'event_invites carries the §6 index set (found ' || v_idx::text || ')');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invite_rate_gate'), 'invites',
    'invite_rate_gate() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invite_eligibility'), 'invites',
    'invite_eligibility() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'invite_contact_suppressed'), 'invites',
    'invite_contact_suppressed() exists');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_related_invite_fkey'), 'invites',
    'consent_records.related_invite FK added under the 0004 merge contract');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_event_invite_fkey'), 'invites',
    'communications.event_invite FK added under the 0004 merge contract');

  -- Scratch DB has neither host table: the deltas were skipped loudly and
  -- the Directus collection spec stays the authority (0002 §10 pattern).
  PERFORM test_support.assert_true(
    to_regclass('public.directus_users') IS NULL, 'invites',
    'scratch has no directus_users: member/limit columns skipped, not forked');
  -- AFC-566: events is no longer absent -- 20261020_0021 created the
  -- register WITH the invite deltas, so the no-fork invariant is now pinned
  -- positively: the table present carries the owning migration's full shape
  -- (route columns 0005 would never create, e.g. title/status, plus the
  -- invite_eligible flag set), proving 0005's conditional ALTERs met a real
  -- register, never a fork of their own making.
  PERFORM test_support.assert_true(
    to_regclass('public.events') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'title')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'status')
    AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'events'
                   AND column_name = 'invite_eligible'), 'invites',
    'events is 0021-owned with the full register shape incl. invite deltas (0005 met it, never forked it)');
END $$;

-- Every §3.1 status inserts; anything outside the enum does not.
DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['pending_approval','queued','sent','delivered',
      'failed','blocked_optout','blocked_rate_limit','withdrawn','registered']
  LOOP
    IF s IN ('pending_approval', 'blocked_optout', 'blocked_rate_limit', 'failed') THEN
      INSERT INTO event_invites
        (event, inviter_person, inviter_user, invitee_name, invitee_phone,
         invitee_contact_hash, status, approval_required, blocked_reason)
      VALUES
        (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
         'Status ' || s, '+2348010000001', 'hash:73-status-' || s,
         s, true, 'suite 73.1 seed: ' || s);
    ELSE
      INSERT INTO event_invites
        (event, inviter_person, inviter_user, invitee_name, invitee_phone,
         invitee_contact_hash, status)
      VALUES
        (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
         'Status ' || s, '+2348010000001', 'hash:73-status-' || s, s);
    END IF;
  END LOOP;

  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_invites WHERE invitee_contact_hash LIKE 'hash:73-status-%') = 9, 'invites',
    'all nine §3.1 statuses insert');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Bogus', '+2348010000002', 'hash:73-bogus', 'teleported')$q$,
    '23514', 'invites', 'a status outside the §3.1 enum is rejected');

  DELETE FROM event_invites WHERE invitee_contact_hash LIKE 'hash:73-status-%';
END $$;

-- ---------------------------------------------------------------------------
-- 73.2  RATE GATE. Counts in, verdict out; no guessing on bad input.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- Within limits: no approval, no block.
  SELECT * INTO r FROM invite_rate_gate(0, 0, 10, 50);
  PERFORM test_support.assert_true(
    r.requires_approval = false AND r.blocked_status IS NULL AND r.blocked_reason IS NULL, 'invites',
    'a quiet member (0/0 against 10/50) needs no approval');

  SELECT * INTO r FROM invite_rate_gate(9, 49, 10, 50);
  PERFORM test_support.assert_true(
    r.requires_approval = false AND r.blocked_status IS NULL, 'invites',
    'one below each limit (9/49 against 10/50) is still within limits');

  -- At the daily limit: blocked, approval required, reason names the limit.
  SELECT * INTO r FROM invite_rate_gate(10, 10, 10, 50);
  PERFORM test_support.assert_true(
    r.requires_approval = true AND r.blocked_status = 'blocked_rate_limit'
    AND r.blocked_reason IS NOT NULL, 'invites',
    'at the daily limit (10/10) the invite is blocked_rate_limit + approval');

  -- Over the weekly limit with a quiet day: still blocked (rolling week).
  SELECT * INTO r FROM invite_rate_gate(2, 50, 10, 50);
  PERFORM test_support.assert_true(
    r.requires_approval = true AND r.blocked_status = 'blocked_rate_limit', 'invites',
    'at the weekly limit (2 today, 50 this week) the invite is blocked');

  -- Custom per-member limits are honoured, not just the defaults.
  SELECT * INTO r FROM invite_rate_gate(3, 3, 3, 50);
  PERFORM test_support.assert_true(
    r.requires_approval = true AND r.blocked_status = 'blocked_rate_limit', 'invites',
    'a custom daily limit of 3 blocks the 4th invite');

  -- Bad input raises check_violation rather than guessing.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM invite_rate_gate(NULL, 0, 10, 50)$q$,
    '23514', 'invites', 'NULL window counts raise');
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM invite_rate_gate(0, 0, NULL, 50)$q$,
    '23514', 'invites', 'NULL limits raise');
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM invite_rate_gate(-1, 0, 10, 50)$q$,
    '23514', 'invites', 'negative counts raise');
END $$;

-- ---------------------------------------------------------------------------
-- 73.3  ELIGIBILITY. Minor rule first, then event flags, then the branch
-- rule. No override parameter to try -- the function has none.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_branch_a uuid := gen_random_uuid();
  v_branch_b uuid := gen_random_uuid();
BEGIN
  -- Adult, eligible public event: open to any member.
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_b, 'public', 'adult', false);
  PERFORM test_support.assert_true(
    r.eligible = true AND r.blocked_reason IS NULL, 'invites',
    'adult on an eligible public event is eligible across branches');

  -- Minor without guardian: rejected even on a fully eligible event.
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_a, 'public', 'child', false);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'minor_no_guardian_consent', 'invites',
    'child without a guardian number is rejected at creation');
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_a, 'public', 'teen', false);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'minor_no_guardian_consent', 'invites',
    'teen without a guardian number is rejected at creation');

  -- Minor WITH guardian: the event flags decide.
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_a, 'public', 'child', true);
  PERFORM test_support.assert_true(
    r.eligible = true AND r.blocked_reason IS NULL, 'invites',
    'child with a guardian number is eligible on an eligible event');

  -- The invite_eligible flag gates everything non-minor too.
  SELECT * INTO r FROM invite_eligibility(false, v_branch_a, v_branch_a, 'public', 'adult', false);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'event_not_invite_eligible', 'invites',
    'an event with invite_eligible = false admits nobody');
  SELECT * INTO r FROM invite_eligibility(false, v_branch_a, v_branch_a, 'public', 'child', true);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'event_not_invite_eligible', 'invites',
    'guardian consent does not override the event flag');

  -- Branch-private events need a same-branch inviter (OQ-R11).
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_b, 'branch', 'adult', false);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'branch_private_requires_same_branch_inviter', 'invites',
    'cross-branch inviter on a branch-private event is rejected');
  SELECT * INTO r FROM invite_eligibility(true, v_branch_a, v_branch_a, 'branch', 'adult', false);
  PERFORM test_support.assert_true(
    r.eligible = true AND r.blocked_reason IS NULL, 'invites',
    'same-branch inviter on a branch-private event is eligible');
  SELECT * INTO r FROM invite_eligibility(true, NULL, v_branch_b, 'branch', 'adult', false);
  PERFORM test_support.assert_true(
    r.eligible = false AND r.blocked_reason = 'branch_private_requires_same_branch_inviter', 'invites',
    'an inviter with no branch cannot invite to a branch-private event');

  -- Unknown age band: a loud error, not a silent rule choice.
  PERFORM test_support.assert_raises(NULL,
    $q$SELECT * FROM invite_eligibility(true, NULL, NULL, 'public', 'toddler', false)$q$,
    '23514', 'invites', 'unknown age band raises check_violation');
END $$;

-- ---------------------------------------------------------------------------
-- 73.4  SUPPRESSION. One STOP suppresses every later send to the number.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A STOP denial on WhatsApp ...
  INSERT INTO consent_records (contact_hash, channel, granted, consent_type, basis, method)
  VALUES ('hash:73-stopped', 'whatsapp', false, 'channel', 'not_applicable', 'digital');

  PERFORM test_support.assert_true(
    invite_contact_suppressed('hash:73-stopped') = true, 'invites',
    'a STOP denial suppresses the number (channel-agnostic: one STOP stops every later send)');

  -- ... while a granted row and an unknown hash do not suppress.
  INSERT INTO consent_records (contact_hash, channel, granted, consent_type, basis, method)
  VALUES ('hash:73-consented', 'sms', true, 'channel', 'explicit_opt_in', 'digital');

  PERFORM test_support.assert_true(
    invite_contact_suppressed('hash:73-consented') = false, 'invites',
    'a granted consent row does not suppress');
  PERFORM test_support.assert_true(
    invite_contact_suppressed('hash:73-never-seen') = false, 'invites',
    'an unknown number is not suppressed');
  PERFORM test_support.assert_true(
    invite_contact_suppressed(NULL) = false, 'invites',
    'NULL contact hash is not suppressed');

  -- An SMS-channel denial suppresses too: suppression is per number, not
  -- per channel.
  INSERT INTO consent_records (contact_hash, channel, granted, consent_type, basis, method)
  VALUES ('hash:73-stopped-sms', 'sms', false, 'channel', 'not_applicable', 'verbal_recorded');
  PERFORM test_support.assert_true(
    invite_contact_suppressed('hash:73-stopped-sms') = true, 'invites',
    'an SMS-channel denial suppresses the number as well');
END $$;

-- ---------------------------------------------------------------------------
-- 73.5  ACCEPTANCE. The three properties the issue demands, as queries over
-- rows written the way the Flow and the route must write them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_eligible integer;
BEGIN
  -- (a) Minor without guardian rejected AT CREATION -- the CHECK, directly.
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, invitee_age_band, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Minor No Guardian', '+2348010000003', 'hash:73-minor', 'child', 'queued')$q$,
    '23514', 'invites', 'ACCEPTANCE: child invite without a guardian number is rejected at creation');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, invitee_age_band, guardian_phone, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Minor Blank Guardian', '+2348010000003', 'hash:73-minor-blank', 'teen', '  ', 'queued')$q$,
    '23514', 'invites', 'ACCEPTANCE: teen invite with a blank guardian number is rejected at creation');

  -- A minor WITH a guardian number is created, never silently dropped.
  INSERT INTO event_invites
    (event, inviter_person, inviter_user, invitee_name, invitee_phone,
     invitee_contact_hash, invitee_age_band, guardian_phone, status)
  VALUES
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
     'Minor With Guardian', '+2348090000003', 'hash:73-minor-ok',
     'child', '+2348090000004', 'queued');

  -- (b) Over-limit -> blocked_rate_limit + approval, never queued.
  INSERT INTO event_invites
    (event, inviter_person, inviter_user, invitee_name, invitee_phone,
     invitee_contact_hash, status, approval_required, blocked_reason)
  VALUES
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
     'Over Limit', '+2348010000004', 'hash:73-over-limit',
     'blocked_rate_limit', true,
     'member invite limit reached: sent 10 in the last 24h (limit 10), 10 in the last 7 days (limit 50); branch-admin approval required');

  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, status, approval_required) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Blocked No Reason', '+2348010000005', 'hash:73-no-reason', 'blocked_rate_limit', true)$q$,
    '23514', 'invites', 'a blocked invite without a blocked_reason is rejected');
  PERFORM test_support.assert_raises(NULL,
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, status, approval_required) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Approval No Flag', '+2348010000006', 'hash:73-no-flag', 'pending_approval', false)$q$,
    '23514', 'invites', 'pending_approval without approval_required is rejected');

  -- (c) A suppressed number is never re-queued: the re-queue query the send
  -- path runs excludes it.
  INSERT INTO event_invites
    (event, inviter_person, inviter_user, invitee_name, invitee_phone,
     invitee_contact_hash, status)
  VALUES
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
     'Stopped Person', '+2348070000007', 'hash:73-stopped', 'queued'),
    (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
     'Fine Person', '+2348070000008', 'hash:73-consented', 'queued');

  SELECT count(*) INTO v_eligible FROM event_invites
   WHERE status = 'queued'
     AND NOT invite_contact_suppressed(invitee_contact_hash);
  PERFORM test_support.assert_true(v_eligible = 2, 'invites',
    'ACCEPTANCE: the re-queue query returns the live numbers only -- the STOP number (hash:73-stopped) is excluded, the consented one is kept (found '
    || v_eligible::text || ')');

  DELETE FROM event_invites WHERE invitee_contact_hash IN ('hash:73-minor-ok', 'hash:73-over-limit', 'hash:73-stopped', 'hash:73-consented');
END $$;

-- ---------------------------------------------------------------------------
-- 73.6  GUARDS. The app identity inserts the resolved row and advances send
-- state -- and nothing else.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM event_invites$q$,
    'invites', 'directus_app reads the invite log');

  -- Inserts the resolved row (preview-then-confirm writes WITH the message).
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO event_invites (event, inviter_person, inviter_user, invitee_name, invitee_phone, invitee_contact_hash, invitee_age_band, channel_choice, consent_basis, message_template, message_rendered, variables_snapshot, status) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'Guard Adult', '+2348010000009', 'hash:73-guard', 'adult', 'auto', 'inviter_vouched', NULL, 'Dear Guard, you are invited', '{}', 'queued')$q$,
    'invites', 'directus_app inserts the resolved invite row');

  -- Advances send state: status + approval + links.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE event_invites SET status = 'sent' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    'invites', 'directus_app advances queued invites to sent');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE event_invites SET status = 'blocked_rate_limit', approval_required = true, blocked_reason = 'suite 73.6' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    'invites', 'directus_app marks over-limit invites blocked with a reason');

  -- The frozen columns are not updatable through the app identity: a
  -- correction is a new invite via retry_of, not an edit.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE event_invites SET message_rendered = 'edited' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot rewrite rendered text');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE event_invites SET consent_basis = 'explicit_opt_in' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot rewrite the stored basis');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE event_invites SET invitee_phone = '+2348000000000' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot rewrite the invitee number');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE event_invites SET invitee_contact_hash = 'hash:edited' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot rewrite the contact hash');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE event_invites SET variables_snapshot = '{}' WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot rewrite the variables snapshot');

  -- Nothing in the log is deletable through the app identity.
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM event_invites WHERE invitee_contact_hash = 'hash:73-guard'$q$,
    '42501', 'invites', 'directus_app cannot delete invite rows');

  DELETE FROM event_invites WHERE invitee_contact_hash = 'hash:73-guard';
END $$;

-- ---------------------------------------------------------------------------
-- 73.7  RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0005_event_invites.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.event_invites') IS NOT NULL, 'invites',
    'rerun: event_invites still exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consent_records_related_invite_fkey')
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_event_invite_fkey'), 'invites',
    'rerun: both owned FKs still present (conditional, idempotent)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_proc WHERE proname IN ('invite_rate_gate', 'invite_eligibility', 'invite_contact_suppressed')) = 3, 'invites',
    'rerun: all three gates still present (OR REPLACE is a no-op)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM event_invites WHERE invitee_contact_hash LIKE 'hash:73-%') = 0, 'invites',
    'rerun: reseeding inserts nothing -- the suite cleaned its rows and the migration seeds none');
END $$;
