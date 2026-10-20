-- 20261020_0008_visitor_journey.sql
--
-- Slice 2c: newcomer journey stages, follow-ups, funnel, conversion + dedupe
-- (AFC-471, parent AFC-462). Spec authority:
-- docs/planning/data-model-v4.md §2 (§2.1 visitors deltas, §2.2 stages,
-- §2.7 follow-ups, §2.8 funnel views, §5 permission matrix, §6 indexes),
-- docs/planning/prd-addendum-v4.md newcomer slice. Full campaign engine and
-- pack-stock engine are OUT (Slice 4, AFC-464, ADR-0009).
--
-- WHAT THIS FILE CREATES
--   visitor_journey_stages -- seedable reference (key, name, sequence,
--     target_days, requires_pack, requires_visit_outcome, default_owner_role,
--     branch NULL = area-wide default set) + the five seeded stages
--     (identify/welcome/pack/dropoff/follow_up, sequences 1-5).
--   visitor_follow_ups -- the outcome log (§2.7): visitor/branch bare uuids
--     (visitors/branches owned elsewhere), contact_at/channel/outcome enum,
--     restricted notes, welfare_case bare uuid, next_step/next_follow_up_at,
--     logged_by, communication bare uuid.
--   visitor_journey_transitions -- the audit row for every stage move
--     (visitor bare uuid, from_stage/to_stage FKs to stages, entered_at
--     default now(), logged_by, note) + journey_transition_guard trigger:
--     forward-one-step only, initial capture must be sequence 1.
--   journey_can_advance(from_seq, to_seq) -- pure order rule, IMMUTABLE, so
--     the Directus Flow (journey.sequence_guard) and the route share it.
--   journey_pack_complete(checklist, required) -- pure pack gate, IMMUTABLE.
--   journey_dropoff_complete(outcome) -- pure drop-off gate, IMMUTABLE.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   visitors -- owned by the Directus snapshot (AFC-147). Journey columns are
--     added CONDITIONALLY (0002 §10 pattern): where the table exists the
--     columns land; where it does not (scratch DB) a NOTICE names the
--     Directus field spec that stays the authority. This file never CREATEs
--     a table named visitors and must not be forked by a later slice.
--   visitor_packs / visitor_pack_items / visitor_pack_item_types -- the
--     pack-stock engine is Slice 4 (AFC-464). Pack readiness here is a
--     lightweight visitors.pack_checklist jsonb (completed item keys from
--     the §2.3 board list); Slice 4 may back it from pack tables but must
--     not redefine the column.
--   people -- conversion links the existing visitors.person column (the
--     canonical link per §2.1 design note; converted_person is NOT added).
--     No people column is created or altered here.
--   campaigns / event_invites / member OTP -- other slices (ADR-0009).
--
-- STATED CHOICES (spec silent or contradictory -- data-model-v4 §2.1 vs the
-- live portal, recorded not silent):
--   STATUS ENUM KEPT. §2.1 says visitors.status holds
--     new/contacted/in_follow_up/connected/integrated/dormant, but the live
--     portal (packages/shared visitorFormSchema, routes, list filters)
--     stores new/follow_up/converted/closed/declined. Renaming the enum is a
--     data migration on personal data (including minors) and needs CTO
--     approval; it is NOT done here. journey_stage is the ordered state
--     machine; conversion sets status='converted' (the existing terminal
--     value, i.e. PRD "Integrated"). A status-enum migration, if the board
--     wants it, is its own ticket with its own approval.
--   OFFICER VALIDATION LIVES IN FLOW + ROUTE. §2.1 requires follow_up_owner
--     to hold the Welfare position in the same branch (Flow
--     visitor.validate_officer). leadership_positions is absent from schema
--     history, so no SQL can prove the position here; the route checks the
--     Directus collection and fails closed, and the suite pins the pure
--     helpers instead of inventing a positions table this slice does not own.
--   FUNNEL VIEWS ARE CONDITIONAL. §2.8 wants visitor_funnel and
--     visitor_follow_up_status views over visitors; without the host table
--     they cannot exist, so they are created only where visitors exists.
--     The portal route folds loaded rows (attendance-report pattern), so
--     reporting works with or without the views; the views are a read-model
--     convenience, never a second source of truth.
--
-- ACCEPTANCE, ENCODED IN SCHEMA (pinned by suite 76):
--   a skipped/backward/repeat stage move is rejected at INSERT; pack-gated
--     moves need a complete checklist and drop-off-gated moves need an
--     outcome (where the visitors table exists to hold them); every move
--     leaves its audit row with entered_at; follow-up outcomes outside the
--     §2.7 enum are rejected; the app cannot rewrite frozen follow-up
--     columns and cannot delete audit rows.
--
-- Rollback: rollback/20261020_0008_visitor_journey.down.sql (refuses while
-- follow-ups or transitions hold rows; drops the guard trigger with its
-- referent table, then functions, views, tables, conditional columns last).
-- Owner: migration role (directus_migrator). Never run as directus_app.
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE below.

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
-- 1. visitor_journey_stages (data-model-v4 §2.2).
--
-- branch NULL = the area-wide default set. key/sequence uniqueness is per
-- scope: Postgres treats NULLs as distinct, so one plain UNIQUE would admit
-- two global 'identify' rows -- hence the four partial indexes below.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitor_journey_stages (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                    text NOT NULL
                           CHECK (btrim(key) <> ''),
  name                   text NOT NULL
                           CHECK (btrim(name) <> ''),
  sequence               integer NOT NULL CHECK (sequence >= 1),
  description            text,
  entry_criteria         jsonb NOT NULL DEFAULT '{}'::jsonb,
  exit_criteria          jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_days            integer NOT NULL DEFAULT 7 CHECK (target_days >= 0),
  default_owner_role     text NOT NULL DEFAULT 'volunteer'
                           CHECK (default_owner_role IN
                             ('usher', 'volunteer', 'branch_admin',
                              'welfare_officer')),
  requires_pack          boolean NOT NULL DEFAULT false,
  requires_visit_outcome boolean NOT NULL DEFAULT false,
  is_terminal            boolean NOT NULL DEFAULT false,
  branch                 uuid,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE visitor_journey_stages IS
  'Newcomer journey stages (data-model-v4 §2.2, AFC-471). Seedable reference; branch NULL = area-wide defaults. Forward-one-step moves enforced by journey_transition_guard on visitor_journey_transitions. Pack-stock engine is OUT (Slice 4): requires_pack is satisfied by visitors.pack_checklist.';

CREATE UNIQUE INDEX IF NOT EXISTS visitor_journey_stages_global_key_uidx
  ON visitor_journey_stages (key) WHERE branch IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visitor_journey_stages_branch_key_uidx
  ON visitor_journey_stages (branch, key) WHERE branch IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visitor_journey_stages_global_seq_uidx
  ON visitor_journey_stages (sequence) WHERE branch IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS visitor_journey_stages_branch_seq_uidx
  ON visitor_journey_stages (branch, sequence) WHERE branch IS NOT NULL;

-- Seed: the five board stages (§2.2 seed table). ON CONFLICT DO NOTHING on
-- the global-key index, FKs need no resolution (branch NULL), reruns clean.
INSERT INTO visitor_journey_stages
  (key, name, sequence, description, target_days, default_owner_role,
   requires_pack, requires_visit_outcome, is_terminal, branch, active)
VALUES
  ('identify', 'Identify (announcement)', 1,
   'First capture: name and contact taken at announcement or walk-in.',
   1, 'usher', false, false, false, NULL, true),
  ('welcome', 'Welcome (data collection)', 2,
   'Welcome desk collects visit detail and consent.',
   1, 'volunteer', false, false, false, NULL, true),
  ('pack', 'Pack (welcome literature)', 3,
   'Literature, sermon notes, gift bag, malt, biscuits, contact card.',
   2, 'usher', true, false, false, NULL, true),
  ('dropoff', 'Drop-off (address visit)', 4,
   'Welfare visit to confirm the newcomer address; needs an outcome.',
   7, 'welfare_officer', false, true, false, NULL, true),
  ('follow_up', 'Follow-up (memory verses)', 5,
   'Weekly check-ins and memory verses until integrated or dormant.',
   60, 'welfare_officer', false, false, false, NULL, true)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. visitor_follow_ups (data-model-v4 §2.7, the outcome log).
--
-- MERGE CONTRACT (the 0005 pattern): visitor/branch/welfare_case/
-- communication/logged_by are bare uuids. The owning slices add the FKs and
-- must not CREATE a table named visitor_follow_ups and must not redefine
-- the columns created here.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitor_follow_ups (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor          uuid NOT NULL,
  branch           uuid,
  contact_at       timestamptz NOT NULL DEFAULT now(),
  contact_channel  text NOT NULL
                     CHECK (contact_channel IN
                       ('whatsapp', 'sms', 'phone', 'visit', 'in_person')),
  outcome          text NOT NULL
                     CHECK (outcome IN
                       ('reached', 'no_answer', 'requested_visit',
                        'needs_support', 'declined', 'moved',
                        'wrong_number', 'integrated')),
  notes            text,
  welfare_case     uuid,
  next_step        text,
  next_follow_up_at date,
  logged_by        uuid,
  communication    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visitor_follow_ups_notes_not_blank
    CHECK (notes IS NULL OR btrim(notes) <> '')
);

COMMENT ON TABLE visitor_follow_ups IS
  'Newcomer outcome log (data-model-v4 §2.7, AFC-471). One row = one contact. notes is restricted (branch admin + assigned officer + area, Directus policy); outcome/channel/contact are immutable after insert -- a correction is a new row, not an edit. visitors.follow_up_notes stays the latest-summary denormalised field (Flow visitor.touch_contact).';
COMMENT ON COLUMN visitor_follow_ups.notes IS
  'Restricted read: branch admin, assigned officer, area and above (data-model-v4 §5). Enforced in the Directus policy; this layer withholds no column from directus_app because Postgres sees one app identity (0005 §7 pattern).';

CREATE INDEX IF NOT EXISTS visitor_follow_ups_visitor_contact_idx
  ON visitor_follow_ups (visitor, contact_at DESC);
CREATE INDEX IF NOT EXISTS visitor_follow_ups_branch_contact_idx
  ON visitor_follow_ups (branch, contact_at DESC) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS visitor_follow_ups_outcome_idx
  ON visitor_follow_ups (outcome);
CREATE INDEX IF NOT EXISTS visitor_follow_ups_logged_by_idx
  ON visitor_follow_ups (logged_by) WHERE logged_by IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. visitor_journey_transitions (the audit row for every stage move).
--
-- from_stage NULL = initial capture (must land on sequence 1). The guard
-- trigger below is the sequence guard (Flow journey.sequence_guard shares
-- journey_can_advance); the trigger is the enforcement that survives a
-- Flow that is edited in Studio without review.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS visitor_journey_transitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor    uuid NOT NULL,
  from_stage uuid REFERENCES visitor_journey_stages(id) ON DELETE RESTRICT,
  to_stage   uuid NOT NULL REFERENCES visitor_journey_stages(id) ON DELETE RESTRICT,
  entered_at timestamptz NOT NULL DEFAULT now(),
  logged_by  uuid,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE visitor_journey_transitions IS
  'Stage-move audit (AFC-471). Every transition stamps entered_at and leaves this row; the row is immutable (no UPDATE/DELETE for the app). journey_transition_guard rejects skips, repeats and backward moves at INSERT.';

CREATE INDEX IF NOT EXISTS visitor_journey_transitions_visitor_entered_idx
  ON visitor_journey_transitions (visitor, entered_at DESC);

-- ---------------------------------------------------------------------------
-- 4. Pure gates. IMMUTABLE, no table access except the guard's own stage
--    reads (STABLE there): the Flow and the route share these rules.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION journey_can_advance(p_from_seq integer, p_to_seq integer)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_to_seq IS NULL THEN
    RAISE EXCEPTION
      'journey_can_advance: target sequence is required'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_from_seq IS NULL THEN
    RETURN p_to_seq = 1;
  END IF;
  RETURN p_to_seq = p_from_seq + 1;
END
$$;

COMMENT ON FUNCTION journey_can_advance(integer, integer) IS
  'Newcomer order rule (AFC-471). Initial capture (NULL from) must land on sequence 1; every later move must step exactly one forward. Skips, repeats and backward moves return false; the trigger raises, the Flow/route branch on the boolean.';

CREATE OR REPLACE FUNCTION journey_pack_complete(p_checklist jsonb, p_required text[])
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_item text;
  v_have jsonb;
BEGIN
  IF p_required IS NULL OR array_length(p_required, 1) IS NULL THEN
    RETURN true;
  END IF;
  v_have := COALESCE(p_checklist, '[]'::jsonb);
  IF jsonb_typeof(v_have) <> 'array' THEN
    RETURN false;
  END IF;
  FOREACH v_item IN ARRAY p_required LOOP
    IF NOT v_have ? v_item THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END
$$;

COMMENT ON FUNCTION journey_pack_complete(jsonb, text[]) IS
  'Pack gate (AFC-471; pack-stock engine OUT, Slice 4). True when every required item key is present in the checklist array. Empty required set = nothing to prove = true.';

CREATE OR REPLACE FUNCTION journey_dropoff_complete(p_outcome text)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p_outcome IS NOT NULL
    AND btrim(p_outcome) <> ''
    AND p_outcome <> 'pending';
END
$$;

COMMENT ON FUNCTION journey_dropoff_complete(text) IS
  'Drop-off gate (AFC-471, data-model-v4 §2.1 dropoff_outcome). True when a real outcome was recorded: address_confirmed, moved, not_home, declined or wrong_number. NULL/blank/pending = the visit has not happened.';

CREATE OR REPLACE FUNCTION journey_required_pack_items()
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN ARRAY['literature', 'sermon_notes', 'gift_bag', 'malt',
               'biscuits', 'contact_card'];
END
$$;

COMMENT ON FUNCTION journey_required_pack_items() IS
  'The six board-list pack item keys (data-model-v4 §2.3 seed). The pack stage requires all six checked; Slice 4 (pack-stock) reuses this list, it does not redefine it.';

-- ---------------------------------------------------------------------------
-- 5. The guard trigger. Raises check_violation (23514) on any illegal move,
--    so suites pin the same code a CHECK would raise.
--
-- Pack/drop-off gates read the visitors row only where the visitors table
-- exists. Where it does not (scratch DB) there is no checklist or outcome
-- to read, so adjacency alone is enforced -- the pure functions above carry
-- the gate contract there (suite 76.3), and the 0002 §10 NOTICE below names
-- the Directus field spec that stays the authority.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION journey_transition_guard()
RETURNS trigger
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_from_seq integer;
  v_to_seq integer;
  v_to_active boolean;
  v_requires_pack boolean;
  v_requires_outcome boolean;
  v_checklist jsonb;
  v_outcome text;
BEGIN
  SELECT sequence, active, requires_pack, requires_visit_outcome
    INTO v_to_seq, v_to_active, v_requires_pack, v_requires_outcome
    FROM visitor_journey_stages WHERE id = NEW.to_stage;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'journey: target stage % does not exist', NEW.to_stage
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT COALESCE(v_to_active, false) THEN
    RAISE EXCEPTION
      'journey: target stage % is not active', NEW.to_stage
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.from_stage IS NOT NULL THEN
    SELECT sequence INTO v_from_seq
      FROM visitor_journey_stages WHERE id = NEW.from_stage;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'journey: source stage % does not exist', NEW.from_stage
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NOT journey_can_advance(v_from_seq, v_to_seq) THEN
    RAISE EXCEPTION
      'journey: illegal move from sequence % to sequence % -- one step forward only',
      COALESCE(v_from_seq::text, '(capture)'), v_to_seq
      USING ERRCODE = 'check_violation';
  END IF;

  IF (v_requires_pack OR v_requires_outcome)
     AND to_regclass('public.visitors') IS NOT NULL THEN
    SELECT pack_checklist, dropoff_outcome INTO v_checklist, v_outcome
      FROM visitors WHERE id = NEW.visitor;
    IF v_requires_pack
       AND NOT journey_pack_complete(v_checklist,
                                     journey_required_pack_items()) THEN
      RAISE EXCEPTION
        'journey: the pack stage requires all six checklist items for visitor %',
        NEW.visitor
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_requires_outcome AND NOT journey_dropoff_complete(v_outcome) THEN
      RAISE EXCEPTION
        'journey: the drop-off stage requires a recorded visit outcome for visitor %',
        NEW.visitor
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS journey_transition_guard_trg
  ON visitor_journey_transitions;

CREATE TRIGGER journey_transition_guard_trg
  BEFORE INSERT ON visitor_journey_transitions
  FOR EACH ROW EXECUTE FUNCTION journey_transition_guard();

-- ---------------------------------------------------------------------------
-- 6. Conditional deltas on visitors (0002 §10 pattern) + conditional funnel
--    views (§2.8). Each block runs only where the host table exists;
--    otherwise a NOTICE names the Directus field spec that remains the
--    authority. No table is created here that another slice owns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE NOTICE 'Skipping visitors journey deltas: table not present. Directus fields journey_stage (M2O visitor_journey_stages), journey_stage_entered_at (datetime), journey_started_at (date), pack_checklist (json, default []), dropoff_outcome (enum pending/address_confirmed/moved/not_home/declined/wrong_number), dropoff_visited_at (datetime), next_check_in_at (datetime), last_contact_at (datetime), last_contact_channel (enum whatsapp/sms/phone/visit/in_person/none), welfare_officer_assigned_at (datetime) per data-model-v4 §2.1. Existing follow_up_owner/person/notes/next_follow_up_date are unchanged.';
  ELSE
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_stage uuid;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_stage_entered_at timestamptz;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS journey_started_at date;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS pack_checklist jsonb NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE visitors ADD COLUMN IF NOT EXISTS dropoff_outcome text NOT NULL DEFAULT 'pending';
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
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_last_contact_channel_valid') THEN
      ALTER TABLE visitors
        ADD CONSTRAINT visitors_last_contact_channel_valid
        CHECK (last_contact_channel IS NULL OR last_contact_channel IN
          ('whatsapp', 'sms', 'phone', 'visit', 'in_person', 'none'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visitors_journey_stage_fkey') THEN
      ALTER TABLE visitors
        ADD CONSTRAINT visitors_journey_stage_fkey
        FOREIGN KEY (journey_stage) REFERENCES visitor_journey_stages(id)
        ON DELETE SET NULL;
      RAISE NOTICE 'FK added: visitors.journey_stage -> visitor_journey_stages(id) SET NULL.';
    ELSE
      RAISE NOTICE 'FK already present on visitors.journey_stage, left alone.';
    END IF;
    CREATE INDEX IF NOT EXISTS visitors_journey_stage_idx ON visitors (journey_stage);
    CREATE INDEX IF NOT EXISTS visitors_next_check_in_idx
      ON visitors (next_check_in_at) WHERE next_check_in_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS visitors_follow_up_owner_idx
      ON visitors (follow_up_owner) WHERE follow_up_owner IS NOT NULL;
    RAISE NOTICE 'visitors journey deltas ensured (stage, entered_at, started_at, pack_checklist, dropoff outcome/visited_at, check-in/contact, officer assigned_at).';
  END IF;
END
$$;

-- §2.8 read model. Created only where visitors exists; the portal route
-- folds loaded rows either way (attendance-report pattern), so the views
-- are convenience, never a second truth.
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL THEN
    RAISE NOTICE 'Skipping visitor_funnel + visitor_follow_up_status views: visitors table not present. Reporting is a query over the route layer until the host table lands.';
  ELSE
    CREATE OR REPLACE VIEW visitor_funnel AS
      SELECT v.branch AS branch,
             s.key AS stage_key,
             count(*) AS visitors,
             count(*) FILTER (
               WHERE v.journey_stage_entered_at >= now() - interval '7 days'
             ) AS new_this_week,
             avg(EXTRACT(epoch FROM (now() - v.journey_stage_entered_at)) / 86400.0)
               FILTER (WHERE v.journey_stage_entered_at IS NOT NULL)
               AS avg_days_in_stage,
             count(*) FILTER (
               WHERE v.journey_stage_entered_at IS NOT NULL
                 AND v.journey_stage_entered_at
                     < now() - (s.target_days || ' days')::interval
             ) AS overdue_count
        FROM visitors v
        JOIN visitor_journey_stages s ON s.id = v.journey_stage
       WHERE s.branch IS NULL
       GROUP BY v.branch, s.key, s.sequence
       ORDER BY s.sequence;

    CREATE OR REPLACE VIEW visitor_follow_up_status AS
      SELECT v.branch AS branch,
             v.follow_up_owner AS officer,
             count(*) FILTER (
               WHERE v.next_check_in_at IS NOT NULL
                 AND v.next_check_in_at::date = CURRENT_DATE
             ) AS due_today,
             count(*) FILTER (
               WHERE v.next_check_in_at IS NOT NULL
                 AND v.next_check_in_at < now()
             ) AS overdue,
             count(*) FILTER (WHERE v.follow_up_owner IS NULL
               AND v.journey_started_at IS NOT NULL
               AND v.journey_started_at < CURRENT_DATE - 3) AS unassigned_over_3d
        FROM visitors v
       GROUP BY v.branch, v.follow_up_owner;

    RAISE NOTICE 'visitor_funnel + visitor_follow_up_status views ensured.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Least privilege (data-model-expansion §10 pattern, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- branch scoping, the notes restriction and the officer-position rule live
-- in the Directus policy + portal route filters, not here. This layer states
-- the ceiling:
--   stages: the app reads the ordered reference; branch-scoped rows are
--     inserted/updated through the listed columns, never deleted (config is
--     audited -- a stage with transitions is RESTRICTed anyway).
--   follow_ups: the app inserts the resolved row and advances next_step /
--     next_follow_up_at / welfare_case only. outcome, contact_channel,
--     contact_at, visitor and notes are immutable (no UPDATE grant): a
--     correction is a new row, not an edit. Nothing is deletable: the log
--     is audited (data-model-v4 §4.2 pattern).
--   transitions: the app inserts the audit row and reads it. No UPDATE, no
--     DELETE: the trail is the evidence.
--   visitors deltas: granted only where the host table exists (EXECUTE in
--     §6); the scratch DB has no such table.
-- ---------------------------------------------------------------------------
GRANT SELECT ON visitor_journey_stages TO directus_app;
GRANT INSERT (key, name, sequence, description, entry_criteria,
  exit_criteria, target_days, default_owner_role, requires_pack,
  requires_visit_outcome, is_terminal, branch, active) ON visitor_journey_stages TO directus_app;
GRANT UPDATE (name, description, entry_criteria, exit_criteria, target_days,
  default_owner_role, requires_pack, requires_visit_outcome, is_terminal,
  active, updated_at) ON visitor_journey_stages TO directus_app;

GRANT SELECT ON visitor_follow_ups TO directus_app;
GRANT INSERT (visitor, branch, contact_at, contact_channel, outcome, notes,
  welfare_case, next_step, next_follow_up_at, logged_by,
  communication) ON visitor_follow_ups TO directus_app;
GRANT UPDATE (next_step, next_follow_up_at, welfare_case) ON visitor_follow_ups TO directus_app;

GRANT SELECT ON visitor_journey_transitions TO directus_app;
GRANT INSERT (visitor, from_stage, to_stage, logged_by, note) ON visitor_journey_transitions TO directus_app;

REVOKE ALL ON visitor_journey_stages FROM PUBLIC;
REVOKE ALL ON visitor_follow_ups FROM PUBLIC;
REVOKE ALL ON visitor_journey_transitions FROM PUBLIC;

DO $$
BEGIN
  IF to_regclass('public.visitors') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT (journey_stage, journey_stage_entered_at, journey_started_at, pack_checklist, dropoff_outcome, dropoff_visited_at, next_check_in_at, last_contact_at, last_contact_channel, welfare_officer_assigned_at) ON visitors TO directus_app';
    EXECUTE 'GRANT UPDATE (journey_stage, journey_stage_entered_at, journey_started_at, pack_checklist, dropoff_outcome, dropoff_visited_at, next_check_in_at, last_contact_at, last_contact_channel, follow_up_owner, welfare_officer_assigned_at, status, person) ON visitors TO directus_app';
    RAISE NOTICE 'visitors journey-delta grants ensured.';
  ELSE
    RAISE NOTICE 'Skipping visitors journey-delta grants: table not present.';
  END IF;
END
$$;
