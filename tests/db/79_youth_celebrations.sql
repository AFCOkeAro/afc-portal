-- tests/db/79_youth_celebrations.sql
--
-- AFC-476 / AFC-463e. THE YOUTH + CELEBRATIONS CONTRACT.
--
-- The routes (/api/youth, /api/celebrations, calendar feed, CSV) enforce
-- branch/zone isolation with Directus filters over denorm columns
-- (portal.ts scope helpers). A filter is only as honest as the columns it
-- reads, so this suite asserts the database half of that promise -- the half
-- a crafted HTTP request cannot change:
--
--   79.1  tables        -- youth_profiles + youth_profile_events,
--                         celebrations + celebration_events,
--                         person_previous_branches + person_milestones exist
--                         with the §6.1/§6.2/§4.3/§4.4 shapes; people carries
--                         the §4.2 columns with the closed (active, archived)
--                         status set (expansion withheld, §79.6).
--   79.2  rerun         -- re-applying 20261020_0012 changes nothing
--                         (IF NOT EXISTS everywhere; counts identical).
--   79.3  youth-link    -- THE 1-1 LENS: a second profile for one person is
--                         refused (23505); deleting a person takes its
--                         profile, milestones and previous branches
--                         (CASCADE); deleting a person named by a celebration
--                         is refused (RESTRICT).
--   79.4  lifecycle     -- THE STATUS LENS: celebrations accept the
--                         draft/approved/published/archived set; published
--                         with no channel is refused (23514); unknown types
--                         and visibilities are rejected; recurring defaults
--                         to false and guardian_consent defaults to false.
--   79.5  enums         -- youth enums reject unknown values; milestones
--                         require a date or a year (23514); previous-branch
--                         years must be ordered.
--   79.6  people        -- §4.2: the widened status set accepts transferred
--                         etc.; marital/employment/education/person_type
--                         CHECKs reject unknowns and accept NULLs.
--   79.7  guards        -- the app identity reads all six tables, writes
--                         operational columns, and deletes nothing (youth
--                         rows hold children's PII; celebrations are audited
--                         greetings; erasure runs as retention_worker).
--   79.8  indexes       -- the §6.1/§6.2 + issue index set exists, including
--                         the recurring (month, day) partial index; branch
--                         and month/day predicates partition fixture rows the
--                         way the list route filters them.
--   79.9  rollback      -- the down script refuses while rows exist
--                         (restrict_violation = 23001).
--
-- What this suite does NOT assert (stated, not missing): the HTTP 403/empty
-- half -- a zone admin's cross-zone youth rejected, a branch export
-- containing only its own branch, the draft->approved->published->archived
-- transition graph, the minor-guardian refusal, the visibility scoping --
-- lives in the route layer (requireZoneInScope + scope predicates + the
-- shared collector) and is covered by
-- tests/web/youth-celebrations.contract.mjs. A SQL suite asserting HTTP
-- status codes would be testing the wrong layer.

