-- Migration 0040: app-layer group writes (AFC-758).
--
-- Departments themselves are board-shaped data, but the board ruled that
-- staff may create *groups* (department_type = 'group', Area-HQ member
-- subsets) from the section page, with a leader assigned at creation.
-- Membership linking already exists (members.post/unlink); it only ever
-- worked for roles that could already write, because directus_app held
-- SELECT alone on both tables here.
--
-- Least-privilege ceiling: INSERT/UPDATE over exactly the columns the
-- portal writes. No DELETE anywhere (unlink is a status flip, retention
-- posture). Branch/zone/area moves are NOT granted: scope placement is
-- set at creation and stays board-managed. REVOKE ALL ON ... FROM PUBLIC
-- is re-asserted (defence in depth; 0013-era precedent).
-- People-branch graft columns are untouched.

-- Departments: creation + group edits (name/code/description/status/leader).
GRANT INSERT (id, name, code, department_type, branch, zone, area, leader_person, description, status)
  ON departments TO directus_app;
GRANT UPDATE (name, code, description, status, leader_person)
  ON departments TO directus_app;

-- Junction: link/reactivate rows and role/status maintenance. Branch/zone
-- stay trigger-filled (0030 afc_set_scope), never app-supplied.
GRANT INSERT (people, departments, role, joined_at, status) ON people_departments TO directus_app;
GRANT UPDATE (role, status) ON people_departments TO directus_app;

REVOKE ALL ON departments FROM PUBLIC;
REVOKE ALL ON people_departments FROM PUBLIC;
