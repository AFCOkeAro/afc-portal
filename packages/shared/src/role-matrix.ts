import { COLLECTIONS } from './collections'

export const ALL = ['create', 'read', 'update', 'delete'] as const
export const CRU = ['create', 'read', 'update'] as const
export const CR = ['create', 'read'] as const
export const R = ['read'] as const
export const NONE: readonly [] = []

type Action = 'create' | 'read' | 'update' | 'delete'
type Scope = 'all' | 'own_branch' | 'own_zone' | 'assigned_branches' | 'assigned_departments' | 'own' | 'public_only' | 'none'

type RoleRow = {
  super_admin: readonly [readonly Action[], Scope, string]
  area_admin: readonly [readonly Action[], Scope, string]
  branch_admin: readonly [readonly Action[], Scope, string]
  department_leader: readonly [readonly Action[], Scope, string]
  volunteer: readonly [readonly Action[], Scope, string]
  none: readonly [readonly Action[], Scope, string]
  zone_admin: readonly [readonly Action[], Scope, string]
}

export const roleMatrix: Record<string, RoleRow> = {
  [COLLECTIONS.customForms]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [NONE, 'none', 'none'],
    department_leader: [NONE, 'none', 'none'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [NONE, 'none', 'none'],
  },
  [COLLECTIONS.visitors]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [CR, 'own_branch', 'R/C own'],
    none: [R, 'public_only', 'R own via policy'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.people]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [R, 'own_branch', 'R (own)'],
    none: [R, 'public_only', 'R (own)'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.households]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [R, 'own_branch', 'R (own)'],
    none: [R, 'public_only', 'R (own)'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.welfareCases]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [CRU, 'assigned_departments', 'CRU (dept)'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.blessings]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [CR, 'own_branch', 'R/C own'],
    none: [NONE, 'none', 'none'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.announcements]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.marriageMatters]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  },
  [COLLECTIONS.impersonationEvents]: {
    super_admin: [R, 'all', 'R'],
    area_admin: [R, 'all', 'R'],
    branch_admin: [NONE, 'none', 'none'],
    department_leader: [NONE, 'none', 'none'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [NONE, 'none', 'none'],
  },
  [COLLECTIONS.officeMinutes]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [ALL, 'own_branch', 'ALL (own)'],
    department_leader: [ALL, 'assigned_branches', 'ALL (dept)'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [ALL, 'own_zone', 'ALL (zone)'],
  },
  [COLLECTIONS.minutesAttendees]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [ALL, 'own_branch', 'ALL'],
    department_leader: [ALL, 'assigned_branches', 'ALL'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [ALL, 'own_zone', 'ALL'],
  },
  [COLLECTIONS.officeMinuteEvents]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [R, 'all', 'R'],
    branch_admin: [R, 'own_branch', 'R'],
    department_leader: [R, 'assigned_branches', 'R'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [R, 'own_zone', 'R'],
  },
  [COLLECTIONS.tasks]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CR, 'own_branch', 'R/C own'],
    none: [R, 'public_only', 'R own via policy'],
    zone_admin: [ALL, 'own_zone', 'ALL (zone)'],
  },
  [COLLECTIONS.taskEvents]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [R, 'all', 'R'],
    branch_admin: [R, 'own_branch', 'R'],
    department_leader: [R, 'assigned_departments', 'assigned'],
    volunteer: [R, 'own_branch', 'R own'],
    none: [NONE, 'none', 'none'],
    zone_admin: [R, 'own_zone', 'R'],
  },
  [COLLECTIONS.announcements]: {
    super_admin: [ALL, 'all', 'ALL'],
    area_admin: [ALL, 'all', 'ALL'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [NONE, 'none', 'none'],
    none: [NONE, 'none', 'none'],
    zone_admin: [CRU, 'own_zone', 'CRU (zone)'],
  } as RoleRow,
} as any

export function capabilitiesForRole(role: string): string[] {
  const r = roleMatrix as any
  const row = r[COLLECTIONS.officeMinutes]
  if (!row) return []
  const caps = row[role] || row['none'] || [[], 'none', '']
  return caps[0] || []
}