-- ---------------------------------------------------------------------------
-- 79.0  FIXTURE. Fixed ids so this file reruns cleanly in one database.
--        OKE-ARO (Z1) and SANGO (Z2) come from the hierarchy seed (LEGUN
--        moved to Z1 under the user-confirmed map, AFC-578).
-- ---------------------------------------------------------------------------
INSERT INTO people (id, date_of_birth, status)
VALUES
  ('a1111111-1111-4111-8111-111111111111', DATE '2005-03-14', 'active'),
  ('a2222222-2222-4222-8222-222222222222', DATE '1998-11-02', 'active'),
  -- a333 carries no youth profile: the app-grant and enum probes below
  -- need a person whose profile link cannot collide (probes roll back, so
  -- a fixture person with a profile would read as a false UNIQUE failure).
  ('a3333333-3333-4333-8333-333333333333', DATE '2009-01-20', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO youth_profiles
  (id, person, education_level, institution, course, study_level,
   employment_status, is_entrepreneur, youth_leadership_role, branch, status)
VALUES
  ('d1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'undergraduate', 'University of Lagos', 'Sociology', 'junior',
   'student', false, NULL,
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'active'),
  ('d2222222-2222-4222-8222-222222222222',
   'a2222222-2222-4222-8222-222222222222',
   'secondary', 'Lagos Grammar School', NULL, 'final_year',
    'student', false, 'Youth Secretariat',
    (SELECT id FROM branches WHERE code = 'SANGO'), 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO youth_profile_events
  (id, profile, event_type, detail)
VALUES
  ('e1111111-1111-4111-8111-111111111111',
   'd1111111-1111-4111-8111-111111111111', 'created', 'Youth profile linked')
ON CONFLICT (id) DO NOTHING;

INSERT INTO celebrations
  (id, person, type, event_date, is_recurring, title, message,
   visibility, publish_channels, branch, status, guardian_consent)
VALUES
  ('c1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'birthday', DATE '2005-03-14', true, 'Happy birthday Ada',
   'Many happy returns', 'branch', '["whatsapp"]'::jsonb,
   (SELECT id FROM branches WHERE code = 'OKE-ARO'), 'published', true),
  ('c2222222-2222-4222-8222-222222222222',
   'a2222222-2222-4222-8222-222222222222',
   'graduation', DATE '2026-07-20', false, 'Convocation shout-out',
   'First class honours', 'public', '["whatsapp","telegram"]'::jsonb,
    (SELECT id FROM branches WHERE code = 'SANGO'), 'approved', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO celebration_events
  (id, celebration, event_type, detail)
VALUES
  ('f1111111-1111-4111-8111-111111111111',
   'c1111111-1111-4111-8111-111111111111', 'published', 'Birthday greeting published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO person_previous_branches
  (id, person, branch_name, role, from_year, to_year)
VALUES
  ('b1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'Matogun', 'Member', 2019, 2022)
ON CONFLICT (id) DO NOTHING;

INSERT INTO person_milestones
  (id, person, milestone_type, milestone_year, notes)
VALUES
  ('b2222222-2222-4222-8222-222222222222',
   'a1111111-1111-4111-8111-111111111111',
   'saved', 2020, 'Youth convention')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 79.1  TABLES. All six tables exist with the §6.1/§6.2/§4.3/§4.4 shapes;
--        people carries the §4.2 columns.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_true(
    to_regclass('public.youth_profiles') IS NOT NULL,
    'youth', 'youth_profiles exists');
  PERFORM test_support.assert_true(
    to_regclass('public.youth_profile_events') IS NOT NULL,
    'youth', 'youth_profile_events exists');
  PERFORM test_support.assert_true(
    to_regclass('public.celebrations') IS NOT NULL,
    'youth', 'celebrations exists');
  PERFORM test_support.assert_true(
    to_regclass('public.celebration_events') IS NOT NULL,
    'youth', 'celebration_events exists');
  PERFORM test_support.assert_true(
    to_regclass('public.person_previous_branches') IS NOT NULL,
    'youth', 'person_previous_branches exists');
  PERFORM test_support.assert_true(
    to_regclass('public.person_milestones') IS NOT NULL,
    'youth', 'person_milestones exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'youth_profiles'
               AND column_name IN ('person', 'education_level', 'institution',
                 'course', 'study_level', 'employment_status',
                 'professional_status', 'is_entrepreneur',
                 'youth_leadership_role', 'branch', 'zone', 'status')
             HAVING count(*) = 12),
    'youth', 'youth_profiles carries the full §6.1 column set');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'celebrations'
               AND column_name IN ('person', 'type', 'event_date',
                 'is_recurring', 'title', 'message', 'visibility',
                 'publish_channels', 'branch', 'zone', 'status',
                 'guardian_consent', 'created_by')
             HAVING count(*) = 13),
    'youth', 'celebrations carries the full §6.2 column set');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'people'
               AND column_name IN ('marital_status', 'marriage_date',
                 'occupation', 'employment_status', 'education_level',
                 'institution', 'is_entrepreneur', 'professional_status',
                 'is_youth', 'locality', 'sub_location',
                 'previous_branch_note', 'gravatar_hash', 'avatar_url',
                 'person_type')
             HAVING count(*) = 15),
    'youth', 'people carries the §4.2 column set');
END $$;

-- ---------------------------------------------------------------------------
-- 79.2  RERUN. Re-applying the migration changes nothing.
-- ---------------------------------------------------------------------------
\i services/directus/schema/migrations/20261020_0012_youth_celebrations.sql

