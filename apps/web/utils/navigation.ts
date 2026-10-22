import type { CollectionName, PermissionAction } from '@afc/shared'

/**
 * The portal navigation, declared as data.
 *
 * Each entry names the capability that reveals it, rather than the role that
 * holds it. `usePermissions` filters this list, so adding a role never requires
 * touching a component and adding a capability never requires touching a role
 * name in the UI (data-model §13 rule 7).
 */
export interface NavigationItem {
  label: string
  to: string
  icon: string
  requires: readonly [CollectionName, PermissionAction]
  /** Sidebar section this entry renders under. */
  group: NavigationGroup
  /** Shown in the sidebar only; the dashboard lists everything. */
  inSidebar?: boolean
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
  { key: 'dashboard', label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/dashboard' },
  { key: 'office', label: 'Office Admin', icon: 'i-lucide-briefcase', to: '/minutes' },
  { key: 'outreach', label: 'Outreach', icon: 'i-lucide-radar', to: '/departments' },
  { key: 'welfare', label: 'Welfare', icon: 'i-lucide-heart-handshake', to: '/visitors' },
  { key: 'worship', label: 'Worship', icon: 'i-lucide-church', to: '/departments' },
  { key: 'people', label: 'People', icon: 'i-lucide-users', to: '/people' },
  { key: 'youth', label: 'Youth', icon: 'i-lucide-sparkles', to: '/campus' },
  { key: 'events', label: 'Events', icon: 'i-lucide-calendar-days', to: '/events' },
  { key: 'communications', label: 'Communications', icon: 'i-lucide-send', to: '/campaigns' },
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
    label: 'Marriage',
    to: '/marriage',
    icon: 'i-lucide-heart',
    requires: ['marriage_matters', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // Weekly remittance, monthly report and deductions all live on the
    // finance records surface; summary/formulas are reached from there.
    label: 'Finance',
    to: '/finance/records',
    icon: 'i-lucide-landmark',
    requires: ['branch_financial_records', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
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
  {
    // My assignments (AFC-668): same list pre-filtered to the session user.
    label: 'My tasks',
    to: '/tasks?mine=1',
    icon: 'i-lucide-user-check',
    requires: ['tasks', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    // No dedicated automation surface yet; tasks is the closest working page.
    label: 'Workflow and Automation',
    to: '/tasks',
    icon: 'i-lucide-workflow',
    requires: ['tasks', 'read'],
    group: 'office',
    inSidebar: true,
  },

  // Outreach
  {
    // AVS centres are served by the centres register today.
    label: 'AVS',
    to: '/bscs',
    icon: 'i-lucide-school',
    requires: ['bible_study_centres', 'read'],
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

  // Worship
  {
    // Sunday School classes are modelled as departments today.
    label: 'Sunday School',
    to: '/departments',
    icon: 'i-lucide-book-open',
    requires: ['departments', 'read'],
    group: 'worship',
    inSidebar: true,
  },
  {
    label: 'Branches',
    to: '/branches',
    icon: 'i-lucide-building-2',
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
    label: 'Attendance',
    to: '/attendance',
    icon: 'i-lucide-clipboard-check',
    requires: ['attendance_sessions', 'read'],
    group: 'worship',
    inSidebar: true,
  },
  {
    // Overview, attendance and blessings reporting.
    label: 'Reporting',
    to: '/attendance/report',
    icon: 'i-lucide-chart-column',
    requires: ['attendance_sessions', 'read'],
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

  // Communications
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

  // Admin
  {
    label: 'Branches',
    to: '/branches',
    icon: 'i-lucide-building-2',
    requires: ['branches', 'read'],
    group: 'admin',
    inSidebar: true,
  },
  {
    label: 'Zones',
    to: '/zones',
    icon: 'i-lucide-map',
    requires: ['zones', 'read'],
    group: 'admin',
    inSidebar: true,
  },
  {
    label: 'Bible Study Centres',
    to: '/bscs',
    icon: 'i-lucide-book-marked',
    requires: ['bible_study_centres', 'read'],
    group: 'admin',
    inSidebar: true,
  },
  {
    label: 'AVS',
    to: '/bscs',
    icon: 'i-lucide-school',
    requires: ['bible_study_centres', 'read'],
    group: 'admin',
    inSidebar: true,
  },
  {
    // Directus owns roles/policies; the portal redirects to its admin view.
    label: 'Roles and Permission',
    to: '/admin/roles',
    icon: 'i-lucide-shield-check',
    requires: ['directus_users', 'read'],
    group: 'admin',
    inSidebar: true,
  },
]
