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
  branch_type:
    | 'area'
    | 'main'
    | 'branch'
    | 'satellite'
    | 'full_fledged'
    | 'afwc'
    | 'semi_formed'
    | 'worship_centre'
    | 'other'
  parent_branch: string | null
  /** Hierarchy parent (data-model-expansion §2.3, required for new rows). */
  zone: string | null
  /** Denormalised via zone (Flow-maintained, hierarchy.denorm). */
  area: string | null
  type_label: 'FFC' | 'AFWC' | null
  pastor: string | null
  map_pin: Record<string, unknown> | null
  outdoor_photo: string | null
  year_founded: number | null
  notable_history: string | null
  address: string | null
  city: string | null
  state: string | null
  phone: string | null
  email: string | null
  status: 'active' | 'inactive'
  sort: number | null
}

/** Area — top of the hierarchy (data-model-expansion §2.1). */
export interface Area {
  id: string
  name: string
  code: string
  overseer: string | null
  address: string | null
  outdoor_photo: string | null
  status: 'active' | 'inactive'
  sort: number | null
}

/** Zone — six per area (data-model-expansion §2.2). */
export interface Zone {
  id: string
  area: string
  name: string
  code: string
  leader: string | null
  address: string | null
  outdoor_photo: string | null
  year_started: number | null
  status: 'active' | 'inactive'
  sort: number | null
}

/** Bible Study Centre — a congregation under a parent branch (§2.4). */
export interface BibleStudyCentre {
  id: string
  name: string
  code: string
  parent_branch: string
  /** Denorm (Flow-maintained). */
  zone: string | null
  leader: string | null
  location: string | null
  address: string | null
  property_type: 'church' | 'school' | 'warehouse' | 'other' | null
  property_owner: string | null
  year_founded: number | null
  history: string | null
  average_attendance: number | null
  photo: string | null
  status: 'active' | 'inactive'
}

/** Conference Centre — a large meeting venue (§2.5). */
export interface ConferenceCentre {
  id: string
  name: string
  code: string
  zone: string | null
  branch: string | null
  location: string | null
  address: string | null
  leader: string | null
  avs_count: number | null
  elementary_count: number | null
  year_started: number | null
  headcount: number | null
  photo: string | null
  status: 'active' | 'inactive'
}

/** Sunday School class under a branch/zone (§2.6). */
export interface SundaySchoolClass {
  id: string
  class_name: string
  branch: string | null
  /** Denorm (Flow-maintained). */
  zone: string | null
  teacher: string | null
  students_count: number | null
  status: 'active' | 'inactive'
}

/** AVS centre — a weekday/school-based outreach centre (§2.7). */
export interface AvsCentre {
  id: string
  centre_name: string
  branch: string
  address: string | null
  school_contact_name: string | null
  school_contact_phone: string | null
  contact_person: string | null
  status: 'regular' | 'paused'
  type: 'primary' | 'secondary' | 'others' | null
  notes: string | null
  photo: string | null
}

/**
 * Campus institution reference only (data-model-expansion §7.1 lite).
 * Full campus care stays in Slice 5; this row exists so a branch/zone page
 * can name the institution without forking the student model.
 */
