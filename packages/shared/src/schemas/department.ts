/**
 * Departments and their membership junction.
 *
 * Department rows are board-shaped data (data-model §2.2): the slice builds
 * the staff list, the per-department member view and member link/unlink, but
 * no create/edit form for departments themselves — that stays a board action.
 * Membership is the `people_departments` junction (§2.4): one row per
 * (person, department), unique on the pair, with a `role` and a `status`.
 *
 * Unlink sets the junction row to `inactive` rather than deleting it, so the
 * assignment history survives. Re-linking the same person reactivates the row
 * instead of violating the unique pair index.
 */
import { z } from 'zod'
import { uuidSchema } from './common'

export const DEPARTMENT_MEMBER_ROLES = ['member', 'leader', 'assistant'] as const

/**
 * Link a person into a department. The department id comes from the route;
 * the body names the person and optionally the junction role. Unlink accepts
 * the same shape minus the role.
 */
export const departmentMemberLinkSchema = z.object({
  person: uuidSchema,
  role: z.enum(DEPARTMENT_MEMBER_ROLES).default('member'),
})
export type DepartmentMemberLink = z.infer<typeof departmentMemberLinkSchema>

export const departmentMemberUnlinkSchema = z.object({
  person: uuidSchema,
})
export type DepartmentMemberUnlink = z.infer<typeof departmentMemberUnlinkSchema>
