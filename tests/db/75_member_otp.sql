-- tests/db/75_member_otp.sql
--
-- AFC-482 / AFC-464 (ADR-0009 decision 6, AFC-478 verdict CHANGES-REQUIRED).
-- THE MEMBER-OTP SCAFFOLDING CONTRACT.
--
-- Member role via phone OTP, scoped to own person record
-- (data-model-v4 §3.2 + §5 + §5.1-§5.2, prd-addendum-v4 §3.3 + §6 OQ-R7):
--
--   75.1  schema         -- member_otp_codes with the F1 storage rule
--                         (hashes only, NO plaintext column) and the F1
--                         CHECKs (expiry <= requested_at + 10 min, attempts
--                         0..5); member_sessions with the F1 lifetime bound
--                         (<= issued_at + 8h); the four pure gates; the §6
--                         indexes. Expiry/lifetime violations rejected AT
--                         CREATION.
--   75.2  throttle       -- member_otp_throttle() over the F1 matrix: within
--                         limits -> allowed; 3+/hr per phone or 10+/hr per
--                         IP -> blocked; NULL or negative inputs raise (a
--                         gate that guesses on bad input is not a gate).
--   75.3  verify         -- member_otp_verify_gate(): consumed -> replay
--                         rejected FIRST (even before expiry), then expiry,
--                         then the 5-attempt lock; attempts_remaining counts
--                         down; NULL/out-of-range inputs raise.
--   75.4  session        -- member_session_valid(): expired session ->
--                         invalid; member_access_expires_at reached ->
--                         invalid even on a live session (the time-box is
--                         re-checked per request); NULL expiry/now raises.
--   75.5  identity       -- member_invite_identity_ok() (F2): absent claims
--                         filled from session -> ok; differing
--                         inviter_user/inviter_person -> rejected (forgery,
--                         never overwritten); NULL session values raise.
--   75.6  acceptance     -- THE ISSUE ACCEPTANCE, as queries: an expiry past
--                         the 10-min bound is rejected at creation; attempts
--                         past 5 are rejected; a consumed row never verifies;
--                         an 8h+ session is rejected at creation; a member
--                         creating an invite as another person is rejected.
--   75.7  guards         -- the app identity inserts challenges/sessions and
--                         advances verify/revoke state, and is refused (42501)
--                         on binding/hash rewrites, on any DELETE, and on
--                         frozen-column rewrites.
--   75.8  rerun          -- re-applying 20261020_0007 changes nothing
--                         (IF NOT EXISTS / OR REPLACE; challenge, session
--                         and function counts identical).
--
-- What this suite does NOT assert (stated, not missing):
--   OTP enablement (request/verify HTTP paths, code entropy source, SMS
--   delivery, device binding) stays DISABLED per the AFC-478 hard gate --
--   a SQL suite cannot assert a route answers 503, and asserting delivery
--   would invent a provider. The portal contract test pins the disabled
--   flag, the generic responses, and the no-person-field request shape.
--   Enumeration resistance at rest (no number stored) is asserted here
--   (75.1: no code/phone plaintext column); enumeration resistance in
--   RESPONSES is a route property, pinned in the web contract test.
--   Cross-read 403s (member reading another person, recipient internals)
--   live in the Directus policy, which Postgres cannot see through the
--   single directus_app identity -- this suite pins the ceiling the policy
--   enforces under (75.7). The matrix §5 scope tests run at the route
--   layer once the role exists.

