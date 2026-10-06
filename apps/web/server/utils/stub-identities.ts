import type { H3Event } from 'h3'
import type { PortalUser, StaffRole } from '@afc/shared'

/**
 * Seeded identities for local shell work, active only when `NUXT_STUB_AUTH=true`.
 *
 * WHY THIS EXISTS
 *   Directus does not exist yet. Without a way to obtain a session, the auth
 *   guard, the capabilities endpoint and the navigation cannot be exercised at
 *   all, and "the middleware redirects" would be an untested claim. This file
 *   gives the shell a session so that claim can be demonstrated.
 *
 * WHAT IT IS NOT
 *   Not authentication. It compares a published string and hands out a session
 *   to anyone who asks. It is off unless `NUXT_STUB_AUTH` is explicitly `true`,
 *   it refuses to run when `NODE_ENV` is `production`, and every fixture below
 *   is a fixed UUID with no personal data behind it. Delete this file and the
 *   `stubAuth` branch in `login.post.ts` together, when the Directus project is
 *   deployed.
 *
 * The roles are chosen to cover the distinct rows of the data-model §10 matrix,
 * so the capabilities endpoint can be shown producing different navigation for
 * each of them.
 */

export const STUB_PASSWORD = 'stub-not-a-secret'

interface StubIdentity {
  email: string
  password: string
  user: PortalUser
}

const BRANCH_ID = '00000000-0000-4000-8000-0000000000b1'
const YOUTH_BRANCH_ID = '00000000-0000-4000-8000-0000000000b2'
const YOUTH_DEPARTMENT_ID = '00000000-0000-4000-8000-0000000000d1'

export const STUB_IDENTITIES: readonly StubIdentity[] = [
  {
    email: 'area.admin@stub.local',
    password: STUB_PASSWORD,
    user: {
      id: '00000000-0000-4000-8000-0000000000a1',
      email: 'area.admin@stub.local',
      firstName: 'Area',
      staffRole: 'area_admin',
      branchId: null,
      branchIds: [BRANCH_ID, YOUTH_BRANCH_ID],
      departmentIds: [],
      personId: null,
    },
  },
  {
    email: 'branch.admin@stub.local',
    password: STUB_PASSWORD,
    user: {
      id: '00000000-0000-4000-8000-0000000000a2',
      email: 'branch.admin@stub.local',
      firstName: 'Branch',
      staffRole: 'branch_admin',
      branchId: BRANCH_ID,
      branchIds: [BRANCH_ID],
      departmentIds: [],
      personId: null,
    },
  },
  {
    email: 'youth.leader@stub.local',
    password: STUB_PASSWORD,
    user: {
      id: '00000000-0000-4000-8000-0000000000a3',
      email: 'youth.leader@stub.local',
      firstName: 'Youth',
      staffRole: 'department_leader',
      branchId: YOUTH_BRANCH_ID,
      branchIds: [YOUTH_BRANCH_ID],
      departmentIds: [YOUTH_DEPARTMENT_ID],
      personId: null,
    },
  },
  {
    email: 'volunteer@stub.local',
    password: STUB_PASSWORD,
    user: {
      id: '00000000-0000-4000-8000-0000000000a4',
      email: 'volunteer@stub.local',
      firstName: 'Sunday',
      staffRole: 'volunteer',
      branchId: BRANCH_ID,
      branchIds: [BRANCH_ID],
      departmentIds: [],
      personId: null,
    },
  },
]

export function stubAuthEnabled(event: H3Event): boolean {
  const config = useRuntimeConfig(event)
  if (!config.stubAuth) return false
  // Defence in depth against the one configuration mistake that would publish
  // this: a production deploy that carried NUXT_STUB_AUTH through.
  if (process.env.NODE_ENV === 'production') {
    throw createError({
      statusCode: 503,
      statusMessage:
        'NUXT_STUB_AUTH is set but NODE_ENV is production. Refusing to serve stub identities.',
    })
  }
  return true
}

export function findStubIdentity(email: string, password: string): PortalUser | null {
  const normalised = email.trim().toLowerCase()
  const match = STUB_IDENTITIES.find(
    (identity) => identity.email === normalised && identity.password === password,
  )
  return match?.user ?? null
}

export function stubRoles(): StaffRole[] {
  return STUB_IDENTITIES.map((identity) => identity.user.staffRole)
}
