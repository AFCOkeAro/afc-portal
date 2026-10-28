/**
 * Directus collection names.
 *
 * Transcribed from `docs/planning/data-model.md` §1–§7. The names are frozen
 * constants rather than a hand-typed string at each call site so that a schema
 * rename is a one-line change here and a compile error everywhere else.
 *
 * `directus_users` is a Directus system collection with custom fields added per
 * data-model §7.1. It is listed because the portal has to reason about the
 * portal-specific fields on it, not because the app writes to it directly.
 */
export const COLLECTIONS = {
  branches: 'branches',
  departments: 'departments',
  people: 'people',
  peopleDepartments: 'people_departments',
  households: 'households',
  events: 'events',
  eventDepartments: 'events_departments',
  eventRegistrations: 'event_registrations',
  /** Per-event expense records (AFC-801). One row per recorded spend. */
  eventExpenses: 'event_expenses',
  /** Per-event budget lines (AFC-825). Append-only; latest row per category wins. */
  eventBudgets: 'event_budgets',
  /** Spend taxonomy (AFC-825). Seeded with the 0044 eight + other; area admins extend it. */
  expenseCategories: 'expense_categories',
  /** Invites (Slice 4). One row per invitation; quota + delivery read it. */
  eventInvites: 'event_invites',
  attendanceSessions: 'attendance_sessions',
  attendanceRecords: 'attendance_records',
  /** Public testimonies per event, public-submitted (AFC-828 phase 4). */
  eventTestimonies: 'event_testimonies',
  /** Annual leave allowances per person per year (AFC-854 Time Off). */
  leaveBalances: 'leave_balances',
  /** Programme items inside a session (AFC-826 schedule builder). */
  sessionActivities: 'session_activities',
  /** AVS mission fields (AFC-841): schools, prisons, skills centres, hospitals. */
  outreachLocations: 'outreach_locations',
  /** Secretary assignments to outreach locations (AFC-841 junction). */
  outreachLocationSecretaries: 'outreach_location_secretaries',
  /** Staff leave requests (AFC-842, Church Office). */
  leaveRequests: 'leave_requests',
  /** Speaker bookings per event (AFC-843). */
  eventSpeakers: 'event_speakers',
  /** Programme materials per event, approval-gated (AFC-844). */
  eventResources: 'event_resources',
  /** Fan feedback per event, public-submitted (AFC-828 phase 2). */
  eventFeedback: 'event_feedback',
  /**
   * Attendance sex/category split (AFC-468, data-model-expansion §3).
   * `serviceTypeDefinitions` is board config (capture renders its ordered
   * category sets); `attendanceCounts` holds one row per
   * (session, category, sex).
   */
  serviceTypeDefinitions: 'service_type_definitions',
  attendanceCounts: 'attendance_counts',
  /**
   * Blessings per service/program (AFC-474, data-model-expansion §3.4).
   * `blessingEvents` is the explicit audit trail (created/updated/note),
   * following the welfare_case_events precedent.
   */
  blessings: 'blessings',
  blessingEvents: 'blessing_events',
  /** Individual blessings mapped to a DB person/user (AFC-671 §C). */
  blessingRecipients: 'blessing_recipients',
  sundayServices: 'sunday_services',
  serviceAssignments: 'service_assignments',
  visitors: 'visitors',
  /**
   * Newcomer journey (AFC-471, data-model-v4 §2). `visitorJourneyStages` is
   * the seedable reference; `visitorFollowUps` the outcome log;
   * `visitorJourneyTransitions` the stage-move audit.
   */
  visitorJourneyStages: 'visitor_journey_stages',
  visitorFollowUps: 'visitor_follow_ups',
  visitorJourneyTransitions: 'visitor_journey_transitions',
  welfareCases: 'welfare_cases',
  welfareContributions: 'welfare_contributions',
  welfareCaseEvents: 'welfare_case_events',
  users: 'directus_users',
  /**
   * Delivery log + consent (AFC-479, data-model-v4 §4.6-§4.7, ADR-0009
   * decisions 1-2). One log for every message: `communications` is the
   * header, `communication_recipients` the per-recipient rows carrying the
   * stored consent basis. No send path is enabled in this slice.
   */
  communications: 'communications',
  /** Campaign catalogue is read-only in the portal; steps/runs are its children. */
  campaigns: 'campaigns',
  campaignSteps: 'campaign_steps',
  campaignRuns: 'campaign_runs',
  communicationRecipients: 'communication_recipients',
  messageTemplates: 'message_templates',
  consentRecords: 'consent_records',
  /**
   * WECA finance (AFC-451, ADR-0008). Capture + computed returns under the
   * board-ratified formula version. Finance scope only.
   */
  branchFinancialRecords: 'branch_financial_records',
  wecaReturns: 'weca_returns',
  wecaReturnFormulas: 'weca_return_formulas',
  /**
   * Organisation hierarchy (AFC-461a, data-model-expansion §2). Snake-case
   * wire names match the Directus collection names. `campusInstitutions` is
   * a reference only here; full campus care stays in Slice 5.
   */
  areas: 'areas',
  zones: 'zones',
  bibleStudyCentres: 'bible_study_centres',
  conferenceCentres: 'conference_centres',
  sundaySchoolClasses: 'sunday_school_classes',
  avsCentres: 'avs_centres',
  campusInstitutions: 'campus_institutions',
  /**
   * Office bundle (AFC-477, data-model-expansion §§9.1–9.7). `*Events` are
   * the explicit per-domain audit trails (created/updated/status_changed/
   * note), following the welfare_case_events precedent -- the portal route
   * is the writer, the table is the trail.
   */
  transfers: 'transfers',
  transferEvents: 'transfer_events',
  marriageMatters: 'marriage_matters',
  marriageMatterEvents: 'marriage_matter_events',
  /**
   * Marriage pipeline (AFC-674 scope A). `marriageCases` is the staged
   * brother/sister pipeline (one row per couple); `marriageCaseEvents` is
   * the explicit stage history (created/stage_changed/halted/
   * transferred_out/approved/note), following the welfare_case_events
   * precedent. `marriageMatters` (single-matter CRUD) stays for history.
   */
  marriageCases: 'marriage_cases',
  marriageCaseEvents: 'marriage_case_events',
  /**
   * Marriage phase-B form submissions (AFC-677). One row per filled source
   * form; payloads validated by the phase-B routes. Same readers as the
   * pipeline rows below.
   */
  marriageCaseForms: 'marriage_case_forms',
  /**
   * Scoped impersonation audit (AFC-684). One row per start/stop with actor,
   * target (user XOR branch XOR zone), action, reason, and timestamp.
   * Created by migration 0037; read by area admins, written by the portal.
   */
  impersonationEvents: 'impersonation_events',
  officeMinutes: 'office_minutes',
  minutesAttendees: 'minutes_attendees',
  officeMinuteEvents: 'office_minute_events',
  tasks: 'tasks',
  taskEvents: 'task_events',
  announcements: 'announcements',
  announcementEvents: 'announcement_events',
  eventReferrals: 'event_referrals',
  /**
   * Youth profiles + celebrations (AFC-476, data-model-expansion §§6.1-6.2).
   * `youthProfileEvents` / `celebrationEvents` are the explicit audit trails
   * (created/updated/note; created/approved/published/archived/note),
   * following the welfare_case_events precedent.
   */
  youthProfiles: 'youth_profiles',
  youthProfileEvents: 'youth_profile_events',
  celebrations: 'celebrations',
  celebrationEvents: 'celebration_events',
  /**
   * Youth-relevant history (data-model-expansion §§4.3-4.4, AFC-476).
   * Created by migration 0012 where no earlier migration owned them.
   */
  personPreviousBranches: 'person_previous_branches',
  personMilestones: 'person_milestones',
  /**
   * Campus care (AFC-483, data-model-expansion §7).
   * `campusInstitutions` graduates from reference-only (0002) to the §7.1
   * field set; the rest are created by migration 0003_campus. Table names
   * are the collection names 1:1 (exam_results is the spec-exact table).
   * `nyscStatusTransitions` is SELECT-only reference the campus API reads
   * to validate NYSC transitions.
   */
  campusStudents: 'campus_students',
  coachingProgrammes: 'coaching_programmes',
  coachingTimetable: 'coaching_timetable',
  coachingFacilitators: 'coaching_facilitators',
  coachingStudents: 'coaching_students',
  coachingClassAttendance: 'coaching_class_attendance',
  coachingProgress: 'coaching_progress',
  examResults: 'exam_results',
  coachingResources: 'coaching_resources',
  coachingFeedback: 'coaching_feedback',
  campusFinancialSupport: 'campus_financial_support',
  nyscStatusTransitions: 'nysc_status_transitions',
} as const

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

export const COLLECTION_NAMES = Object.values(COLLECTIONS) as CollectionName[]

/**
 * The collections a signed-in portal user can navigate to. Narrower than
 * COLLECTION_NAMES on purpose: the permission matrix (data-model §10) has no
 * grant for some collections to some roles, and navigation is driven by
 * capability rather than by a hard-coded role check (data-model §13 rule 7).
 */
export const NAVIGABLE_COLLECTIONS = [
  COLLECTIONS.people,
  COLLECTIONS.events,
  COLLECTIONS.attendanceSessions,
  COLLECTIONS.visitors,
  COLLECTIONS.welfareCases,
  COLLECTIONS.youthProfiles,
  COLLECTIONS.celebrations,
] as const satisfies readonly CollectionName[]

export type NavigableCollection = (typeof NAVIGABLE_COLLECTIONS)[number]
