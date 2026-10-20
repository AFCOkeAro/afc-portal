import type {
  AttendanceRecord,
  AttendanceSession,
  Branch,
  Department,
  EventRecord,
  EventRegistration,
  Household,
  Person,
  Visitor,
  WelfareCase,
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

export interface HouseholdRow extends Household {
  branch_name: string | null
  member_count: number
}

export interface HouseholdMemberRow {
  id: string
  display_name: string
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
}

export interface AttendanceSessionRow extends AttendanceSession {
  branch_name: string | null
  records_count: number
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
  actor: string | null
  created_at: string | null
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
  }
  attendanceTrend: DashboardAttendancePoint[]
  upcomingEvents: EventRow[]
  followUps: VisitorRow[]
  welfareCases: WelfareCaseRow[]
  branches: BranchSummary[]
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
