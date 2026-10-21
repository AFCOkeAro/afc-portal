-- 20261020_0025_visitors_register.sql
--
-- Visitors register (AFC-583, parent AFC-566, ancestor AFC-460).
-- Spec authority: docs/planning/data-model-v4.md §2.1 (visitors deltas) +
-- §2.2/§2.7/§2.8 (stages, follow-ups, funnel views owned by 0008),
-- packages/shared visitorFormSchema (operations.ts: names, contact, visit,
-- age_group, owner, status), visitorConvertSchema / followUpFormSchema /
-- journeyAdvanceSchema (visitor-journey.ts), the Visitor/VisitorJourney
-- shared types, JOURNEY_FIELDS in apps/web/server/utils/visitor-journey.ts
-- (the exact 25 columns the routes select), and the eleven portal routes
-- under apps/web/server/api/visitors/.
--
-- SEQUENCE NOTE (verified at authoring time): 0024 is TAKEN
-- (20261020_0024_lagos_north_branches.sql, AFC-578, untracked in tree).
-- This file is 0025, the next free number. Suite number 89 is likewise
-- TAKEN (tests/db/89_lagos_north_branches.sql, AFC-578, untracked), so the
-- contract suite for this slice is 90 (tests/db/90_visitors_register.sql).
--
-- WHAT THIS FILE CREATES (verified: no CREATE TABLE visitors exists in
-- services/directus/schema/migrations/ -- 0008 touches visitors only
-- conditionally and states it never creates the table):
--   visitors -- the newcomer register: the AFC-147 base columns the routes
--     read/write (branch, visitor_first_name/last_name, email, phone,
--     visit_date, event, age_group, invited_by, person, status,
--     follow_up_owner, next_follow_up_date, notes) PLUS follow_up_notes
--     (the latest-summary denormalised field 0008 names as existing) PLUS
--     the full 0008 §6 journey-delta set (journey_stage,
--     journey_stage_entered_at, journey_started_at, pack_checklist,
--     dropoff_outcome, dropoff_visited_at, next_check_in_at,
--     last_contact_at, last_contact_channel, welfare_officer_assigned_at),
--     so 0008's conditional blocks become no-ops on re-apply -- same
--     treatment, no fork.
--   Four merge FKs (§3): visitors.person -> people (conversion link),
--     visitors.journey_stage -> visitor_journey_stages (under 0008's FIXED
--     name, closing its §6 conditional), visitor_follow_ups.visitor ->
--     visitors + visitor_journey_transitions.visitor -> visitors (closing
--     0008 §§2-3 bare-uuid merge contracts from the visitors side).
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   visitor_funnel + visitor_follow_up_status views: 0008 §2.8 owns that
--     read model and creates it conditionally where visitors exists. Now
--     that the host table lands, 0008's re-apply lands the views (pinned
--     in suite 90.4). Creating them here would fork 0008's ownership.
--   converted_person / welfare_officer columns: 0008 states person is the
--     canonical conversion link and follow_up_owner is the single owner
--     field. A second link or a second owner column would drift.
--   pack_id / pack-stock columns: the pack-stock engine is Slice 4
--     (AFC-464). Pack readiness here is the pack_checklist jsonb 0008
--     defined; Slice 4 may back it but must not redefine it.
--   dormancy_due_at / consent_* / consent_captured_at / consent_method /
--     source_detail: no portal route reads or writes them (verified by grep
--     over apps/web/server). Dormancy is derived (last_contact_at + 60d,
--     folded route-side); consent history lives in consent_records (0004
--     slice). Adding lifecycle no reader needs would invent state the
--     portal cannot move.
--   An events FK on visitors.event, or FKs on invited_by / follow_up_owner:
--     no merge contract names them (verified: only 0008 touches visitors,
--     and it names none of these). The event link stays a bare uuid -- a
--     visit may shadow an event without belonging to it (0023 precedent:
--     sessions.event is likewise bare). Officer validation lives in the
--     Flow + route (0008 stated choice -- leadership_positions is absent
--     from schema history, so no SQL can prove the position here).
--
-- CONDITIONAL OVERLAP, stated so a re-run stays silent:
--   0008 §6 adds the ten journey-delta columns IF NOT EXISTS, the two
--   CHECKs and the journey_stage FK under their FIXED names, the three
--   indexes, the two views, and the delta grants -- all guarded on the
--   visitors table existing. This file creates the table WITH the columns,
--   CHECKs (under the same fixed names), FK and indexes, so every 0008
--   block is a no-op on re-apply except the two views, which land for the
--   first time (their absence until now was the documented scratch skip).
--   0006 campaigns references visitors_by_stage audiences as a query kind,
--   not a table -- nothing to close from this side.
--
-- MERGE-CONTRACT NOTE (0008 says never fork visitors -- where the fork
-- risk lives and why this file is the owner):
--   0008 §"WHAT THIS FILE DELIBERATELY DOES NOT CREATE" forbids any later
--   slice from CREATEing a table named visitors. The fork risk lived in
--   exactly this gap: the routes assume a visitors register, the scratch
--   DB has none, and any slice could have invented a shadow with a subset
--   of columns. This file is the single owner because it creates the full
--   register the routes assume (base + 0008 deltas, suite 90 pins every
--   route-selected column) and closes each 0008 conditional under its
--   fixed name. Any later slice needing a visitors column must ALTER TABLE
--   ADD COLUMN, never CREATE TABLE -- the 0004/people merge-contract
--   posture, restated for visitors.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. visitors.branch nullable RESTRICT (null = area-wide, same posture
--      as events/departments/sessions: intake resolves null for area staff
--      without an explicit branch).
--   2. status CHECK is the live-portal five (new/follow_up/converted/
--      closed/declined). The §2.1 six (contacted/in_follow_up/connected/
--      integrated/dormant...) rename is NOT done here -- 0008's stated
--      choice stands (a data migration on personal data incl. minors needs
--      its own ticket + CTO approval). Conversion sets 'converted'.
--   3. FK policy per data-model §7 + 0008 precedent: visitors.person and
--      visitors.journey_stage are SET NULL (a person correction or a stage
--      reseed never deletes the newcomer row); the two audit-trail FKs
--      (§3c/d) are RESTRICT -- follow-ups and transitions are evidence, so
--      a visitor with care history cannot be hard-deleted while the trail
--      exists (refuse loudly, never CASCADE evidence away; SET NULL is
--      impossible -- both visitor columns are NOT NULL).
--   4. Email/phone shape is NOT CHECKed in SQL: the Nigerian-mobile and
--      email rules live in visitorFormSchema (zod) and the route rejects
--      bad input with a 400 before any INSERT. A SQL regex would double-own
--      what the route already proves (0023 precedent: no DB total trigger).
--   5. notes carries the same blank-guard as follow-up notes (NULL or real
--      text, never whitespace) -- intake sends null, not ''.
--
-- GRANTS (expansion §10 posture: one app identity; branch/zone scoping lives
-- in the Directus policy + portal route filters, not here). directus_app gets
-- SELECT everywhere, INSERT/UPDATE on operational columns (names, contact,
-- visit, journey deltas incl. follow_up_owner/status/person -- conversion,
-- assignment and the journey writer all move through UPDATEs), NO DELETE
-- (newcomer rows are personal data incl. minors; erasure runs as
-- retention_worker, never through the API). 0008's delta re-grant lands a
-- subset of the same ceiling -- idempotent, stated not silent. No
-- durations, no awareness_at.
--
-- Rollback: rollback/20261020_0025_visitors_register.down.sql (refuses
-- while visitors holds rows OR while the 0008 care trail holds rows;
-- drops the two audit-trail merge FKs first (F4), then 0008's read-model
-- views (forced -- DROP TABLE fails on the view dependency), then the
-- register; no CASCADE). Owner: migration role (directus_migrator). Never
-- run as directus_app. Role hygiene per ADR-0002: this file provisions no
-- roles and grants no role-creation or superuser capability; only
-- GRANT/REVOKE below.

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
-- 1. visitors (data-model-v4 §2.1 + AFC-147 base + 0008 §6 deltas).
--
-- The journey-delta columns ride the CREATE so 0008's ADD COLUMN blocks
-- are no-ops; the two CHECKs and the journey_stage FK are added in §2/§3
-- under 0008's FIXED names so its conditional blocks agree exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitors (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch                    uuid REFERENCES branches(id) ON DELETE RESTRICT,
  visitor_first_name        text NOT NULL CHECK (btrim(visitor_first_name) <> ''),
  visitor_last_name         text NOT NULL CHECK (btrim(visitor_last_name) <> ''),
  email                     text,
  phone                     text,
  visit_date                date NOT NULL,
  event                     uuid,
  age_group                 text NOT NULL DEFAULT 'unknown'
                              CHECK (age_group IN
                                ('adult', 'youth', 'teen', 'child', 'unknown')),
  invited_by                uuid,
  person                    uuid REFERENCES people(id) ON DELETE SET NULL,
  status                    text NOT NULL DEFAULT 'new'
                              CHECK (status IN
                                ('new', 'follow_up', 'converted', 'closed',
                                 'declined')),
  follow_up_owner           uuid,
  next_follow_up_date       date,
  notes                     text
                              CHECK (notes IS NULL OR btrim(notes) <> ''),
  follow_up_notes           text,
  journey_stage             uuid,
  journey_stage_entered_at  timestamptz,
  journey_started_at        date,
  pack_checklist            jsonb NOT NULL DEFAULT '[]'::jsonb,
  dropoff_outcome           text NOT NULL DEFAULT 'pending',
  dropoff_visited_at        timestamptz,
  next_check_in_at          timestamptz,
  last_contact_at           timestamptz,
  last_contact_channel      text,
  welfare_officer_assigned_at timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE visitors IS
  'Newcomer register (data-model-v4 §2.1, AFC-471/AFC-583). branch null = area-wide. status is the live-portal five (0008 stated choice -- no enum rename here). person is the canonical conversion link (no converted_person); follow_up_owner is the single owner field (no welfare_officer dup); pack readiness is pack_checklist (Slice 4 may back it, never redefine it). Owner of this table: 20261020_0025 -- later slices ALTER, never CREATE.';
