import type {
  AttendanceRecord,
  AttendanceSession,
  Blessing,
  BlessingEvent,
  Branch,
  Celebration,
  CelebrationEvent,
  Department,
  EventRecord,
  EventRegistration,
  Household,
  Person,
  ServiceAssignment,
  SundaySchoolClass,
  SundayService,
  SundayServiceEvent,
  Visitor,
  WelfareCase,
  YouthProfile,
  YouthProfileEvent,
} from '@afc/shared'

export interface BranchSummary {
  id: string
  name: string
  code: string
  branch_type: string
  status: string
  city?: string | null
  state?: string | null
  parent_branch?: string | null
  type_label?: string | null
  zone?: string | null
  area?: string | null
}

export interface BranchSectionWarning {
  section: string
  code: string
}

export interface BranchDetail extends Branch {
  people_count: number
  youth_count: number
  minor_count: number
  open_follow_ups: number
  open_welfare: number
  upcoming_events: number
  attendance_last_sunday: number
  attendance_last_30_days: number
  attendance_trend: DashboardAttendancePoint[]
  recent_people: PersonRow[]
  events: EventRow[]
  follow_ups: VisitorRow[]
  welfare_cases: WelfareCaseRow[]
  blessings_total: number
  blessings_breakdown: BlessingBreakdownRow[]
  warnings: BranchSectionWarning[]
}

export interface PersonRow extends Person {
  branch_name: string | null
  age: number | null
  notes?: string | null
  safeguarding_flag?: boolean | null
}

export interface PersonTimelineItem {
  id: string
  kind: 'attendance' | 'registration' | 'visitor' | 'welfare'
  title: string
  detail: string | null
  at: string | null
}

export interface PersonDetail extends PersonRow {
  timeline: PersonTimelineItem[]
  household_name: string | null
  departments: PersonDepartmentMembership[]
}

export interface PersonDepartmentMembership {
  id: string
  name: string
  role: string
  joined_at: string | null
}

/** One week of per-person attendance history (AFC-597). */
export interface PersonAttendanceBucket {
  week_start: string
  sessions_held: number
  /** 1 when the person attended at least one scoped session that week. */
  present: number
}

export interface PersonAttendanceSession {
  id: string
  session_name: string
  session_date: string
  session_type: string
  href: string
}

/** GET /api/people/:id/attendance payload (AFC-597). */
export interface PersonAttendanceHistory {
  person: string
  weeks: number
  session_type: string | null
  from: string
  to: string
  buckets: PersonAttendanceBucket[]
  sessions: PersonAttendanceSession[]
  totals: {
    sessions_held: number
    sessions_attended: number
    weeks_present: number
    rate: number | null
  }
}

export interface HouseholdRow extends Household {
  branch_name: string | null
  member_count: number
}

export interface HouseholdMemberRow {
  id: string
  display_name: string
  household_role: string | null
  gender: string
  is_minor: boolean | null
  phone: string | null
  membership_status: string
  status: string
  age: number | null
  is_head: boolean
}

export interface HouseholdDetail extends HouseholdRow {
  head_name: string | null
  members: HouseholdMemberRow[]
}

export interface DepartmentRow extends Department {
  branch_name: string | null
  leader_name: string | null
  member_count: number
}

export interface DepartmentMemberRow {
  id: string
  display_name: string
  role: string
  phone: string | null
  branch_name: string | null
  membership_status: string
  status: string
  joined_at: string | null
}

export interface DepartmentDetail extends DepartmentRow {
  members: DepartmentMemberRow[]
}

export interface ManagementTeamLeader {
  person: string
  display_name: string
  role: string
  phone: string | null
  branch_name: string | null
}

export interface ManagementTeamEntry {
  department: string
  department_name: string
  department_type: string | null
  code: string | null
  level: 'branch' | 'zone' | 'area'
  leaders: ManagementTeamLeader[]
}

export interface RegistrationRow extends EventRegistration {
  person_name: string | null
}

export interface EventRow extends EventRecord {
  branch_name: string | null
  registered_count: number
  confirmed_count: number
  attended_count: number
}

export interface EventDetail extends EventRow {
  registrations: RegistrationRow[]
  blessings: BlessingRow[]
  blessings_total: number
}

export interface AttendanceSessionRow extends AttendanceSession {
  branch_name: string | null
  records_count: number
}

export interface ServiceRow extends SundayService {
  branch_name: string | null
}

export interface ServiceAssignmentRow extends ServiceAssignment {
  person_name: string | null
}

export interface ServiceDetail extends ServiceRow {
  preacher_name: string | null
  assignments: ServiceAssignmentRow[]
  assignment_count: number
  events: SundayServiceEvent[]
  blessings: BlessingRow[]
  blessings_total: number
}

/** Blessing list/detail row (AFC-474): the shared Blessing plus resolved scope names. */
export interface BlessingRow extends Blessing {
  branch_name: string | null
  zone_name: string | null
}

export interface BlessingBreakdownRow {
  blessing_type: string
  male: number
  female: number
  total: number
}

export interface BlessingDetail extends BlessingRow {
  events: BlessingEvent[]
}

/** Youth directory row (AFC-476): the shared YouthProfile plus resolved names. */
export interface YouthRow extends YouthProfile {
  person_name: string | null
  branch_name: string | null
}

export interface YouthDetail extends YouthRow {
  person_is_minor: boolean | null
  events: YouthProfileEvent[]
  previous_branches: Array<Record<string, unknown>>
  milestones: Array<Record<string, unknown>>
}

/** Celebrations feed row (AFC-476): the shared Celebration plus resolved names. */
export interface CelebrationRow extends Celebration {
  person_name: string | null
  person_is_minor: boolean | null
  branch_name: string | null
  zone_name: string | null
}

