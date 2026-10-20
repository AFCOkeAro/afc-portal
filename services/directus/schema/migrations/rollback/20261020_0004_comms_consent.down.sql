-- rollback/20261020_0004_comms_consent.down.sql
--
-- Reversal for 20261020_0004_comms_consent.sql. AFC-479 / AFC-464.
--
-- What it destroys, stated plainly:
--   comms_resolve_consent() -- the audience-time consent resolver. Pure
--     function, no dependents outside this file.
--   communication_recipients -- every per-recipient delivery row, INCLUDING
--     queued/sent rows (re-applying the forward file recreates the tables and
--     re-seeds the templates, but no recipient row survives a rollback).
--   communications -- every delivery-log header.
--   consent_records -- every consent history row.
--   message_templates -- the registry INCLUDING the eleven seed rows and any
--     board-added rows.
--
-- What it does NOT destroy: campaigns / campaign_steps / campaign_runs /
--   event_invites (owned by tracks b/c; this migration never created them and
--   the bare-uuid columns never became FKs here, so there is nothing to drop).
--   No CASCADE: a hidden dependency must fail loudly, not vanish silently.
--   No trigger/function is created by the forward file except
--   comms_resolve_consent, so the rollback-control gate only reconciles that
--   one drop against its referent (F1: the function reads no surviving table,
--   and its referent tables are dropped in this same script).

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a log that holds rows.
--
-- Recipient rows are audited delivery evidence (a consent basis was stored,
-- a message was sent or a reason was recorded). Consent rows are the history
-- a suppression decision reads. Empty tables roll back; anything else needs
-- a verified copy first and a reviewed step, not this script. The seed counts
-- as rows: an operator rolls back a seeded database by deleting the eleven
-- template rows as the migrator first, which is a deliberate act.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_templates   integer;
  v_consent     integer;
  v_comms       integer;
  v_recipients  integer;
BEGIN
  SELECT count(*) INTO v_templates FROM message_templates;
  SELECT count(*) INTO v_consent FROM consent_records;
  SELECT count(*) INTO v_comms FROM communications;
  SELECT count(*) INTO v_recipients FROM communication_recipients;

  IF v_templates > 0 OR v_consent > 0 OR v_comms > 0 OR v_recipients > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back comms/consent: message_templates holds % row(s), consent_records % row(s), communications % row(s) and communication_recipients % row(s). These are audited delivery and consent evidence. Take a verified copy before proceeding; empty tables roll back, populated ones do not.',
      v_templates, v_consent, v_comms, v_recipients
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'comms/consent rollback proceeding: no templates, consent, communications or recipients. Re-apply 20261020_0004 to get the seed back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The resolver, then tables in dependency order: recipients (child) before
--    communications (referenced), then consent history and the registry.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS comms_resolve_consent(text, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean, boolean);

DROP TABLE IF EXISTS communication_recipients;
DROP TABLE IF EXISTS communications;
DROP TABLE IF EXISTS consent_records;
DROP TABLE IF EXISTS message_templates;
