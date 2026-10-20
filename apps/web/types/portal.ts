import type {
  AttendanceRecord,
  AttendanceSession,
  EventRecord,
  EventRegistration,
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