export interface CelebrationDetail extends CelebrationRow {
  events: CelebrationEvent[]
}

export interface AttendanceDetail extends AttendanceSessionRow {
  records: (AttendanceRecord & { person_name: string | null })[]
}

export interface VisitorRow extends Visitor {
  branch_name: string | null
  person_name: string | null
}

export interface WelfareContribution {
  id: string
  case: string
  contribution_type: 'cash' | 'goods' | 'service'
  amount: string | null
  description: string | null
  contributor: string | null
  contributed_at: string | null
  status: 'pending' | 'approved' | 'disbursed'
  approved_by: string | null
  approved_at: string | null
}

export interface WelfareEvent {
  id: string
  case: string
  event_type: string
  summary: string
  /** Freeform note text (AFC-472); null for non-note audit rows. */
  body: string | null
  /** Short summary under the spec field name; mirrors summary. */
  detail: string | null
  actor: string | null
  created_at: string | null
}

export interface WelfareReportGroup {
  status: string
  category: string
  priority: string
  count: number
}

export interface WelfareReport {
  groups: WelfareReportGroup[]
  totals: {
    cases: number
    open: number
  }
  filters: {
    branch: string | null
    confidentiality: string | null
    status: string | null
    category: string | null
    priority: string | null
  }
}

export interface WelfareCaseRow extends WelfareCase {
  branch_name: string | null
  person_name: string | null
  contribution_total: string
  event_count: number
}

export interface WelfareDetail extends WelfareCaseRow {
  contributions: WelfareContribution[]
  events: WelfareEvent[]
}

export interface DashboardAttendancePoint {
  date: string
  total: number
  branch_name: string | null
}

/** Sunday School class row (AFC-577): the shared class plus the resolved branch name. */
export interface SundaySchoolClassRow extends SundaySchoolClass {
  branch_name: string | null
}

/** Recent Sunday School attendance session (AFC-577): sessions are the only
 * dated Sunday School records the model holds, so the widget shows recent
 * sessions rather than a schedule that does not exist. */
export interface DashboardSundaySession {
  id: string
  session_date: string
  total: number
  branch_name: string | null
}

/**
 * One upcoming greeting (AFC-577). Birthday rows come from month/day matches
 * on people.date_of_birth; celebration rows from the celebrations feed. The
 * payload carries the occurrence date (YYYY-MM-DD) and a display name only --
 * never a full date of birth, birth year, or age (people DOB is a §10.1
 * restricted read).
 */
export interface DashboardCelebrationItem {
  kind: 'celebration' | 'birthday'
  id: string
  name: string
  label: string
  /** Occurrence inside the next-30-day window (YYYY-MM-DD). */
  date: string
  branch_name: string | null
  person_is_minor: boolean | null
  href: string
}

export interface DashboardData {
  scope: {
    isArea: boolean
    label: string
    branchCount: number
  }
  metrics: {
    people: number
    upcomingEvents: number
    upcomingRegistrations: number
    attendanceCurrent: number
    attendancePrior: number
    openFollowUps: number
    openWelfare: number
    households: number
    unlinkedPeople: number
    sundaySchoolClasses: number
    sundaySchoolEnrolment: number
    upcomingCelebrations: number
  }
  attendanceTrend: DashboardAttendancePoint[]
  upcomingEvents: EventRow[]
  followUps: VisitorRow[]
  welfareCases: WelfareCaseRow[]
  branches: BranchSummary[]
  /** Family summary (AFC-577): folds the shared AFC-576 collector, so the
   * figures match GET /api/people/summary exactly. Zeroed with
   * households_visible false when the caller may not read households. */
  family: {
    households: number
    avg_members: number
    unlinked_people: number
    households_visible: boolean
  }
  /** Sunday School summary (AFC-577): class count + total enrolment from
   * sunday_school_classes plus recent sunday_school sessions. Visible only
   * to roles with the sunday_school_classes read grant. */
  sundaySchool: {
    classes: number
    enrolment: number
    visible: boolean
  }
  sundaySchoolClasses: SundaySchoolClassRow[]
  sundaySchoolSessions: DashboardSundaySession[]
  /** Next-30-day greetings (AFC-577): staff-only, same scoping as visitor
   * follow-ups. Empty unless the caller holds both the celebrations and the
   * visitors read grants. */
  upcomingCelebrations: DashboardCelebrationItem[]
}

export interface Paginated<T> {
  data: T[]
  meta: {
    total: number
    page: number
    limit: number
  }
}

export type AttendanceReportGroup = 'branch' | 'zone'

export type AttendanceReportPeriod =
  'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'

/** One grouped row of the split contract: group x service x bucket x category. */
export interface AttendanceSplitRow {
  branch: string | null
  branch_name: string | null
  zone: string | null
  zone_name: string | null
  service: string
  /** Date bucket for the period (week-start YYYY-MM-DD, YYYY-MM, YYYY-Qn, YYYY, or day). */
  date: string
  category: string
  male: number
  female: number
  total: number
}

export interface AttendanceReportTotals {
  sessions: number
  male: number
  female: number
  total: number
}

export interface AttendanceReportCompare extends AttendanceReportTotals {
  from: string
  to: string
  has_data: boolean
}

export interface AttendanceReport {
  rows: AttendanceSplitRow[]
  totals: AttendanceReportTotals
  /** Prior-year side of the compare toggle; null when the toggle is off. */
  compare: AttendanceReportCompare | null
  meta: {
    total: number
    page: number
    limit: number
  }
  filters: {
    from: string
    to: string
    branch: string | null
    zone: string | null
    session_type: string | null
    group_by: AttendanceReportGroup
    period: AttendanceReportPeriod
  }
}
