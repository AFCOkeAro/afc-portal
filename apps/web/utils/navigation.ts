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
  /** Shown in the sidebar only; the dashboard lists everything. */
  inSidebar?: boolean
}

export const NAVIGATION: readonly NavigationItem[] = [
  {
    label: 'Dashboard',
    to: '/dashboard',
    icon: 'i-lucide-layout-dashboard',
    // Every staff role holds a read grant on `branches`, so this resolves for all
    // of them and disappears for a session with no grants at all.
    requires: ['branches', 'read'],
    inSidebar: true,
  },
  {
    label: 'People',
    to: '/people',
    icon: 'i-lucide-users',
    requires: ['people', 'read'],
    inSidebar: true,
  },
  {
    label: 'Households',
    to: '/households',
    icon: 'i-lucide-house',
    requires: ['households', 'read'],
    inSidebar: true,
  },
  {
    label: 'Departments',
    to: '/departments',
    icon: 'i-lucide-network',
    requires: ['departments', 'read'],
    inSidebar: true,
  },
  {
    label: 'Events',
    to: '/events',
    icon: 'i-lucide-calendar-days',
    requires: ['events', 'read'],
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
    inSidebar: true,
  },
  {
    label: 'My invitations',
    to: '/me/invitations',
    icon: 'i-lucide-mail-open',
    requires: ['events', 'read'],
    inSidebar: true,
  },
  {
    label: 'Campaigns',
    to: '/campaigns',
    icon: 'i-lucide-workflow',
    requires: ['communications', 'read'],
    inSidebar: true,
  },
  {
    label: 'Delivery log',
    to: '/communications',
    icon: 'i-lucide-scroll-text',
    requires: ['communications', 'read'],
    inSidebar: true,
  },
  {
    label: 'Attendance',
    to: '/attendance',
    icon: 'i-lucide-clipboard-check',
    requires: ['attendance_sessions', 'read'],
    inSidebar: true,
  },
  {
    label: 'Services',
    to: '/services',
    icon: 'i-lucide-church',
    requires: ['sunday_services', 'read'],
    inSidebar: true,
  },
  {
    label: 'Visitors',
    to: '/visitors',
    icon: 'i-lucide-user-plus',
    requires: ['visitors', 'read'],
    inSidebar: true,
  },
  {
    label: 'Welfare',
    to: '/welfare',
    icon: 'i-lucide-heart-handshake',
    requires: ['welfare_cases', 'read'],
    inSidebar: true,
  },
  {
    label: 'Youth',
    to: '/youth',
    icon: 'i-lucide-sparkles',
    requires: ['youth_profiles', 'read'],
    inSidebar: true,
  },
  {
    label: 'Celebrations',
    to: '/celebrations',
    icon: 'i-lucide-party-popper',
    requires: ['celebrations', 'read'],
    inSidebar: true,
  },
  {
    label: 'Campus',
    to: '/campus',
    icon: 'i-lucide-graduation-cap',
    requires: ['coaching_programmes', 'read'],
    inSidebar: true,
  },
  {
    label: 'Transfers',
    to: '/transfers',
    icon: 'i-lucide-arrow-right-left',
    requires: ['transfers', 'read'],
    inSidebar: true,
  },
  {
    label: 'Marriage',
    to: '/marriage',
    icon: 'i-lucide-heart',
    requires: ['marriage_matters', 'read'],
    inSidebar: true,
  },
  {
    label: 'Minutes',
    to: '/minutes',
    icon: 'i-lucide-notebook-text',
    requires: ['office_minutes', 'read'],
    inSidebar: true,
  },
  {
    label: 'Tasks',
    to: '/tasks',
    icon: 'i-lucide-list-checks',
    requires: ['tasks', 'read'],
    inSidebar: true,
  },
  {
    label: 'Announcements',
    to: '/announcements',
    icon: 'i-lucide-megaphone',
    requires: ['announcements', 'read'],
    inSidebar: true,
  },
  {
    label: 'Calendar',
    to: '/calendar',
    icon: 'i-lucide-calendar-range',
    requires: ['sunday_services', 'read'],
    inSidebar: true,
  },
  {
    label: 'Search',
    to: '/search',
    icon: 'i-lucide-search',
]
