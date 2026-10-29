import type { CollectionName, PermissionAction } from '@afc/shared'

/**
 * The portal navigation, declared as data.
 *
 * Each entry names the capability that reveals it, rather than the role that
 * holds it. `usePermissions` filters this list, so adding a role never requires
 * touching a component and adding a capability never requires touching a role
 * name in the UI (data-model §13 rule 7).
 */
/** Submenu entry (AFC-831): rendered nested under its parent item,
 *  filtered by its own capability. One level only, on purpose. */
export interface NavigationChild {
  label: string
  to: string
  icon: string
  requires: readonly [CollectionName, PermissionAction]
}

export interface NavigationItem {
  label: string
  to: string
  icon: string
  requires: readonly [CollectionName, PermissionAction]
  /** Sidebar section this entry renders under. */
  group: NavigationGroup
  /** Shown in the sidebar only; the dashboard lists everything. */
  inSidebar?: boolean
  /** Submenu entries (AFC-831). */
  children?: readonly NavigationChild[]
}

/**
 * Sidebar sections in render order. The header of each section links straight
 * to the group's canonical page (a real route, not an index), and the chevron
 * beside it only collapses the section. The old `/sections/<key>` URLs redirect
 * to the same canonical page so bookmarks keep working. A section with no
 * permitted items is dropped, so capability-gating stays per item.
 */
export type NavigationGroup =
  | 'dashboard'
  | 'office'
  | 'family'
  | 'finance'
  | 'outreach'
  | 'welfare'
  | 'worship'
  | 'people'
  | 'youth'
  | 'events'
  | 'communications'
  | 'admin'

export interface NavigationGroupDef {
  key: NavigationGroup
  label: string
  icon: string
  /** Canonical page the section header links to. */
  to: string
}

export const NAVIGATION_GROUPS: readonly NavigationGroupDef[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'i-lucide-layout-dashboard',
    to: '/dashboard',
  },
  { key: 'office', label: 'Church Office', icon: 'i-lucide-briefcase', to: '/minutes' },
  { key: 'family', label: 'Family', icon: 'i-lucide-heart', to: '/marriage' },
  { key: 'finance', label: 'Finance', icon: 'i-lucide-landmark', to: '/finance/records' },
  { key: 'outreach', label: 'Outreach', icon: 'i-lucide-radar', to: '/departments' },
  { key: 'welfare', label: 'Welfare', icon: 'i-lucide-heart-handshake', to: '/visitors' },
  { key: 'worship', label: 'Worship', icon: 'i-lucide-church', to: '/departments' },
  { key: 'people', label: 'People', icon: 'i-lucide-users', to: '/people' },
  { key: 'youth', label: 'Youth', icon: 'i-lucide-sparkles', to: '/campus' },
  // AFC-845: the section is Programs (routes stay /events; no URL churn).
  { key: 'events', label: 'Programs', icon: 'i-lucide-calendar-days', to: '/events' },
  {
    key: 'communications',
    label: 'Communications',
    icon: 'i-lucide-send',
    to: '/campaigns',
  },
  { key: 'admin', label: 'Admin', icon: 'i-lucide-shield-check', to: '/branches' },
]

