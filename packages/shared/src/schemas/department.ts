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
 *
 * Group creation (AFC-758) is the one staff-writable department path: only
 * department_type 'group' may be created through the API, and only
 * area-scoped (branch null + area set, the Groups 1-4 precedent). All other
 * department types stay board-managed and are refused with a named code.
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

/**
 * Create a group (AFC-758). Staff may create groups only: any other
 * department_type is refused by the route, and area scope (branch null
 * with an area) is required. The leader, when given, is linked as a
 * junction leader row in the same request.
 */
export const departmentGroupCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name the group').max(200),
  code: z
    .string()
    .trim()
    .min(1, 'Give the group a code')
    .max(40)
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Code uses capitals, digits and dashes'),
  department_type: z.literal('group'),
  area: uuidSchema,
  description: z.string().trim().max(2000).optional(),
  leader_person: uuidSchema.optional(),
})
export type DepartmentGroupCreate = z.infer<typeof departmentGroupCreateSchema>

/**
 * Edit a group (AFC-758). Name/description/status/leader only — scope
 * placement (branch/zone/area) and type never move through the app.
 */
export const departmentGroupPatchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  leader_person: uuidSchema.nullable().optional(),
})
export type DepartmentGroupPatch = z.infer<typeof departmentGroupPatchSchema>

/**
 * Create a department guide (AFC-800, parent AFC-759). Guides are
 * instructional rows owned by one department, ordered by
 * (sort_order, id). The writer gate lives in the route: departments
 * update grant OR an active leader link on the department. Editable
 * through the app: title/body/sort_order only — placement (department)
 * never moves, and there is no DELETE path (retention posture).
 */
export const departmentGuideCreateSchema = z.object({
  title: z.string().trim().min(1, 'Name the guide').max(200),
  body: z.string().trim().max(20000).default(''),
  sort_order: z.number().int().min(0).max(9999).default(0),
})
export type DepartmentGuideCreate = z.infer<typeof departmentGuideCreateSchema>

/**
 * Edit a department guide (AFC-800). Title/body/sort_order only.
 */
export const departmentGuidePatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().max(20000).optional(),
  sort_order: z.number().int().min(0).max(9999).optional(),
})
export type DepartmentGuidePatch = z.infer<typeof departmentGuidePatchSchema>
