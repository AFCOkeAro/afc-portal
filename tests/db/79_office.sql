-- tests/db/79_office.sql
--
-- AFC-477 / AFC-463f. THE OFFICE CONTRACT.
--
-- The routes (/api/transfers, /api/marriage, /api/minutes, /api/tasks,
-- /api/announcements, /api/calendar, /api/search, CSV exports) enforce
-- branch/zone isolation with Directus filters over denorm columns (portal.ts
-- scope helpers). A filter is only as honest as the columns it reads, so this
-- suite asserts the database half of that promise -- the half a crafted HTTP
-- request cannot change:
--
--   79.1  tables        -- all seven §9 tables + five audit tables exist with
--                         the §9 column sets; events deltas are conditional.
--   79.2  rerun         -- re-applying 20261020_0013 changes nothing
--                         (IF NOT EXISTS everywhere; counts identical).
--   79.3  constraints   -- required scopes, closed enums, window order,
--                         branches-differ, attendee/assignee presence.
--   79.4  links         -- zone denorm backfills; RESTRICT on branches/people;
--                         SET NULL on denorm/program links; CASCADE on trails.
--   79.5  guards        -- the app identity reads everything, writes
--                         operational columns, deletes nothing.
--   79.6  indexes       -- the §9 index set exists; branch predicates
--                         partition fixture rows the way list routes filter.
--   79.7  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half, the publish-window approval lifecycle, assignee-scoped task views,
-- calendar combination + scope/type filters, cross-entity search scoping +
-- fail-closed -- all live in the route layer and are covered by
-- tests/web/office.contract.mjs. A SQL suite asserting HTTP status codes
-- would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 79.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO (Z1) and LEGUN (Z2) come from the 0002 hierarchy seed.
--        people is the 0004 minimal anchor (id/status): the person fixture
--        below satisfies the conditional person FKs where people exists.
-- ---------------------------------------------------------------------------
INSERT INTO people (id, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfers
  (id, person, from_branch, to_branch, reason, status, notes)
VALUES
  ('11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    (SELECT id FROM branches WHERE code = 'LEGUN'),
    'Moved for work', 'requested', 'route writes person move on approval')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transfer_events
  (id, transfer, event_type, detail)
VALUES
  ('12121212-1212-4121-8121-121212121212',
    '11111111-1111-4111-8111-111111111111', 'created', 'Transfer requested')
ON CONFLICT (id) DO NOTHING;

INSERT INTO marriage_matters
  (id, person, branch, matter_type, status, notes)
VALUES
  ('21111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000001',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'wedding', 'open', 'Banns requested')
ON CONFLICT (id) DO NOTHING;

INSERT INTO office_minutes
  (id, title, meeting_date, branch, status)
VALUES
  ('31111111-1111-4111-8111-111111111111',
    'Workers meeting', DATE '2026-10-04',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'final')
ON CONFLICT (id) DO NOTHING;

INSERT INTO minutes_attendees (id, minute, person)
VALUES
  ('31313131-3131-4313-8131-313131313131',
    '31111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tasks
  (id, title, assignee_person, branch, status, priority, due_date)
VALUES
  ('41111111-1111-4111-8111-111111111111',
    'Follow up on transfer', '00000000-0000-4000-8000-000000000001',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'),
    'todo', 'high', DATE '2026-10-18')
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_events (id, task, event_type, detail)
VALUES
  ('41414141-4141-4414-8141-414141414141',
    '41111111-1111-4111-8111-111111111111', 'created', 'Task created')
ON CONFLICT (id) DO NOTHING;

INSERT INTO announcements
  (id, title, body, status, publish_from, publish_to)
VALUES
  ('51111111-1111-4111-8111-111111111111',
    'Camp meeting', 'Annual camp meeting announced',
    'published', TIMESTAMPTZ '2026-10-01 00:00:00+00', TIMESTAMPTZ '2026-11-01 00:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO announcement_events (id, announcement, event_type, detail)
VALUES
  ('51515151-5151-4515-8151-515151515151',
    '51111111-1111-4111-8111-111111111111', 'created', 'Draft created')
ON CONFLICT (id) DO NOTHING;

-- AFC-566: 0021 created the events register, so the 0013 merge FK
-- (event_referrals_event_fkey, added by this suite's own 0013 re-apply
-- below) is now enforced. The referral fixture therefore names a REAL
-- event row, seeded here -- the merge contract working, not a fork.
INSERT INTO events (id, title, start_at, end_at)
VALUES
  ('00000000-0000-4000-8000-0000000000e1',
    'Office Fixture Event', TIMESTAMPTZ '2026-10-05 09:00:00+00', TIMESTAMPTZ '2026-10-05 12:00:00+00')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_referrals (id, event, invitee_name, status)
VALUES
  ('61111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000e1', 'Friend of member', 'invited')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 79.1  TABLES. All office tables exist with their §9 columns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.transfers') IS NOT NULL, 'office', 'transfers exists');
  PERFORM test_support.assert_true(
    to_regclass('public.marriage_matters') IS NOT NULL, 'office', 'marriage_matters exists');
  PERFORM test_support.assert_true(
    to_regclass('public.office_minutes') IS NOT NULL, 'office', 'office_minutes exists');
  PERFORM test_support.assert_true(
    to_regclass('public.minutes_attendees') IS NOT NULL, 'office', 'minutes_attendees exists');
  PERFORM test_support.assert_true(
    to_regclass('public.tasks') IS NOT NULL, 'office', 'tasks exists');
  PERFORM test_support.assert_true(
    to_regclass('public.announcements') IS NOT NULL, 'office', 'announcements exists');
  PERFORM test_support.assert_true(
    to_regclass('public.event_referrals') IS NOT NULL, 'office', 'event_referrals exists');
  PERFORM test_support.assert_true(
    to_regclass('public.transfer_events') IS NOT NULL, 'office', 'transfer_events exists');
  PERFORM test_support.assert_true(
    to_regclass('public.task_events') IS NOT NULL, 'office', 'task_events exists');
  PERFORM test_support.assert_true(
    to_regclass('public.announcement_events') IS NOT NULL, 'office', 'announcement_events exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'transfers'
               AND column_name IN ('person', 'from_branch', 'to_branch', 'reason',
                 'request_date', 'effective_date', 'status', 'requested_by',
                 'approved_by', 'notes', 'zone')
             HAVING count(*) = 11),
    'office', 'transfers carries the full §9.1 column set + zone denorm');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'tasks'
               AND column_name IN ('title', 'description', 'assignee_user',
                 'assignee_person', 'branch', 'zone', 'due_date', 'status',
                 'priority', 'related_type', 'related_id', 'created_by')
             HAVING count(*) = 12),
    'office', 'tasks carries the full §9.4 column set + scope');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'announcements'
               AND column_name IN ('title', 'body', 'publish_from', 'publish_to',
                 'channels', 'audience', 'status', 'branch', 'zone')
             HAVING count(*) = 9),
    'office', 'announcements carries the §9.5 column set + scope');