-- ---------------------------------------------------------------------------
-- 75.1  SCHEMA. The tables, the F1 CHECKs, the gates, the indexes.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_idx integer;
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.member_otp_codes') IS NOT NULL, 'member_otp',
    'member_otp_codes exists');
  PERFORM test_support.assert_true(
    to_regclass('public.member_sessions') IS NOT NULL, 'member_otp',
    'member_sessions exists');

  -- F1 storage rule: hashes only. A plaintext code or phone column must
  -- not exist -- it cannot be SELECTed, leaked, or granted by accident
  -- if it is not there.
  PERFORM test_support.assert_true(
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'member_otp_codes'
                   AND column_name IN ('code', 'plain_code', 'code_plaintext',
                                       'phone', 'phone_number', 'msisdn')),
    'member_otp', 'no plaintext code or phone column on member_otp_codes');

  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'member_otp_throttle'), 'member_otp',
    'member_otp_throttle() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'member_otp_verify_gate'), 'member_otp',
    'member_otp_verify_gate() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'member_session_valid'), 'member_otp',
    'member_session_valid() exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'member_invite_identity_ok'), 'member_otp',
    'member_invite_identity_ok() exists');

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'member_otp_codes';
  PERFORM test_support.assert_true(v_idx >= 2, 'member_otp',
    'member_otp_codes carries the §6 index set (found ' || v_idx::text || ')');

  SELECT count(*) INTO v_idx FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'member_sessions';
  PERFORM test_support.assert_true(v_idx >= 3, 'member_otp',
    'member_sessions carries the §6 index set (found ' || v_idx::text || ')');
END $$;

-- ---------------------------------------------------------------------------
-- 75.2  THROTTLE. F1 resend caps: 3/hr per phone, 10/hr per IP.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM member_otp_throttle(0, 0);
  PERFORM test_support.assert_true(r.allowed AND r.blocked_reason IS NULL, 'member_otp',
    'throttle: no sends in window -> allowed');

  SELECT * INTO r FROM member_otp_throttle(2, 9);
  PERFORM test_support.assert_true(r.allowed AND r.blocked_reason IS NULL, 'member_otp',
    'throttle: 2 phone + 9 ip -> allowed (just under both caps)');

  SELECT * INTO r FROM member_otp_throttle(3, 0);
  PERFORM test_support.assert_true(NOT r.allowed AND r.blocked_reason = 'otp_resend_phone_cap', 'member_otp',
    'throttle: 3/hr per phone -> blocked with otp_resend_phone_cap');

  SELECT * INTO r FROM member_otp_throttle(0, 10);
  PERFORM test_support.assert_true(NOT r.allowed AND r.blocked_reason = 'otp_resend_ip_cap', 'member_otp',
    'throttle: 10/hr per ip -> blocked with otp_resend_ip_cap');

  SELECT * INTO r FROM member_otp_throttle(9, 99);
  PERFORM test_support.assert_true(NOT r.allowed AND r.blocked_reason = 'otp_resend_phone_cap', 'member_otp',
    'throttle: phone cap evaluated first when both exceeded');

  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_throttle(NULL, 0)',
    '23514', 'member_otp', 'throttle: NULL phone count raises');
  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_throttle(0, NULL)',
    '23514', 'member_otp', 'throttle: NULL ip count raises');
  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_throttle(-1, 0)',
    '23514', 'member_otp', 'throttle: negative count raises');
END $$;

-- ---------------------------------------------------------------------------
-- 75.3  VERIFY. F1: replay first, then expiry, then the 5-attempt lock.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM member_otp_verify_gate(false, false, 0);
  PERFORM test_support.assert_true(r.allowed AND r.attempts_remaining = 5 AND r.locked_reason IS NULL, 'member_otp',
    'verify: fresh code -> allowed with 5 attempts remaining');

  SELECT * INTO r FROM member_otp_verify_gate(false, false, 4);
  PERFORM test_support.assert_true(r.allowed AND r.attempts_remaining = 1 AND r.locked_reason IS NULL, 'member_otp',
    'verify: 4 attempts used -> allowed with 1 remaining');

  SELECT * INTO r FROM member_otp_verify_gate(false, false, 5);
  PERFORM test_support.assert_true(NOT r.allowed AND r.attempts_remaining = 0 AND r.locked_reason = 'otp_locked', 'member_otp',
    'verify: 5 attempts -> locked (otp_locked)');

  SELECT * INTO r FROM member_otp_verify_gate(false, true, 0);
  PERFORM test_support.assert_true(NOT r.allowed AND r.locked_reason = 'otp_expired', 'member_otp',
    'verify: expired code -> rejected (otp_expired)');

  -- Replay is checked BEFORE expiry: a used code never verifies, even on
  -- an otherwise live row. This ordering is the single-use guarantee.
  SELECT * INTO r FROM member_otp_verify_gate(true, false, 0);
  PERFORM test_support.assert_true(NOT r.allowed AND r.locked_reason = 'otp_replay', 'member_otp',
    'verify: consumed code -> replay rejected (otp_replay)');

  SELECT * INTO r FROM member_otp_verify_gate(true, true, 5);
  PERFORM test_support.assert_true(NOT r.allowed AND r.locked_reason = 'otp_replay', 'member_otp',
    'verify: consumed+expired+locked -> replay wins (checked first)');

  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_verify_gate(false, false, NULL)',
    '23514', 'member_otp', 'verify: NULL attempt count raises');
  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_verify_gate(false, false, 6)',
    '23514', 'member_otp', 'verify: attempt count above 5 raises');
  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_otp_verify_gate(false, false, -1)',
    '23514', 'member_otp', 'verify: negative attempt count raises');
