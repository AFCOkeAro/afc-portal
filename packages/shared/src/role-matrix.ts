/**
 * Role → capability translation.
 *
 * SERVER-SIDE ONLY. This module is the single place in the codebase that knows
 * a role name maps to a set of grants. Nothing under `apps/web/composables`,
 * `apps/web/pages` or `apps/web/components` may import it: data-model §13
 * rule 7 forbids hard-coding Directus role names in the UI, and the way to
 * enforce that in review is to make the import impossible from the client.
 *
 * The matrix below is a transcription of `docs/planning/data-model.md` §10, and
 * `FIELD_RESTRICTIONS` of §10.1. Each cell keeps the document's parenthetical
 * qualifier as its `note`, so a reviewer can check the code against the table
 * without reading the code twice.
 *
 * This translation drives navigation and field visibility only. It is not an
 * enforcement point: data-model §9 puts enforcement in the Directus policy, and
 * the permission tests in CI (repo-plan §4 step 5) are what prove it. Until
 * Directus exists, nothing here should be mistaken for a control.
 */
import { COLLECTIONS } from './collections'
import type { CollectionName } from './collections'
import type { StaffRole } from './auth'
import type {
  CapabilitiesPayload,
  Grant,
  PermissionAction,
  PermissionScope,
} from './permissions'
import { readableCollections, sortGrants, writableCollections } from './permissions'

/** `[actions, scope, note]` */
type Cell = readonly [readonly PermissionAction[], PermissionScope, string?]

const ALL: readonly PermissionAction[] = ['create', 'read', 'update', 'delete']
const CRU: readonly PermissionAction[] = ['create', 'read', 'update']
const RU: readonly PermissionAction[] = ['read', 'update']
const CR: readonly PermissionAction[] = ['create', 'read']
const CU: readonly PermissionAction[] = ['create', 'update']
const R: readonly PermissionAction[] = ['read']
const U: readonly PermissionAction[] = ['update']
const C: readonly PermissionAction[] = ['create']
const NONE: readonly PermissionAction[] = []

/**
 * data-model §10. Keyed by collection for readability; the document is keyed by
 * collection in the row and role in the column, so this is the same table
 * rotated.
 */
