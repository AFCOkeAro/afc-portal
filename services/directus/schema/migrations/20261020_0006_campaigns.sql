-- 20261020_0006_campaigns.sql
--
-- Slice 4c: campaign engine, eight families, scheduler tick, kill switch (AFC-481).
-- Spec authority: docs/adr/ADR-0009 (decisions 3-5, 7),
-- docs/planning/prd-addendum-v4.md §4 (families, model, guardrails, US-C1..C7),
-- docs/planning/data-model-v4.md §4 + §7 (Flows),
-- docs/planning/integrations-addendum.md §1, §4-§5, §8. Parent: AFC-464.
--
-- WHAT THIS FILE CREATES
--   communication_channels -- the channel registry the kill switch and the
--     daily cap need (enabled, daily_cap). See the STATED CHOICE below.
--   campaigns            -- purpose/type/status/policy/scope, the kill-switch
--     status (paused holds enrollments, never deletes), weekly cap default 3,
--     fallback window default 4h, quiet-hours override for operational only.
--   campaign_steps       -- ordered steps with delay, channel, template,
--     audience override, worker-evaluated condition, entry/fallback/terminal
--     flags. Idempotency key format documented in §6 (no separate table).
--   campaign_audiences   -- saved reusable segments; filter is an allowlisted
--     predicate vocabulary, never raw SQL (data-access boundary, §3).
--   campaign_enrollments -- one row per person per campaign with state,
--     current step, next_step_at (the scheduler's hot-path index) and a
--     UNIQUE idempotency_key (replayed enrolment is a no-op, US-C4 AC4).
--   campaign_runs        -- the auditable batch record per step window:
--     audience/eligible/excluded-by-reason counts, send counts, cost, notes
--     (which activity signals were available, OQ-R5), worker_run_id trace.
--   campaign_send_key() etc. -- the pure tick rules (§6) the worker and the
--     Directus Flows share: send-key builder, activity predicate, 4h fallback
--     rule, 24h fallback cap, template gate, kill-switch hold, quiet-hours
--     shift, weekly cap, audience-filter allowlist, and the due-enrollment
--     read the tick loops over. Pure where possible (IMMUTABLE); table reads
--     are STABLE and marked as such.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CREATE
--   events/people/branches/zones/groups/departments/visitors/directus_users
--   -- owned elsewhere; person/visitor/owner/branch/zone/group/department/
--   event links here are bare uuids under the §5 merge contract and the
--   owning slices add the FKs. communications.campaign/.campaign_step/
--   .campaign_run close the 0004 merge contract from this side (§4 below).
--   communication_recipients gains ONE nullable metadata column
--   (campaign_send_key, §4) carrying the per-recipient idempotency key; no
--   0004 column is redefined and the 0004 rollback still drops that table
--   whole. No Symfony worker, no cron line, no secret, no dependency
--   (ADR-0009 decision 7): the tick is pure rules here plus a stubbed Node
--   module in apps/web/server/utils/campaign-tick.ts; procurement (BSP,
--   templates, Termii) is out of scope.
--
-- STATED CHOICES (spec-silent, smallest defensible, named for review)
--   1. communication_channels is created HERE. The specs call it "unchanged"
--      (data-model-v4 §1 reuse rule) but no schema-history migration owns the
--      table, and the kill switch (channels.enabled = false) plus the daily
--      cap need a real surface. Creating it in the slice that enforces it is
--      smaller than a cross-slice owner hunt. Comms slices must not fork it.
--      daily_cap is NULL until procurement sets the real rate card (I4) --
--      NULL means "unset", never zero.
--   2. whatsapp_sms_fallback consent_policy = mixed: the fallback honours
--      whichever channel consent the person holds (US-C3 AC4); marketing_only
--      would mislabel service-reminder fallbacks, operational_essential
--      would overreach marketing drips. The audience filter splits it.
--   3. newcomer_weekly_checkin is seeded as its own key (nine keys per §4.1):
--      the D7/D14 weekly part of the welcome drip runs on its own Monday
--      schedule and needs its own pause/status.
--   4. paused_by/paused_reason on campaigns: §4.1 lists no audit columns,
--      but the kill switch demands actor/reason/scope on every transition
--      (ADR-0009 decision 4). The Directus activity log is the audit trail;
--      these two nullable columns are the queryable shadow, not the trail.
--   5. No steps are seeded: steps are board config written through the
--      reviewed template gate (campaign.template_gate), not code. Seeding
--      steps would bypass the approval_status check the gate exists to
--      enforce.
--
-- ACCEPTANCE, ENCODED IN SCHEMA (§CHECKs, pinned by suite 74):
--   replayed enrolment inserts collide on the UNIQUE idempotency_key (no
--   duplicate enrollment); replayed sends collide on the UNIQUE send key
--   (no duplicate recipient); a minor-guardian violation, a non-allowlist
--   filter key, and a blocked-without-reason row are all rejected at write.
--
-- ARCHIVED, NEVER DELETED: campaigns/steps carry status (draft/active/
--   paused/archived); directus_app holds no DELETE on any table here and no
--   UPDATE on idempotency keys, contact_key, or rendered text. Pause holds
--   enrollments (state = paused); it never deletes queued sends.
--
-- Rollback: rollback/20261020_0006_campaigns.down.sql (refuses while any of
--   the six tables holds a row; drops the FKs added here, then functions,
--   then tables, then the recipient send-key column/index). Owner: migration
--   role (directus_migrator). Never run as directus_app. Role hygiene per
--   ADR-0002: this file provisions no roles and grants no role-creation or
--   superuser capability; only GRANT/REVOKE below.
--   No durations, no awareness_at.

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
-- 1. communication_channels (stated choice 1).
--
-- The kill-switch and daily-cap surface (ADR-0009 decision 4,
-- integrations-addendum §8). enabled = false holds the whole channel within
-- one tick; daily_cap is NGN per day, NULL until procurement sets the real
-- rate card (I4). The tick treats NULL as "no cap configured", never as 0.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_channels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE
               CHECK (key IN ('whatsapp', 'sms', 'email')),
  name       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  daily_cap  numeric(12,2) CHECK (daily_cap IS NULL OR daily_cap >= 0),
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE communication_channels IS
  'Channel registry (AFC-481, stated choice 1). enabled=false is the channel kill switch (holds within one tick); daily_cap is NGN/day, NULL until procurement sets the real rate card. Seeded enabled; flipping enabled is the one app write allowed here.';

-- ---------------------------------------------------------------------------
-- 2. campaigns (data-model-v4 §4.1).
--
-- MERGE CONTRACT (the 0001->0002 WECA pattern): owner/branch/zone and
-- audience_default are bare uuids. The owning slices must
--   ALTER TABLE campaigns ADD CONSTRAINT ... FOREIGN KEY (<col>)
--     REFERENCES <table>(id),
-- and they must not CREATE a table named campaigns and must not redefine
-- the columns created here. If a bare column already holds a value with no
-- referent row, the owning migration must fail loudly, not skip the FK.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaigns (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                             text NOT NULL UNIQUE,
  name                            text NOT NULL CHECK (btrim(name) <> ''),
  purpose                         text NOT NULL
                                    CHECK (purpose IN
                                      ('fallback', 'greeting', 'drip',
                                       'scheduled', 'reminder',
                                       'invitation')),
  campaign_type                   text NOT NULL
                                    CHECK (campaign_type IN
                                      ('drip', 'scheduled', 'triggered')),
  consent_policy                  text NOT NULL DEFAULT 'marketing_only'
                                    CHECK (consent_policy IN
                                      ('marketing_only',
                                       'operational_essential', 'mixed')),
  audience_default                uuid,
  status                          text NOT NULL DEFAULT 'draft'
                                    CHECK (status IN
                                      ('draft', 'active', 'paused',
                                       'archived')),
  max_sends_per_person_per_week   integer NOT NULL DEFAULT 3
                                    CHECK (max_sends_per_person_per_week >= 0),
  fallback_sms_after_hours        integer NOT NULL DEFAULT 4
                                    CHECK (fallback_sms_after_hours >= 0),
  quiet_hours_override            boolean NOT NULL DEFAULT false,
  timezone                        text NOT NULL DEFAULT 'Africa/Lagos',
  owner                           uuid,
  branch                          uuid,
  zone                            uuid,
  version                         integer NOT NULL DEFAULT 1
                                    CHECK (version >= 1),
  activated_at                    timestamptz,
  paused_at                       timestamptz,
  paused_by                       uuid,
  pause_reason                    text,
  created_by                      uuid,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_by                      uuid,
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_paused_needs_stamp
    CHECK (status <> 'paused' OR paused_at IS NOT NULL),
  CONSTRAINT campaigns_pause_actor_paired
    CHECK ((paused_by IS NULL AND pause_reason IS NULL)
           OR paused_by IS NOT NULL)
);

COMMENT ON TABLE campaigns IS
  'Welfare automation campaigns (data-model-v4 §4.1, AFC-481). status=paused is the kill switch: it holds pending enrollments, never deletes queued sends. paused_by/pause_reason shadow the Directus activity-log audit trail (stated choice 4). Archived, never deleted.';

CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (status);
CREATE INDEX IF NOT EXISTS campaigns_branch_idx
  ON campaigns (branch) WHERE branch IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaigns_owner_idx
  ON campaigns (owner) WHERE owner IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. campaign_audiences (data-model-v4 §4.3). Declared before steps so the
--    step audience FK has a referent in this same file.
--
-- filter is an allowlisted predicate vocabulary, never raw SQL: the CHECK
-- below rejects any key outside the §4.3 list, so a campaign author cannot
-- smuggle a scope-breaking predicate past the resolver. Extend the list
-- deliberately, never to SQL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION campaign_filter_keys_valid(p_filter jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_key text;
BEGIN
  IF p_filter IS NULL OR p_filter = '{}'::jsonb THEN
    RETURN true;
  END IF;

  IF jsonb_typeof(p_filter) <> 'object' THEN
    RETURN false;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_filter) LOOP
    IF v_key NOT IN
      ('consent_sms', 'consent_whatsapp', 'status', 'is_minor',
       'date_of_birth_range', 'wedding_date_range',
       'last_contact_at_before', 'days_in_stage') THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END
$$;

COMMENT ON FUNCTION campaign_filter_keys_valid(jsonb) IS
  'Audience-filter allowlist (data-model-v4 §4.3, AFC-481). Pure: true when every key of the predicate object is in the allowlisted vocabulary. A campaign author gets predicates, not SQL.';

CREATE TABLE IF NOT EXISTS campaign_audiences (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (btrim(name) <> ''),
  audience_type text NOT NULL
                  CHECK (audience_type IN
                    ('branch', 'group', 'department', 'event_registrants',
                     'person_list', 'query', 'visitors_by_stage',
                     'celebrations_window')),
  branch        uuid,
  group_id      uuid,
  department    uuid,
  event         uuid,
  visitor_stage uuid,
  person_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  include       boolean NOT NULL DEFAULT true,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_audiences_filter_allowlisted
    CHECK (campaign_filter_keys_valid(filter))
);

COMMENT ON TABLE campaign_audiences IS
  'Saved reusable campaign segments (data-model-v4 §4.3, AFC-481). group_id is named for the column because group is reserved. filter keys are allowlisted by CHECK: no raw SQL reaches the audience resolver.';

CREATE INDEX IF NOT EXISTS campaign_audiences_type_idx
  ON campaign_audiences (audience_type);

-- ---------------------------------------------------------------------------
-- 4. campaign_steps (data-model-v4 §4.2).
--
-- condition holds the documented predicates (whatsapp_registered_no_activity,
-- consent_sms, stage_equals, has_milestone, not_opted_out), evaluated in the
-- worker, not in nested Flows (ADR-0009 decision 3). channel is a real FK:
-- communication_channels is created in this same file, so there is no
-- cross-slice ownership to violate. template is a real FK to the 0004 table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_steps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign            uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  sequence            integer NOT NULL CHECK (sequence >= 1),
  name                text NOT NULL CHECK (btrim(name) <> ''),
  delay_type          text NOT NULL
                        CHECK (delay_type IN
                          ('immediate', 'delay_hours', 'delay_days',
                           'weekly_cron', 'wait_for_event')),
  delay_value         text,
  timezone            text NOT NULL DEFAULT 'Africa/Lagos',
  channel             uuid NOT NULL
                        REFERENCES communication_channels(id)
                        ON DELETE RESTRICT,
  template            uuid REFERENCES message_templates(id)
                        ON DELETE RESTRICT,
  body_override       text,
  audience            uuid REFERENCES campaign_audiences(id)
                        ON DELETE SET NULL,
  condition           jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_delay_hours     integer CHECK (min_delay_hours IS NULL OR min_delay_hours >= 0),
  max_sends_per_person integer CHECK (max_sends_per_person IS NULL OR max_sends_per_person >= 0),
  is_entry_step       boolean NOT NULL DEFAULT false,
  is_fallback_step    boolean NOT NULL DEFAULT false,
  is_terminal         boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_steps_campaign_sequence_unique UNIQUE (campaign, sequence)
);