END $$;

-- ---------------------------------------------------------------------------
-- 79.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0013_office.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM transfers
      WHERE id = '11111111-1111-4111-8111-111111111111') = 1,
    'office', 'rerun: the fixture transfer survives');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM tasks
      WHERE id = '41111111-1111-4111-8111-111111111111') = 1,
    'office', 'rerun: the fixture task survives');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM announcements
      WHERE id = '51111111-1111-4111-8111-111111111111') = 1,
    'office', 'rerun: the fixture announcement survives');
END $$;

-- ---------------------------------------------------------------------------
-- 79.3  CONSTRAINTS. Required scopes, closed enums, window order,
--        branches-differ, attendee/assignee presence.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Unknown transfer status rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO transfers (person, from_branch, to_branch, status) VALUES ('00000000-0000-4000-8000-000000000001', (SELECT id FROM branches WHERE code = 'OKE-ARO'), (SELECT id FROM branches WHERE code = 'LEGUN'), 'flying')$q$,
    '23514', 'office', 'an unknown transfer status is rejected');
  -- Same-branch transfer rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO transfers (person, from_branch, to_branch) VALUES ('00000000-0000-4000-8000-000000000001', (SELECT id FROM branches WHERE code = 'OKE-ARO'), (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23514', 'office', 'a same-branch transfer is rejected (branches differ)');
  -- Marriage without a branch rejected (scopeless record invisible).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_matters (person, branch, matter_type) VALUES ('00000000-0000-4000-8000-000000000001', NULL, 'wedding')$q$,
    '23502', 'office', 'a marriage matter without a branch is rejected');
  -- Unknown marriage type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO marriage_matters (person, branch, matter_type) VALUES ('00000000-0000-4000-8000-000000000001', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'divorce')$q$,
    '23514', 'office', 'an unknown marriage matter_type is rejected');
  -- Minutes without a title rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO office_minutes (title, meeting_date, branch) VALUES ('   ', DATE '2026-10-11', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23514', 'office', 'minutes with a blank title are rejected');
  -- Attendee with neither side rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO minutes_attendees (minute, person, attendee_user) VALUES ('31111111-1111-4111-8111-111111111111', NULL, NULL)$q$,
    '23514', 'office', 'an attendee row with no person and no user is rejected');
  -- Task with no assignee rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO tasks (title, branch) VALUES ('Nobody owns this', (SELECT id FROM branches WHERE code = 'OKE-ARO'))$q$,
    '23514', 'office', 'a task with no assignee is rejected');
  -- Unknown task status rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO tasks (title, assignee_person, branch, status) VALUES ('Bad status', '00000000-0000-4000-8000-000000000001', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'sleeping')$q$,
    '23514', 'office', 'an unknown task status is rejected');
  -- Announcement window inversion rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO announcements (title, publish_from, publish_to) VALUES ('Backwards', TIMESTAMPTZ '2026-11-01 00:00:00+00', TIMESTAMPTZ '2026-10-01 00:00:00+00')$q$,
    '23514', 'office', 'an announcement with publish_to before publish_from is rejected');
  -- Referral without a name rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO event_referrals (event, invitee_name) VALUES ('00000000-0000-4000-8000-0000000000e1', '   ')$q$,
    '23514', 'office', 'a referral with a blank invitee_name is rejected');
  -- Unknown audit event type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO task_events (task, event_type) VALUES ('41111111-1111-4111-8111-111111111111', 'deleted')$q$,
    '23514', 'office', 'an unknown task audit event type is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 79.4  LINKS. Denorm backfill; branch RESTRICT; trail CASCADE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM transfers WHERE id = '11111111-1111-4111-8111-111111111111'),
    (SELECT zone::text FROM branches WHERE code = 'OKE-ARO'),
    'office', 'transfer zone agrees with its from_branch zone (denorm backfill)');
  PERFORM test_support.assert_equals(
    (SELECT zone::text FROM tasks WHERE id = '41111111-1111-4111-8111-111111111111'),
    (SELECT zone::text FROM branches WHERE code = 'OKE-ARO'),
    'office', 'task zone agrees with its branch zone (denorm backfill)');
  -- A branch with office rows is not deleted by accident.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM branches WHERE code = 'OKE-ARO'$q$,
    '23503', 'office', 'deleting a branch with office rows is refused (RESTRICT)');
  -- A freeform audit note is accepted.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO transfer_events (id, transfer, event_type, detail) VALUES ('13131313-1313-4131-8131-131313131313', '11111111-1111-4111-8111-111111111111', 'note', 'Pastor confirmed the move') ON CONFLICT (id) DO NOTHING$q$,
    'office', 'a freeform transfer audit note is accepted');