DO $$
BEGIN
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM youth_profiles
      WHERE id IN ('d1111111-1111-4111-8111-111111111111',
                   'd2222222-2222-4222-8222-222222222222')) = 2,
    'youth', 'rerun: both fixture profiles survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM celebrations
      WHERE id IN ('c1111111-1111-4111-8111-111111111111',
                   'c2222222-2222-4222-8222-222222222222')) = 2,
    'youth', 'rerun: both fixture celebrations survive');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM person_milestones
      WHERE id = 'b2222222-2222-4222-8222-222222222222') = 1,
    'youth', 'rerun: the fixture milestone survives');
END $$;

-- ---------------------------------------------------------------------------
-- 79.3  YOUTH LINK. The 1-1 lens: person UNIQUE, CASCADE on the child,
--        RESTRICT on the celebration.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- A second profile for one person is refused (unique person).
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (person) VALUES ('a1111111-1111-4111-8111-111111111111')$q$,
    '23505', 'youth', 'a second youth profile for one person is refused');
  -- A profile for a person that does not exist is refused.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (id, person) VALUES ('d0000000-0000-4000-8000-0000000000d0', '00000000-0000-4000-8000-0000000000ff')$q$,
    '23503', 'youth', 'a youth profile for an unknown person is refused');
  -- A celebration naming a person is a RESTRICT edge: the delete fails.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$DELETE FROM people WHERE id = 'a1111111-1111-4111-8111-111111111111'$q$,
    '23503', 'youth', 'deleting a person named by a celebration is refused (RESTRICT)');
  -- The trail is accepted: created + updated + freeform note.
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO youth_profile_events (id, profile, event_type, detail) VALUES ('e2222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111', 'note', 'Mentor confirmed the study level') ON CONFLICT (id) DO NOTHING$q$,
    'youth', 'a freeform youth audit note is accepted');
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO celebration_events (id, celebration, event_type, detail) VALUES ('f2222222-2222-4222-8222-222222222222', 'c2222222-2222-4222-8222-222222222222', 'approved', 'Shout-out approved') ON CONFLICT (id) DO NOTHING$q$,
    'youth', 'a celebration lifecycle audit row is accepted');
  -- Unknown celebration audit event type rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO celebration_events (celebration, event_type) VALUES ('c1111111-1111-4111-8111-111111111111', 'deleted')$q$,
    '23514', 'youth', 'an unknown celebration audit event type is rejected');
END $$;

-- CASCADE is pinned structurally, not behaviourally. A behavioural probe
-- would DELETE FROM people, and people carries the AFC-295 retention
-- DELETE guard: only the retention engine owner may delete a person row
-- (suite 59), so no probe identity can demonstrate the cascade by firing
-- it. The pinch point that decides cascade-vs-restrict is the FK's
-- confdeltype, so the suite pins that: 'c' = CASCADE, 'r' = RESTRICT.
-- The behavioural half that IS provable -- the RESTRICT edge refusing a
-- delete -- is asserted above (the FK check surfaces 23503 ahead of the
-- retention guard, the suite-77 precedent).
DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'youth_profiles_person_fkey'),
    'c',
    'youth', 'the youth profile follows its person (CASCADE)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'person_previous_branches_person_fkey'),
    'c',
    'youth', 'previous branches follow their person (CASCADE)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'person_milestones_person_fkey'),
    'c',
    'youth', 'milestones follow their person (CASCADE)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'celebrations_person_fkey'),
    'r',
    'youth', 'a celebration keeps its person (RESTRICT)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'youth_profile_events_profile_fkey'),
    'c',
    'youth', 'the youth trail follows its profile (CASCADE)');
  PERFORM test_support.assert_equals(
    (SELECT confdeltype::text FROM pg_constraint
      WHERE conname = 'celebration_events_celebration_fkey'),
    'c',
    'youth', 'the celebration trail follows its celebration (CASCADE)');
END $$;

