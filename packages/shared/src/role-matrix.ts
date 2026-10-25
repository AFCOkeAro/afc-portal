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
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.departments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [RU, 'own_department', 'own dept'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.people]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [RU, 'assigned_departments', 'assigned dept members'],
    volunteer: [R, 'own_branch', 'name/branch only, own'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.peopleDepartments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [CRU, 'own_department', 'own dept'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.households]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
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
    zone_admin: [CRU, 'own_zone'],
  },
  // Invites (Slice 4). The §11 table predates this collection; grants mirror
  // the event it belongs to: area-wide for board, scoped CRU for zone/branch
  // staff, own intake for volunteers. Quota routes read the same collection.
  [COLLECTIONS.eventInvites]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [C, 'own_branch', 'C own invites'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
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
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.attendanceSessions]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_branches'],
    volunteer: [CU, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.attendanceRecords]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_branches'],
    volunteer: [CU, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.sundayServices]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.serviceAssignments]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_departments', 'assigned dept roles'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.visitors]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [CRU, 'assigned_departments', 'assigned, youth'],
    volunteer: [C, 'own_branch', 'own branch intake'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  // Newcomer journey (AFC-471, data-model-v4 §5). Stages are reference data:
  // branch admins manage their own branch rows, everyone else reads. The
  // follow-up log and the transition audit are append-only in spirit (no D
  // for any role -- corrections are new rows); volunteers log intake
  // follow-ups on their own branch. Follow-up notes restriction (§10.1) is
  // record-level and lives in the Directus policy; FIELD_RESTRICTIONS below
  // hides the field from roles that never see it.
  [COLLECTIONS.visitorJourneyStages]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.visitorFollowUps]: {
    super_admin: [CRU, 'all'],
    area_admin: [CRU, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [CRU, 'assigned_departments', 'assigned, youth'],
    volunteer: [CR, 'own_branch', 'own branch intake follow-ups'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.visitorJourneyTransitions]: {
    super_admin: [CRU, 'all'],
    area_admin: [CRU, 'all'],
    branch_admin: [CRU, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned, youth'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.welfareCases]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned, youth cases only'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.welfareContributions]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.welfareCaseEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned youth'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.users]: {
    super_admin: [ALL, 'all'],
    area_admin: [NONE, 'none'],
    branch_admin: [NONE, 'none'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [NONE, 'none'],
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
    zone_admin: [CRU, 'own_zone'],
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
    zone_admin: [CRU, 'own_zone'],
  },
  // Campaign catalogue (AFC-527). Read-only: this slice exposes no send,
  // enqueue, pause or resume path. Steps and runs are children of a campaign;
  // migration 0032 carries their branch/zone so the policy scopes them without
  // relational metadata. Readers mirror the communications-read set.
  [COLLECTIONS.campaigns]: {
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.campaignSteps]: {
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.campaignRuns]: {
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.communicationRecipients]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch', 'own communications'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.messageTemplates]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.consentRecords]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own people'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.branchFinancialRecords]: {
    // data-model-expansion §11: CRUD / CRUD / R (zone) / CRU (own).
    // Zone admin: R (zone) per data-model-expansion §11.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.eventExpenses]: {
    // AFC-801: exact mirror of branch_financial_records (AFC-801 contract:
    // CRU pattern, own_branch/own_zone; super/area ALL; branch CRU own;
    // zone R own_zone). No deviations from the finance-amounts posture, so
    // none flagged: department_leader/volunteer/none hold nothing, and the
    // FIELD_RESTRICTIONS entry below hides amount/notes from every role
    // outside the finance set, same as finance amounts.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'own'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.wecaReturns]: {
    // data-model-expansion §11: CRUD / CRUD / R (zone) / R (own).
    // Zone admin: R (zone) per §11.
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch', 'own'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
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
    zone_admin: [R, 'all'],
  },
  // Hierarchy (AFC-461a, data-model-expansion §11). Zone admin is a
  // first-class role; scopes use own_zone/assigned_zones (the zone analogue
  // of own_branch/assigned_branches).
  [COLLECTIONS.areas]: {
    super_admin: [ALL, 'all'],
    area_admin: [RU, 'all', 'R/U (zone area)'],
    branch_admin: [R, 'own_zone', 'R (own zone area)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.zones]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_zone', 'R (own zone)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [RU, 'own_zone'],
  },
  [COLLECTIONS.bibleStudyCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch', 'assigned BSC'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.conferenceCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch', 'R (own)'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.sundaySchoolClasses]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [RU, 'own_department', 'R/U (own dept)'],
    volunteer: [R, 'own_branch', 'R/U attendance via records'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.avsCentres]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [R, 'assigned_branches', 'R (AVS dept via own dept only: policy)'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.campusInstitutions]: {
    // Reference only in Slice 1; readable, never written from the portal.
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_zone', 'R'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [R, 'all'],
  },
  // Campus care (AFC-483, data-model-expansion §11). Zone admin is a
  // first-class role; the cells below follow §11 and never invent a wider
  // grant. campusInstitutions keeps the Slice 1 read-only posture (the
  // migration leaves its SELECT-only ceiling intact and suite 70.4 pins it),
  // even though §11 names CRUD for super/area admin -- a wider cell would
  // claim a write the database refuses with 42501.
  [COLLECTIONS.campusStudents]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [R, 'own_branch', 'R (assigned)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingProgrammes]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingTimetable]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingFacilitators]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingStudents]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingClassAttendance]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingProgress]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.examResults]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CU, 'own_branch', 'C/U (own class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingResources]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.coachingFeedback]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (campus)'],
    volunteer: [CRU, 'own_branch', 'CRU (assigned class)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.campusFinancialSupport]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'own_department', 'R (campus)'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.nyscStatusTransitions]: {
    // Ratified NYSC graph, seeded by migration 0003; the routes read it,
    // nobody writes it from the portal.
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_zone', 'R'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [R, 'all'],
  },
  // Attendance split (AFC-468, data-model-expansion §11):
  // attendance_counts CRUD / CRUD / CRUD (zone) / CRUD (own) / CRU (dept) /
  // C/U (assigned). Zone admin: CRUD (zone) per §11.
  [COLLECTIONS.attendanceCounts]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CU, 'own_branch', 'C/U (assigned)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  // Blessings (AFC-474, data-model-expansion §11):
  // blessings CRUD / CRUD / CRUD (zone) / CRUD (own) / CRU (dept) /
  // C/U (assigned). Zone admin: CRUD (zone) per §11. The audit trail is
  // append-only in spirit (no D for any role --
  // corrections are new rows).
  [COLLECTIONS.blessings]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CU, 'own_branch', 'C/U (assigned)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.blessingEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  // Individual blessings (AFC-671 §C): same holders as blessings — the
  // recipient row carries a branch, so the same hierarchy predicate
  // applies. The matrix row is the portal half; the database ceiling
  // (no DELETE) lives in migration 0034.
  [COLLECTIONS.blessingRecipients]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CU, 'own_branch', 'C/U (assigned)'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
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
    zone_admin: [R, 'all'],
  },
  // Office bundle (AFC-477, data-model-expansion §11). Zone admin is a
  // first-class role; the cells below follow §11 and never invent a wider
  // grant. `welfare` (marriage R) is not a StaffRole either:
  // the dept cell carries the welfare-dept reading and the policy narrows it.
  [COLLECTIONS.transfers]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.transferEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.marriageMatters]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_departments', 'R (welfare dept via policy)'],
    volunteer: [NONE, 'none'],
    // "R (own)": household reads its own matters; enforced record-level.
    none: [R, 'public_only', 'R (own household via policy)'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.marriageMatterEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned welfare'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  // Marriage pipeline (AFC-674 scope A). Same holders as marriageMatters:
  // the pipeline replaces single-matter CRUD for new couples but the
  // ministry facts stay with the same readers (welfare-dept R and
  // own-household R are policy/record-level, as above). No wider grant.
  [COLLECTIONS.marriageCases]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_departments', 'R (welfare dept via policy)'],
    volunteer: [NONE, 'none'],
    // "R (own)": household reads its own case; enforced record-level.
    none: [R, 'public_only', 'R (own household via policy)'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.marriageCaseEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned welfare'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  // Marriage phase-B form submissions (AFC-677). Same holders as the
  // pipeline rows: the staff who move a case fill its forms. No wider
  // grant; `none` (household self-service) is read-own via policy.
  [COLLECTIONS.marriageCaseForms]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_departments', 'R (welfare dept via policy)'],
    volunteer: [NONE, 'none'],
    // "R (own)": household reads its own submissions; enforced record-level.
    none: [R, 'public_only', 'R (own household via policy)'],
    zone_admin: [CRU, 'own_zone'],
  },
  // Scoped impersonation audit (AFC-684). Area-only read (the log list view);
  // the portal writes start/stop rows with the server token, not with a role
  // grant, so no role holds a write here. Zone/branch staff start previews
  // but never read the area-wide log.
  [COLLECTIONS.impersonationEvents]: {
    super_admin: [R, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [NONE, 'none'],
    department_leader: [NONE, 'none'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [NONE, 'none'],
  },
  [COLLECTIONS.officeMinutes]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch', 'R (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.minutesAttendees]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.officeMinuteEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  // "R/C own": volunteers create tasks assigned to themselves and read their
  // own; household reads its own. Assignee-scoped views are route-enforced
  // (assignee_user = session user OR branch scope by role).
  [COLLECTIONS.tasks]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [CR, 'own_branch', 'R/C own'],
    none: [R, 'public_only', 'R own via policy'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.taskEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned'],
    volunteer: [R, 'own_branch', 'own tasks'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  // "R (public ones)": household/volunteer/public read published rows in
  // scope; the publish window (publish_from/to) is route-enforced.
  [COLLECTIONS.announcements]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [R, 'assigned_branches', 'R (dept)'],
    volunteer: [R, 'own_branch'],
    none: [R, 'public_only', 'R (public ones)'],
    zone_admin: [CRU, 'own_zone'],
  },
  [COLLECTIONS.announcementEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_branches'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.eventReferrals]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [CRU, 'own_branch', 'CRU (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [C, 'own_branch', 'C (own)'],
    none: [C, 'allowlisted_fields', 'C (public reg)'],
    zone_admin: [CRU, 'own_zone'],
  },
  // Youth profiles + celebrations (AFC-476, data-model-expansion §11):
  // youth_profiles CRUD / CRUD / CRUD (zone) / CRUD (own) / CRU (youth dept)
  // / R / R (own); celebrations CRUD / CRUD / CRUD (zone) / CRUD (own) /
  // CRU (dept) / R / R (own) / R (public ones). The household role is not a
  // StaffRole, so its R (own) cell lives in the Directus policy only; the
  // cells below never invent a wider grant.
  // grant. The audit trails are append-only in spirit (no D for any role --
  // corrections are new rows). History tables follow the youth profile's
  // grants: a reader of the profile reads its history.
  [COLLECTIONS.youthProfiles]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (youth dept)'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.youthProfileEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.celebrations]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (dept)'],
    volunteer: [R, 'own_branch'],
    // "R (public ones)": the public role reads celebrations whose visibility
    // is public. It is the only read grant here, mirroring events.
    none: [R, 'public_only'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.celebrationEvents]: {
    super_admin: [ALL, 'all'],
    area_admin: [R, 'all'],
    branch_admin: [R, 'own_branch'],
    department_leader: [R, 'assigned_departments', 'assigned'],
    volunteer: [NONE, 'none'],
    none: [NONE, 'none'],
    zone_admin: [R, 'own_zone'],
  },
  [COLLECTIONS.personPreviousBranches]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (youth dept)'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
  },
  [COLLECTIONS.personMilestones]: {
    super_admin: [ALL, 'all'],
    area_admin: [ALL, 'all'],
    branch_admin: [ALL, 'own_branch', 'CRUD (own)'],
    department_leader: [CRU, 'own_department', 'CRU (youth dept)'],
    volunteer: [R, 'own_branch'],
    none: [NONE, 'none'],
    zone_admin: [ALL, 'own_zone'],
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
    fields: ['safeguarding_flag', 'notes', 'date_of_birth', 'marriage_date'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'designated safeguarding lead is not a staff_role; excluded. marriage_date joins the restricted set per expansion §11.1 (AFC-476).',
  },
  // Youth PII (AFC-476, least-privilege lens): a volunteer sees that a youth
  // profile exists and its status, never the education/employment detail;
  // the youth leader (department_leader) reads those fields for youth in
  // their scope. The Directus policy withholds them record-level; this
  // table is what the portal routes strip (visibleFields/stripHidden).
  [COLLECTIONS.youthProfiles]: {
    fields: [
      'institution',
      'course',
      'professional_status',
      'employment_status',
      'education_level',
      'study_level',
      'youth_leadership_role',
    ],
    roles: ['super_admin', 'area_admin', 'branch_admin', 'department_leader'],
    note: 'youth detail: youth leader reads own-scope youth (record-level, enforced in policy); volunteers and public never see PII',
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
  // AFC-801: expense amounts + notes hide from non-finance roles, same as
  // finance amounts. No finance-amount role exists outside this list
  // ("finance lead" is not a staff_role); zone admins read rows but never
  // amounts, enforced by the same route strip as branch_financial_records.
  [COLLECTIONS.eventExpenses]: {
    fields: ['amount', 'notes'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'amounts + notes: branch admin (own records only, enforced by policy), area+; zone/dept/volunteer/public never see figures',
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
  // Campus scores + support (AFC-483, data-model-expansion §11.1):
  // coordinator, branch admin+, own student reads. Neither "campus
  // coordinator" nor "own student" is a staff_role (same precedent as the
  // safeguarding lead above): they grant nothing here, which errs towards
  // hiding. Branch-admin-own scoping is record-level in the Directus policy.
  // aggregate rides with scores (it is derived from them; showing it while
  // hiding them would leak the same fact). coaching_progress score/max_score
  // are deliberately NOT listed: §11.1 names campus_students/exam_results and
  // support only, and the route policy still scopes progress reads.
  [COLLECTIONS.campusStudents]: {
    fields: ['financial_support_total'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'derived total: branch admin (own records, enforced by policy), area+',
  },
  [COLLECTIONS.examResults]: {
    fields: ['scores', 'aggregate'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'scores: branch admin (own records, enforced by policy), area+',
  },
  [COLLECTIONS.campusFinancialSupport]: {
    fields: ['amount'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'amounts: branch admin (own records, enforced by policy), area+',
  },
  // Newcomer follow-up notes (AFC-471, data-model-v4 §5: restricted to
  // branch admin + assigned officer + area). Whole-field hiding here covers
  // the roles that never qualify; the assigned-officer read is record-level
  // and lives in the Directus policy, which withholds the row (or the field)
  // for non-assignees. Volunteers log intake follow-ups but do not read
  // notes back except through assignment, which the policy grants.
  [COLLECTIONS.visitorFollowUps]: {
    fields: ['notes'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'follow-up notes: branch admin (own branch, enforced by policy), area+; assigned officer read is record-level in policy',
  },
  // Office tasks (AFC-477, data-model-expansion §11.1). description is an
  // assignee + scoped-admin read: the policy withholds it from anyone else,
  // and the portal strips it (visibleFields/stripHidden) for the same roles.
  [COLLECTIONS.tasks]: {
    fields: ['description'],
    roles: ['super_admin', 'area_admin', 'branch_admin'],
    note: 'task description: assignee + scoped admin (record-level in policy); hidden here for roles that never qualify',
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
