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
  attendanceSessions: 'attendance_sessions',
  attendanceRecords: 'attendance_records',
  sundayServices: 'sunday_services',
  serviceAssignments: 'service_assignments',
  visitors: 'visitors',
  welfareCases: 'welfare_cases',
  welfareContributions: 'welfare_contributions',
  welfareCaseEvents: 'welfare_case_events',
  users: 'directus_users',
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
] as const satisfies readonly CollectionName[]

export type NavigableCollection = (typeof NAVIGABLE_COLLECTIONS)[number]