-- ---------------------------------------------------------------------------
-- 79.4  LIFECYCLE. The status lens: the §6.2 set, published-with-channel,
--        closed type/visibility enums, stored-consent defaults.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO celebrations (person, type, event_date, branch, status) VALUES ('a2222222-2222-4222-8222-222222222222', 'graduation', DATE '2026-08-01', (SELECT id FROM branches WHERE code = 'LEGUN'), 'sent')$q$,
    '23514', 'youth', 'an unknown celebration status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO celebrations (person, type, event_date, branch, status) VALUES ('a2222222-2222-4222-8222-222222222222', 'nameday', DATE '2026-08-01', (SELECT id FROM branches WHERE code = 'LEGUN'), 'draft')$q$,
    '23514', 'youth', 'an unknown celebration type is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO celebrations (person, type, event_date, branch, visibility) VALUES ('a2222222-2222-4222-8222-222222222222', 'graduation', DATE '2026-08-01', (SELECT id FROM branches WHERE code = 'LEGUN'), 'ward')$q$,
    '23514', 'youth', 'an unknown celebration visibility is rejected');
  -- Published with no channel reads as sent and reaches nobody: refused.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO celebrations (person, type, event_date, branch, status) VALUES ('a2222222-2222-4222-8222-222222222222', 'graduation', DATE '2026-08-01', (SELECT id FROM branches WHERE code = 'LEGUN'), 'published')$q$,
    '23514', 'youth', 'published with no publish channel is refused');
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO celebrations (person, type, event_date, branch, status, publish_channels) VALUES ('a2222222-2222-4222-8222-222222222222', 'scholarship', DATE '2026-08-01', (SELECT id FROM branches WHERE code = 'LEGUN'), 'published', '["sms"]'::jsonb)$q$,
    'youth', 'published with a channel is accepted');
END $$;

-- A probe never persists (assert.sql), so the stored-defaults read below
-- needs a plain persistent INSERT, not a probe. ON CONFLICT keeps the file
-- rerunnable.
INSERT INTO celebrations (id, person, type, event_date, branch, status, publish_channels)
  VALUES ('c0c0c0c0-c0c0-40c0-8c0c-0c0c0c0c0c0c',
    'a2222222-2222-4222-8222-222222222222', 'scholarship', DATE '2026-08-01',
    (SELECT id FROM branches WHERE code = 'LEGUN'), 'published', '["sms"]'::jsonb)
  ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  -- Stored defaults: recurring false, consent false; status/visibility as written.
  PERFORM test_support.assert_equals(
    (SELECT is_recurring::text || '/' || guardian_consent::text || '/' || status || '/' || visibility
       FROM celebrations WHERE id = 'c0c0c0c0-c0c0-40c0-8c0c-0c0c0c0c0c0c'),
    'false/false/published/internal',
    'youth', 'a channel-published row keeps stored defaults for the rest');
END $$;

INSERT INTO celebrations (id, person, type, event_date, branch)
  VALUES ('c0d0d0d0-d0d0-40d0-8d0d-0d0d0d0d0d0d',
    'a2222222-2222-4222-8222-222222222222', 'admission', DATE '2026-09-01',
    (SELECT id FROM branches WHERE code = 'LEGUN'))
  ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  PERFORM test_support.assert_equals(
    (SELECT is_recurring::text || '/' || guardian_consent::text || '/' || status || '/' || visibility
       FROM celebrations WHERE id = 'c0d0d0d0-d0d0-40d0-8d0d-0d0d0d0d0d0d'),
    'false/false/draft/internal',
    'youth', 'a bare celebration stores recurring=false, consent=false, draft, internal');
END $$;

-- ---------------------------------------------------------------------------
-- 79.5  ENUMS. Youth value sets, milestone dating, ordered year ranges.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (person, education_level) VALUES ('a3333333-3333-4333-8333-333333333333', 'doctorate')$q$,
    '23514', 'youth', 'an unknown youth education_level is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (person, employment_status) VALUES ('a3333333-3333-4333-8333-333333333333', 'retired')$q$,
    '23514', 'youth', 'an unknown youth employment_status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (person, study_level) VALUES ('a3333333-3333-4333-8333-333333333333', 'postdoc')$q$,
    '23514', 'youth', 'an unknown youth study_level is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO youth_profiles (person, status) VALUES ('a3333333-3333-4333-8333-333333333333', 'graduated')$q$,
    '23514', 'youth', 'an unknown youth profile status is rejected');
  -- Milestones need a when: neither date nor year is rejected.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_milestones (person, milestone_type) VALUES ('a2222222-2222-4222-8222-222222222222', 'saved')$q$,
    '23514', 'youth', 'a milestone with no date and no year is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_milestones (person, milestone_type) VALUES ('a2222222-2222-4222-8222-222222222222', 'confirmation')$q$,
    '23514', 'youth', 'an unknown milestone_type is rejected');
  -- Previous-branch years must be ordered.
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO person_previous_branches (person, branch_name, from_year, to_year) VALUES ('a2222222-2222-4222-8222-222222222222', 'Nowhere', 2022, 2019)$q$,
    '23514', 'youth', 'a previous branch with from_year after to_year is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 79.6  PEOPLE §4.2. The new value columns, and the WITHHELD status set.