COMMENT ON COLUMN visitors.event IS
  'Bare uuid (0023 sessions.event precedent): a visit may shadow an event without belonging to it. No merge contract names this link.';
COMMENT ON COLUMN visitors.follow_up_notes IS
  'Latest-summary denormalised field (0008 contract): the Flow visitor.touch_contact writes the summary here; the outcome log stays in visitor_follow_ups.';

CREATE INDEX IF NOT EXISTS visitors_branch_idx ON visitors (branch);
CREATE INDEX IF NOT EXISTS visitors_status_idx ON visitors (status);
CREATE INDEX IF NOT EXISTS visitors_visit_date_idx ON visitors (visit_date DESC);
CREATE INDEX IF NOT EXISTS visitors_person_idx ON visitors (person)
  WHERE person IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. 0008 §6 close-outs from the visitors side (0008 precedent: the slice
--    that lands the host table closes the conditional deltas under their
--    FIXED names, so reruns and contract tests agree). Column blocks are
--    no-ops (the CREATE above ships them); the CHECKs, FK, indexes and
--    grants below use 0008's exact names so its re-apply agrees exactly.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE NOTICE 'Skipping visitors journey-delta close-outs: table not present (this file just created it -- this NOTICE means the CREATE above did not run).';
    RETURN;
  END IF;

  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_stage uuid;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_stage_entered_at timestamptz;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_started_at date;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS pack_checklist jsonb;
  ALTER TABLE visitors ALTER COLUMN pack_checklist SET DEFAULT '[]'::jsonb;
  ALTER TABLE visitors ALTER COLUMN pack_checklist SET NOT NULL;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS dropoff_outcome text;
  ALTER TABLE visitors ALTER COLUMN dropoff_outcome SET DEFAULT 'pending';
  ALTER TABLE visitors ALTER COLUMN dropoff_outcome SET NOT NULL;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS dropoff_visited_at timestamptz;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS next_check_in_at timestamptz;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_contact_at timestamptz;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS last_contact_channel text;
  ALTER TABLE visitors ADD COLUMN IF NOT EXISTS welfare_officer_assigned_at timestamptz;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_dropoff_outcome_valid') THEN
    ALTER TABLE visitors
      ADD CONSTRAINT visitors_dropoff_outcome_valid
      CHECK (dropoff_outcome IN ('pending', 'address_confirmed', 'moved',
                                 'not_home', 'declined', 'wrong_number'));
    RAISE NOTICE 'CHECK added: visitors_dropoff_outcome_valid (closes 0008 §6 merge contract).';
  ELSE
    RAISE NOTICE 'visitors_dropoff_outcome_valid already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_last_contact_channel_valid') THEN
    ALTER TABLE visitors
      ADD CONSTRAINT visitors_last_contact_channel_valid
      CHECK (last_contact_channel IS NULL OR last_contact_channel IN
        ('whatsapp', 'sms', 'phone', 'visit', 'in_person', 'none'));
    RAISE NOTICE 'CHECK added: visitors_last_contact_channel_valid (closes 0008 §6 merge contract).';
  ELSE
    RAISE NOTICE 'visitors_last_contact_channel_valid already present, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_journey_stage_fkey') THEN
    ALTER TABLE visitors
      ADD CONSTRAINT visitors_journey_stage_fkey
      FOREIGN KEY (journey_stage) REFERENCES visitor_journey_stages(id)
      ON DELETE SET NULL;
    RAISE NOTICE 'FK added: visitors.journey_stage -> visitor_journey_stages(id) SET NULL (closes 0008 §6 merge contract).';
  ELSE
    RAISE NOTICE 'FK already present on visitors.journey_stage, left alone.';
  END IF;

  CREATE INDEX IF NOT EXISTS visitors_journey_stage_idx ON visitors (journey_stage);
  CREATE INDEX IF NOT EXISTS visitors_next_check_in_idx
    ON visitors (next_check_in_at) WHERE next_check_in_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS visitors_follow_up_owner_idx
    ON visitors (follow_up_owner) WHERE follow_up_owner IS NOT NULL;
  RAISE NOTICE 'visitors journey deltas ensured (0008 §6 closed under fixed names).';
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit-trail merge close-outs (0008 §§2-3 pattern: visitor/branch/
--    welfare_case/communication/logged_by are bare uuids; the owning slice
--    adds the FKs). The visitors side lands the two visitor links here
--    under these FIXED names; later slices must not redefine them.
--    (a) visitors_person_fkey -- the conversion link (0008: person is the
--        canonical link). SET NULL: a person correction never deletes the
--        newcomer row.
--    (b) visitor_follow_ups_visitor_fkey -- the outcome log. RESTRICT:
--        the log is evidence (stated choice 3).
--    (c) visitor_journey_transitions_visitor_fkey -- the stage-move audit.
--        RESTRICT: the trail is evidence (stated choice 3).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.people') IS NULL THEN
    RAISE NOTICE 'Skipping visitors_person_fkey: people not present. The FK lands when people exists; until then the conversion link stays a bare uuid.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_person_fkey') THEN
    ALTER TABLE visitors ADD CONSTRAINT visitors_person_fkey
      FOREIGN KEY (person) REFERENCES people(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: visitors.person -> people(id) SET NULL (the canonical conversion link).';
  ELSE
    RAISE NOTICE 'visitors_person_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.visitor_follow_ups') IS NULL THEN
    RAISE NOTICE 'Skipping visitor_follow_ups_visitor_fkey: table not present. The FK lands when visitor_follow_ups exists; until then outcome rows stay bare uuids under the 0008 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitor_follow_ups_visitor_fkey') THEN
    ALTER TABLE visitor_follow_ups ADD CONSTRAINT visitor_follow_ups_visitor_fkey
      FOREIGN KEY (visitor) REFERENCES visitors(id) ON DELETE RESTRICT;
    RAISE NOTICE 'FK added: visitor_follow_ups.visitor -> visitors(id) RESTRICT (closes 0008 §2 merge contract; the log is evidence).';
  ELSE
    RAISE NOTICE 'visitor_follow_ups_visitor_fkey already present, left alone.';
  END IF;

  IF to_regclass('public.visitor_journey_transitions') IS NULL THEN
    RAISE NOTICE 'Skipping visitor_journey_transitions_visitor_fkey: table not present. The FK lands when the transitions table exists; until then audit rows stay bare uuids under the 0008 merge contract.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitor_journey_transitions_visitor_fkey') THEN
    ALTER TABLE visitor_journey_transitions ADD CONSTRAINT visitor_journey_transitions_visitor_fkey
      FOREIGN KEY (visitor) REFERENCES visitors(id) ON DELETE RESTRICT;
    RAISE NOTICE 'FK added: visitor_journey_transitions.visitor -> visitors(id) RESTRICT (closes 0008 §3 merge contract; the trail is evidence).';
  ELSE
    RAISE NOTICE 'visitor_journey_transitions_visitor_fkey already present, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Least-privilege ceiling. No DELETE on the register. The journey-delta
--    re-grant below mirrors 0008 §7 exactly (same columns, idempotent) so
--    its re-apply agrees with this ceiling instead of widening it.
-- ---------------------------------------------------------------------------
GRANT SELECT ON visitors TO directus_app;
GRANT INSERT (branch, visitor_first_name, visitor_last_name, email, phone,
  visit_date, event, age_group, invited_by, person, status, follow_up_owner,
  next_follow_up_date, notes, follow_up_notes, journey_stage,
  journey_stage_entered_at, journey_started_at, pack_checklist,
  dropoff_outcome, dropoff_visited_at, next_check_in_at, last_contact_at,
  last_contact_channel, welfare_officer_assigned_at)
  ON visitors TO directus_app;
GRANT UPDATE (branch, visitor_first_name, visitor_last_name, email, phone,
  visit_date, event, age_group, invited_by, person, status, follow_up_owner,
  next_follow_up_date, notes, follow_up_notes, journey_stage,
  journey_stage_entered_at, journey_started_at, pack_checklist,
  dropoff_outcome, dropoff_visited_at, next_check_in_at, last_contact_at,
  last_contact_channel, welfare_officer_assigned_at)
  ON visitors TO directus_app;

REVOKE ALL ON visitors FROM PUBLIC;
