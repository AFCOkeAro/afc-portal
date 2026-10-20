-- rollback/20261020_0006_campaigns.down.sql
--
-- Reversal for 20261020_0006_campaigns.sql. AFC-481 / AFC-464.
--
-- What it destroys, stated plainly:
--   campaign_send_key(), campaign_has_activity(), campaign_fallback_due(),
--     campaign_fallback_allowed(), campaign_template_allowed(),
--     campaign_tick_hold(), campaign_within_cap(),
--     campaign_shift_quiet_hours(), campaign_filter_keys_valid(),
--     campaign_due_enrollments() -- the pure tick rules. Pure/computed
--     functions with no dependents outside the suite that pins them; the
--     one table reader (campaign_due_enrollments) reads only tables dropped
--     in this same script.
--   The three FKs the forward file added under the 0004 merge contract
--     (communications.campaign/.campaign_step/.campaign_run) -- dropped
--     first, so the campaign tables can go. The comms TABLES stay; only
--     the FKs to the campaign tables go (the 0002 WECA-FK shape: the owning
--     tables survive, the constraint written as ALTER TABLE IF EXISTS).
--     Each FK's referent (campaigns/steps/runs) is dropped by this same
--     script, so each drop is a reversal, not a disarm.
--   campaign_enrollments, campaign_runs, campaign_steps, campaign_audiences,
--     campaigns, communication_channels -- every campaign row, INCLUDING
--     paused enrollments and completed runs (re-applying the forward file
--     recreates the tables and re-seeds the nine keys and three channels,
--     but no enrolment or run row survives a rollback).
--   The send-key dedupe aid on communication_recipients: the UNIQUE index
--     (DROP INDEX, not a constraint drop) then the nullable metadata column.
--     The 0004 columns are untouched -- the delivery log survives with its
--     rendered text, bases and reasons intact.
--
-- What it does NOT destroy: message_templates, consent_records,
-- communications rows, communication_recipients rows (owned by 0004; only
-- the FKs to the campaign tables go, never the columns -- the columns
-- belong to 0004 and this script does not fork them). event_invites (owned
-- by 0005). No CASCADE: a hidden dependency must fail loudly, not vanish
-- silently.
--
-- ROLLBACK-GATE NOTE (stated, not hidden): the reversal of the send-key aid
-- is DROP INDEX + DROP COLUMN. Neither is a control removal in the gate's
-- taxonomy (no trigger, no trigger-function, no rule, no constraint drop):
-- the aid is this slice's own dedupe index, its referent tables are dropped
-- in this same script, and the surviving delivery log keeps every 0004
-- control exactly as it was.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a campaign store that holds rows.
--
-- Enrolment and run rows are audited automation evidence (who was enrolled
-- on what basis, what was sent or held and why, what it cost). Empty tables
-- roll back; anything else needs a verified copy first and a reviewed step,
-- not this script. The seeds count as rows: an operator rolls back a seeded
-- database by deleting the nine campaign rows and three channel rows as the
-- migrator first, which is a deliberate act.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_campaigns    integer;
  v_steps        integer;
  v_audiences    integer;
  v_enrollments  integer;
  v_runs         integer;
  v_channels     integer;
BEGIN
  SELECT count(*) INTO v_campaigns FROM campaigns;
  SELECT count(*) INTO v_steps FROM campaign_steps;
  SELECT count(*) INTO v_audiences FROM campaign_audiences;
  SELECT count(*) INTO v_enrollments FROM campaign_enrollments;
  SELECT count(*) INTO v_runs FROM campaign_runs;
  SELECT count(*) INTO v_channels FROM communication_channels;

  IF v_campaigns > 0 OR v_steps > 0 OR v_audiences > 0
     OR v_enrollments > 0 OR v_runs > 0 OR v_channels > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back campaigns: campaigns holds % row(s), campaign_steps % row(s), campaign_audiences % row(s), campaign_enrollments % row(s), campaign_runs % row(s) and communication_channels % row(s). These are audited automation evidence (enrolment basis, hold reasons, run counts, cost). Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_campaigns, v_steps, v_audiences, v_enrollments, v_runs, v_channels
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'campaign rollback proceeding: no campaign rows. Re-apply 20261020_0006 to get the tables, rules and seeds back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The FKs added by forward §7, then the rules, then the tables.
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS communications DROP CONSTRAINT IF EXISTS communications_campaign_fkey;
ALTER TABLE IF EXISTS communications DROP CONSTRAINT IF EXISTS communications_campaign_step_fkey;
ALTER TABLE IF EXISTS communications DROP CONSTRAINT IF EXISTS communications_campaign_run_fkey;

DROP FUNCTION IF EXISTS campaign_due_enrollments(timestamptz);
DROP FUNCTION IF EXISTS campaign_shift_quiet_hours(timestamptz, text, boolean);
DROP FUNCTION IF EXISTS campaign_within_cap(integer, integer);
DROP FUNCTION IF EXISTS campaign_tick_hold(text, boolean);
DROP FUNCTION IF EXISTS campaign_template_allowed(text, text, text);
DROP FUNCTION IF EXISTS campaign_fallback_allowed(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS campaign_fallback_due(timestamptz, timestamptz, timestamptz, timestamptz, integer, timestamptz);
DROP FUNCTION IF EXISTS campaign_has_activity(timestamptz, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS campaign_filter_keys_valid(jsonb);
DROP FUNCTION IF EXISTS campaign_send_key(uuid, uuid, uuid, text, timestamptz);

DROP TABLE IF EXISTS campaign_enrollments;
DROP TABLE IF EXISTS campaign_runs;
DROP TABLE IF EXISTS campaign_steps;
DROP TABLE IF EXISTS campaign_audiences;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS communication_channels;

-- ---------------------------------------------------------------------------
-- 2. The send-key dedupe aid on communication_recipients (§8 of the forward
--    file): index first, then the column. 0004 columns are untouched.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS communication_recipients_send_key_uidx;
ALTER TABLE IF EXISTS communication_recipients DROP COLUMN IF EXISTS campaign_send_key;
