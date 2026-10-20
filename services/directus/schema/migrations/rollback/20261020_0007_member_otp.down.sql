-- rollback/20261020_0007_member_otp.down.sql
--
-- Reversal for 20261020_0007_member_otp.sql. AFC-482 / AFC-464.
--
-- What it destroys, stated plainly:
--   member_otp_throttle(), member_otp_verify_gate(), member_session_valid(),
--     member_invite_identity_ok()
--     -- the pure member-OTP gates. Pure functions, no dependents outside
--     the suite that pins them.
--   member_otp_codes, member_sessions -- every challenge and session row,
--     INCLUDING locked and revoked rows (re-applying the forward file
--     recreates the tables, but no row survives a rollback).
--   The conditional directus_users deltas are NOT dropped here: 0005 §2
--     owns those columns (member_person, invite limits,
--     member_access_expires_at) and this file only re-ensured them. A
--     rollback that drops another slice's columns is a fork by reversal;
--     the columns stay and 0005's down script owns their removal. The
--     grants EXECUTEd by forward §8 on directus_users are left in place
--     for the same reason (they are 0005's columns).
--
-- What it does NOT destroy: people, directus_users rows, event_invites,
-- consent_records rows, communications rows (all owned elsewhere; this
-- file holds no FK to any of them -- member_person/user_id are bare
-- uuids, so there is nothing to unpick). No CASCADE: a hidden dependency
-- must fail loudly, not vanish silently.
--
-- Rollback-control gate (AFC-266): the CHECK constraints dropped here die
-- with the tables that carry them (F1: each constraint's referent is
-- created by this same migration and dropped by this same script). No
-- trigger, rule, or trigger-function is created by the forward file, so
-- there is no control left guarding a surviving object.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back OTP evidence that holds rows.
--
-- Challenge and session rows are abuse evidence (who was challenged, what
-- was locked, which person a session was bound to). Empty tables roll
-- back; anything else needs a verified copy first and a reviewed step,
-- not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_codes integer;
  v_sessions integer;
BEGIN
  SELECT count(*) INTO v_codes FROM member_otp_codes;
  SELECT count(*) INTO v_sessions FROM member_sessions;

  IF v_codes > 0 OR v_sessions > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back member OTP: member_otp_codes holds % row(s), member_sessions holds % row(s). These are abuse and session-binding evidence. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_codes, v_sessions
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'member-OTP rollback proceeding: no challenge or session rows. Re-apply 20261020_0007 to get the tables and gates back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The gates, then the tables. No CASCADE.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS member_invite_identity_ok(uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS member_session_valid(timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS member_otp_verify_gate(boolean, boolean, integer);
DROP FUNCTION IF EXISTS member_otp_throttle(integer, integer);

DROP TABLE IF EXISTS member_sessions;
DROP TABLE IF EXISTS member_otp_codes;
