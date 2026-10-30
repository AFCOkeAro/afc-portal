-- Migration 0061: notification preferences (AFC-903 phase 1, chairman ask
-- 2026-10-29).
--
-- Admin notification preferences: one row per admin user with per-channel
-- switches (Email/Telegram/WhatsApp), a digest cadence
-- (realtime/daily/weekly/monthly), and the digest sections the admin wants
-- (tasks, celebrations, upcoming events, system activity).
--
-- Phase 1 is store + content only. No transport lives here and none is
-- referenced anywhere in the tree: there are no provider columns, no
-- tokens, no secrets, no sending identities. Routes read this register and
-- build digest text with the shared digest builders; delivery (phase 2
-- outbox + scheduler, phase 3 provider wiring) fails closed while its
-- providers are unprovisioned. A missing row means "unconfigured": the
-- digest builder returns null and nothing is sent.
--
-- admin_user is a bare uuid: directus_users is Directus-core managed, not
-- migrator-owned, so a hard FK would couple this register to core-house
-- keeping the migrator must not own (same no-FK rationale as the 0060
-- collaborators register's person column). The route validates the user
-- exists and UNIQUE(admin_user) owns dedup.
--
-- Channels default to email-only: Telegram/WhatsApp stay off until phase 3
-- providers are provisioned (board/CTO) and the admin opts in. All-off is a
-- legal explicit mute (the digest builder treats it as nothing-to-send):
-- muting is a row update, never a row delete, so the choice survives.
--
-- Grants: SELECT for reads; INSERT on the assignment columns; UPDATE the
-- switches, cadence and sections; DELETE for removal. REVOKE PUBLIC. No
-- roles provisioned (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-903). R2 CTO review on
-- the AFC-903 thread before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261030_0066_notification_preferences.down.sql
-- (refuses while rows exist; drops the table). Owner: migration role
-- (directus_migrator). Never run as directus_app.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
--    pattern.
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
-- 1. OWNERSHIP PRECONDITION. Brand-new register: fail closed if a leftover
--    table from a failed apply is owned by someone else.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_foreign text;
BEGIN
  SELECT string_agg(o, ', ' ORDER BY o) INTO v_foreign
    FROM (
      SELECT n.nspname || '.' || c.relname AS o
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind IN ('r', 'p')
         AND c.relname IN ('notification_preferences')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the notification preferences register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. notification_preferences. One row per admin user with channel
--    switches, cadence and sections.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user           uuid NOT NULL UNIQUE,
  email_enabled        boolean NOT NULL DEFAULT true,
  telegram_enabled     boolean NOT NULL DEFAULT false,
  whatsapp_enabled     boolean NOT NULL DEFAULT false,
  cadence              text NOT NULL DEFAULT 'daily'
                         CHECK (cadence IN ('realtime', 'daily', 'weekly', 'monthly')),
  sections             text[] NOT NULL DEFAULT '{tasks,celebrations,events,activity}'
                         CHECK (sections <@ ARRAY['tasks', 'celebrations', 'events', 'activity']),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification_preferences IS
  'AFC-903 phase 1: per-admin notification channels (email/telegram/whatsapp) + digest cadence (realtime/daily/weekly/monthly) + digest sections (tasks/celebrations/events/activity). Store + content only: no provider columns, no tokens, no secrets (phases 2/3). admin_user is a bare uuid: directus_users is Directus-core managed, not migrator-owned, so no FK (0060 precedent).';

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT on the assignment
--    columns; UPDATE the switches, cadence and sections; DELETE for
--    removal. REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON notification_preferences TO directus_app;
GRANT INSERT (admin_user, email_enabled, telegram_enabled, whatsapp_enabled, cadence, sections)
  ON notification_preferences TO directus_app;
GRANT UPDATE (email_enabled, telegram_enabled, whatsapp_enabled, cadence, sections)
  ON notification_preferences TO directus_app;
GRANT DELETE ON notification_preferences TO directus_app;

REVOKE ALL ON notification_preferences FROM PUBLIC;
