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
  /** Sidebar section this entry renders under (AFC-549). */
  group: NavigationGroup
  /** Shown in the sidebar only; the dashboard lists everything. */
  inSidebar?: boolean
}

/**
 * Sidebar sections in render order (AFC-549). The sidebar renders one
 * headed section per group and drops groups with no permitted items, so a
 * volunteer sees only the sections their capabilities allow.
 */
export type NavigationGroup =
  'overview' | 'people' | 'gatherings' | 'communications' | 'office'

export const NAVIGATION_GROUPS: readonly { key: NavigationGroup; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'people', label: 'People and Care' },
  { key: 'gatherings', label: 'Gatherings' },
  { key: 'communications', label: 'Communications' },
  { key: 'office', label: 'Office' },
]

export const NAVIGATION: readonly NavigationItem[] = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'i-lucide-layout-dashboard',
    // Every staff role holds a read grant on `branches`, so this resolves for all
    // of them and disappears for a session with no grants at all.
    requires: ['branches', 'read'],
    group: 'overview',
    inSidebar: true,
  },
  {
    label: 'Branches',
    to: '/branches',
    icon: 'i-lucide-building-2',
    requires: ['branches', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    label: 'People',
    to: '/people',
    icon: 'i-lucide-users',
    requires: ['people', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Households',
    to: '/households',
    icon: 'i-lucide-house',
    requires: ['households', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Departments',
    to: '/departments',
    icon: 'i-lucide-network',
    requires: ['departments', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Events',
    to: '/events',
    icon: 'i-lucide-calendar-days',
    requires: ['events', 'read'],
    group: 'gatherings',
    inSidebar: true,
  },
  // Slice 4 UI (AFC-527, wireframes v3 screens 8-12). Capability-gated, no
  // role names (data-model §13 rule 7). The member entry resolves for staff
  // today; the member role holds no matrix grant yet (track d, OTP-gated),
  // so it resolves for members once the matrix gains the member row.
  {
    label: 'Invitations',
    to: '/invites',
    icon: 'i-lucide-mail-plus',
    requires: ['events', 'read'],
    group: 'gatherings',
    inSidebar: true,
  },
  {
    label: 'My invitations',
    to: '/me/invitations',
    icon: 'i-lucide-mail-open',
    requires: ['events', 'read'],
    group: 'gatherings',
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
    label: 'Delivery log',
    to: '/communications',
    icon: 'i-lucide-scroll-text',
    requires: ['communications', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Attendance',
    to: '/attendance',
    icon: 'i-lucide-clipboard-check',
    requires: ['attendance_sessions', 'read'],
    group: 'gatherings',
    inSidebar: true,
  },
  {
    label: 'Services',
    to: '/services',
    icon: 'i-lucide-church',
    requires: ['sunday_services', 'read'],
    group: 'gatherings',
    inSidebar: true,
  },
  {
    label: 'Visitors',
    to: '/visitors',
    icon: 'i-lucide-user-plus',
    requires: ['visitors', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Welfare',
    to: '/welfare',
    icon: 'i-lucide-heart-handshake',
    requires: ['welfare_cases', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Finance',
    to: '/finance/records',
    icon: 'i-lucide-landmark',
    requires: ['branch_financial_records', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    label: 'Youth',
    to: '/youth',
    icon: 'i-lucide-sparkles',
    requires: ['youth_profiles', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Celebrations',
    to: '/celebrations',
    icon: 'i-lucide-party-popper',
    requires: ['celebrations', 'read'],
    group: 'people',
    inSidebar: true,
  },
  {
    label: 'Campus',
    to: '/campus',
    icon: 'i-lucide-graduation-cap',
    requires: ['coaching_programmes', 'read'],
    group: 'people',
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
    label: 'Marriage',
    to: '/marriage',
    icon: 'i-lucide-heart',
    requires: ['marriage_matters', 'read'],
    group: 'office',
    inSidebar: true,
  },
  {
    label: 'Minutes',
    to: '/minutes',
    icon: 'i-lucide-notebook-text',
    requires: ['office_minutes', 'read'],
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
    label: 'Announcements',
    to: '/announcements',
    icon: 'i-lucide-megaphone',
    requires: ['announcements', 'read'],
    group: 'communications',
    inSidebar: true,
  },
  {
    label: 'Calendar',
    to: '/calendar',
    icon: 'i-lucide-calendar-range',
    requires: ['sunday_services', 'read'],
    group: 'overview',
    inSidebar: true,
  },
  {
    label: 'Search',
    to: '/search',
    icon: 'i-lucide-search',
    requires: ['people', 'read'],
    group: 'overview',
    inSidebar: true,
  },
]