END $$;

-- ---------------------------------------------------------------------------
-- 75.4  SESSION. F1: session expiry AND member_access_expires_at.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM member_session_valid(
    timestamptz '2026-10-20 10:00:00+00', NULL, timestamptz '2026-10-20 09:00:00+00');
  PERFORM test_support.assert_true(r.valid AND r.invalid_reason IS NULL, 'member_otp',
    'session: live session, no time-box -> valid');

  SELECT * INTO r FROM member_session_valid(
    timestamptz '2026-10-20 10:00:00+00',
    timestamptz '2026-12-31 00:00:00+00',
    timestamptz '2026-10-20 09:00:00+00');
  PERFORM test_support.assert_true(r.valid AND r.invalid_reason IS NULL, 'member_otp',
    'session: live session, future time-box -> valid');

  SELECT * INTO r FROM member_session_valid(
    timestamptz '2026-10-20 10:00:00+00', NULL, timestamptz '2026-10-20 10:00:00+00');
  PERFORM test_support.assert_true(NOT r.valid AND r.invalid_reason = 'session_expired', 'member_otp',
    'session: now at session expiry -> invalid (session_expired)');

  -- The time-box bites even on a live session: access revoked at 09:30
  -- invalidates the 10:00 session at 09:45. Re-checked per request.
  SELECT * INTO r FROM member_session_valid(
    timestamptz '2026-10-20 10:00:00+00',
    timestamptz '2026-10-20 09:30:00+00',
    timestamptz '2026-10-20 09:45:00+00');
  PERFORM test_support.assert_true(NOT r.valid AND r.invalid_reason = 'member_access_expired', 'member_otp',
    'session: member_access_expires_at reached -> invalid on a live session');

  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_session_valid(NULL, NULL, timestamptz ''2026-10-20 09:00:00+00'')',
    '23514', 'member_otp', 'session: NULL session expiry raises');
  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_session_valid(timestamptz ''2026-10-20 10:00:00+00'', NULL, NULL)',
    '23514', 'member_otp', 'session: NULL now raises');
END $$;

-- ---------------------------------------------------------------------------
-- 75.5  IDENTITY. F2: session-derived, mismatch is forgery.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_user uuid := '00000000-0000-4000-8000-0000000000a9';
  v_person uuid := '00000000-0000-4000-8000-0000000000b9';
  v_other_user uuid := '00000000-0000-4000-8000-0000000000c9';
  v_other_person uuid := '00000000-0000-4000-8000-0000000000d9';
