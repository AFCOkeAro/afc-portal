-- services/directus/seeds/demo/002_demo_clear.sql
--
-- AFC-1086 demo clear (parent AFC-1084, ancestor AFC-1083).
--
-- Removes ONLY rows the demo seed planted, child-to-parent, then drops
-- their registry rows. Safe on empty (NOTICE + zero counts) and a second
-- run is a no-op (nothing matches, nothing deleted).
--
-- HOW TO RUN (staging only, never production):
--   psql "$STAGING_PG_URL" -v ON_ERROR_STOP=1 \
--     -c "SET ROLE directus_migrator;" \
--     -f services/directus/seeds/demo/002_demo_clear.sql
-- Never run as directus_app: the app role holds no DELETE anywhere.
--
-- SAFETY (three layers, smallest defensible, named for review):
--   1. Registry-driven: every DELETE names row_ids from demo_seed_registry
--      for its own table. A row the seed never planted cannot match, so
--      production data is unreachable even on a shared table.
--   2. DEMO- fallback: on tables with a DEMO- natural key (codes, slugs,
--      tickets, idempotency keys, filenames) a LIKE 'DEMO-%' sweep catches
--      a planted row whose registry entry is missing. Tables WITHOUT a
--      DEMO- natural marker (people, visitors, households) are registry
--      only -- matching by name would risk a real namesake.
--   3. Sealed-table refusal: the script raises before deleting anything if
--      the registry ever names a sealed or retention table (incidents,
--      legal_holds, retention_runs, retention_run_items, retention_clocks,
--      retention_policies, member_otp_codes, member_sessions). The seed
--      never writes those tables, so reaching the guard means the registry
--      was tampered with -- refuse loudly, delete nothing.
--
-- ORDER is child-to-parent against every RESTRICT/CASCADE edge the seed
-- touches (follow-ups before visitors, enrollments before campaigns,
-- recipients before blessings, items before imports, junctions before
-- departments/households/people). demo_admin_actions is audit history and
-- is NEVER cleared here.

-- ---------------------------------------------------------------------------
-- 0. Preconditions + sealed-table refusal. Nothing is deleted before this
--    block passes.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.demo_seed_registry') IS NULL THEN
    RAISE EXCEPTION
      'demo_seed_registry is missing: apply migration '
      '20261105_0068_demo_seed_registry.sql before clearing. Refusing to '
      'delete without the address book.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM demo_seed_registry WHERE table_name IN
      ('incidents', 'legal_holds',
       'retention_runs', 'retention_run_items',
       'retention_clocks', 'retention_policies',
       'member_otp_codes', 'member_sessions')
  ) THEN
    RAISE EXCEPTION
      'demo_seed_registry names a sealed or retention table: refusing to '
      'clear. The seed never writes those tables; inspect the registry '
      'before proceeding.'
      USING ERRCODE = 'restrict_violation';
  END IF;
END
$$;

DO $$
DECLARE
  v_n bigint;
  v_m bigint;
  v_removed bigint := 0;
  v_tables bigint := 0;
  v_detail jsonb := '{}'::jsonb;
