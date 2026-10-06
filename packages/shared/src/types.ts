/**
 * Domain types.
 *
 * Field names are the Directus snake_case field names from
 * `docs/planning/data-model.md`, not camelCase. They are types on the wire, and
 * renaming them at the boundary would mean a translation layer nobody specified.
 *
 * These are the rows the portal reads. They are deliberately narrow: a field is
 * only here if a page in the current scope renders it. Adding a field here is a
 * statement that the portal has a reason to hold it in the browser, which for
 * anything on the §10.1 restricted list is a decision to make deliberately.
 */
import type { StaffRole } from './auth'

export interface Branch {
  id: string
  name: string
  code: string
  slug: string | null
  branch_type: 'area' | 'main' | 'branch' | 'satellite'
  parent_branch: string | null
  address: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  status: 'active' | 'inactive'
  sort: number | null
}

export interface Department {
  id: string
  name: string
  code: string | null
  department_type:
    | 'youth'
    | 'teens'
    | 'worship'
    | 'welfare'
    | 'outreach'
    | 'children'
    | 'media'
    | 'ushering'
    | 'admin'
  /** Null means an area-wide department (data-model §2.2). */
  branch: string | null
  leader_person: string | null
  description: string | null
  status: 'active' | 'inactive'
}

export type MembershipStatus =
  'member' | 'regular_attendee' | 'visitor' | 'youth' | 'child' | 'staff' | 'inactive'

export interface Person {
  id: string
  first_name: string
  last_name: string
  preferred_name: string | null
  other_names: string | null
  gender: 'male' | 'female' | 'unspecified'
  /** Null for records created without one. Restricted read — §10.1. */
  date_of_birth: string | null
  /** Derived from DOB by a Flow, never hand-edited (data-model §2.3). */
  is_minor: boolean | null
  phone: string | null
  email: string | null
  address: string | null
  household: string | null
  branch: string | null
  membership_status: MembershipStatus
  member_since: string | null
  guardian: string | null
  consent_data: boolean
  consent_media: boolean
  consent_signed_at: string | null
  status: 'active' | 'archived'
}

export interface Household {
  id: string
  name: string | null
  branch: string | null
  address: string | null
  phone: string | null
  primary_contact: string | null
  notes: string | null
}

export interface EventRecord {
  id: string
  title: string
  slug: string | null
  summary: string | null
  event_type: 'service' | 'summit' | 'camp' | 'training' | 'outreach' | 'social' | 'other'
  /** Null is an area-wide event (data-model §3.1). */
  branch: string | null
  start_at: string
  end_at: string
  location: string | null
  address: string | null
  /** Null means unlimited capacity. */
  capacity: number | null
  waitlist_enabled: boolean
  registration_open: boolean
  registration_opens_at: string | null
  registration_closes_at: string | null
  fee_amount: string | null
  currency: 'NGN' | 'USD' | 'GBP' | null
  requires_guardian_consent: boolean
  collect_medical: boolean
  age_min: number | null
  age_max: number | null
  visibility: 'public' | 'branch' | 'internal'
  status: 'draft' | 'published' | 'closed' | 'cancelled'
}

export type RegistrationStatus =
  'pending' | 'confirmed' | 'waitlisted' | 'cancelled' | 'attended' | 'no_show'

export interface EventRegistration {
  id: string
  event: string
  person: string | null
  registrant_first_name: string
  registrant_last_name: string
  email: string | null
  phone: string | null
  date_of_birth: string | null
  age_group: 'adult' | 'youth' | 'teen' | 'child' | 'unknown'
  branch: string | null
  guardian_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  guardian_consent: boolean
  consent_signed_at: string | null
  /** Restricted read — §10.1. */
  medical_notes: string | null
  /** Restricted read — §10.1. */
  allergies: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  amount_expected: string | null
  amount_paid: string | null
  payment_status: 'not_required' | 'pending' | 'paid' | 'refunded' | null
  payment_reference: string | null
  ticket_code: string | null
  registration_status: RegistrationStatus
  source: 'public_form' | 'staff'
  created_at: string
}

export type AttendanceSessionType =
  'sunday_service' | 'midweek' | 'event' | 'camp' | 'department'

export interface AttendanceSession {
  id: string
  branch: string | null
  session_date: string
  session_type: AttendanceSessionType
  service: string | null
  event: string | null
  session_name: string
  headcount_total: number | null
  headcount_men: number | null
  headcount_women: number | null
  headcount_children: number | null
  recorded_by: string | null
  recorded_at: string | null
}

export interface AttendanceRecord {
  id: string
  session: string
  person: string | null
  attendee_name: string | null
  attendance_category: 'member' | 'visitor' | 'child' | 'other' | null
  recorded_by: string | null
  recorded_at: string | null
}

export type VisitorStatus = 'new' | 'follow_up' | 'converted' | 'closed' | 'declined'

export interface Visitor {
  id: string
  branch: string | null
  visitor_first_name: string
  visitor_last_name: string
  email: string | null
  phone: string | null
  visit_date: string
  event: string | null
  age_group: 'adult' | 'youth' | 'teen' | 'child' | 'unknown'
  invited_by: string | null
  person: string | null
  status: VisitorStatus
  follow_up_owner: string | null
  next_follow_up_date: string | null
  notes: string | null
}

export interface WelfareCase {
  id: string
  case_ref: string
  branch: string | null
  person: string | null
  category: 'medical' | 'financial' | 'bereavement' | 'education' | 'other'
  priority: 'low' | 'normal' | 'high' | 'urgent' | null
  status: 'open' | 'in_progress' | 'resolved' | 'closed' | null
  amount_requested: string | null
  amount_assisted: string | null
  assigned_to: string | null
  /** Restricted read — §10.1. */
  description: string | null
  /** Restricted read — §10.1. */
  outcome_notes: string | null
  opened_at: string | null
  closed_at: string | null
}

/** Directus user row projected onto the custom fields from data-model §7.1. */
export interface PortalUserRecord {
  id: string
  email: string
  first_name: string | null
  staff_role: StaffRole
  branch: string | null
  branch_ids: string[]
  department_ids: string[]
  person: string | null
}