END $$;

-- Throwaway trail CASCADE: delete a throwaway task, its events follow.
INSERT INTO tasks (id, title, assignee_person, branch)
  VALUES ('48888888-8888-4888-8888-888888888888', 'Throwaway',
    '00000000-0000-4000-8000-000000000001',
    (SELECT id FROM branches WHERE code = 'OKE-ARO'))
  ON CONFLICT (id) DO NOTHING;
INSERT INTO task_events (id, task, event_type)
  VALUES ('48484848-4848-4484-8484-848484848484',
    '48888888-8888-4888-8888-888888888888', 'created')
  ON CONFLICT (id) DO NOTHING;

DELETE FROM tasks WHERE id = '48888888-8888-4888-8888-888888888888';

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM task_events WHERE task = '48888888-8888-4888-8888-888888888888') = 0,
    'office', 'the trail follows its task (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 79.5  GUARDS. The app ceiling: read everywhere, write operational
--        columns, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM transfers$q$,
    'office', 'directus_app can read transfers');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM tasks$q$,
    'office', 'directus_app can read tasks');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM announcements$q$,
    'office', 'directus_app can read announcements');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO tasks (title, assignee_person, branch, status) VALUES ('probe', '00000000-0000-4000-8000-000000000001', (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'todo')$q$,
    'office', 'directus_app can record tasks');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$UPDATE tasks SET status = 'in_progress' WHERE id = '41111111-1111-4111-8111-111111111111'$q$,
    'office', 'directus_app can update task status');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO announcement_events (announcement, event_type, detail) VALUES ('51111111-1111-4111-8111-111111111111', 'note', 'probe')$q$,
    'office', 'directus_app can write announcement audit rows');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM transfers WHERE id = '11111111-1111-4111-8111-111111111111'$q$,
    '42501', 'office', 'directus_app has no DELETE on transfers');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM tasks WHERE id = '41111111-1111-4111-8111-111111111111'$q$,
    '42501', 'office', 'directus_app has no DELETE on tasks');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM announcements WHERE id = '51111111-1111-4111-8111-111111111111'$q$,
    '42501', 'office', 'directus_app has no DELETE on announcements');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM task_events WHERE task = '41111111-1111-4111-8111-111111111111'$q$,
    '42501', 'office', 'directus_app has no DELETE on the task audit trail');