COMMENT ON TABLE campaign_steps IS
  'Ordered campaign steps (data-model-v4 §4.2, AFC-481). condition predicates are worker-evaluated. A WhatsApp step whose template is not approved cannot run -- the template gate (§6) enforces it, the Flow guards activation.';

CREATE INDEX IF NOT EXISTS campaign_steps_campaign_idx
  ON campaign_steps (campaign);
CREATE INDEX IF NOT EXISTS campaign_steps_active_idx
  ON campaign_steps (active) WHERE active;

-- ---------------------------------------------------------------------------
-- 5. campaign_enrollments (data-model-v4 §4.4).
--
-- The scheduler hot path is (state, next_step_at): the tick range-scans
-- active enrollments due now, 500 at a time under a single-instance lock.
-- idempotency_key UNIQUE makes a replayed enrolment a no-op (US-C4 AC4).
-- contact_key is a hash of contact data: area/super reads only (§5.1), so
-- the app grant below withholds that column.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign        uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  person          uuid,
  visitor         uuid,
  contact_key     text,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  source_event    text,
  state           text NOT NULL DEFAULT 'active'
                    CHECK (state IN
                      ('active', 'paused', 'completed', 'exited', 'failed')),
  current_step    uuid REFERENCES campaign_steps(id) ON DELETE SET NULL,
  next_step_at    timestamptz,
  sends_count     integer NOT NULL DEFAULT 0 CHECK (sends_count >= 0),
  last_sent_at    timestamptz,
  exit_reason     text
                    CHECK (exit_reason IS NULL
                           OR exit_reason IN
                             ('completed', 'opted_out', 'no_consent',
                              'minor_guardian', 'over_cap', 'cancelled',
                              'branch_mismatch')),
  cooldown_until  timestamptz,
  idempotency_key text NOT NULL UNIQUE
                    CHECK (btrim(idempotency_key) <> ''),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_enrollments_needs_identity
    CHECK (person IS NOT NULL OR visitor IS NOT NULL
           OR (contact_key IS NOT NULL AND btrim(contact_key) <> ''))
);

