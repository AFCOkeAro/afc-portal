-- 20261020_0007_member_otp.sql
--
-- Slice 4d: member role via phone OTP, scoped to own person record (AFC-482).
-- Spec authority: docs/adr/ADR-0009 decision 6,
-- docs/planning/data-model-v4.md §3.2 + §5 + §5.1-§5.2,
-- docs/planning/prd-addendum-v4.md §3.3 + §6 (OQ-R7). Parent: AFC-464.
--
-- HARD GATE (ADR-0009 decision 6, AFC-478 verdict CHANGES-REQUIRED):
-- OTP endpoints are NOT enabled by this file. This migration is schema +
-- disabled-behind-flag scaffolding ONLY: the tables and pure gates below
-- carry the AFC-478 F1 parameter block so the values are reviewable, but no
-- user-facing path may issue or accept OTP codes until the SecurityEngineer
-- re-review verdict lands. The portal routes (apps/web/server/utils/
-- member-otp.ts + api/auth/member-otp/*) answer 503 member_otp_disabled
-- unless NUXT_MEMBER_OTP_ENABLED=true, and flipping that flag requires the
-- re-review verdict plus CTO approval. See the F1 block below.
--
-- WHAT THIS FILE CREATES
--   member_otp_codes -- one row per issued code challenge: phone_hash (never
--     the number), code_hash + code_salt (salted sha256; NO plaintext column
--     exists anywhere in this file), requested_at, expires_at (<= 10 min
--     after requested_at, F1), attempt_count (0..5, F1: <=5 then invalidate),
--     consumed_at (single-use, F1), request_ip_hash (per-IP throttle input).
--   member_sessions  -- one row per issued member session: user_id + 
--     member_person bound server-side at issue (F2), issued_at, expires_at
--     (<= 8h after issued_at, F1 short lifetime), revoked_at. The binding
--     columns are immutable: a session never changes person.
--   member_otp_throttle() -- pure resend rule (F1): <=3/hr per phone,
--     <=10/hr per IP. No table access, no clock reads; the writer counts
--     the windows and passes the counts in (0005 invite_rate_gate pattern).
--   member_otp_verify_gate() -- pure verify rule (F1): consumed -> reject,
--     expired -> reject, attempts >= 5 -> lock, else allow with the
--     remaining-attempt count. The writer passes the row state in.
--   member_session_valid() -- pure session rule (F1): now < session
--     expires_at AND (member_access_expires_at IS NULL OR now <
--     member_access_expires_at). Re-checked on EVERY request by the route
--     layer; the DB cannot check "every request", so the rule is pure and
--     the route calls it before each read.
--   member_invite_identity_ok() -- pure F2 rule: on invite.create and any
--     consent write, inviter_user := session user and inviter_person :=
--     session member_person; a request carrying different values is
--     rejected (never silently overwritten). Returns (ok, reason).
--
-- F1 PARAMETER BLOCK (AFC-478 verdict, recorded here so it is reviewable;
-- the verdict wins over the issue description on any conflict):
--   code digits: 6, CSPRNG (generated in the route layer; the DB never sees
--     the code, only code_hash + code_salt).
--   expiry: <= 10 minutes (CHECK member_otp_codes_expiry_bound).
--   single-use: consumed_at set on first successful verify; the gate
--     rejects consumed rows before comparing anything else.
--   storage: salted hash ONLY (code_hash = sha256(code || salt)); a
--     plaintext column would fail the suite's "no plaintext" assertion.
--   attempts: <= 5 per code, then invalidate (CHECK + gate).
--   resend: <= 3/hr per phone; per-IP <= 10/hr (gate inputs).
--   session: bound server-side to exactly one member_person; lifetime <= 8h;
--     member_access_expires_at re-checked on every request.
--   device binding: explicitly DROPPED for v1 (verdict permits "specify it
--     or explicitly drop it"). The sealed httpOnly session cookie is the
--     bearer; no device fingerprint is collected or stored.
--   SIM-swap acceptance: RECORDED RISK. An OTP to a SIM-swapped number
--     reaches the attacker; this is accepted because the member role's
--     least-privilege scope (own record only, no people search, no
--     finance/welfare, internals redacted) bounds the blast radius. Owner:
--     CTO/board. Revisit if the role ever gains breadth.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   people, branches/zones, directus_users, events -- owned elsewhere.
--   member_person / member_access_expires_at / invite limits on
--   directus_users were added conditionally by 0005 §2; §2 below re-ensures
--   them (ADD COLUMN IF NOT EXISTS) where the host table exists, because
--   the member login needs the link wherever users exist. No table owned
--   by another slice is forked here: user_id / member_person are bare
--   uuids under the §5 merge contract and the owning slices add the FKs.
--   No Directus policy, no Flow, no session cookie: policy lives in the
--   Directus project, the cookie in the portal session layer.
--
-- ACCEPTANCE, ENCODED IN SCHEMA (§4 CHECKs, pinned by suite 75):
--   a code row with an expiry beyond requested_at + 10 min is rejected at
--   creation; attempts beyond 5 are rejected; a consumed row never
--   verifies (gate returns locked before any comparison); a session row
--   outliving issued_at + 8h is rejected at creation; the session binding
--   (user_id, member_person) is immutable (no UPDATE grant).
--
-- RENDERED CODES ARE NEVER STORED: there is no code column to UPDATE, so
-- directus_app holds no UPDATE on code_hash/code_salt/phone_hash/expires_at
-- either -- a re-request is a new row, not an edit. No DELETE anywhere in
-- this file: OTP rows are abuse evidence (who was challenged, what was
-- locked and why). Sessions are revoked (revoked_at), never deleted.
--
-- Rollback: rollback/20261020_0007_member_otp.down.sql (refuses while any
-- OTP or session row exists; drops functions, then tables, conditional
-- columns last). Owner: migration role (directus_migrator). Never run as
-- directus_app. Role hygiene per ADR-0002: this file provisions no roles
-- and grants no role-creation or superuser capability; only GRANT/REVOKE
-- below. No durations, no awareness_at.

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
-- 1. member_otp_codes (F1 parameters, stored as CHECKs + gate below).
--
-- phone_hash: sha256 of the normalised E.164 number. The number itself is
--   never stored here (no existence oracle at rest; the request route
--   answers identically whether the number is registered or not).
-- code_hash + code_salt: sha256(code || salt). There is deliberately NO
--   code column: a plaintext column cannot be SELECTed, leaked, or
--   granted by accident if it does not exist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_otp_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash     text NOT NULL
                   CHECK (btrim(phone_hash) <> ''),
  code_hash      text NOT NULL
                   CHECK (btrim(code_hash) <> ''),
  code_salt      text NOT NULL
                   CHECK (btrim(code_salt) <> ''),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  attempt_count  integer NOT NULL DEFAULT 0
                   CHECK (attempt_count >= 0 AND attempt_count <= 5),
  consumed_at    timestamptz,
  request_ip_hash text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_otp_codes_expiry_bound
    CHECK (expires_at > requested_at
           AND expires_at <= requested_at + interval '10 minutes'),
  CONSTRAINT member_otp_codes_consumed_after_request
    CHECK (consumed_at IS NULL OR consumed_at >= requested_at)
);

COMMENT ON TABLE member_otp_codes IS
  'Member OTP challenges (F1, AFC-482). Salted hashes only -- no plaintext code, no phone number. Expiry <= requested_at + 10 min; attempts 0..5; single-use via consumed_at. Rows are abuse evidence: never updated in place except the verify counters, never deleted.';

CREATE INDEX IF NOT EXISTS member_otp_codes_phone_hash_idx
  ON member_otp_codes (phone_hash);
CREATE INDEX IF NOT EXISTS member_otp_codes_expires_idx
  ON member_otp_codes (expires_at);

-- ---------------------------------------------------------------------------
-- 2. member_sessions (F1 session binding + F2 server-side identity).
--
-- user_id / member_person are bare uuids under the merge contract: the
-- Directus/people-owning slices add the FKs and must not fork this table.
-- The binding is immutable (no UPDATE grant): a changed person is a new
-- session, not an edit -- which is what makes "bound to exactly one
-- member_person" checkable rather than aspirational.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS member_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  member_person uuid NOT NULL,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_sessions_expiry_bound
    CHECK (expires_at > issued_at
           AND expires_at <= issued_at + interval '8 hours'),
  CONSTRAINT member_sessions_revoked_after_issue
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

COMMENT ON TABLE member_sessions IS
  'Member OTP sessions (F1+F2, AFC-482). Bound server-side to exactly one member_person at issue; lifetime <= issued_at + 8h; member_access_expires_at re-checked per request by member_session_valid(). Revoked, never deleted; binding immutable. Disabled behind NUXT_MEMBER_OTP_ENABLED until AFC-478 re-review.';

CREATE INDEX IF NOT EXISTS member_sessions_user_idx
  ON member_sessions (user_id);
CREATE INDEX IF NOT EXISTS member_sessions_person_idx
  ON member_sessions (member_person);
CREATE INDEX IF NOT EXISTS member_sessions_expires_idx
  ON member_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- 3. Conditional deltas on directus_users (0002 §10 pattern). 0005 §2
--    added these where the host table exists; this slice re-ensures them
--    (idempotent) because the member login needs the link wherever users
--    exist. The Directus collection spec remains the authority; the
--    scratch DB has no directus_users, so absence is NOTICE-loud, not a
--    failure. No column here enables OTP: enablement is the portal flag.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.directus_users') IS NULL THEN
    RAISE NOTICE 'Skipping directus_users member deltas: system table not present. Directus fields member_person (M2O people), invite_daily_limit (integer, default 10), invite_weekly_limit (integer, default 50), member_access_expires_at (datetime, nullable) per data-model-v4 §3.2.';
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
    RAISE NOTICE 'directus_users member deltas ensured (member_person, invite limits, member_access_expires_at).';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. member_otp_throttle -- pure resend rule (F1).
--
-- The writer counts the member's sends in the rolling windows and passes
-- the counts in (0005 invite_rate_gate pattern); this function applies the
-- per-phone (<=3/hr) and per-IP (<=10/hr) caps. Pure: no table access, no
-- clock reads. Over the cap the request is answered with the SAME generic
-- success-path response ("if this number is registered you will receive a
-- code") and no row is written -- the throttle never becomes an oracle.
--
-- Returns exactly one row: (allowed, blocked_reason), where a NULL
-- blocked_reason means within limits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION member_otp_throttle(
  p_sent_phone_1h integer,
  p_sent_ip_1h integer
)
RETURNS TABLE (allowed boolean, blocked_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_sent_phone_1h IS NULL OR p_sent_ip_1h IS NULL THEN
    RAISE EXCEPTION
      'member_otp_throttle: window counts are both required (got phone_1h=%, ip_1h=%)',
      p_sent_phone_1h, p_sent_ip_1h
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_phone_1h < 0 OR p_sent_ip_1h < 0 THEN
    RAISE EXCEPTION
      'member_otp_throttle: window counts must be non-negative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_phone_1h >= 3 THEN
    RETURN QUERY SELECT false, 'otp_resend_phone_cap'::text;
    RETURN;
  END IF;

  IF p_sent_ip_1h >= 10 THEN
    RETURN QUERY SELECT false, 'otp_resend_ip_cap'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END
$$;

COMMENT ON FUNCTION member_otp_throttle(integer, integer) IS
  'OTP resend throttle (F1, AFC-482). Pure: <=3/hr per phone, <=10/hr per IP. Over-cap requests get the generic success response and no row -- the throttle is never an existence oracle.';

-- ---------------------------------------------------------------------------
-- 5. member_otp_verify_gate -- pure verify rule (F1).
--
-- Order is load-bearing: consumed first (replay rejected before any
-- comparison -- a used code never verifies, even with the right digits),
-- then expiry, then the attempt lock (attempts >= 5 invalidates the code).
-- Only then may the caller compare the presented hash. The function does
-- NOT compare hashes itself: comparison lives in the route layer next to
-- the timing discipline, and this gate states what the comparison may
-- proceed on.
--
-- Returns exactly one row: (allowed, attempts_remaining, locked_reason).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION member_otp_verify_gate(
  p_consumed boolean,
  p_expired boolean,
  p_attempts integer
)
RETURNS TABLE (allowed boolean, attempts_remaining integer, locked_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_attempts IS NULL THEN
    RAISE EXCEPTION
      'member_otp_verify_gate: attempt count is required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_attempts < 0 OR p_attempts > 5 THEN
    RAISE EXCEPTION
      'member_otp_verify_gate: attempt count out of range 0..5 (got %)',
      p_attempts
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(p_consumed, false) THEN
    RETURN QUERY SELECT false, 0, 'otp_replay'::text;
    RETURN;
  END IF;

  IF COALESCE(p_expired, false) THEN
    RETURN QUERY SELECT false, 0, 'otp_expired'::text;
    RETURN;
  END IF;

  IF p_attempts >= 5 THEN
    RETURN QUERY SELECT false, 0, 'otp_locked'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, (5 - p_attempts), NULL::text;
END
$$;

COMMENT ON FUNCTION member_otp_verify_gate(boolean, boolean, integer) IS
  'OTP verify gate (F1, AFC-482). Pure: replay rejected first, then expiry, then the 5-attempt lock. Never compares hashes -- the route compares after this gate allows.';

-- ---------------------------------------------------------------------------
-- 6. member_session_valid -- pure session rule (F1).
--
-- Valid only while now < session expires_at AND (member_access_expires_at
-- IS NULL OR now < member_access_expires_at). The route layer calls this
-- before EVERY member read (data-model-v4 §3.2: time-boxed access), so a
-- revoked time-box takes effect on the next request, not at the next
-- login. Pure: the caller passes now.
--
-- Returns exactly one row: (valid, invalid_reason).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION member_session_valid(
  p_session_expires_at timestamptz,
  p_member_access_expires_at timestamptz,
  p_now timestamptz
)
RETURNS TABLE (valid boolean, invalid_reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_session_expires_at IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION
      'member_session_valid: session expiry and now are both required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_now >= p_session_expires_at THEN
    RETURN QUERY SELECT false, 'session_expired'::text;
    RETURN;
  END IF;

  IF p_member_access_expires_at IS NOT NULL AND p_now >= p_member_access_expires_at THEN
    RETURN QUERY SELECT false, 'member_access_expired'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END
$$;

COMMENT ON FUNCTION member_session_valid(timestamptz, timestamptz, timestamptz) IS
  'Member session validity (F1, AFC-482). Pure: session expiry AND member_access_expires_at, re-checked on every request by the route layer.';

-- ---------------------------------------------------------------------------
-- 7. member_invite_identity_ok -- pure F2 rule.
--
-- On invite.create and any consent write: inviter_user := session user,
-- inviter_person := session member_person. A request carrying different
-- values is REJECTED (never silently overwritten -- silent overwrite hides
-- confused-deputy bugs from the audit trail, AFC-478 F2). A member
-- creating an invite as another person gets a 403, pinned by suite 75.
--
-- NULL claimed values mean "not supplied": the writer fills them from the
-- session. Non-NULL values that differ from the session are forgery.
--
-- Returns exactly one row: (ok, reason).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION member_invite_identity_ok(
  p_session_user uuid,
  p_session_person uuid,
  p_claimed_user uuid,
  p_claimed_person uuid
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_session_user IS NULL OR p_session_person IS NULL THEN
    RAISE EXCEPTION
      'member_invite_identity_ok: session user and session person are both required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_claimed_user IS NOT NULL AND p_claimed_user <> p_session_user THEN
    RETURN QUERY SELECT false, 'inviter_user_mismatch'::text;
    RETURN;
  END IF;

  IF p_claimed_person IS NOT NULL AND p_claimed_person <> p_session_person THEN
    RETURN QUERY SELECT false, 'inviter_person_mismatch'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END
$$;

COMMENT ON FUNCTION member_invite_identity_ok(uuid, uuid, uuid, uuid) IS
  'F2 server-side identity rule (AFC-478 F2, AFC-482). Pure: claimed inviter values must equal the session values or be absent (filled from session); mismatch is forgery, rejected not overwritten.';

-- ---------------------------------------------------------------------------
-- 8. Least privilege (data-model-expansion §10 pattern, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- the member-vs-staff read split and branch scoping live in the Directus
-- policy + portal route filters, not here. This layer states the ceiling:
--   member_otp_codes: the app inserts the challenge row (hashes only) and
--     advances verify state (attempt_count, consumed_at) only. Hashes,
--     expiry, phone hash and binding are immutable (no UPDATE grant): a
--     correction is a new challenge, not an edit. Nothing is deletable:
--     OTP rows are abuse evidence.
--   member_sessions: the app inserts the bound session and revokes it
--     (revoked_at) only. user_id/member_person/expires_at are immutable
--     (no UPDATE grant): a changed person or lifetime is a new session.
--     Nothing is deletable: sessions are audited.
--   directus_users deltas: granted only where the host table exists
--     (EXECUTE in §3); the scratch DB has no such table.
-- ---------------------------------------------------------------------------
GRANT SELECT ON member_otp_codes TO directus_app;
GRANT INSERT (phone_hash, code_hash, code_salt, requested_at, expires_at,
  request_ip_hash) ON member_otp_codes TO directus_app;
GRANT UPDATE (attempt_count, consumed_at) ON member_otp_codes TO directus_app;

GRANT SELECT ON member_sessions TO directus_app;
GRANT INSERT (user_id, member_person, issued_at, expires_at) ON member_sessions TO directus_app;
GRANT UPDATE (revoked_at) ON member_sessions TO directus_app;

REVOKE ALL ON member_otp_codes FROM PUBLIC;
REVOKE ALL ON member_sessions FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('public.directus_users') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT (member_person, invite_daily_limit, invite_weekly_limit, member_access_expires_at) ON directus_users TO directus_app';
    EXECUTE 'GRANT UPDATE (invite_daily_limit, invite_weekly_limit, member_access_expires_at) ON directus_users TO directus_app';
    RAISE NOTICE 'directus_users member-delta grants ensured.';
  ELSE
    RAISE NOTICE 'Skipping directus_users member-delta grants: system table not present.';
  END IF;
END
$$;
