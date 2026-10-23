-- Rollback for 0040: revoke exactly the grants 0040 added.
-- SELECT (pre-existing) is untouched. Refuses while callers could still
-- depend on group writes? No: revocation is instantaneous and safe to
-- re-apply forward; no data moves.
REVOKE INSERT (id, name, code, department_type, branch, zone, area, leader_person, description, status) ON departments FROM directus_app;
REVOKE UPDATE (name, code, description, status, leader_person) ON departments FROM directus_app;
REVOKE INSERT (people, departments, role, joined_at, status) ON people_departments FROM directus_app;
REVOKE UPDATE (role, status) ON people_departments FROM directus_app;