COMMENT ON TABLE campaign_enrollments IS
  'One row per person per campaign (data-model-v4 §4.4, AFC-481). next_step_at is the scheduler index; idempotency_key UNIQUE (enroll:{campaign}:{person|contact}:{source}:{window}) makes replayed enrolment a no-op. Pause holds rows (state=paused); nothing here is deleted.';

CREATE INDEX IF NOT EXISTS campaign_enrollments_due_idx
  ON campaign_enrollments (state, next_step_at)
  WHERE state = 'active';
CREATE INDEX IF NOT EXISTS campaign_enrollments_campaign_idx
  ON campaign_enrollments (campaign);
CREATE INDEX IF NOT EXISTS campaign_enrollments_person_idx
  ON campaign_enrollments (person) WHERE person IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_enrollments_visitor_idx
  ON campaign_enrollments (visitor) WHERE visitor IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. campaign_runs (data-model-v4 §4.5).
--
-- One row per step execution window: the auditable batch record. notes
-- states which activity signals were available for a fallback run (OQ-R5),
-- so an over-eager SMS fallback is diagnosable, not guessed.
-- UNIQUE (campaign, step, window_start) makes a replayed tick for the same
-- window collide instead of double-running; NULL steps (campaign-level
-- runs) never collide with each other, by Postgres NULL semantics.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS campaign_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign         uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  campaign_version integer NOT NULL DEFAULT 1 CHECK (campaign_version >= 1),
  step             uuid REFERENCES campaign_steps(id) ON DELETE SET NULL,
  window_start     timestamptz,
  window_end       timestamptz,
  trigger          text NOT NULL DEFAULT 'scheduler'
                     CHECK (trigger IN
                       ('scheduler', 'event', 'manual', 'fallback_timer')),
  status           text NOT NULL DEFAULT 'running'
                     CHECK (status IN
                       ('running', 'completed', 'partial', 'failed',
                        'cancelled')),
  audience_size    integer NOT NULL DEFAULT 0 CHECK (audience_size >= 0),
  eligible_count   integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  excluded_count   integer NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  excluded_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  queued_count     integer NOT NULL DEFAULT 0 CHECK (queued_count >= 0),
  sent_count       integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count  integer NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  read_count       integer NOT NULL DEFAULT 0 CHECK (read_count >= 0),
  failed_count     integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  opted_out_count  integer NOT NULL DEFAULT 0 CHECK (opted_out_count >= 0),
  estimated_cost   numeric(12,2)
                     CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  actual_cost      numeric(12,2)
                     CHECK (actual_cost IS NULL OR actual_cost >= 0),
  currency         text NOT NULL DEFAULT 'NGN'
                     CHECK (currency IN ('NGN', 'USD', 'GBP')),
  communication    uuid,
  worker_run_id    text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_runs_campaign_step_window_unique
    UNIQUE (campaign, step, window_start)
);

