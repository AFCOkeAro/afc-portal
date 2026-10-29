-- 20261028_0059_event_section_visibility.sql
--
-- Per-section visibility + programme sections (AFC-871, parent AFC-460).
-- Spec authority: AFC-871 ("event registration, resources, speakers,
-- schedule each settable to draft / private / public / login / custom
-- access") + the YDD youth-site reference (28 screenshots: public programme
-- landing pages, programme detail + ticket, 7 register steps).
--
-- WHAT THIS FILE DOES (columns owned by no earlier migration -- verified:
-- no ADD COLUMN for any of these names exists in
-- services/directus/schema/migrations/):
--   events.registration_visibility  -- who may see/use the registration
--     step: draft / private / public / login / custom (fail-closed default
--     'private'; backfilled to 'public' where the legacy event visibility
--     is already 'public' so existing public programmes keep working).
--   events.speakers_visibility      -- same enum, same default/backfill.
--   events.resources_visibility     -- same enum, same default/backfill.
--   events.schedule_visibility      -- same enum, same default/backfill.
--   events.speakers / events.resources / events.schedule -- jsonb arrays
--     (the three programme-detail sections the reference renders; staff-
--     managed content, no relational behaviour behind them yet).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   No audience-membership table: `custom` has no grant infrastructure
--   behind it yet, so custom is fail-closed by definition (never served to
--   the public feed, never registerable anonymously) until a reviewed
--   slice models the audience. No `login` session check in SQL: the portal
--   route layer owns the signed-in test; the database owns the enum.
--   No seed rows: sections are staff content, never fixtures.
--   No Directus policy rows: enforcement lives in the Directus project +
--   the portal route predicates, per data-model §9.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. Fail-closed default 'private', not 'public'. A new event's sections
--      are invisible to the public feed until staff explicitly opens each
--      one. The one exception is the backfill: rows whose legacy
--      `visibility` is already 'public' get 'public' sections, so this
--      migration does not silently close programmes the board already
--      published. New rows after this migration get 'private' everywhere
--      and staff opens them per section.
--   2. JSONB arrays, not child tables. Speakers/resources/schedule have no
--      stated relational behaviour (no per-speaker registration, no stock
--      counts, no per-session check-in); three jsonb columns carry the
--      reference content with zero new registers, zero new FKs, zero new
--      grants surface. A CHECK pins jsonb_typeof = 'array' so a stray
--      object can never pose as a list.
--   3. `login` and `custom` are stored, never served publicly. The public
--      feed predicate is `= 'public'` only; anything else fails closed at
--      the route layer. The database cannot distinguish them further and
--      does not try.
--   4. Column-level grants extend the 0021 posture: directus_app keeps its
--      table SELECT and gains INSERT/UPDATE on the seven new columns. No
--      DELETE change (events rows are cancelled, never deleted, per 0021).
--
-- SECURITY REVIEW NOTE: the visibility matrix (which section value serves
-- whom on which route) needs the SecurityEngineer review the AFC-871 gates
-- require. This migration stores the enum; the route predicates that read
-- it land in the next slice and carry the failure-shape suite. Do NOT treat
-- a green db suite as clearance for the public surface.
--
-- GRANTS (expansion §10 posture: one app identity; scoping lives in the
-- Directus policy + portal route filters, not here).
--
-- Rollback: rollback/20261028_0059_event_section_visibility.down.sql
-- (refuses while any row carries configured section data that the legacy
-- column cannot re-derive; otherwise drops the seven columns, no CASCADE).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE below.
-- No durations, no awareness_at.