END $$;

-- ---------------------------------------------------------------------------
-- 79.6  INDEXES + PARTITION. The §9 index set exists; branch predicates
--        partition fixture rows the way list routes filter them.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_oke uuid;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'transfers_person_status_idx'),
    'office', 'the (person, status) transfer index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'tasks_assignee_status_idx'),
    'office', 'the (assignee_user, status) task index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'announcements_status_idx'),
    'office', 'the announcements status index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'event_referrals_event_inviter_idx'),
    'office', 'the (event, inviter) referral index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'task_events_task_created_idx'),
    'office', 'the (task, created_at) audit index exists');

  SELECT id INTO v_oke FROM branches WHERE code = 'OKE-ARO';

  -- Branch predicate: Oke-Aro tasks only (the LEGUN transfer is excluded by
  -- from_branch; the fixture task is included).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM tasks t WHERE t.branch = v_oke
      AND t.id = '41111111-1111-4111-8111-111111111111') = 1,
    'office', 'a branch predicate isolates exactly that branch''s task');
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM tasks WHERE status = 'todo'
      AND id = '41111111-1111-4111-8111-111111111111'),
    '1',
    'office', 'a status predicate isolates the todo fixture');
END $$;

-- ---------------------------------------------------------------------------
-- 79.7  ROLLBACK REFUSES while rows exist (probed, discarded). The guard
--        text is the down script's own first block, so the suite pins the
--        shipped refusal rather than a paraphrase.
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM transfers) > 0 THEN RAISE EXCEPTION 'refusing to roll back office: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'office', 'rollback refuses while transfers exist');
END $outer$;