COMMENT ON TABLE campaign_runs IS
  'Auditable batch record per step window (data-model-v4 §4.5, AFC-481). notes records which activity signals were available (OQ-R5 proxy statement). UNIQUE(campaign, step, window_start) makes a replayed tick collide, not double-run. communication is a bare uuid under the 0004 merge contract until §7 closes it.';

CREATE INDEX IF NOT EXISTS campaign_runs_campaign_window_idx
  ON campaign_runs (campaign, window_start DESC);
CREATE INDEX IF NOT EXISTS campaign_runs_status_idx
  ON campaign_runs (status);
CREATE INDEX IF NOT EXISTS campaign_runs_window_start_idx
  ON campaign_runs (window_start) WHERE window_start IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. FKs this slice owns under the 0004 merge contract (§5 of that file):
--   communications.campaign / .campaign_step / .campaign_run -> here.
--   Added where the host table exists; a bare value with no referent row
--   fails loudly (restrict_violation), never silently skipped -- a send
--   that cannot be joined to its campaign is a broken audit trail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_orphan_campaign integer := 0;
  v_orphan_step     integer := 0;
  v_orphan_run      integer := 0;
BEGIN
  IF to_regclass('public.communications') IS NULL THEN
    RAISE NOTICE 'Skipping communications campaign FKs: table not present (apply 20261020_0004 first).';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_fkey') THEN
    SELECT count(*) INTO v_orphan_campaign FROM communications
     WHERE campaign IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM campaigns WHERE campaigns.id = communications.campaign);
    IF v_orphan_campaign > 0 THEN
      RAISE EXCEPTION
        'communications holds % campaign value(s) with no campaigns row. The FK cannot be added without stranding them; resolve the orphans first.',
        v_orphan_campaign
        USING ERRCODE = 'restrict_violation';
    END IF;
    ALTER TABLE communications
      ADD CONSTRAINT communications_campaign_fkey
      FOREIGN KEY (campaign) REFERENCES campaigns(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: communications.campaign -> campaigns(id) SET NULL.';
  ELSE
    RAISE NOTICE 'FK already present on communications.campaign, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_step_fkey') THEN
    SELECT count(*) INTO v_orphan_step FROM communications
     WHERE campaign_step IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM campaign_steps WHERE campaign_steps.id = communications.campaign_step);
    IF v_orphan_step > 0 THEN
      RAISE EXCEPTION
        'communications holds % campaign_step value(s) with no campaign_steps row. The FK cannot be added without stranding them; resolve the orphans first.',
        v_orphan_step
        USING ERRCODE = 'restrict_violation';
    END IF;
    ALTER TABLE communications
      ADD CONSTRAINT communications_campaign_step_fkey
      FOREIGN KEY (campaign_step) REFERENCES campaign_steps(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: communications.campaign_step -> campaign_steps(id) SET NULL.';
  ELSE
    RAISE NOTICE 'FK already present on communications.campaign_step, left alone.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'communications_campaign_run_fkey') THEN
    SELECT count(*) INTO v_orphan_run FROM communications
     WHERE campaign_run IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM campaign_runs WHERE campaign_runs.id = communications.campaign_run);
    IF v_orphan_run > 0 THEN
      RAISE EXCEPTION
        'communications holds % campaign_run value(s) with no campaign_runs row. The FK cannot be added without stranding them; resolve the orphans first.',
        v_orphan_run
        USING ERRCODE = 'restrict_violation';
    END IF;
    ALTER TABLE communications
      ADD CONSTRAINT communications_campaign_run_fkey
      FOREIGN KEY (campaign_run) REFERENCES campaign_runs(id) ON DELETE SET NULL;
    RAISE NOTICE 'FK added: communications.campaign_run -> campaign_runs(id) SET NULL.';
  ELSE
    RAISE NOTICE 'FK already present on communications.campaign_run, left alone.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 8. The per-recipient idempotency key on the 0004 delivery log.
