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
]
