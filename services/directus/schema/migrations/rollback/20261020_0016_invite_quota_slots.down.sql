-- rollback/20261020_0016_invite_quota_slots.down.sql
--
-- Reversal for 20261020_0016_invite_quota_slots.sql. AFC-516 / AFC-518.
--
-- What it destroys, stated plainly:
--   invite_quota_slots -- every claimed quota slot row (a claim is quota
--     consumed; rolling back a ledger that holds claims destroys the evidence
--     of who consumed what, so populated ledgers do not roll back here).
--     Re-applying the forward file recreates the table, but no claimed slot
--     survives a rollback.
--
-- What it does NOT destroy: event_invites rows, directus_users limit columns,
-- events invite flags (owned elsewhere; this slice created no FK to them and
-- drops none). No CASCADE: a hidden dependency must fail loudly, not vanish
-- silently. No DROP TRIGGER / DROP FUNCTION / DROP RULE / DROP CONSTRAINT
-- statement appears anywhere in this file -- the forward file creates none,
-- so the rollback-control gate reconciles zero control drops and the
-- grandfather file stays at zero entries.

-- ---------------------------------------------------------------------------
-- 0. Refuse to roll back a quota ledger that holds rows.
--
-- Claimed slots are audited quota-consumption evidence (who consumed which
-- slot in which window). Empty ledgers roll back; anything else needs a
-- verified copy first and a reviewed step, not this script.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_slots integer;
BEGIN
  SELECT count(*) INTO v_slots FROM invite_quota_slots;

  IF v_slots > 0 THEN
    RAISE EXCEPTION
      'refusing to roll back invite quota slots: invite_quota_slots holds % row(s). These are audited quota-consumption evidence (inviter, window, slot). Take a verified copy before proceeding; empty ledgers roll back, populated ones do not.',
      v_slots
      USING ERRCODE = 'restrict_violation';
  END IF;

  RAISE NOTICE
    'invite-quota rollback proceeding: no slot rows. Re-apply 20261020_0016 to get the ledger back.';
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The table this migration created, and nothing else.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS invite_quota_slots;