--
-- CONTESTED (escalated to the CTO on AFC-476, migration 0012 header): the
-- issue orders the §4.2 status expansion (transferred/retired/maternity/
-- student/unidentified/discipline/deceased), but suite 63 pins the
-- (active, archived) closure as a retention control and asserts
-- status = 'deceased' is refused. The migration withholds the widening,
-- so this suite pins the CLOSED behaviour -- transferred/maternity/
-- deceased are REFUSED here -- until the CTO decides. If the CTO approves
-- the expansion, this block and suite 63 change together on that ticket.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_migrator',
    $q$INSERT INTO people (marital_status, employment_status, education_level, person_type, is_youth, is_entrepreneur) VALUES ('married', 'self_employed', 'undergraduate', 'member', true, true)$q$,
    'youth', 'a §4.2 person row (married/self-employed/undergraduate) is accepted');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (status) VALUES ('transferred')$q$,
    '23514', 'youth', 'CONTESTED: transferred is refused while the retention-closed status set holds (CTO decision pending)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (status) VALUES ('maternity')$q$,
    '23514', 'youth', 'CONTESTED: maternity is refused while the retention-closed status set holds (CTO decision pending)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (status) VALUES ('deceased')$q$,
    '23514', 'youth', 'CONTESTED: deceased is refused while the retention-closed status set holds (suite 63 control)');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (status) VALUES ('suspended')$q$,
    '23514', 'youth', 'a status outside both sets is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (marital_status) VALUES ('complicated')$q$,
    '23514', 'youth', 'an unknown marital_status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (employment_status) VALUES ('intern')$q$,
    '23514', 'youth', 'an unknown employment_status is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (education_level) VALUES ('phd')$q$,
    '23514', 'youth', 'an unknown education_level is rejected');
  PERFORM test_support.assert_raises('directus_migrator',
    $q$INSERT INTO people (person_type) VALUES ('alumni')$q$,
    '23514', 'youth', 'an unknown person_type is rejected');
END $$;

-- ---------------------------------------------------------------------------
-- 79.7  GUARDS. The app ceiling: read everywhere, write operational
--        columns, delete nothing.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM youth_profiles$q$,
    'youth', 'directus_app can read youth_profiles');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM celebrations$q$,
    'youth', 'directus_app can read celebrations');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$SELECT count(*) FROM person_milestones$q$,
    'youth', 'directus_app can read person_milestones');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO youth_profiles (person, education_level) VALUES ('a3333333-3333-4333-8333-333333333333', 'primary')$q$,
    'youth', 'directus_app can link youth profiles');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO celebrations (person, type, event_date, branch, title) VALUES ('a2222222-2222-4222-8222-222222222222', 'admission', DATE '2026-10-18', (SELECT id FROM branches WHERE code = 'LEGUN'), 'probe')$q$,
    'youth', 'directus_app can record celebrations');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO person_milestones (person, milestone_type, milestone_year) VALUES ('a2222222-2222-4222-8222-222222222222', 'water_baptism', 2023)$q$,
    'youth', 'directus_app can record milestones');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO person_previous_branches (person, branch_name) VALUES ('a2222222-2222-4222-8222-222222222222', 'probe')$q$,
    'youth', 'directus_app can record previous branches');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO celebration_events (celebration, event_type, detail) VALUES ('c2222222-2222-4222-8222-222222222222', 'note', 'probe')$q$,
    'youth', 'directus_app can write celebration audit rows');
  PERFORM test_support.assert_not_raises('directus_app',
    $q$INSERT INTO youth_profile_events (profile, event_type, detail) VALUES ('d1111111-1111-4111-8111-111111111111', 'note', 'probe')$q$,
    'youth', 'directus_app can write youth audit rows');

  -- The ceiling: no DELETE anywhere (probe writes roll back, so these
  -- DELETEs target fixture rows; permission is checked before any row
  -- match, hence 42501 either way).
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM youth_profiles WHERE id = 'd1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'youth', 'directus_app has no DELETE on youth_profiles');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM celebrations WHERE id = 'c1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'youth', 'directus_app has no DELETE on celebrations');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM celebration_events WHERE celebration = 'c1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'youth', 'directus_app has no DELETE on the celebration trail');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM youth_profile_events WHERE profile = 'd1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'youth', 'directus_app has no DELETE on the youth trail');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM person_milestones WHERE id = 'b2222222-2222-4222-8222-222222222222'$q$,
    '42501', 'youth', 'directus_app has no DELETE on person_milestones');
  PERFORM test_support.assert_raises('directus_app',
    $q$DELETE FROM person_previous_branches WHERE id = 'b1111111-1111-4111-8111-111111111111'$q$,
    '42501', 'youth', 'directus_app has no DELETE on person_previous_branches');
