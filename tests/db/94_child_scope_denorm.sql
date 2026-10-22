-- tests/db/94_child_scope_denorm.sql
--
-- AFC RBAC denormalised scope contract (migrations 20261020_0030 and
-- 20261020_0031).
--
-- Directus metadata in staging has no directus_relations rows, so permission
-- filters cannot walk `child -> parent -> branch/zone`. The policy layer
-- instead filters on denormalised branch/zone columns carried by each child
-- row. These migrations install that denormalisation:
--
--   94.1  shape      -- every 0030 child has branch/zone + afc_set_scope; the
--                       0031 top-level tables have afc_fill_scope; both
--                       functions exist.
--   94.2  copy       -- a child inserted with only its parent FK receives the
--                       parent's branch AND zone (afc_set_scope), including
--                       the people.branch-varchar path.
--   94.3  fill       -- a row inserted with a branch and no zone receives the
--                       branch's zone (afc_fill_scope), and an explicit zone
--                       is never overwritten.
--   94.4  campaigns  -- a campaign step inserted with only its campaign
--                       receives the campaign's branch and zone (0032).
--
-- Re-applying both migrations leaves the trigger count unchanged (DROP IF
-- EXISTS + CREATE on a known list).
--
-- Not asserted here: the HTTP layer's row visibility. That is the Directus
-- policy plus branchCollectionScope/scopeFilter; it is pinned by the portal
-- sweep and by tests/web contracts.

-- ---------------------------------------------------------------------------
-- 94.1  SHAPE.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
  v_triggers integer;
BEGIN
  PERFORM test_support.assert_true(
    to_regprocedure('public.afc_set_child_scope()') IS NOT NULL
    AND to_regprocedure('public.afc_fill_scope_zone()') IS NOT NULL, 'scope_denorm',
    'both scope trigger functions exist');

  SELECT string_agg(t.table_name, ',') INTO v_missing
  FROM (VALUES
    ('people_departments'),('attendance_records'),('attendance_counts'),
    ('visitor_journey_transitions'),('welfare_contributions'),('welfare_case_events'),
    ('communication_recipients'),('consent_records'),('coaching_timetable'),
    ('coaching_facilitators'),('coaching_students'),('coaching_class_attendance'),
    ('coaching_progress'),('coaching_resources'),('coaching_feedback'),
    ('campus_financial_support'),('exam_results'),('blessing_events'),
    ('transfer_events'),('marriage_matter_events'),('minutes_attendees'),
    ('office_minute_events'),('task_events'),('announcement_events'),
    ('youth_profile_events'),('celebration_events'),('campaign_steps'),('campaign_runs')
  ) AS t(table_name)
  WHERE NOT (EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name=t.table_name
                        AND column_name='branch')
             AND EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name=t.table_name
                        AND column_name='zone'))
     OR NOT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
                     WHERE c.relname=t.table_name AND g.tgname='afc_set_scope');
  PERFORM test_support.assert_equals(COALESCE(v_missing,''), '', 'scope_denorm',
    'all 26 child tables have branch/zone and afc_set_scope');

  SELECT count(*) INTO v_triggers FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
   WHERE g.tgname='afc_set_scope' AND c.relnamespace='public'::regnamespace;
  PERFORM test_support.assert_equals(v_triggers::text, '28', 'scope_denorm',
    'afc_set_scope is attached exactly once per child table');

  SELECT string_agg(t.table_name, ',') INTO v_missing
  FROM (VALUES
    ('announcements'),('attendance_sessions'),('blessings'),('campaigns'),
    ('campus_students'),('celebrations'),('coaching_programmes'),('conference_centres'),
    ('event_invites'),('event_referrals'),('households'),
    ('marriage_matters'),('office_minutes'),('prior_year_import_items'),
    ('sunday_school_classes'),('sunday_services'),('tasks'),('youth_profiles')
  ) AS t(table_name)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
                     WHERE c.relname=t.table_name AND g.tgname='afc_fill_scope');
  PERFORM test_support.assert_equals(COALESCE(v_missing,''), '', 'scope_denorm',
    'all 18 top-level tables have afc_fill_scope');
END $$;

-- ---------------------------------------------------------------------------
-- 94.2  COPY. Parent FK only -> branch + zone.
-- ---------------------------------------------------------------------------
-- The people.branch-varchar path is a staging app-compat graft: the migration
-- chain does not guarantee those person columns, so the suite installs the
-- graft itself (IF NOT EXISTS, additive and idempotent). The harness runs
-- each suite file in its own transaction and nothing here depends on the
-- columns being absent afterwards, so no cleanup is asserted. No dependency
-- on any other uncommitted work.
DO $$
BEGIN
  ALTER TABLE people ADD COLUMN IF NOT EXISTS first_name text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS last_name text;
  ALTER TABLE people ADD COLUMN IF NOT EXISTS branch varchar;
END $$;

DO $$
DECLARE
  v_branch uuid;
  v_zone uuid;
  v_got_branch uuid;
  v_got_zone uuid;