export interface CampusInstitution {
  id: string
  name: string
  town: string | null
  state: string | null
  coordinator: string | null
  notes: string | null
  status: 'active' | 'inactive'
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
  /** Denorm for scoping (data-model-expansion §4.1, Flow-maintained). */
  zone: string | null
  household_head: string | null
  address: string | null
  phone: string | null
  primary_contact: string | null
  notes: string | null
  /** Couples' wedding date (data-model-expansion §4.1). */
  wedding_date: string | null
  status: 'active' | 'archived'
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
  | 'sunday_service'
  | 'midweek'
  | 'event'
  | 'camp'
  | 'department'
  | 'sunday_school'
  | 'elementary'
  | 'devotional'
  | 'youth_service'
  | 'revival_service'
  | 'special'

export interface AttendanceSession {
  id: string
  branch: string | null
  /** Denorm for scoping (data-model-expansion §3.2, Flow-maintained). */
  zone: string | null
  /** Nullable BSC-level service (data-model-expansion §3.2). */
  bsc: string | null
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

/**
 * Sunday service header (data-model §4.3, AFC-473). `zone` is denorm via
 * branch (Flow services.denorm); `total_attendance` is copied from the
 * linked attendance session by Flow services.total, never hand-edited.
 * `service_type` is the §4.3 service set, not the §3.1 session set.
 */
export interface SundayService {
  id: string
  branch: string
  zone: string | null
  service_date: string
  service_time: string | null
  service_type: 'sunday' | 'midweek' | 'special' | 'camp'
  theme: string | null
  preacher: string | null
  expected_attendance: number | null
  total_attendance: number | null
  status: 'planned' | 'completed'
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Roster row (data-model §4.4, AFC-473). `branch` is denorm from the
 * service for §10 scoping.
 */
export interface ServiceAssignment {
  id: string
  service: string
  person: string
  role:
    | 'worship_leader'
    | 'preacher'
    | 'usher'
    | 'media'
    | 'sound'
    | 'children'
    | 'welcome'
    | 'prayer'
    | 'offering'
    | 'communion'
  branch: string | null
  status: 'invited' | 'confirmed' | 'declined'
  notes: string | null
  created_by: string | null
  created_at: string
}

/** Explicit service audit (AFC-473; welfare_case_events precedent). */
export interface SundayServiceEvent {
  id: string
  service: string
  event_type: 'created' | 'assigned' | 'status_changed' | 'note'
  detail: string | null
  actor_user: string | null
  created_at: string
}

export type VisitorStatus = 'new' | 'follow_up' | 'converted' | 'closed' | 'declined'

/**
 * Newcomer journey fields (AFC-471, data-model-v4 §2.1 deltas). All optional
 * so rows written before the journey slice still parse; `follow_up_owner`
 * is the single owner field (the PRD `welfare_officer` maps to it -- no
 * second column by design). Status enum deliberately unchanged (see the
 * 0008 migration header): conversion sets `converted` + `person`.
 */
export interface VisitorJourney {
  journey_stage: string | null
  journey_stage_entered_at: string | null
  journey_started_at: string | null
  pack_checklist: string[]
  dropoff_outcome:
    | 'pending'
    | 'address_confirmed'
    | 'moved'
    | 'not_home'
    | 'declined'
    | 'wrong_number'
    | null
  dropoff_visited_at: string | null
  next_check_in_at: string | null
  last_contact_at: string | null
  last_contact_channel:
    'whatsapp' | 'sms' | 'phone' | 'visit' | 'in_person' | 'none' | null
  welfare_officer_assigned_at: string | null
}

export interface VisitorFollowUp {
  id: string
  visitor: string
  branch: string | null
  contact_at: string
  contact_channel: 'whatsapp' | 'sms' | 'phone' | 'visit' | 'in_person'
  outcome:
    | 'reached'
    | 'no_answer'
    | 'requested_visit'
    | 'needs_support'
    | 'declined'
    | 'moved'
    | 'wrong_number'
    | 'integrated'
  /** Restricted read -- data-model-v4 §5. */
  notes: string | null
  welfare_case: string | null
  next_step: string | null
  next_follow_up_at: string | null
  logged_by: string | null
  communication: string | null
}

export interface VisitorJourneyTransition {
  id: string
  visitor: string
  from_stage: string | null
  to_stage: string
  entered_at: string
  logged_by: string | null
  note: string | null
}

export interface Visitor extends Partial<VisitorJourney> {
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
  category:
    'medical' | 'financial' | 'food' | 'housing' | 'bereavement' | 'education' | 'other'
  priority: 'low' | 'medium' | 'normal' | 'high' | 'urgent' | null
  status: 'open' | 'in_progress' | 'pending_approval' | 'resolved' | 'closed' | null
  /** Confidentiality scope (data-model §6.1, AFC-472): branch or area. */
  confidentiality: 'branch' | 'area' | null
  title: string | null
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

/**
 * Welfare audit row (data-model §6.3, AFC-472). `detail` is the short
 * timeline summary; `body` the nullable freeform note text. `actor_user`
 * is the audit actor (auto-set to the session user by the portal routes).
 */
export interface WelfareCaseEvent {
  id: string
  case: string
  event_type:
    | 'created'
    | 'status_changed'
    | 'status'
    | 'updated'
    | 'assigned'
    | 'note'
    | 'contribution_added'
    | 'contribution'
    | 'contribution_status'
  detail: string | null
  body: string | null
  actor_user: string | null
  created_at: string | null
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
  /** Area scope (data-model-expansion §8.5). */
  area: string | null
  /** Single-zone scope (data-model-expansion §8.5). */
  zone: string | null
  /** Multi-zone scope, Flow-synced (data-model-expansion §8.5). */
  zone_ids: string[]
}

/**
 * Delivery log + consent (AFC-479, data-model-v4 §4.6-§4.7, ADR-0009).
 * The single delivery-log header for every message: manual sends, campaign
 * sends, invite sends and welcome-form sends all land here.
 */
export interface Communication {
  id: string
  source_kind: 'manual' | 'campaign' | 'invite' | 'welcome_form' | 'birthday_webhook'
  campaign: string | null
  campaign_step: string | null
  campaign_run: string | null
  event_invite: string | null
  consent_policy: 'marketing_only' | 'operational_essential' | 'mixed' | null
  branch: string | null
  status: 'queued' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled'
  estimated_cost: string | null
  created_by: string | null
  created_at: string | null
}

export type ConsentBasis =
  'explicit_opt_in' | 'guardian' | 'legitimate_interest' | 'inviter_vouched' | 'none'

export type ExclusionReason =
  | 'no_consent'
  | 'minor_no_guardian_consent'
  | 'opted_out'
  | 'invalid_contact'
  | 'dnc'
  | 'over_cap'

/**
 * One row per recipient. A send state (queued/sent/delivered/read) always
 * carries a real consent_basis; an excluded row carries basis 'none' plus an
 * exclusion_reason. contact_value, error_detail and provider_message_id are
 * restricted reads (data-model-v4 §5.1).
 */
export interface CommunicationRecipient {
  id: string
  communication: string
  contact_value: string | null
  contact_hash: string | null
  channel: 'whatsapp' | 'sms' | 'email'
  consent_basis: ConsentBasis
  message_rendered: string | null
  status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'excluded'
  exclusion_reason: ExclusionReason | null
  provider_message_id: string | null
  error_detail: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  created_at: string | null
}

export interface MessageTemplate {
  id: string
  key: string
  channel: 'whatsapp' | 'sms' | 'email'
  category:
    | 'marketing'
    | 'operational'
    | 'event_invitation'
    | 'greeting'
    | 'memory_verse'
    | 'service_reminder'
    | 'fallback'
  rotation_key: string | null
  approval_status: 'draft' | 'submitted' | 'pending_provider' | 'approved' | 'rejected'
  provider_template_id: string | null
  body: string
  variables: string[]
  active: boolean
  branch: string | null
}

export interface ConsentRecord {
  id: string
  person: string | null
  contact_hash: string | null
  channel: 'whatsapp' | 'sms' | 'email'
  granted: boolean
  consent_type: 'channel' | 'marketing_invite'
  basis:
    | 'explicit_opt_in'
    | 'guardian'
    | 'legitimate_interest'
    | 'inviter_vouched'
    | 'not_applicable'
  related_invite: string | null
  method: 'paper' | 'digital' | 'verbal_recorded' | null
  expires_at: string | null
  captured_at: string | null
}