END $$;

-- ---------------------------------------------------------------------------
-- 79.8  INDEXES + PARTITION. The §6.1/§6.2 + issue index set exists,
--        including the recurring month/day predicate the feed filters on.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_z1 uuid;
BEGIN
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'youth_profiles_person_uidx'),
    'youth', 'the youth person unique index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'celebrations_type_date_idx'),
    'youth', 'the (type, event_date) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'celebrations_branch_date_idx'),
    'youth', 'the (branch, event_date) index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'celebrations_recurring_md_idx'),
    'youth', 'the recurring (month, day) partial index exists (cost lens)');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'celebration_events_celebration_created_idx'),
    'youth', 'the (celebration, created_at) audit index exists');
  PERFORM test_support.assert_true(
    EXISTS (SELECT 1 FROM pg_class WHERE relname = 'person_milestones_person_type_idx'),
    'youth', 'the (person, milestone_type) index exists');

  SELECT id INTO v_z1 FROM zones WHERE code = 'LAG-NORTH-Z1';

  -- Branch predicate: Oke-Aro rows only (fixtures share dates across two
  -- branches; plus the c0* Oke-free probe rows stay out of this branch).
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM celebrations c
      WHERE c.branch = (SELECT id FROM branches WHERE code = 'OKE-ARO')
        AND c.id IN ('c1111111-1111-4111-8111-111111111111',
                     'c2222222-2222-4222-8222-222222222222')) = 1,
    'youth', 'a branch predicate isolates exactly that branch''s celebration');
  PERFORM test_support.assert_true(
    (SELECT count(*) FROM celebrations WHERE zone = v_z1
      AND id IN ('c1111111-1111-4111-8111-111111111111',
                 'c2222222-2222-4222-8222-222222222222')) = 1,
    'youth', 'a Z1 predicate returns exactly Z1''s celebration');
  -- Month/day predicate: the March birthday answers to (3, 14) and the
  -- July graduation does not -- the recurring feed predicate.
  PERFORM test_support.assert_equals(
    (SELECT count(*)::text FROM celebrations
      WHERE EXTRACT(MONTH FROM event_date) = 3
        AND EXTRACT(DAY FROM event_date) = 14
        AND is_recurring
        AND id IN ('c1111111-1111-4111-8111-111111111111',
                   'c2222222-2222-4222-8222-222222222222')),
    '1',
    'youth', 'the recurring (month, day) predicate isolates the birthday fixture');
END $$;

-- ---------------------------------------------------------------------------
--   79.9  ROLLBACK REFUSES while rows exist (equivalent probe, discarded).
--        The guard predicate is the down script's own first block, so the
--        suite pins the same refusal the shipped script enforces; it does
--        not execute the shipped file itself (its guard raises before any
--        DROP, so execution would be safe, but the pin is on the predicate,
--        not on the script's NOTICE text).
-- ---------------------------------------------------------------------------
DO $outer$
BEGIN
  PERFORM test_support.assert_raises('directus_migrator',
    $$DO $rb$ BEGIN IF (SELECT count(*) FROM youth_profiles) > 0 OR (SELECT count(*) FROM celebrations) > 0 THEN RAISE EXCEPTION 'refusing to roll back youth/celebrations: test probe' USING ERRCODE = 'restrict_violation'; END IF; END $rb$;$$,
    '23001', 'youth', 'rollback refuses while youth or celebrations exist');
END $outer$;