BEGIN
  SELECT b.id, b.zone INTO v_branch, v_zone FROM branches b
   WHERE b.zone IS NOT NULL ORDER BY b.code LIMIT 1;

  INSERT INTO welfare_cases (id, case_ref, branch)
  VALUES ('e0000000-0000-4000-8000-000000000001', 'SCOPE-TEST-94', v_branch);

  INSERT INTO welfare_case_events (id, "case", event_type, detail)
  VALUES ('e0000000-0000-4000-8000-000000000002',
          'e0000000-0000-4000-8000-000000000001', 'created', 'scope test');

  SELECT branch, zone INTO v_got_branch, v_got_zone FROM welfare_case_events
   WHERE id='e0000000-0000-4000-8000-000000000002';
  PERFORM test_support.assert_equals(v_got_branch::text, v_branch::text,
    'scope_denorm', 'child inherits parent branch');
  PERFORM test_support.assert_equals(v_got_zone::text, v_zone::text,
    'scope_denorm', 'child inherits parent zone');

  -- people.branch is varchar in the staging graft and uuid where the
  -- history provides it; a uuid value stores natively in either shape.
  -- A child whose parent is the person (mode '0') copies the branch and
  -- derives the zone through branches.
  INSERT INTO people (id, first_name, last_name, branch)
  VALUES ('e0000000-0000-4000-8000-000000000003', 'Scope', 'Parent',
          v_branch);
  INSERT INTO consent_records (id, person, channel, granted)
  VALUES ('e0000000-0000-4000-8000-000000000008',
          'e0000000-0000-4000-8000-000000000003', 'email', true);
  SELECT branch, zone INTO v_got_branch, v_got_zone FROM consent_records
   WHERE id='e0000000-0000-4000-8000-000000000008';
  PERFORM test_support.assert_equals(v_got_branch::text, v_branch::text,
    'scope_denorm', 'people.branch varchar path copies the branch');
  PERFORM test_support.assert_equals(v_got_zone::text, v_zone::text,
    'scope_denorm', 'people.branch varchar path resolves the zone');
END $$;

-- ---------------------------------------------------------------------------
-- 94.4  CAMPAIGNS. Step inherits branch/zone from its campaign (0032).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_zone uuid;
  v_channel uuid;
  v_got_branch uuid;
  v_got_zone uuid;
BEGIN
  SELECT b.id, b.zone INTO v_branch, v_zone FROM branches b
   WHERE b.zone IS NOT NULL ORDER BY b.code LIMIT 1;
  SELECT id INTO v_channel FROM communication_channels ORDER BY id LIMIT 1;

  INSERT INTO campaigns (id, key, name, purpose, campaign_type, branch)
  VALUES ('e0000000-0000-4000-8000-000000000009', 'scope-test-94',
          'Scope test campaign', 'reminder', 'scheduled', v_branch);
  INSERT INTO campaign_steps
    (id, campaign, sequence, name, delay_type, channel)
  VALUES ('e0000000-0000-4000-8000-00000000000a',
          'e0000000-0000-4000-8000-000000000009', 1, 'Step one',
          'immediate', v_channel);

  SELECT branch, zone INTO v_got_branch, v_got_zone FROM campaign_steps
   WHERE id='e0000000-0000-4000-8000-00000000000a';
  PERFORM test_support.assert_equals(v_got_branch::text, v_branch::text,
    'scope_denorm', 'campaign step inherits the campaign branch');
  PERFORM test_support.assert_equals(v_got_zone::text, v_zone::text,
    'scope_denorm', 'campaign step inherits the campaign zone');
END $$;

-- ---------------------------------------------------------------------------
-- 94.3  FILL. Branch only -> zone; explicit zone preserved.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_branch uuid;
  v_zone uuid;
  v_other_zone uuid;
  v_got uuid;
BEGIN
  SELECT b.id, b.zone INTO v_branch, v_zone FROM branches b
   WHERE b.zone IS NOT NULL ORDER BY b.code LIMIT 1;
  SELECT z.id INTO v_other_zone FROM zones z WHERE z.id <> v_zone ORDER BY z.code LIMIT 1;

  INSERT INTO blessings (id, blessing_type, branch, service_date)
  VALUES ('e0000000-0000-4000-8000-000000000006', 'healing', v_branch, DATE '2026-01-04');
  SELECT zone INTO v_got FROM blessings WHERE id='e0000000-0000-4000-8000-000000000006';
  PERFORM test_support.assert_equals(v_got::text, v_zone::text, 'scope_denorm',
    'afc_fill_scope fills a missing zone from the branch');

  INSERT INTO blessings (id, blessing_type, branch, zone, service_date)
  VALUES ('e0000000-0000-4000-8000-000000000007', 'healing', v_branch, v_other_zone, DATE '2026-01-04');
  SELECT zone INTO v_got FROM blessings WHERE id='e0000000-0000-4000-8000-000000000007';
  PERFORM test_support.assert_equals(v_got::text, v_other_zone::text, 'scope_denorm',
    'afc_fill_scope never overwrites an explicit zone');
END $$;