const MATRIX: Readonly<Record<CollectionName, Readonly<Record<StaffRole, Cell>>>> = {
  [COLLECTIONS.branches]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch', 'own, minimal'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.departments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [RU, 'own_department', 'own dept'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.people]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [RU, 'assigned_departments', 'assigned dept members'],
    volunteer: [R, 'own_branch', 'name/branch only, own'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.peopleDepartments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [CRU, 'own_department', 'own dept'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.households]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.events]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own; not area events'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    // "R (public only)": the public role reads events whose visibility is
    // public. It is the only role with a read grant here.
    none: [R, 'public_only'],
  },
  [COLLECTIONS.eventRegistrations]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'own branch events'],
    department_leader: [R, 'assigned_departments', 'assigned dept events'],
    // §10 gives the volunteer "U (check-in fields only, own)": update, not read.
    // PRD US-8 then describes a volunteer checking a registrant in "by name or
    // ticket code", which is a read. The document does not resolve whether the
    // check-in lookup is a field-restricted read inside the U grant or a missing R.
    // Encoded as written (U only) rather than inventing a read; the UI therefore
    // offers no visitor a registration list. Flagged for the CTO — see the
    // AFC-174 update.
    volunteer: [U, 'own_branch', 'check-in fields only, own; read not granted here'],
    none: [C, 'allowlisted_fields'],
  },
  [COLLECTIONS.attendanceSessions]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_branches'],
    volunteer: [CU, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.attendanceRecords]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_branches'],
    volunteer: [CU, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.sundayServices]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.serviceAssignments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_departments', 'assigned dept roles'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.visitors]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_departments', 'assigned, youth'],
    volunteer: [C, 'own_branch', 'own branch intake'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.welfareCases]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned, youth cases only'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.welfareContributions]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.welfareCaseEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned youth'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.users]: {
    super_admin: [ALL, 'all'],
    area_admin: [NONE, 'none'],
    branch_admin: [NONE, 'none'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.eventDepartments]: {
    // Not in the §10 table. It is the events↔departments junction, reachable
    // through `events`, so it follows the events grants. Recorded here rather
    // than left undefined so the translation cannot silently drop it.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  // Delivery log + consent (AFC-479, data-model-v4 §5, ADR-0009 decision 2).
  // One log for every message; the matrix below is the UI contract only --
  // enforcement stays in the Directus policy (data-model §9). Welfare-officer
  // (assigned-only, redacted) and member (own invites, status only) are not
  // StaffRoles, so their grants live in the Directus policy only; the cells
  // below never invent a wider grant. No send path is enabled in this slice.
  [COLLECTIONS.communications]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.communicationRecipients]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch', 'own communications'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.messageTemplates]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.consentRecords]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own people'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.branchFinancialRecords]: {
    // data-model-expansion §11: CRUD / CRUD / R (zone) / CRU (own).
    // `zone_admin` is not a StaffRole, so the zone column has no cell here;
    // that grant lives in the Directus policy only. Recorded, not invented.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.wecaReturns]: {
    // data-model-expansion §11: CRUD / CRUD / R (zone) / R (own).
    // Same zone_admin caveat as above.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch', 'own'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.wecaReturnFormulas]: {
    // In no permission matrix: the formulas table is new in ADR-0008, and
    // §11.1 names readers ("area+, finance lead") without granting a cell.
    // Treated as a reference collection like leadership_positions (readable,
    // written only as reviewed migration rows): "finance lead" is not a
    // StaffRole, so it grants nothing here. Flagged for the CTO.
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  // Hierarchy (AFC-461a, data-model-expansion §11). `zone_admin` is not a
  // StaffRole, so the zone column's CRUD grant lives in the Directus policy
  // only; the cells below give the closest portal-role reading and never
  // invent a wider grant. Scopes use own_zone/assigned_zones (the zone
  // analogue of own_branch/assigned_branches).
  [COLLECTIONS.areas]: {
    super_admin: [ALL, 'all'],
    area_admin: [RU, 'all', 'R/U (zone area)'],
    branch_admin: [R, 'own_zone', 'R (own zone area)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.zones]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_zone', 'R (own zone)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.bibleStudyCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch', 'assigned BSC'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.conferenceCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch', 'R (own)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.sundaySchoolClasses]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [RU, 'own_department', 'R/U (own dept)'],
    volunteer: [R, 'own_branch', 'R/U attendance via records'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.avsCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [R, 'assigned_branches', 'R (AVS dept via own dept only: policy)'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.campusInstitutions]: {
    // Reference only in Slice 1; readable, never written from the portal.
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_zone', 'R'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
  // Attendance split (AFC-468, data-model-expansion §11):
  // attendance_counts CRUD / CRUD / CRUD (zone) / CRUD (own) / CRU (dept) /
  // C/U (assigned). `zone_admin` is not a StaffRole, so the zone column has
  // no cell here; that grant lives in the Directus policy only. Recorded, not
  // invented.
  [COLLECTIONS.attendanceCounts]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CU, 'own_branch', 'C/U (assigned)'],
    none: [NONE, 'none'],
  },
  [COLLECTIONS.serviceTypeDefinitions]: {
    // Board config, not in the §11 table: the capture form reads it at every
    // level, the board edits it at area level. Definitions are area-wide
    // rows, so branch/zone scoping applies to sessions, never to the
    // definition itself; the cells below grant reads accordingly and grant
    // writes to area only.
    super_admin: [ALL, 'all'],
    area_admin: [CRU, 'all', 'board config'],
    branch_admin: [R, 'all'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
  },
}

/**
 * data-model §10.1. Field-level read restrictions, and the roles allowed to see
 * each restricted group.
 *
 * Two roles named in the document are not in `staff_role` (data-model §7.1):
 * "designated safeguarding lead" and "camp coordinator". The smallest
 * defensible reading is that neither exists as a login role today, so neither
 * grants the restricted field. That errs towards hiding data, which is the
 * correct direction for a children's record. If either role is added, this table
 * and this comment are the two places that change.
 */
const FIELD_RESTRICTIONS: Readonly<
  Record<string, { fields: readonly string[]; roles: readonly StaffRole[]; note: string }>
> = {
  [COLLECTIONS.people]: {
    fields: ['safeguarding_flag', 'notes', 'date_of_birth'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'designated safeguarding lead is not a staff_role; excluded',
  },
  [COLLECTIONS.eventRegistrations]: {
    fields: [
      'medical_notes',
      'allergies',
      'emergency_contact_name',
      'emergency_contact_phone',
    ],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'camp coordinator is not a staff_role; excluded',
  },
  [COLLECTIONS.welfareCases]: {
    fields: ['description', 'outcome_notes'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'per-case assigned_to ownership is a record-level grant only the Directus policy can evaluate, so the UI hides the field for roles outside this list',
  },
  [COLLECTIONS.users]: {
    fields: ['branch_ids', 'department_ids'],
    roles: [],
    note: 'system/Flow only, no UI edit',
  },
  // Delivery-log internals (AFC-479, data-model-v4 §5.1). contact_value,
  // error_detail and provider_message_id are staff-only reads (branch admin
  // and above); every other role sees counts and statuses, never the contact
  // or the provider detail. The Directus policy withholds them; this table is
  // what the portal routes strip (visibleFields/stripHidden).
  [COLLECTIONS.communicationRecipients]: {
    fields: ['contact_value', 'error_detail', 'provider_message_id'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'welfare officer sees assigned rows redacted; member sees own invite status only (both enforced in policy, hidden here)',
  },
  // data-model-expansion §11.1. "finance lead" is not a staff_role (same
  // precedent as safeguarding lead above): it grants no field here, which
  // errs towards hiding amounts. Branch-admin-own scoping is record-level and
  // lives in the Directus policy; this table only hides whole fields by role.
  [COLLECTIONS.branchFinancialRecords]: {
    fields: ['income', 'intervention', 'faith_city'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'amounts: branch admin (own records only, enforced by policy), area+, finance lead (not a staff_role; excluded)',
  },
  [COLLECTIONS.wecaReturns]: {
    fields: [
      'computed_mf',
      'computed_area',
      'computed_savings',
      'computed_intervention',
      'computed_faith_city',
      'total_due',
    ],
    roles: ['super_admin', 'area_admin'],
    note: 'computed returns: area+, finance lead (not a staff_role; excluded)',
  },
}

export function grantsForRole(role: StaffRole): Grant[] {
  const grants: Grant[] = []
  for (const [collection, byRole] of Object.entries(MATRIX) as Array<
    [CollectionName, Record<StaffRole, Cell>]
  >) {
    const cell = byRole[role]
    if (!cell || cell[0].length === 0) continue
    const [actions, scope, note] = cell
    for (const action of actions) {
      grants.push(
        note === undefined
          ? { collection, action, scope }
          : { collection, action, scope, note },
      )
    }
  }
  return sortGrants(grants)
}

export function hiddenFieldsForRole(role: StaffRole): Record<string, string[]> {
  const hidden: Record<string, string[]> = {}
  for (const [collection, restriction] of Object.entries(FIELD_RESTRICTIONS)) {
    if (restriction.roles.includes(role)) continue
    hidden[collection] = [...restriction.fields]
  }
  return hidden
}

/**
 * data-model §9 rule 5, extended to hierarchy scopes (data-model-expansion
 * §10): "a user with no scope values sees nothing (fail-closed)". Super admin
 * is the Directus built-in Admin role and is not scoped either, so it is
 * exempt alongside area admin. A zone grant counts as a scope exactly like a
 * branch grant; absent scope fields (pre-hierarchy sessions) mean no grant at
 * that level, never all.
 */
export function isScopedSession(input: {
  staffRole: StaffRole
  branchId: string | null
  zoneId?: string | null
  zoneIds?: string[]
}): boolean {
  if (input.staffRole === 'area_admin' || input.staffRole === 'super_admin') {
    return true
  }
  if (input.branchId !== null) return true
  if (input.zoneId != null) return true
  return (input.zoneIds ?? []).length > 0
}

export function capabilitiesForRole(input: {
  staffRole: StaffRole
  branchId: string | null
  zoneId?: string | null
  zoneIds?: string[]
}): CapabilitiesPayload {
  const grants = isScopedSession(input) ? grantsForRole(input.staffRole) : []
  return {
    grants: sortGrants(grants),
    readable: readableCollections(grants),
    writable: writableCollections(grants),
    hiddenFields: hiddenFieldsForRole(input.staffRole),
    scoped: isScopedSession(input),
  }
}