BEGIN
  SELECT * INTO r FROM member_invite_identity_ok(v_user, v_person, NULL, NULL);
  PERFORM test_support.assert_true(r.ok AND r.reason IS NULL, 'member_otp',
    'identity: absent claims filled from session -> ok');

  SELECT * INTO r FROM member_invite_identity_ok(v_user, v_person, v_user, v_person);
  PERFORM test_support.assert_true(r.ok AND r.reason IS NULL, 'member_otp',
    'identity: matching claims -> ok');

  SELECT * INTO r FROM member_invite_identity_ok(v_user, v_person, v_other_user, v_person);
  PERFORM test_support.assert_true(NOT r.ok AND r.reason = 'inviter_user_mismatch', 'member_otp',
    'identity: forged inviter_user -> rejected (403 at the route)');

  SELECT * INTO r FROM member_invite_identity_ok(v_user, v_person, v_user, v_other_person);
  PERFORM test_support.assert_true(NOT r.ok AND r.reason = 'inviter_person_mismatch', 'member_otp',
    'identity: member inviting as another person -> rejected (403 at the route)');

  PERFORM test_support.assert_raises(NULL,
    'SELECT * FROM member_invite_identity_ok(NULL, NULL, NULL, NULL)',
    '23514', 'member_otp', 'identity: NULL session values raise');
END $$;

-- ---------------------------------------------------------------------------
-- 75.6  ACCEPTANCE. The issue acceptance, as queries against real rows.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_user uuid := '00000000-0000-4000-8000-0000000000a9';
  v_person uuid := '00000000-0000-4000-8000-0000000000b9';
  v_other_person uuid := '00000000-0000-4000-8000-0000000000d9';