-- ---------------------------------------------------------------------------
-- 0. Bootstrap roles exist. Fail closed naming this file, per the 0001/0042
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
-- 1. OWNERSHIP PRECONDITION (0042 §1 / 0044 §1 pattern). events must already
--    belong to directus_migrator -- the identity this sequence runs as. Only
--    an owner can ADD a column or GRANT, so anything else here would fail
--    halfway with a bare 42501. Refusing up front names the foreign-owned
--    object and the operator step that fixes it. Never widen the migration
--    identity to make this pass.
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
         AND c.relname IN ('events')
         AND c.relowner <> 'directus_migrator'::regrole
    ) AS foreign_objects;

  IF v_foreign IS NOT NULL THEN
    RAISE EXCEPTION
      'refusing the event section-visibility columns: % is not owned by '
      'directus_migrator, and only an owner can add columns or GRANT on it. '
      'Transfer ownership to directus_migrator first, then re-run this '
      'migration. Never widen the migration identity to make this pass.',
      v_foreign
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Per-section visibility columns. One enum, four sections, fail-closed
--    default, backfill from the legacy column so published public
--    programmes keep their public surface.
-- ---------------------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS registration_visibility text NOT NULL DEFAULT 'private'
    CHECK (registration_visibility IN ('draft', 'private', 'public', 'login', 'custom')),
  ADD COLUMN IF NOT EXISTS speakers_visibility text NOT NULL DEFAULT 'private'
    CHECK (speakers_visibility IN ('draft', 'private', 'public', 'login', 'custom')),
  ADD COLUMN IF NOT EXISTS resources_visibility text NOT NULL DEFAULT 'private'
    CHECK (resources_visibility IN ('draft', 'private', 'public', 'login', 'custom')),
  ADD COLUMN IF NOT EXISTS schedule_visibility text NOT NULL DEFAULT 'private'
    CHECK (schedule_visibility IN ('draft', 'private', 'public', 'login', 'custom'));

-- Backfill once: rows the board already published as public keep a public
-- surface per section. Branch/internal/draft rows stay 'private' (fail
-- closed; staff opens each section explicitly). Re-runnable: only rows
-- still on the default move, so a staff-set 'login'/'custom' is never
-- overwritten by a re-apply.
UPDATE events SET registration_visibility = 'public'
 WHERE visibility = 'public' AND registration_visibility = 'private';
UPDATE events SET speakers_visibility = 'public'
 WHERE visibility = 'public' AND speakers_visibility = 'private';
UPDATE events SET resources_visibility = 'public'
 WHERE visibility = 'public' AND resources_visibility = 'private';
UPDATE events SET schedule_visibility = 'public'
 WHERE visibility = 'public' AND schedule_visibility = 'private';

COMMENT ON COLUMN events.registration_visibility IS
  'AFC-871: who may see/use event registration (draft/private/public/login/custom). Fail-closed default private; public backfill where legacy visibility is public. login/custom are never served to the signed-out feed.';
COMMENT ON COLUMN events.speakers_visibility IS
  'AFC-871: who may see the speakers section (draft/private/public/login/custom). Same default/backfill as registration_visibility.';
COMMENT ON COLUMN events.resources_visibility IS
  'AFC-871: who may see the resources section (draft/private/public/login/custom). Same default/backfill as registration_visibility.';
COMMENT ON COLUMN events.schedule_visibility IS
  'AFC-871: who may see the schedule section (draft/private/public/login/custom). Same default/backfill as registration_visibility.';

-- ---------------------------------------------------------------------------
-- 3. Programme sections. Staff-managed jsonb arrays (choice 2): no child
--    tables until a relational behaviour needs them. The array CHECK keeps
--    a stray object from posing as a list.
-- ---------------------------------------------------------------------------
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS speakers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(speakers) = 'array'),
  ADD COLUMN IF NOT EXISTS resources jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(resources) = 'array'),
  ADD COLUMN IF NOT EXISTS schedule jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(schedule) = 'array');

COMMENT ON COLUMN events.speakers IS
  'AFC-871: programme speakers section (jsonb array of {name, role, bio} objects, staff-managed). Empty until staff fills it.';
COMMENT ON COLUMN events.resources IS
  'AFC-871: programme resources section (jsonb array of {title, url, kind} objects, staff-managed). Empty until staff fills it.';
COMMENT ON COLUMN events.schedule IS
  'AFC-871: programme schedule section (jsonb array of {day, time, title} objects, staff-managed). Empty until staff fills it; the staff [id] page day-strip stays derived from start_at/end_at.';

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling (0021 posture extended). Table SELECT already
--    covers the new columns for reads; INSERT/UPDATE name them explicitly.
--    No DELETE change: events rows are cancelled, never deleted.
-- ---------------------------------------------------------------------------
GRANT INSERT (registration_visibility, speakers_visibility,
  resources_visibility, schedule_visibility, speakers, resources, schedule)
  ON events TO directus_app;
GRANT UPDATE (registration_visibility, speakers_visibility,
  resources_visibility, schedule_visibility, speakers, resources, schedule)
  ON events TO directus_app;
