/**
 * Identity and session shapes.
 *
 * `StaffRole` mirrors `directus_users.staff_role` (data-model §7.1). The portal
 * never branches on it in the browser: the server turns a role into a
 * capability list (see `permissions.ts`) and the UI branches on capabilities
 * only. That is data-model §13 rule 7, and it is what keeps a future swap of
 * the governance layer a deployment change rather than a UI rewrite.
 */
import { z } from 'zod'

export const STAFF_ROLES = [
  'super_admin',
  'area_admin',
  'branch_admin',
  'department_leader',
  'volunteer',
  'none',
] as const

export type StaffRole = (typeof STAFF_ROLES)[number]

export const staffRoleSchema = z.enum(STAFF_ROLES)

/**
 * The signed-in user as the portal needs it. Directus's own user row carries far
 * more; this is the reduced projection the server hands to the browser.
 *
 * `branchIds` and `departmentIds` come from the JSON array fields the sync Flow
 * maintains (data-model §7.1). They are included so the UI can scope a view —
 * never to authorise one. The Directus policy is the only authoritative control
 * (data-model §9).
 */
export interface PortalUser {
  id: string
  email: string
  firstName: string | null
  staffRole: StaffRole
  /** Home branch. Null for area admins. */
  branchId: string | null
  /** Multi-branch scope, maintained by the sync Flow. */
  branchIds: string[]
  /** Department scope, derived from `users_departments`. */
  departmentIds: string[]
  /** Linked person profile, when the login maps to one. */
  personId: string | null
}

export const loginCredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})
export type LoginCredentials = z.infer<typeof loginCredentialsSchema>

/**
 * Session envelope. `expiresAt` is an ISO timestamp so the client does not have
 * to agree with the server about clock units.
 */
export interface AuthSession {
  user: PortalUser
  issuedAt: string
  expiresAt: string
}

export const authSessionSchema: z.ZodType<AuthSession> = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    firstName: z.string().nullable(),
    staffRole: staffRoleSchema,
    branchId: z.string().uuid().nullable(),
    branchIds: z.array(z.string().uuid()),
    departmentIds: z.array(z.string().uuid()),
    personId: z.string().uuid().nullable(),
  }),
  issuedAt: z.string(),
  expiresAt: z.string(),
})

/** Name of the httpOnly cookie that carries the session token. */
export const SESSION_COOKIE_NAME = 'afc_session'