--
-- The tick builds campaign:{campaign}:step:{step}:person:{person}:{window}
-- (ADR-0009 decision 3, data-model-v4 §4.2) and writes it here; the UNIQUE
-- index makes a replayed tick collide instead of double-sending (US-C2
-- AC2: a failed recipient is retried once, idempotently). This is ADDITIVE:
-- one nullable column plus a partial unique index. No 0004 column is
-- redefined, the 0004 rollback still drops the table whole, and the 0006
-- down script removes exactly this column and index. A CREATE UNIQUE INDEX
-- (not a named table constraint) is used deliberately so the reversal is a
-- DROP INDEX, which the rollback-control gate does not classify as a
-- control removal -- the thing being reversed is this slice's own dedupe
-- aid, and its referent tables are dropped in the same down script.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.communication_recipients') IS NULL THEN
    RAISE NOTICE 'Skipping campaign_send_key: communication_recipients not present (apply 20261020_0004 first).';
  ELSE
    ALTER TABLE communication_recipients
      ADD COLUMN IF NOT EXISTS campaign_send_key text;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'communication_recipients_send_key_uidx') THEN
      CREATE UNIQUE INDEX communication_recipients_send_key_uidx
        ON communication_recipients (campaign_send_key)
        WHERE campaign_send_key IS NOT NULL;
      RAISE NOTICE 'Send-key dedupe index added on communication_recipients(campaign_send_key).';
    ELSE
      RAISE NOTICE 'Send-key dedupe index already present, left alone.';
    END IF;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 9. The pure tick rules (§6). The scheduler tick, the Directus Flows and
--    the route layer share these, so the rule cannot drift between writers.
--    IMMUTABLE = no table access, no clock reads; STABLE = reads tables or
--    the timezone database. Interval literals below live in a migration,
--    which the retention-literal gate allowlists as the config layer --
--    these are campaign guardrails (4h fallback, 24h cap), not retention
--    periods, and the retention engine reads no table created here.
-- ---------------------------------------------------------------------------