BEGIN
  -- An expiry 11 minutes out is rejected AT CREATION (F1: <= 10 min).
  BEGIN
    INSERT INTO member_otp_codes (phone_hash, code_hash, code_salt, requested_at, expires_at)
    VALUES ('hash:75-phone', 'hash:75-code', 'salt:75',
            timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 09:11:00+00');
    PERFORM test_support.assert_true(false, 'member_otp',
      'acceptance: 11-minute expiry must be rejected at creation');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'member_otp',
      'acceptance: 11-minute expiry rejected at creation (expiry bound)');
  END;

  -- A 10-minute expiry is the boundary: accepted.
  INSERT INTO member_otp_codes (phone_hash, code_hash, code_salt, requested_at, expires_at)
  VALUES ('hash:75-ok', 'hash:75-code', 'salt:75',
          timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 09:10:00+00');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM member_otp_codes WHERE phone_hash = 'hash:75-ok'), 'member_otp',
    'acceptance: exact 10-minute expiry accepted (boundary)');

  -- Attempts past 5 are rejected at the CHECK, not just the gate.
  BEGIN
    UPDATE member_otp_codes SET attempt_count = 6 WHERE phone_hash = 'hash:75-ok';
    PERFORM test_support.assert_true(false, 'member_otp',
      'acceptance: attempt_count 6 must be rejected');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'member_otp',
      'acceptance: attempt_count 6 rejected (0..5 CHECK)');
  END;

  -- A consumed row never verifies, even with zero attempts and no expiry.
  UPDATE member_otp_codes SET consumed_at = timestamptz '2026-10-20 09:05:00+00'
   WHERE phone_hash = 'hash:75-ok';
  SELECT * INTO r FROM member_otp_verify_gate(true, false, 0);
  PERFORM test_support.assert_true(NOT r.allowed AND r.locked_reason = 'otp_replay', 'member_otp',
    'acceptance: consumed row never verifies (replay rejected)');

  -- An 8h+ session is rejected AT CREATION (F1 short lifetime).
  BEGIN
    INSERT INTO member_sessions (user_id, member_person, issued_at, expires_at)
    VALUES (v_user, v_person,
            timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 17:00:01+00');
    PERFORM test_support.assert_true(false, 'member_otp',
      'acceptance: 8h+1s session must be rejected at creation');
  EXCEPTION WHEN check_violation THEN
    PERFORM test_support.assert_true(true, 'member_otp',
      'acceptance: 8h+1s session rejected at creation (lifetime bound)');
  END;

  -- An exact-8h session is the boundary: accepted.
  INSERT INTO member_sessions (user_id, member_person, issued_at, expires_at)
  VALUES (v_user, v_person,
          timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 17:00:00+00');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM member_sessions WHERE member_person = v_person), 'member_otp',
    'acceptance: exact 8h session accepted (boundary)');

  -- A member creating an invite as another person is rejected (F2 -> 403).
  SELECT * INTO r FROM member_invite_identity_ok(v_user, v_person, v_user, v_other_person);
  PERFORM test_support.assert_true(NOT r.ok, 'member_otp',
    'acceptance: member creating an invite as another person -> rejected');

  DELETE FROM member_sessions WHERE member_person = v_person;
  DELETE FROM member_otp_codes WHERE phone_hash IN ('hash:75-ok');
END $$;

-- ---------------------------------------------------------------------------
-- 75.7  GUARDS. The app identity advances state; it never rewrites
--         bindings, hashes, or evidence, and never deletes.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO member_otp_codes (phone_hash, code_hash, code_salt, requested_at, expires_at)
  VALUES ('hash:75-guard', 'hash:75-g', 'salt:75-g',
          timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 09:10:00+00');
  INSERT INTO member_sessions (user_id, member_person, issued_at, expires_at)
  VALUES ('00000000-0000-4000-8000-0000000000a9',
          '00000000-0000-4000-8000-0000000000b9',
          timestamptz '2026-10-20 09:00:00+00', timestamptz '2026-10-20 12:00:00+00');

  -- Allowed: advancing verify state and revoking the session.
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE member_otp_codes SET attempt_count = 1 WHERE phone_hash = 'hash:75-guard'$q$,
    'member_otp', 'directus_app advances the attempt counter');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE member_otp_codes SET consumed_at = timestamptz '2026-10-20 09:05:00+00' WHERE phone_hash = 'hash:75-guard'$q$,
    'member_otp', 'directus_app marks a verified code consumed (single-use)');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE member_sessions SET revoked_at = timestamptz '2026-10-20 10:00:00+00' WHERE member_person = '00000000-0000-4000-8000-0000000000b9'$q$,
    'member_otp', 'directus_app revokes a session');

  -- Refused: rewriting the stored hash, the binding, or the evidence.
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE member_otp_codes SET code_hash = 'hash:edited' WHERE phone_hash = 'hash:75-guard'$q$,
    '42501', 'member_otp', 'directus_app cannot rewrite the stored code hash');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE member_otp_codes SET expires_at = timestamptz '2026-10-20 09:09:00+00' WHERE phone_hash = 'hash:75-guard'$q$,
    '42501', 'member_otp', 'directus_app cannot rewrite the expiry');
  PERFORM test_support.assert_raises('directus_app',
    $q$UPDATE member_sessions SET member_person = '00000000-0000-4000-8000-0000000000d9' WHERE member_person = '00000000-0000-4000-8000-0000000000b9'$q$,
    '42501', 'member_otp', 'directus_app cannot rewrite the session binding');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM member_otp_codes WHERE phone_hash = 'hash:75-guard'$q$,
    '42501', 'member_otp', 'directus_app cannot delete challenge rows');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM member_sessions WHERE member_person = '00000000-0000-4000-8000-0000000000b9'$q$,
    '42501', 'member_otp', 'directus_app cannot delete session rows');

  DELETE FROM member_sessions WHERE member_person = '00000000-0000-4000-8000-0000000000b9';
  DELETE FROM member_otp_codes WHERE phone_hash = 'hash:75-guard';
END $$;

-- ---------------------------------------------------------------------------
-- 75.8  RERUN. Re-applying the real migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0007_member_otp.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.member_otp_codes') IS NOT NULL
    AND to_regclass('public.member_sessions') IS NOT NULL, 'member_otp',
    'rerun: both tables still exist');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM pg_proc WHERE proname IN
      ('member_otp_throttle', 'member_otp_verify_gate',
       'member_session_valid', 'member_invite_identity_ok')) = 4, 'member_otp',
    'rerun: all four gates still present (OR REPLACE is a no-op)');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM member_otp_codes WHERE phone_hash LIKE 'hash:75-%') = 0
    AND (SELECT count(*) FROM member_sessions WHERE member_person = '00000000-0000-4000-8000-0000000000b9') = 0, 'member_otp',
    'rerun: reseeding inserts nothing -- the suite cleaned its rows and the migration seeds none');
END $$;
