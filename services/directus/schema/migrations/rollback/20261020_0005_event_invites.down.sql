-- rollback/20261020_0005_event_invites.down.sql
--
-- Reversal for 20261020_0005_event_invites.sql. AFC-480 / AFC-464.
--
-- What it destroys, stated plainly:
--   invite_rate_gate(), invite_eligibility(), invite_contact_suppressed()
--     -- the pure invite gates. Pure functions, no dependents outside the
--     suite that pins them.
--   The two FKs the forward file added under the 0004 merge contract
--     (consent_records.related_invite, communications.event_invite) --
--     dropped first, so event_invites can go. The comms TABLES stay; only
--     the FKs to event_invites go (the 0002 WECA-FK shape: the owning
--     tables survive, the constraint written as ALTER TABLE IF EXISTS so
--     the reversal is explicit about what it removes).
--   event_invites -- every invite row, INCLUDING blocked/suppressed rows
--     (re-applying the forward file recreates the table, but no invite row
--     survives a rollback).
--   The conditional deltas (directus_users member/limit columns, events
--     invite flags) -- dropped only where the host table exists; their
--     absence is not a failure, because the forward migration may have
--     skipped them too.
--
-- What it does NOT destroy: message_templates, consent_records rows,
-- communications rows, communication_recipients rows (owned by 0004; the
-- bare-column contract is restored by dropping only the FK, never the
-- column -- the columns belong to 0004 and this script does not fork
-- them). No CASCADE: a hidden dependency must fail loudly, not vanish
-- silently. No trigger/function is created by the forward file except the
-- three gates, so the rollback-control gate reconciles only those drops
-- against their referents (F5: the functions have no surviving caller once
-- this table is gone; the FK drops follow the IF EXISTS shape the gate
-- does not classify as controls, matching the 0002 WECA-FK precedent).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back an invite log that holds rows.
--
-- Invite rows are audited consent-adjacent evidence (who invited whom on
-- what basis, what was blocked and why). Empty tables roll back; anything
-- else needs a verified copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_invites integer;
BEGIN
  SELECT count(*) INTO v_invites FROM event_invites;

  IF v_invites > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back event invites: event_invites holds % row(s). These are audited invitation and suppression evidence (invitee basis, blocked reasons). Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_invites
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'event-invite rollback proceeding: no invite rows. Re-apply 20261020_0005 to get the table and gates back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The FKs added by forward §3, then the gates, then the table.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS consent_records DROP CONSTRAINT IF EXISTS consent_records_related_invite_fkey;
ALTER TABLE IF EXISTS communications DROP CONSTRAINT IF EXISTS communications_event_invite_fkey;

DROP FUNCTION IF EXISTS invite_rate_gate(integer, integer, integer, integer);
DROP FUNCTION IF EXISTS invite_eligibility(boolean, uuid, uuid, text, text, boolean);
DROP FUNCTION IF EXISTS invite_contact_suppressed(text);

DROP TABLE IF EXISTS event_invites;

-- ---------------------------------------------------------------------------
-- 2. Conditional deltas added by forward §2, dropped only where the host
--    table exists.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS directus_users DROP CONSTRAINT IF EXISTS directus_users_invite_limits_nonnegative;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS member_access_expires_at;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS invite_weekly_limit;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS invite_daily_limit;
ALTER TABLE IF EXISTS directus_users DROP COLUMN IF EXISTS member_person;

ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS reminder_offsets;
ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS reminders_enabled;
ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS live_join_url;
ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS invite_requires_approval;
ALTER TABLE IF EXISTS events DROP COLUMN IF EXISTS invite_eligible;