BEGIN
  -- -- -- child tables first ---------------------------------------------

  -- minutes_attendees (registry only: no DEMO- natural key)
  DELETE FROM minutes_attendees WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'minutes_attendees');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'minutes_attendees';
  v_detail := v_detail || jsonb_build_object('minutes_attendees', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- office_minutes (registry only)
  DELETE FROM office_minutes WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'office_minutes');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'office_minutes';
  v_detail := v_detail || jsonb_build_object('office_minutes', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- welfare_contributions (registry only)
  DELETE FROM welfare_contributions WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'welfare_contributions');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'welfare_contributions';
  v_detail := v_detail || jsonb_build_object('welfare_contributions', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- welfare_case_events (append-only for the app; the migrator may delete
  -- planted rows. Registry only: ids carry no DEMO- marker.)
  DELETE FROM welfare_case_events WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'welfare_case_events');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'welfare_case_events';
  v_detail := v_detail || jsonb_build_object('welfare_case_events', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- welfare_cases (registry + case_ref fallback)
  DELETE FROM welfare_cases WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'welfare_cases');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM welfare_cases WHERE case_ref LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'welfare_cases';
  v_detail := v_detail || jsonb_build_object('welfare_cases', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- blessing_recipients (registry only)
  DELETE FROM blessing_recipients WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'blessing_recipients');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'blessing_recipients';
  v_detail := v_detail || jsonb_build_object('blessing_recipients', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- blessings (registry only)
  DELETE FROM blessings WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'blessings');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'blessings';
  v_detail := v_detail || jsonb_build_object('blessings', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- campaign_enrollments (registry + idempotency_key fallback)
  DELETE FROM campaign_enrollments WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'campaign_enrollments');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM campaign_enrollments WHERE idempotency_key LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'campaign_enrollments';
  v_detail := v_detail || jsonb_build_object('campaign_enrollments', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- campaign_steps (registry only)
  DELETE FROM campaign_steps WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'campaign_steps');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'campaign_steps';
  v_detail := v_detail || jsonb_build_object('campaign_steps', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- campaign_audiences (registry only)
  DELETE FROM campaign_audiences WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'campaign_audiences');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'campaign_audiences';
  v_detail := v_detail || jsonb_build_object('campaign_audiences', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- campaigns (registry + key fallback)
  DELETE FROM campaigns WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'campaigns');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM campaigns WHERE key LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'campaigns';
  v_detail := v_detail || jsonb_build_object('campaigns', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- event_registrations (registry + ticket_code fallback)
  DELETE FROM event_registrations WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'event_registrations');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM event_registrations WHERE ticket_code LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'event_registrations';
  v_detail := v_detail || jsonb_build_object('event_registrations', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- event_invites (registry + contact_hash fallback)
  DELETE FROM event_invites WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'event_invites');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM event_invites WHERE invitee_contact_hash LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'event_invites';
  v_detail := v_detail || jsonb_build_object('event_invites', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- invite_quota_slots (registry only: no DEMO- natural column)
  DELETE FROM invite_quota_slots WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'invite_quota_slots');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'invite_quota_slots';
  v_detail := v_detail || jsonb_build_object('invite_quota_slots', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- events (registry + slug fallback)
  DELETE FROM events WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'events');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM events WHERE slug LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'events';
  v_detail := v_detail || jsonb_build_object('events', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- attendance_records (registry only)
  DELETE FROM attendance_records WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'attendance_records');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'attendance_records';
  v_detail := v_detail || jsonb_build_object('attendance_records', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- attendance_counts (registry only: session uuids are not DEMO- text)
  DELETE FROM attendance_counts WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'attendance_counts');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'attendance_counts';
  v_detail := v_detail || jsonb_build_object('attendance_counts', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- attendance_sessions (registry + idempotency_key fallback)
  DELETE FROM attendance_sessions WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'attendance_sessions');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM attendance_sessions WHERE idempotency_key LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'attendance_sessions';
  v_detail := v_detail || jsonb_build_object('attendance_sessions', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- service_assignments (registry only)
  DELETE FROM service_assignments WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'service_assignments');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'service_assignments';
  v_detail := v_detail || jsonb_build_object('service_assignments', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- sunday_services (registry only)
  DELETE FROM sunday_services WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'sunday_services');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'sunday_services';
  v_detail := v_detail || jsonb_build_object('sunday_services', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- visitor_follow_ups (registry only; RESTRICT parent below)
  DELETE FROM visitor_follow_ups WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'visitor_follow_ups');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'visitor_follow_ups';
  v_detail := v_detail || jsonb_build_object('visitor_follow_ups', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- visitor_journey_transitions (registry only)
  DELETE FROM visitor_journey_transitions WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'visitor_journey_transitions');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'visitor_journey_transitions';
  v_detail := v_detail || jsonb_build_object('visitor_journey_transitions', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- visitors (registry only: names are recognizable, not DEMO- -- a name
  -- match could hit a real namesake, so no fallback here by design)
  DELETE FROM visitors WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'visitors');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'visitors';
  v_detail := v_detail || jsonb_build_object('visitors', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- celebrations (registry only)
  DELETE FROM celebrations WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'celebrations');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'celebrations';
  v_detail := v_detail || jsonb_build_object('celebrations', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- youth_profiles (registry only)
  DELETE FROM youth_profiles WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'youth_profiles');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'youth_profiles';
  v_detail := v_detail || jsonb_build_object('youth_profiles', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- person_milestones (registry only)
  DELETE FROM person_milestones WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'person_milestones');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'person_milestones';
  v_detail := v_detail || jsonb_build_object('person_milestones', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- campus_students (registry only)
  DELETE FROM campus_students WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'campus_students');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'campus_students';
  v_detail := v_detail || jsonb_build_object('campus_students', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- consent_records (registry only)
  DELETE FROM consent_records WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'consent_records');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'consent_records';
  v_detail := v_detail || jsonb_build_object('consent_records', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- prior_year_import_items (registry + natural_key fallback; RESTRICT parent)
  DELETE FROM prior_year_import_items WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'prior_year_import_items');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM prior_year_import_items WHERE natural_key LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'prior_year_import_items';
  v_detail := v_detail || jsonb_build_object('prior_year_import_items', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- prior_year_imports (registry + filename fallback)
  DELETE FROM prior_year_imports WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'prior_year_imports');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM prior_year_imports WHERE filename LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'prior_year_imports';
  v_detail := v_detail || jsonb_build_object('prior_year_imports', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- weca_returns (registry only: period is a real YYYY-MM, never DEMO-)
  DELETE FROM weca_returns WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'weca_returns');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'weca_returns';
  v_detail := v_detail || jsonb_build_object('weca_returns', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- branch_financial_records (registry only: same branch+month shape as real rows)
  DELETE FROM branch_financial_records WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'branch_financial_records');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'branch_financial_records';
  v_detail := v_detail || jsonb_build_object('branch_financial_records', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- people_departments (registry only: includes the GROUP-1 junction row)
  DELETE FROM people_departments WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'people_departments');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'people_departments';
  v_detail := v_detail || jsonb_build_object('people_departments', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- departments (registry + code fallback; GROUP-1 itself is never DEMO-)
  DELETE FROM departments WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'departments');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM departments WHERE code LIKE 'DEMO-%';
  GET DIAGNOSTICS v_m = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'departments';
  v_detail := v_detail || jsonb_build_object('departments', v_n + v_m);
  v_removed := v_removed + v_n + v_m; v_tables := v_tables + 1;

  -- households (registry only: names are recognizable, not DEMO-)
  DELETE FROM households WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'households');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'households';
  v_detail := v_detail || jsonb_build_object('households', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  -- -- -- parents last ---------------------------------------------------
  -- people (registry only: names are recognizable, not DEMO- -- no fallback
  -- by design; a name match could hit a real namesake)
  DELETE FROM people WHERE id IN
    (SELECT row_id FROM demo_seed_registry WHERE table_name = 'people');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  DELETE FROM demo_seed_registry WHERE table_name = 'people';
  v_detail := v_detail || jsonb_build_object('people', v_n);
  v_removed := v_removed + v_n; v_tables := v_tables + 1;

  RAISE NOTICE 'DEMO_CLEAR done: % rows across % tables: %', v_removed, v_tables, v_detail;
END
$$;
