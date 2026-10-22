import { STAFF_ROLES } from '@afc/shared'
import { grantsForRole } from '@afc/shared/role-matrix'
import { NAVIGATION, NAVIGATION_GROUPS } from '../../utils/navigation'

/**
 * Module + bundle catalog (AFC-669), computed server-side so the admin UI
 * never imports the role matrix (data-model §13 rule 7 keeps role names
 * out of client code).
 *
 * A *module* is one sidebar section with the collections its pages read.
 * A *bundle* is a named, assignable preset: a staff role plus the scope
 * contract the server already enforces. Assigning a bundle to a person is
 * setting their staff role and scope links — the admin People tab does that
 * through PATCH /api/admin/users/:id.
 */
export interface ModuleDef {
  key: string
  label: string
  to: string
  icon: string
  collections: string[]
  roles: string[]
}

export function buildModules(): ModuleDef[] {
  return NAVIGATION_GROUPS.map((group) => {
    const collections = [
      ...new Set(
        NAVIGATION.filter((item) => item.group === group.key).map(
          (item) => item.requires[0],
        ),
      ),
    ]
    const roles = (STAFF_ROLES as readonly string[]).filter(
      (role) =>
        role !== 'none' &&
        grantsForRole(role as never).some(
          (grant) => grant.action === 'read' && collections.includes(grant.collection),
        ),
    )
    return {
      key: group.key,
      label: group.label,
      to: group.to,
      icon: group.icon,
      collections,
      roles,
    }
  })
}

export interface BundlePreset {
  id: string
  label: string
  description: string
  staffRole: string
  scope: string
}

export const BUNDLE_PRESETS: BundlePreset[] = [
  {
    id: 'area_operations',
    label: 'Area operations',
    description: 'Full area oversight across every module.',
    staffRole: 'area_admin',
    scope: 'Every branch in the area. Server-enforced row scoping.',
  },
  {
    id: 'zone_operations',
    label: 'Zone operations',
    description: 'Run the programme for the branches inside one zone.',
    staffRole: 'zone_admin',
    scope: "Only branches in the assignee's zone. Server-enforced.",
  },
  {
    id: 'branch_operations',
    label: 'Branch operations',
    description: 'Day-to-day modules for a single branch.',
    staffRole: 'branch_admin',
    scope: "Only the assignee's branch. Server-enforced.",
  },
  {
    id: 'department_ministry',
    label: 'Department ministry',
    description: 'Department-scoped service modules.',
    staffRole: 'department_leader',
    scope: 'Own department rows. Server-enforced.',
  },
  {
    id: 'volunteer_support',
    label: 'Volunteer support',
    description: 'Assist modules without management actions.',
    staffRole: 'volunteer',
    scope: 'Assigned rows only. Server-enforced.',
  },
]

export function bundlesWithModules(): Array<BundlePreset & { modules: ModuleDef[] }> {
  const modules = buildModules()
  return BUNDLE_PRESETS.map((preset) => ({
    ...preset,
    modules: modules.filter((module) => module.roles.includes(preset.staffRole)),
  }))
}
