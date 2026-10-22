-- Migration 0038: v4 people identity columns (AFC-700, CTO decision A).
--
-- WHAT THIS FILE CREATES (verified: no other file in this history adds
-- these columns -- grep first_name/last_name over services/directus/schema/
-- hits only visitor/event-registration namesakes and the 0004 down-script
-- anchor check below).
--
--   people.first_name / people.last_name -- nullable text. The scope-denorm
--     suite (tests/db/94) inserts a named parent person; the retention
--     anchor (20261006_0004) carries no names by design.
--   people.branch -- nullable uuid REFERENCES branches(id) ON DELETE SET
--     NULL. The mode-0 scope sync (20261020_0030) copies branch/zone from a
--     person onto people_departments and consent_records; without a branch
--     column on people that copy has nothing to read and the scratch-DB
--     backfill raised 42703. Branch is the same type as every other branch
--     column in this history (uuid FK), NOT the staging varchar graft: the
--     0030 trigger and backfill read parent.branch through ::text plus the
--     uuid-shape check, so a project database that already carries the
--     varchar graft keeps working (ADD COLUMN IF NOT EXISTS leaves it) and
--     a database built from this history gets the uuid FK.
--
-- NOT added here, deliberately: phone, email, membership_status, guardian
-- and the rest of the operational record. Those are a wider data-model
-- decision with their own grant surface; this file unblocks identity +
-- scope and nothing else. A follow-up migration owns the remainder.
--
-- NULLABLE, no backfill: existing anchor rows read NULL. Names are plain
-- text with no CHECK -- the app layer validates shape, matching the 0012
-- people-column precedent (marital_status et al).
--
-- GRANTS (expansion §10, least privilege ADR-0002): directus_app gets
-- INSERT/UPDATE on exactly the three new columns, mirroring the 0020
-- (household) and 0026 (household_role) people-column grants. No DELETE
-- anywhere in this file (people rows are retention-managed, AFC-295).
-- SELECT already covers the whole row; REVOKE ALL FROM PUBLIC is
-- re-asserted for the table.
--
-- Idempotent: columns and index use IF NOT EXISTS; grants and the revoke
-- are re-runnable.
--
-- Rollback: rollback/20261022_0038_people_identity.down.sql (refuses while
-- any of the three columns carries data; drops columns + index + the
-- column grants it added). Owner: migration role (directus_migrator).
-- Role hygiene per ADR-0002: this file provisions no roles and grants no
-- role-creation or superuser capability; only GRANT/REVOKE on tables.

-- 1. Identity columns. Nullable: backfill-safe, existing rows read NULL.
ALTER TABLE people ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE people ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE people ADD COLUMN IF NOT EXISTS branch uuid REFERENCES branches(id) ON DELETE SET NULL;

COMMENT ON COLUMN people.first_name IS
  'Person given name (AFC-700). Nullable: pre-038 anchor rows read NULL. Validated at the app layer.';
COMMENT ON COLUMN people.last_name IS
  'Person family name (AFC-700). Nullable: pre-038 anchor rows read NULL. Validated at the app layer.';
COMMENT ON COLUMN people.branch IS
  'Home branch (AFC-700). Nullable uuid FK; the 0030 scope sync copies it onto people_departments and consent_records. Project databases carrying the staging varchar graft keep it (IF NOT EXISTS); the sync reads through ::text either way.';

-- 2. Scope-filter index on the new branch link, mirroring the 0020/0026
--    people-column indexes. No name indexes: no stated query pattern reads
--    by name at the database layer.
CREATE INDEX IF NOT EXISTS people_branch_idx ON people (branch);

-- 3. Least-privilege ceiling: extend the app role with exactly the three
--    new columns. GRANT is idempotent; repeating it changes nothing.
GRANT INSERT (first_name, last_name, branch) ON people TO directus_app;
GRANT UPDATE (first_name, last_name, branch) ON people TO directus_app;

REVOKE ALL ON people FROM PUBLIC;
