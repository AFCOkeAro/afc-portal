import type { ServiceAssignment, SundayService, SundayServiceEvent } from '@afc/shared'
import type { BlessingRow } from '../../../types/portal'
import {
  assertUuidParam,
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  zoneScopeFilter,
} from '../../utils/portal'

const SERVICE_FIELDS = [
  'id',
  'branch',
  'zone',
  'service_date',
  'service_time',
  'service_type',
  'theme',
  'preacher',
  'expected_attendance',
  'total_attendance',
  'status',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
]

const ASSIGNMENT_FIELDS = [
  'id',
  'service',
  'person',
  'role',
  'branch',
  'status',
  'notes',
  'created_by',
  'created_at',
]

const EVENT_FIELDS = ['id', 'service', 'event_type', 'detail', 'actor_user', 'created_at']

const BLESSING_FIELDS = [
  'id',
  'blessing_type',
  'other_label',
  'count',
  'total_count',
  'branch',
  'service_date',
  'sunday_service',
  'event',
  'created_at',
]

export interface ServiceAssignmentRow extends ServiceAssignment {
  person_name: string | null
}

export interface ServiceDetail extends SundayService {
  branch_name: string | null
  preacher_name: string | null
  assignments: ServiceAssignmentRow[]
  assignment_count: number
  events: SundayServiceEvent[]
  blessings: BlessingRow[]
  blessings_total: number
}

/**
 * GET /api/services/:id — service detail with its roster tab and audit trail.
 *
 * The roster (service_assignments) and the trail (sunday_service_events)
 * are children of the service, so scoping the service scopes them: a
 * cross-branch id is a 404 here exactly like the welfare detail route,
 * never a foreign roster.
 */
export default defineEventHandler(async (event): Promise<ServiceDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_services', 'read')

  const id = assertUuidParam(getRouterParam(event, 'id'), 'service', 'invalid_service_id')

  // Same hierarchy predicate as the list: area all, zone grants by zone,
  // branch staff by branch. A service outside the caller's scope is a 404.
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'sunday_services',
    id,
    {
      fields: SERVICE_FIELDS,
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const names = await branchNames(event, scope)

  let assignments: ServiceAssignmentRow[] = []
  if (can(scope, 'service_assignments', 'read')) {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'service_assignments',
      {
        filter: { service: { _eq: id } },
        fields: ASSIGNMENT_FIELDS,
        sort: 'role,created_at',
        limit: -1,
      },
    )
    const personIds = [
      ...new Set(
        result.data
          .map((assignment) => assignment.person)
          .filter(
            (person): person is string => typeof person === 'string' && person.length > 0,
          ),
      ),
    ]
    const personNames = new Map<string, string>()
    if (personIds.length > 0 && can(scope, 'people', 'read')) {
      const people = await listItems<{
        id: string | number
        first_name: string
        last_name: string
        preferred_name: string | null
      }>(event, scope, 'people', {
        filter: mergeFilters({ id: { _in: personIds } }, scopeFilter(scope)),
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: -1,
      })
      for (const person of people.data) {
        personNames.set(
          String(person.id),
          person.preferred_name ||
            [person.first_name, person.last_name].filter(Boolean).join(' ') ||
            String(person.id),
        )
      }
    }
    assignments = result.data.map((assignment) => ({
      ...(assignment as unknown as ServiceAssignment),
      id: String(assignment.id),
      person_name: assignment.person
        ? (personNames.get(String(assignment.person)) ?? String(assignment.person))
        : null,
    }))
  }

  let events: SundayServiceEvent[] = []
  if (can(scope, 'sunday_services', 'read')) {
    const trail = await listItems<SundayServiceEvent>(
      event,
      scope,
      'sunday_service_events',
      {
        filter: { service: { _eq: id } },
        fields: EVENT_FIELDS,
        sort: 'created_at',
        limit: -1,
      },
    )
    events = trail.data.map((item) => ({ ...item, id: String(item.id) }))
  }

  let preacherName: string | null = null
  if (row.preacher && can(scope, 'people', 'read')) {
    try {
      const preacher = await findScopedItem<{
        first_name: string
        last_name: string
        preferred_name: string | null
      }>(event, scope, 'people', String(row.preacher), {
        fields: ['first_name', 'last_name', 'preferred_name'],
      })
      preacherName =
        preacher.preferred_name ||
        [preacher.first_name, preacher.last_name].filter(Boolean).join(' ') ||
        null
    } catch {
      preacherName = null
    }
  }

  // Blessings recorded against this service (US-B1: record from the
  // service page; US-E1 surface for the service side). Gated on
  // blessings:read with the same hierarchy predicate as the service
  // itself, so a cross-branch blessing linked here never leaks into a
  // narrower session.
  let blessings: BlessingRow[] = []
  if (can(scope, 'blessings', 'read')) {
    const linked = await listItems<BlessingRow>(event, scope, 'blessings', {
      filter: mergeFilters(
        { sunday_service: { _eq: id } },
        scope.isArea
          ? undefined
          : scope.zoneIds.length > 0
            ? zoneScopeFilter(scope)
            : scopeFilter(scope),
      ),
      fields: BLESSING_FIELDS,
      sort: 'blessing_type,service_date',
      limit: -1,
    })
    blessings = linked.data.map((row) => ({
      ...row,
      id: String(row.id),
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      zone_name: null,
    }))
  }

  return {
    ...(row as unknown as SundayService),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    preacher_name: preacherName,
    assignments,
    assignment_count: assignments.length,
    events,
    blessings,
    blessings_total: blessings.reduce(
      (sum, row) => sum + Number((row as BlessingRow).count ?? row.total_count ?? 0),
      0,
    ),
  }
})