-- The idempotency key both the worker and the Notifier path use
-- (data-model-v4 §4.2): the window is bucketed to the hour so two ticks in
-- the same slot build the same key. contact_key covers visitor-only
-- recipients with no person row; exactly one identity is required.
CREATE OR REPLACE FUNCTION campaign_send_key(
  p_campaign uuid,
  p_step uuid,
  p_person uuid,
  p_contact_key text,
  p_window timestamptz
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_campaign IS NULL OR p_step IS NULL OR p_window IS NULL THEN
    RAISE EXCEPTION
      'campaign_send_key: campaign, step and window are all required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_person IS NULL AND (p_contact_key IS NULL OR btrim(p_contact_key) = ''))
     OR (p_person IS NOT NULL AND p_contact_key IS NOT NULL
         AND btrim(p_contact_key) <> '') THEN
    RAISE EXCEPTION
      'campaign_send_key: exactly one recipient identity is required (person xor contact_key)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN 'campaign:' || p_campaign::text
    || ':step:' || p_step::text
    || ':person:' || COALESCE(p_person::text, 'contact:' || btrim(p_contact_key))
    || ':' || to_char(date_trunc('hour', p_window), 'YYYYMMDDHH24');
END
$$;

COMMENT ON FUNCTION campaign_send_key(uuid, uuid, uuid, text, timestamptz) IS
  'Per-recipient send idempotency key (ADR-0009 decision 3, AFC-481). Pure: the same (step, person, window) always builds the same key, so a replayed tick collides on the UNIQUE index instead of double-sending.';

-- has_activity(r) (integrations-addendum §1): delivered OR read OR inbound
-- reply. delivered_at is the proxy until the BSP confirms read/inbound
-- webhooks (OQ-R5); the run notes state which signals were available.
CREATE OR REPLACE FUNCTION campaign_has_activity(
  p_delivered_at timestamptz,
  p_read_at timestamptz,
  p_inbound_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p_delivered_at IS NOT NULL
      OR p_read_at IS NOT NULL
      OR p_inbound_at IS NOT NULL;
END
$$;

COMMENT ON FUNCTION campaign_has_activity(timestamptz, timestamptz, timestamptz) IS
  'WhatsApp activity predicate (integrations-addendum §1, AFC-481). Pure: delivered_at OR read_at OR inbound reply. delivered_at is the documented proxy (OQ-R5).';

-- The 4-hour fallback rule (prd-addendum-v4 US-C3, ADR-0009 decision 5):
-- fires at/after sent_at + fallback window when has_activity is false.
-- Never before the window (AC1); the window defaults to the campaign's
-- fallback_sms_after_hours (4) and is passed in by the caller.
CREATE OR REPLACE FUNCTION campaign_fallback_due(
  p_sent_at timestamptz,
  p_delivered_at timestamptz,
  p_read_at timestamptz,
  p_inbound_at timestamptz,
  p_window_hours integer,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_window_hours IS NULL OR p_window_hours < 0 THEN
    RAISE EXCEPTION
      'campaign_fallback_due: a non-negative fallback window is required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_at IS NULL OR p_now IS NULL THEN
    RETURN false;
  END IF;

  IF campaign_has_activity(p_delivered_at, p_read_at, p_inbound_at) THEN
    RETURN false;
  END IF;

  RETURN p_now >= p_sent_at + make_interval(hours => p_window_hours);
END
$$;

COMMENT ON FUNCTION campaign_fallback_due(timestamptz, timestamptz, timestamptz, timestamptz, integer, timestamptz) IS
  'WhatsApp→SMS fallback rule (US-C3, AFC-481). Pure: due at/after sent_at + window with no activity signal, never before. SMS consent is still enforced separately -- due here never means sendable without it.';

-- At most one fallback per person per 24h per campaign family (US-C3 AC3).
-- NULL last-fallback means none was ever sent: allowed.
CREATE OR REPLACE FUNCTION campaign_fallback_allowed(
  p_last_fallback_at timestamptz,
  p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_now IS NULL THEN
    RETURN false;
  END IF;

  IF p_last_fallback_at IS NULL THEN
    RETURN true;
  END IF;

  RETURN p_now >= p_last_fallback_at + make_interval(hours => 24);
END
$$;

COMMENT ON FUNCTION campaign_fallback_allowed(timestamptz, timestamptz) IS
  'Fallback frequency cap (US-C3 AC3, AFC-481). Pure: at most one fallback SMS per person per 24 hours per campaign family.';

-- Template gate (data-model-v4 §4.6, Flow campaign.template_gate): a
-- WhatsApp step with approval_status != approved cannot run, with or
-- without a provider id. SMS/email are free-form: always allowed.
CREATE OR REPLACE FUNCTION campaign_template_allowed(
  p_channel text,
  p_approval_status text,
  p_provider_template_id text
)
RETURNS TABLE (allowed boolean, reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_channel IS NULL
     OR p_channel NOT IN ('whatsapp', 'sms', 'email') THEN
    RAISE EXCEPTION
      'campaign_template_allowed: unknown channel %, expected whatsapp/sms/email',
      p_channel
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_channel = 'whatsapp' THEN
    IF COALESCE(p_approval_status, '') <> 'approved'
       OR p_provider_template_id IS NULL
       OR btrim(p_provider_template_id) = '' THEN
      RETURN QUERY SELECT false,
        'whatsapp template is not runnable: approval_status must be approved with a provider_template_id'::text;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END
$$;

COMMENT ON FUNCTION campaign_template_allowed(text, text, text) IS
  'WhatsApp template gate (data-model-v4 §4.6, AFC-481). Pure: WhatsApp runs only on approved templates with a provider id; SMS/email are free-form. The Flow rejects activation the same way.';

-- Kill-switch hold (ADR-0009 decision 4): paused campaigns and disabled
-- channels hold enrollments within one tick. Held rows are kept, never
-- deleted; the tick simply skips them until the switch flips back.
CREATE OR REPLACE FUNCTION campaign_tick_hold(
  p_campaign_status text,
  p_channel_enabled boolean
)
RETURNS TABLE (held boolean, reason text)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF COALESCE(p_channel_enabled, true) = false THEN
    RETURN QUERY SELECT true, 'channel_disabled'::text;
    RETURN;
  END IF;

  IF COALESCE(p_campaign_status, 'draft') = 'paused' THEN
    RETURN QUERY SELECT true, 'campaign_paused'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT false, NULL::text;
END
$$;

COMMENT ON FUNCTION campaign_tick_hold(text, boolean) IS
  'Kill-switch predicate (ADR-0009 decision 4, AFC-481). Pure: paused campaigns and disabled channels hold enrollments within one tick. Held means skipped-and-kept, never deleted.';

-- Frequency cap (prd-addendum-v4 §4.3): marketing ≤ cap sends per person
-- per week (default 3, from campaigns.max_sends_per_person_per_week). A
-- NULL or negative window count raises: a cap that guesses is not a cap.
CREATE OR REPLACE FUNCTION campaign_within_cap(
  p_sent_this_week integer,
  p_weekly_cap integer
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_sent_this_week IS NULL OR p_weekly_cap IS NULL THEN
    RAISE EXCEPTION
      'campaign_within_cap: sent count and cap are both required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_sent_this_week < 0 OR p_weekly_cap < 0 THEN
    RAISE EXCEPTION
      'campaign_within_cap: counts and caps must be non-negative'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN p_sent_this_week < p_weekly_cap;
END
$$;

COMMENT ON FUNCTION campaign_within_cap(integer, integer) IS
  'Weekly frequency cap (prd-addendum-v4 §4.3, AFC-481). Pure: marketing sends stay under max_sends_per_person_per_week (default 3). The writer counts the window; this rule decides.';

-- Quiet-hours shift (prd-addendum-v4 §4.3, OQ-R6): 20:00-07:00 in the
-- campaign timezone moves to 08:00 the same morning (for 00:00-07:00) or
-- the next morning (for 20:00-24:00), unless the campaign is
-- operational_essential. STABLE: it reads the timezone database.
CREATE OR REPLACE FUNCTION campaign_shift_quiet_hours(
  p_scheduled timestamptz,
  p_timezone text,
  p_operational_essential boolean
)
RETURNS timestamptz
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_tz    text := COALESCE(NULLIF(btrim(p_timezone), ''), 'Africa/Lagos');
  v_local timestamp;
  v_date  date;
BEGIN
  IF p_scheduled IS NULL THEN
    RAISE EXCEPTION
      'campaign_shift_quiet_hours: a scheduled time is required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(p_operational_essential, false) THEN
    RETURN p_scheduled;
  END IF;

  v_local := p_scheduled AT TIME ZONE v_tz;
  v_date  := v_local::date;

  IF EXTRACT(HOUR FROM v_local) >= 20 THEN
    RETURN ((v_date + 1) + time '08:00') AT TIME ZONE v_tz;
  END IF;

  IF EXTRACT(HOUR FROM v_local) < 7 THEN
    RETURN (v_date + time '08:00') AT TIME ZONE v_tz;
  END IF;

  RETURN p_scheduled;
END
$$;

COMMENT ON FUNCTION campaign_shift_quiet_hours(timestamptz, text, boolean) IS
  'Quiet-hours shift (prd-addendum-v4 §4.3, AFC-481). 20:00-07:00 in the campaign timezone moves to 08:00 unless operational_essential. STABLE (timezone database); an empty timezone falls back to Africa/Lagos.';

-- The tick read (ADR-0009 decision 3): enrollments due at p_now whose
-- campaign is active, whose current step (when set) is active, whose
-- channel is enabled, and whose cooldown has passed. The tick holds the
-- single-instance lock, reads this in 500-chunks ordered by next_step_at,
-- and resolves consent/caps per row. STABLE: it reads the campaign tables.
CREATE OR REPLACE FUNCTION campaign_due_enrollments(p_now timestamptz)
RETURNS SETOF campaign_enrollments
LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION
      'campaign_due_enrollments: the tick time is required'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN QUERY
    SELECT e.*
      FROM campaign_enrollments e
      JOIN campaigns c ON c.id = e.campaign
      LEFT JOIN campaign_steps s ON s.id = e.current_step
      LEFT JOIN communication_channels ch ON ch.id = s.channel
     WHERE e.state = 'active'
       AND e.next_step_at IS NOT NULL
       AND e.next_step_at <= p_now
       AND (e.cooldown_until IS NULL OR e.cooldown_until <= p_now)
       AND c.status = 'active'
       AND (s.id IS NULL OR s.active)
       AND (s.id IS NULL OR ch.enabled)
     ORDER BY e.next_step_at;
END
$$;

COMMENT ON FUNCTION campaign_due_enrollments(timestamptz) IS
  'Scheduler tick read (ADR-0009 decision 3, AFC-481). Due active enrollments for active campaigns with active steps and enabled channels. Pause/channel-disable takes effect on the very next tick because the tick re-reads this every minute.';

-- ---------------------------------------------------------------------------
-- 10. SEED -- the nine campaign keys from data-model-v4 §4.1
--     (idempotent; ON CONFLICT (key) DO NOTHING, so board edits via the app
--     are never overwritten by a rerun). All seed rows start draft: nothing
--     sends until a reviewed activation flips the status (template gate).
--     audience_default stays NULL until the board wires audiences via the
--     app; steps are board config (stated choice 5), not seed rows.
-- ---------------------------------------------------------------------------
INSERT INTO communication_channels (key, name, enabled, daily_cap, notes) VALUES
  ('whatsapp', 'WhatsApp (BSP)', true, NULL,
   'Seeded enabled (AFC-481). daily_cap set from the real rate card at procurement (I4); NULL = unset.'),
  ('sms', 'SMS (Termii)', true, NULL,
   'Seeded enabled (AFC-481). The only per-message cost; cap set at procurement.'),
  ('email', 'Email (SMTP)', true, NULL,
   'Seeded enabled (AFC-481). Meeting-reminder fallback channel (US-C7).')
ON CONFLICT (key) DO NOTHING;

INSERT INTO campaigns
  (key, name, purpose, campaign_type, consent_policy,
   status, max_sends_per_person_per_week, fallback_sms_after_hours,
   quiet_hours_override, timezone)
VALUES
  ('whatsapp_sms_fallback', 'WhatsApp activity check to SMS fallback',
   'fallback', 'triggered', 'mixed',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('newcomer_weekly_checkin', 'Newcomer weekly check-in',
   'drip', 'scheduled', 'marketing_only',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('birthday_anniversary_greeting', 'Birthday and anniversary greetings',
   'greeting', 'scheduled', 'marketing_only',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('new_visitor_welcome_drip', 'New-visitor welcome drip',
   'drip', 'drip', 'marketing_only',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('new_convert_drip', 'New-convert drip',
   'drip', 'drip', 'marketing_only',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('weekly_memory_verse', 'Weekly memory verses',
   'scheduled', 'scheduled', 'marketing_only',
   'draft', 3, 4, false, 'Africa/Lagos'),
  ('service_reminder', 'Service reminders',
   'reminder', 'scheduled', 'operational_essential',
   'draft', 3, 4, true, 'Africa/Lagos'),
  ('meeting_reminder', 'Meeting reminders',
   'reminder', 'triggered', 'operational_essential',
   'draft', 3, 4, true, 'Africa/Lagos'),
  ('event_invitation', 'Event invitations',
   'invitation', 'triggered', 'mixed',
   'draft', 3, 4, false, 'Africa/Lagos')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 11. Least privilege (data-model-expansion §10 pattern, column 11.1).
--
-- Postgres sees ONE app identity (directus_app) for every Directus role, so
-- branch/zone scoping lives in the Directus policy + portal route filters,
-- not here. This layer states the ceiling:
--   communication_channels: the app reads; the kill switch is the one app
--     write (UPDATE enabled/daily_cap/notes/updated_at) so pausing a channel
--     never needs a deploy. Keys and ids are immutable; nothing is deletable.
--   campaigns/steps/audiences: board config -- the app inserts and updates
--     the lifecycle columns (status/version/stamps/owner/active); keys and
--     ids are immutable; nothing is deletable (archived, never deleted).
--   campaign_enrollments: the app inserts the resolved row and advances the
--     state machine (state/current_step/next_step_at/sends_count/
--     last_sent_at/exit_reason/cooldown_until) only. idempotency_key and
--     contact_key are immutable (no UPDATE grant): a correction is a new
--     enrolment, not an edit. contact_key is unreadable here (§5.1:
--     area/super only via policy) -- the SELECT grant names every other
--     column instead of the table. Nothing is deletable.
--   campaign_runs: the app inserts the run header and advances counts/cost/
--     status/notes only. The window identity (campaign/step/window_start)
--     is immutable: a rerun collides, it is not edited. Nothing is deletable.
--   communication_recipients.campaign_send_key: written once at insert by
--     the tick (INSERT grant extended); never updated, never the basis for
--     a rewrite of rendered text or basis (0004 grants unchanged).
-- ---------------------------------------------------------------------------
GRANT SELECT ON communication_channels TO directus_app;
GRANT UPDATE (enabled, daily_cap, notes, updated_at)
  ON communication_channels TO directus_app;

GRANT SELECT ON campaigns TO directus_app;
GRANT INSERT (key, name, purpose, campaign_type, consent_policy,
  audience_default, status, max_sends_per_person_per_week,
  fallback_sms_after_hours, quiet_hours_override, timezone, owner, branch,
  zone, version, activated_at, paused_at, paused_by, pause_reason,
  created_by, updated_by) ON campaigns TO directus_app;
GRANT UPDATE (name, consent_policy, audience_default, status,
  max_sends_per_person_per_week, fallback_sms_after_hours,
  quiet_hours_override, timezone, owner, branch, zone, version,
  activated_at, paused_at, paused_by, pause_reason, updated_by, updated_at)
  ON campaigns TO directus_app;

GRANT SELECT ON campaign_audiences TO directus_app;
GRANT INSERT (name, audience_type, branch, group_id, department, event,
  visitor_stage, person_ids, filter, include, created_by)
  ON campaign_audiences TO directus_app;
GRANT UPDATE (name, audience_type, branch, group_id, department, event,
  visitor_stage, person_ids, filter, include)
  ON campaign_audiences TO directus_app;

GRANT SELECT ON campaign_steps TO directus_app;
GRANT INSERT (campaign, sequence, name, delay_type, delay_value, timezone,
  channel, template, body_override, audience, condition, min_delay_hours,
  max_sends_per_person, is_entry_step, is_fallback_step, is_terminal,
  active) ON campaign_steps TO directus_app;
GRANT UPDATE (sequence, name, delay_type, delay_value, timezone, channel,
  template, body_override, audience, condition, min_delay_hours,
  max_sends_per_person, is_entry_step, is_fallback_step, is_terminal,
  active, updated_at) ON campaign_steps TO directus_app;

GRANT SELECT (id, campaign, person, visitor, enrolled_at, source_event,
  state, current_step, next_step_at, sends_count, last_sent_at, exit_reason,
  cooldown_until, idempotency_key, created_at, updated_at)
  ON campaign_enrollments TO directus_app;
GRANT INSERT (campaign, person, visitor, contact_key, enrolled_at,
  source_event, state, current_step, next_step_at, sends_count,
  last_sent_at, exit_reason, cooldown_until, idempotency_key)
  ON campaign_enrollments TO directus_app;
GRANT UPDATE (state, current_step, next_step_at, sends_count, last_sent_at,
  exit_reason, cooldown_until, updated_at)
  ON campaign_enrollments TO directus_app;

GRANT SELECT ON campaign_runs TO directus_app;
GRANT INSERT (campaign, campaign_version, step, window_start, window_end,
  trigger, status, audience_size, eligible_count, excluded_count,
  excluded_reasons, queued_count, sent_count, delivered_count, read_count,
  failed_count, opted_out_count, estimated_cost, actual_cost, currency,
  communication, worker_run_id, started_at, completed_at, notes)
  ON campaign_runs TO directus_app;
GRANT UPDATE (status, audience_size, eligible_count, excluded_count,
  excluded_reasons, queued_count, sent_count, delivered_count, read_count,
  failed_count, opted_out_count, estimated_cost, actual_cost, currency,
  communication, completed_at, notes)
  ON campaign_runs TO directus_app;

DO $$
BEGIN
  IF to_regclass('public.communication_recipients') IS NOT NULL THEN
    EXECUTE 'GRANT INSERT (campaign_send_key) ON communication_recipients TO directus_app';
    RAISE NOTICE 'campaign_send_key insert grant ensured.';
  ELSE
    RAISE NOTICE 'Skipping campaign_send_key grant: communication_recipients not present.';
  END IF;
END
$$;

REVOKE ALL ON communication_channels FROM PUBLIC;
REVOKE ALL ON campaigns FROM PUBLIC;
REVOKE ALL ON campaign_audiences FROM PUBLIC;
REVOKE ALL ON campaign_steps FROM PUBLIC;
REVOKE ALL ON campaign_enrollments FROM PUBLIC;
REVOKE ALL ON campaign_runs FROM PUBLIC;
