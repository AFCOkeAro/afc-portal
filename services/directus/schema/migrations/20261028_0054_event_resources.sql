-- Migration 0054: event resources with approval (AFC-844, chairman direction
-- 2026-10-28).
--
-- The Resources tab lists programme materials: links or uploaded files
-- (documents, spreadsheets, PDFs), media (images, video) and compressed
-- bundles (zip). Resources a speaker shares link the AFC-843 speaker;
-- nothing appears on the Resources page until it is approved (status
-- pending → approved; rejected stays hidden with its reason on the row).
--
-- Design: event_resources (one row per item; source link XOR upload file;
-- kind names the shelf it renders on). The speaker link is a bare uuid
-- with a conditional FK (the 0023 §3 merge-contract pattern): the AFC-843
-- slice may land after this one, so the forward file adds
-- event_resources_speaker_fkey only when event_speakers exists, and
-- re-applying 0054 after 0053 lands completes the link.
-- Suite 94 is untouched (no scope trigger; choice-8 route-stamped
-- branch/zone, same as 0044/0050/0051/0052/0053).
--
-- Uploads ride the receipt precedent (AFC-824): multipart to a
-- resources/upload route, stored in directus_files, file id on the row;
-- downloads proxy through resources/file (never a bare Directus URL).
--
-- Grants: SELECT/INSERT/UPDATE/DELETE for directus_app (programme admin
-- content; add/remove is the tool). REVOKE PUBLIC. No roles provisioned
-- (ADR-0002).
--
-- Review: R1 self-claim by the operator run (AFC-844). R2 CTO review on
-- the AFC-844 issue before landing. No independent security reviewer
-- (board declined the seat on cost); a CTO review is a recorded
-- degradation, not independent review.
--
-- Rollback: rollback/20261028_0054_event_resources.down.sql
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
         AND c.relname IN ('event_resources')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the resources register: % is not owned by '
      'directus_migrator, and only an owner may replace it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. event_resources. One row per item; approval gates page display.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_resources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event                uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  speaker              uuid,
  branch               uuid REFERENCES branches(id) ON DELETE SET NULL,
  zone                 uuid REFERENCES zones(id) ON DELETE SET NULL,
  title                text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  source_type          text NOT NULL
                         CHECK (source_type IN ('link', 'upload')),
  kind                 text NOT NULL
                         CHECK (kind IN ('document', 'spreadsheet', 'pdf',
                                         'image', 'video', 'archive', 'other')),
  url                  text,
  file_id              uuid,
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by           uuid,
  decided_at           timestamptz,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_resources_link_or_upload
    CHECK ((source_type = 'link' AND url IS NOT NULL AND file_id IS NULL)
        OR (source_type = 'upload' AND file_id IS NOT NULL AND url IS NULL))
);

COMMENT ON TABLE event_resources IS
  'AFC-844: programme materials per event (links + uploads; documents, sheets, PDFs, media, archives). status gates Resources-page display: pending/rejected stay hidden. speaker is the sharing speaker (conditional FK below); source pairing is strict.';

-- Conditional speaker FK (0023 §3 merge-contract pattern): the AFC-843
-- slice may land after this one. Present when event_speakers exists;
-- re-applying 0054 after 0053 completes the link.
DO $$
BEGIN
  IF to_regclass('public.event_speakers') IS NULL THEN
    RAISE NOTICE 'Skipping event_resources_speaker_fkey: event_speakers not present. The FK lands when 0053 does; until then the speaker link stays a bare uuid under the merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_resources_speaker_fkey') THEN
    ALTER TABLE event_resources ADD CONSTRAINT event_resources_speaker_fkey
      FOREIGN KEY (speaker) REFERENCES event_speakers(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: event_resources.speaker -> event_speakers(id) SET NULL.';
  ELSE
    RAISE NOTICE 'event_resources_speaker_fkey already present, left alone.';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS event_resources_event_idx
  ON event_resources (event);
CREATE INDEX IF NOT EXISTS event_resources_status_idx
  ON event_resources (status);

-- ---------------------------------------------------------------------------
-- 3. Least-privilege ceiling. SELECT for reads; INSERT/UPDATE on
--    operational columns; DELETE granted (programme admin content —
--    add/remove is the tool). REVOKE PUBLIC.
-- ---------------------------------------------------------------------------
GRANT SELECT ON event_resources TO directus_app;
GRANT INSERT (event, speaker, branch, zone, title, source_type, kind, url, file_id, status, decided_by, decided_at, created_by)
  ON event_resources TO directus_app;
GRANT UPDATE (speaker, title, source_type, kind, url, file_id, status, decided_by, decided_at)
  ON event_resources TO directus_app;
GRANT DELETE ON event_resources TO directus_app;

REVOKE ALL ON event_resources FROM PUBLIC;