export const NAVIGATION: readonly NavigationItem[] = [
  // Dashboard
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'i-lucide-layout-dashboard',
    // Every staff role holds a read grant on `branches`, so this resolves for all
    // of them and disappears for a session with no grants at all.
    requires: ['branches', 'read'],
    group: 'dashboard',
    inSidebar: true,
  },
  {
    label: 'Calendar',
    to: '/calendar',
    icon: 'i-lucide-calendar-range',
    requires: ['sunday_services', 'read'],
    group: 'dashboard',
    inSidebar: true,
  },
  {
    label: 'Search',
    to: '/search',
    icon: 'i-lucide-search',
    requires: ['people', 'read'],
    group: 'dashboard',
    inSidebar: true,
  },

  // Office Admin
  {
    label: 'Minutes',
    to: '/minutes',
    icon: 'i-lucide-notebook-text',
    requires: ['office_minutes', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // AFC-854: Time Off (minimal HR) — annual allowances today; used and
    // remaining days compute against leave_requests in phase 2.
    label: 'Time Off',
    to: '/time-off',
    icon: 'i-lucide-calendar-range',
    requires: ['leave_balances', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // AFC-842: Church Office leave requests — file, correct, decide.
    label: 'Annual Leave',
    to: '/annual-leave',
    icon: 'i-lucide-calendar-range',
    requires: ['leave_requests', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    label: 'Marriage',
    to: '/marriage',
    icon: 'i-lucide-heart',
    requires: ['marriage_matters', 'read'],
    group: 'family',
    inSidebar: true,
  },
  {
    // Pipeline surface (AFC-674 scopes B-F + report): the index links to
    // the conducted-marriages report, so one entry covers both.
    label: 'Marriage pipeline',
    to: '/marriage-cases',
    icon: 'i-lucide-heart-handshake',
    requires: ['marriage_cases', 'read'],
    group: 'family',
    inSidebar: true,
  },
  {
    // AFC-822: the conducted-marriages report; previously reachable only
    // from inside the pipeline page.
    label: 'Marriage report',
    to: '/marriage-cases/report',
    icon: 'i-lucide-scroll-text',
    requires: ['marriage_cases', 'read'],
    group: 'family',
    inSidebar: true,
  },
  {
    // Departments as their own section (AFC-758): ministries plus HQ
    // groups. Group creation lives on the section page itself.
    label: 'Departments',
    to: '/departments',
    icon: 'i-lucide-network',
    requires: ['departments', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // Weekly remittance, monthly report and deductions all live on the
    // finance records surface; formulas, returns and summary also have
    // sidebar entries (AFC-822).
    label: 'Finance',
    to: '/finance/records',
    icon: 'i-lucide-landmark',
    requires: ['branch_financial_records', 'read'],
    group: 'finance',
    inSidebar: true,
  },
  {
    // AFC-822: exposed next to Finance; previously reachable only in-page.
    label: 'Formulas',
    to: '/finance/formulas',
    icon: 'i-lucide-notebook-text',
    requires: ['branch_financial_records', 'read'],
    group: 'finance',
    inSidebar: true,
  },
  {
    // AFC-822: exposed next to Finance; previously reachable only in-page.
    label: 'Returns',
    to: '/finance/returns',
    icon: 'i-lucide-clipboard-check',
    requires: ['branch_financial_records', 'read'],
    group: 'finance',
    inSidebar: true,
  },
  {
    // AFC-822: exposed next to Finance; previously reachable only in-page.
    label: 'Finance summary',
    to: '/finance/summary',
    icon: 'i-lucide-chart-column',
    requires: ['branch_financial_records', 'read'],
    group: 'finance',
    inSidebar: true,
  },
  {
    // AFC-839: monetary moves live with the Church Office, not Finance.
    label: 'Transfers',
    to: '/transfers',
    icon: 'i-lucide-arrow-right-left',
    requires: ['transfers', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    label: 'Tasks',
    to: '/tasks',
    icon: 'i-lucide-list-checks',
    requires: ['tasks', 'read'],
    group: 'office',
    inSidebar: true,
  },
  // AFC-839: no My tasks entry — /tasks carries the Assigned to me
  // checkbox, so a second entry is a second truth to maintain.
  {
    // AFC-840: dedicated template catalogue; applying a template fans out
    // to ordinary task rows through /api/tasks/from-template.
    label: 'Workflows',
    to: '/workflows',
    icon: 'i-lucide-workflow',
    requires: ['tasks', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // AFC-840: hub of every data-entry point; each card gates on its own
    // create grant, so the hub itself needs only the widest read.
    label: 'Forms',
    to: '/forms',
    icon: 'i-lucide-file-text',
    requires: ['events', 'read'],
    group: 'office',
    inSidebar: true,
  },

  // Outreach
  {
    // AFC-841: AVS is the outreach mission-fields surface (schools,
    // prisons, skills centres, hospitals) — not Bible Study Centres.
    label: 'AVS',
    to: '/avs',
    icon: 'i-lucide-school',
    requires: ['outreach_locations', 'read'],
    group: 'outreach',
    inSidebar: true,
  },
  {
    // Secretaries sit inside the departments register.
    label: 'Secretaries',
    to: '/departments',
    icon: 'i-lucide-clipboard-list',
    requires: ['departments', 'read'],
    group: 'outreach',
    inSidebar: true,
  },
  {
    // Outreach prospects are tracked as visitors.
    label: 'Outreach List',
    to: '/visitors',
    icon: 'i-lucide-list-plus',
    requires: ['visitors', 'read'],
    group: 'outreach',
    inSidebar: true,
  },
  // AFC-895: the funnel is a tab on /visitors now (deep-link
  // /visitors?tab=funnel); no standalone menu entry. The old
  // /visitors/funnel route redirects to that tab.

  // Welfare
  {
    label: 'Visitors',
    to: '/visitors',
    icon: 'i-lucide-user-plus',
    requires: ['visitors', 'read'],
    group: 'welfare',
    inSidebar: true,
  },
  {
    label: 'Celebrations',
    to: '/celebrations',
    icon: 'i-lucide-party-popper',
    requires: ['celebrations', 'read'],
    group: 'welfare',
    inSidebar: true,
  },
  {
    label: 'Welfare',
    to: '/welfare',
    icon: 'i-lucide-heart-handshake',
    requires: ['welfare_cases', 'read'],
    group: 'welfare',
    inSidebar: true,
  },
  // AFC-895: the welfare report is a tab on /welfare now (deep-link
  // /welfare?tab=reports); no standalone menu entry. The old
  // /welfare/reports route redirects to that tab.

  // Worship
  {
    // AFC-870: dedicated class pages backed by sunday_school_classes;
    // departments stay for groups/management teams only.
    label: 'Sunday School',
    to: '/sunday-school',
    icon: 'i-lucide-book-open',
    requires: ['sunday_school_classes', 'read'],
    group: 'worship',
    inSidebar: true,
  },
  {
    // AFC-672: merged Churches surface (zones + branches + BSC in one menu
    // with kind filter + map). Replaces the worship Branches entry; every
    // staff role holds the branches read grant so the menu resolves for all
    // staff, and the page gates each kind by its own capability.
    label: 'Churches',
    to: '/churches',
    icon: 'i-lucide-church',
    requires: ['branches', 'read'],
    group: 'worship',
    inSidebar: true,
  },
  {
    // Groups / management teams are modelled as departments today.
    label: 'Groups',
    to: '/departments',
    icon: 'i-lucide-network',
    requires: ['departments', 'read'],
    group: 'worship',
    inSidebar: true,
  },
  {
    // Overview, attendance and blessings reporting. Attendance renders
    // nested under it (AFC-831) instead of as a second top-level entry.
    label: 'Reporting',
    to: '/attendance/report',
    icon: 'i-lucide-chart-column',
    requires: ['attendance_sessions', 'read'],
    group: 'worship',
    inSidebar: true,
    children: [
      {
        label: 'Attendance',
        to: '/attendance',
        icon: 'i-lucide-clipboard-check',
        requires: ['attendance_sessions', 'read'],
      },
    ],
  },
  {
    // Bulk entry + individual mapping (AFC-671); reports live on the page.
    label: 'Blessings',
    to: '/blessings',
    icon: 'i-lucide-sparkles',
    requires: ['blessings', 'read'],
    group: 'worship',
    inSidebar: true,
  },

  // People
  {
    label: 'Persons',
    to: '/people',
    icon: 'i-lucide-users',
    requires: ['people', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Household (Family)',
    to: '/households',
    icon: 'i-lucide-house',
    requires: ['households', 'read'],
    group: 'people',
    inSidebar: true,
  },

  // Youth
  {
    label: 'Teenagers',
    to: '/campus',
    icon: 'i-lucide-graduation-cap',
    requires: ['coaching_programmes', 'read'],
    group: 'youth',
    inSidebar: true,
  },
  {
    label: 'Youth profiles',
    to: '/youth',
    icon: 'i-lucide-users',
    requires: ['youth_profiles', 'read'],
    group: 'youth',
    inSidebar: true,
  },

  // Events
  {
    label: 'Invitations',
    to: '/invites',
    icon: 'i-lucide-mail-plus',
    requires: ['events', 'read'],
    group: 'events',
    inSidebar: true,
  },
  {
    label: 'My invitations',
    to: '/me/invitations',
    icon: 'i-lucide-mail-open',
    requires: ['events', 'read'],
    group: 'events',
    inSidebar: true,
  },
  {
    label: 'Services',
    to: '/services',
    icon: 'i-lucide-church',
    requires: ['sunday_services', 'read'],
    group: 'events',
    inSidebar: true,
  },
  {
    // AFC-870: in-code worship planner templates; planning reuses POST
    // /api/services, so the same read grant reveals the entry.
    label: 'Worship templates',
    to: '/services/templates',
    icon: 'i-lucide-list-music',
    requires: ['sunday_services', 'read'],
    group: 'events',
    inSidebar: true,
  },

  // Communications
  {
    label: 'New communication',
    to: '/communications/new',
    icon: 'i-lucide-square-pen',
    requires: ['communications', 'create'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Workflows',
    to: '/workflows',
    icon: 'i-lucide-git-branch',
    requires: ['communications', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Campaigns',
    to: '/campaigns',
    icon: 'i-lucide-workflow',
    requires: ['communications', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Announcements',
    to: '/announcements',
    icon: 'i-lucide-megaphone',
    requires: ['announcements', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Delivery log',
    to: '/communications',
    icon: 'i-lucide-scroll-text',
    requires: ['communications', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Hardening status',
    to: '/hardening/status',
    icon: 'i-lucide-shield-check',
    requires: ['communications', 'read'],
    group: 'communications',
    inSidebar: true,
  },

  // Admin
  // AFC-672: the admin Branches / Zones / Bible Study Centres entries are
  // removed — the single worship Churches entry above is the only sidebar
  // path to those registers. The old routes still resolve as deep-link
  // redirects into the filtered Churches view (pages/branches/index.vue,
  // pages/zones/index.vue); the outreach AVS entry is untouched (separate
  // centres register, not the BSC kind filter).
  // AFC-841: no Admin AVS entry — AVS lives under Outreach on the
  // outreach_locations register. /bscs/[id] stays as a deep link.
  {
    // Directus owns roles/policies; the portal redirects to its admin view.
    label: 'Roles and Permission',
    to: '/admin/roles',
    icon: 'i-lucide-shield-check',
    requires: ['directus_users', 'read'],
    group: 'admin',
    inSidebar: true,
  },
  {
    // AFC-822: staff scope preview; previously reachable only by URL.
    label: 'Preview scope',
    to: '/admin/impersonate',
    icon: 'i-lucide-user-check',
    requires: ['directus_users', 'read'],
    group: 'admin',
    inSidebar: true,
  },
]
