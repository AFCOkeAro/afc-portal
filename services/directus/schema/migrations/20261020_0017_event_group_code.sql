-- 20261020_0017_event_group_code.sql
--
-- Slice 2 workstream B: persist the group submission code (AFC-519,
-- CTO decision on AFC-493 option A, parent AFC-470).
-- Spec authority: docs/planning/data-model.md §3.2 (group_code row +
-- (event, group_code) index, added by this change),
-- apps/web/server/api/events/[id]/group-registrations.post.ts (validates
-- one group_code per group submission and echoes it in response meta;
-- S4 group-record page /events/:id/group-registrations/:id and the
-- idempotency key need the code as stored ground truth, US-G3).
--
-- WHAT THIS FILE CREATES
--   NOTHING new-standing: a single nullable column plus one composite
--   index on a table owned elsewhere:
--   event_registrations.group_code text NULL, with
--   CHECK (char_length(group_code) <= 64) (NULL passes a CHECK by
--   definition, so no explicit IS NULL arm is needed), and
--   event_registrations_event_group_code_idx ON (event, group_code).
--   All access is event-scoped: the idempotency pre-check lists by event
--   and the S4 page queries by event+group, so the leading column is event.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   No backfill, no NOT NULL, no default: pre-existing rows never carried
--   a code and must stay NULL rather than gain an invented one. No GRANT
--   and no role change: group_code is a staff-chosen operational label,
--   not PII, and the Directus role matrix is untouched (the owning slice
--   states whatever ceiling its table needs; a new nullable column rides
--   the table-level grants it already has). No trigger, no function, no
--   rule, no FK: there is nothing here for the rollback-control gate to
--   reconcile.
--
-- CONDITIONAL (0002 §10 / 0005 pattern): the registrations-owning slice
-- creates event_registrations. Where the table is absent this file emits
-- a NOTICE naming the Directus field spec that remains the authority and
-- changes nothing -- it never forks the table. Rerunnable: ADD COLUMN
-- IF NOT EXISTS, named-constraint existence check, CREATE INDEX IF NOT
-- EXISTS.
--
-- Rollback: rollback/20261020_0017_event_group_code.down.sql (refuses
-- while a non-null group_code exists; drops the index, the CHECK, then
-- the column). Owner: migration role (directus_migrator). Never run as
-- directus_app. Role hygiene per ADR-0002: this file provisions no roles
-- and grants no role-creation or superuser capability; it issues no
-- GRANT/REVOKE at all.
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0002
--    pattern: a deploy that skipped bootstrap gets a sentence, not a partial
--    install. Only GRANT/REVOKE below would mint privilege -- this file has
--    none (ADR-0002, scripts/migration-privilege-gate.sh).
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
-- 1. group_code on the registrations-owning slice's table, or a loud skip.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.event_registrations') IS NULL THEN
    RAISE NOTICE 'Skipping event_registrations.group_code: table not present. Directus field group_code (text, nullable, max 64 chars) per data-model.md §3.2; the registrations-owning slice creates the table.';
  ELSE
    ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS group_code text;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_registrations_group_code_len') THEN
      ALTER TABLE event_registrations
        ADD CONSTRAINT event_registrations_group_code_len
        CHECK (char_length(group_code) <= 64);
    END IF;

    CREATE INDEX IF NOT EXISTS event_registrations_event_group_code_idx
      ON event_registrations (event, group_code);

    RAISE NOTICE 'event_registrations.group_code ensured (nullable text, <=64 chars, indexed on (event, group_code)).';
  END IF;
END
$$;
