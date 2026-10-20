import type { H3Event } from 'h3'
import { directusFetch } from './directus'
import {
  ageFromDob,
  listItems,
  mergeFilters,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  stripHidden,
  stripHiddenMany,
  zoneScopeFilter,
  type PortalScope,
} from './portal'

/**
 * Campus care shared helpers (AFC-484, PRD US-C1..US-C5).
 *
 * Scope model (data-model-expansion §10, ADR-0010 decision 1): only
 * `campus_students` (§7.2 branch/zone) and `coaching_programmes` (§7.3
 * area/zone/branch) carry scope columns. Every other campus row resolves its
 * scope by joining through its programme (or through its student → branch).
 * The helpers below encode that resolution so routes stay thin.
 *
 * Field restrictions (expansion §11.1): scores/aggregate, financial-support
 * amounts and the derived support total are coordinator + branch-admin-own +
 * own-student reads. The Directus policy withholds them record-level; the
 * portal strips them field-level via the shared role matrix
 * (stripHidden/stripHiddenMany) before rows leave the server.
 */

export const CAMPUS_STUDENT_FIELDS = [
  'id',
  'person',
  'institution',
  'course',
  'level',
  'admission_year',
  'graduation_year',
  'coordinator',
  'afcf_handshake_status',
  'afcmf_linked',
  'nysc_status',
  'nysc_deployment',
  'next_checkup_date',
  'financial_support_total',
  'branch',
  'zone',
  'status',
  'notes',
  'created_at',
  'updated_at',
]

export const COACHING_PROGRAMME_FIELDS = [
  'id',
  'name',
  'exam',
  'year',
  'area',
  'zone',
  'branch',
  'scope_note',
  'status',
  'created_at',
  'updated_at',
]

export const COACHING_TIMETABLE_FIELDS = [
  'id',
  'programme',
  'subject',
  'facilitator',
  'day_of_week',
  'start_time',
  'end_time',
  'location',
  'capacity',
  'status',
  'created_at',
  'updated_at',
]

export const COACHING_FACILITATOR_FIELDS = [
  'id',
  'person',
  'programme',
  'subject',
  'registration_date',
  'call_status',
  'status',
  'created_at',
  'updated_at',
]

export const COACHING_ATTENDANCE_FIELDS = [
  'id',
  'timetable',
  'programme',
  'class_date',
  'campus_student',
  'person',
  'present',
  'marked_by',
  'created_at',
  'updated_at',
]

export const COACHING_PROGRESS_FIELDS = [
  'id',
  'campus_student',
  'person',
  'programme',
  'assessment',
  'score',
  'max_score',
  'progress_date',
  'remarks',
  'recorded_by',
  'created_at',
  'updated_at',
]

export const EXAM_RESULT_FIELDS = [
  'id',
  'campus_student',
  'person',
  'exam',
  'exam_year',
  'scores',
  'aggregate',
  'status',
  'institution',
  'recorded_by',
  'created_at',
  'updated_at',
]

export const CAMPUS_SUPPORT_FIELDS = [
  'id',
  'student',
  'programme',
  'amount',
  'term',
  'source',
  'status',
  'approved_by',
  'support_date',
  'created_at',
  'updated_at',
]

export const CAMPUS_LEVELS = [
  'freshman',
  'sophomore',
  'junior',
  'senior',
  'final_year',
  'graduated',
  'other',
] as const

export const CAMPUS_STATUSES = ['active', 'inactive', 'graduated'] as const

export const AFCF_STATUSES = [
  'not_contacted',
  'contacted',
  'connected',
  'active',
  'declined',
] as const

export const FACILITATOR_CALL_STATUSES = [
  'registered',
  'called',
  'confirmed',
  'declined',
] as const

export const SUPPORT_STATUSES = ['proposed', 'approved', 'disbursed'] as const

export const RESULT_STATUSES = [
  'pending',
  'passed',
  'failed',
  'admitted',
  'not_admitted',
] as const

/** Level order for US-C5 progression (freshman → … → final_year → graduated). */
const LEVEL_ORDER = [
  'freshman',
  'sophomore',
  'junior',
  'senior',
  'final_year',
  'graduated',
] as const

export function isLevelProgression(
  from: string | null | undefined,
  to: string,
): boolean {
  if (!from) return true
  if (from === to) return true
  if (from === 'other' || to === 'other') return true
  const fromIdx = (LEVEL_ORDER as readonly string[]).indexOf(from)
  const toIdx = (LEVEL_ORDER as readonly string[]).indexOf(to)
  if (fromIdx === -1 || toIdx === -1) return true
  return toIdx >= fromIdx
}

/**
 * Scope predicate for campus_students (carries branch/zone denorm, §7.2).
 * Area sees all; explicit zone grants filter on zone; branch staff by branch.
 * A requested branch/zone outside scope is a 403 (fail-closed).
 */
export async function campusStudentScopeFilter(
  event: H3Event,
  scope: PortalScope,
  filters: { branch?: string | null; zone?: string | null },
): Promise<Record<string, unknown> | undefined> {
  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, filters.zone ?? null, visibleZones)
  const resolvedBranch = filters.branch
    ? resolveBranch(scope, filters.branch)
    : undefined
  return mergeFilters(
    filters.zone ? { zone: { _eq: filters.zone } } : undefined,
    resolvedBranch ? { branch: { _eq: resolvedBranch } } : undefined,
    scope.isArea
      ? undefined
      : scope.zoneIds.length > 0
        ? zoneScopeFilter(scope)
        : { branch: { _in: scope.branchIds } },
  )
}

/**
 * Scope predicate for coaching_programmes (area/zone/branch scope, §7.3).
 * Null scope columns mean "wider than that level", so an area-wide programme
 * (all null) is visible to every scoped session; branch staff additionally
 * see programmes in their branches plus area-wide ones.
 */
export async function coachingProgrammeScopeFilter(
  event: H3Event,
  scope: PortalScope,
  filters: { branch?: string | null; zone?: string | null },
): Promise<Record<string, unknown> | undefined> {
  const visibleZones = scope.isArea ? [] : await scopeZoneIds(event, scope)
  requireZoneInScope(scope, filters.zone ?? null, visibleZones)
  const resolvedBranch = filters.branch
    ? resolveBranch(scope, filters.branch)
    : undefined
  const requested = mergeFilters(
    filters.zone ? { zone: { _eq: filters.zone } } : undefined,
    resolvedBranch ? { branch: { _eq: resolvedBranch } } : undefined,
  )
  if (scope.isArea) return requested
  if (scope.zoneIds.length > 0) {
    return mergeFilters(
      requested,
      {
        _or: [
          { zone: { _in: scope.zoneIds } },
          { _and: [{ zone: { _null: true } }, { branch: { _null: true } }] },
        ],
      },
    )
  }
  return mergeFilters(
    requested,
    {
      _or: [
        { branch: { _in: scope.branchIds } },
        { _and: [{ zone: { _null: true } }, { branch: { _null: true } }] },
      ],
    },
  )
}

/**
 * Resolve the programme ids a session may see (paginated, chunked at 200).
 * Child collections (timetable/attendance/progress/results/resources/
 * feedback/support) carry no scope columns of their own, so routes filter
 * them with `{ programme: { _in: visibleIds } }`. An empty id set is
 * fail-closed: the caller returns an empty list, never an unfiltered one.
 */
export async function visibleProgrammeIds(
  event: H3Event,
  scope: PortalScope,
): Promise<string[]> {
  if (scope.isArea) return []
  const filter = await coachingProgrammeScopeFilter(event, scope, {})
  const ids: string[] = []
  let page = 1
  for (;;) {
    const result = await listItems<Record<string, unknown>>(
      event,
      scope,
      'coaching_programmes',
      { filter, fields: ['id'], page, limit: 200 },
    )
    for (const row of result.data) {
      if (row.id != null) ids.push(String(row.id))
    }
    if (result.data.length < 200 || ids.length >= result.meta.total) break
    page += 1
  }
  return ids
}

/**
 * Programme predicate for child collections. Area staff see everything.
 * Other sessions see rows whose programme is in their visible set; rows
 * linked only to a student (programme null) resolve through the student
 * branch instead — the caller adds that predicate.
 */
export async function programmeChildFilter(
  event: H3Event,
  scope: PortalScope,
): Promise<Record<string, unknown> | undefined> {
  if (scope.isArea) return undefined
  const ids = await visibleProgrammeIds(event, scope)
  // Fail-closed: a session with no visible programmes sees no child rows.
  if (ids.length === 0) return { programme: { _eq: '__none__' } }
  return { programme: { _in: ids } }
}

/**
 * Student-side scope through a relation (Directus relational filter).
 * Used by collections whose rows link a student but no programme
 * (exam_results) or a nullable programme (campus_financial_support):
 * a non-area session sees rows whose student (or person) sits in a branch
 * (or zone) they hold. People rows with no branch are invisible to
 * non-area sessions (fail-closed).
 */
export function studentRelationScope(
  scope: PortalScope,
  relation: 'campus_student' | 'student' | 'person' | 'guardian',
): Record<string, unknown> | undefined {
  if (scope.isArea) return undefined
  if (scope.zoneIds.length > 0) {
    return {
      [relation]: {
        _or: [
          { zone: { _in: scope.zoneIds } },
          { branch: { _in: scope.branchIds } },
        ],
      },
    }
  }
  return { [relation]: { branch: { _in: scope.branchIds } } }
}

/**
 * Attendance scope (AFC-484, US-C2; AFC-524 F1). Marks carry both a session
 * link (direct programme or slot programme) and a student identity
 * (campus_student xor person). Both sides must be in scope: a visible
 * programme alone never exposes another branch's student (area-wide
 * programmes are visible everywhere, so a union would leak). The session
 * side is an OR (direct or slot programme); the student side is an OR
 * (campus_student or person branch); the two sides are ANDed. Fail-closed
 * when either side is empty.
 */
export async function campusAttendanceScopeFilter(
  event: H3Event,
  scope: PortalScope,
): Promise<Record<string, unknown> | undefined> {
  if (scope.isArea) return undefined
  const ids = await visibleProgrammeIds(event, scope)
  // Fail-closed: no visible programmes means no attendance rows, even when
  // the student side would match.
  const sessionPart: Record<string, unknown> =
    ids.length > 0
      ? {
          _or: [
            { programme: { _in: ids } },
            { timetable: { programme: { _in: ids } } },
          ],
        }
      : { programme: { _eq: '__none__' } }
  const studentPaths = [
    studentRelationScope(scope, 'campus_student'),
    studentRelationScope(scope, 'person'),
  ].filter((path): path is Record<string, unknown> => Boolean(path))
  const studentPart: Record<string, unknown> =
    studentPaths.length === 0
      ? { id: { _eq: '__none__' } }
      : studentPaths.length === 1
        ? (studentPaths[0] as Record<string, unknown>)
        : { _or: studentPaths }
  return mergeFilters(sessionPart, studentPart)
}

/**
 * Progress scope (AFC-524 F1). Progress rows always carry a programme AND a
 * student identity, so both must be in scope (intersect, not union). An
 * area-wide programme is visible to every branch, but the student side
 * still confines the row to its branch/zone.
 */
export async function campusProgressScopeFilter(
  event: H3Event,
  scope: PortalScope,
): Promise<Record<string, unknown> | undefined> {
  if (scope.isArea) return undefined
  const programmePart = await programmeChildFilter(event, scope)
  const studentPaths = [
    studentRelationScope(scope, 'campus_student'),
    studentRelationScope(scope, 'person'),
  ].filter((path): path is Record<string, unknown> => Boolean(path))
  const studentPart: Record<string, unknown> | undefined =
    studentPaths.length === 0
      ? { id: { _eq: '__none__' } }
      : studentPaths.length === 1
        ? (studentPaths[0] as Record<string, unknown>)
        : { _or: studentPaths }
  return mergeFilters(programmePart, studentPart)
}

/**
 * Write-path student scope (AFC-524 F1). Resolves the named student row and
 * 404s when it sits outside the caller's branch/zone scope. Mirrors the
 * results/support POST pattern: a non-area session may only write for a
 * student it could list. People rows with no branch are fail-closed.
 *
 * Returns the student row (campus_students rows include the linked `person`
 * for the F2 guardian check).
 */
export async function assertStudentInScope(
  event: H3Event,
  scope: PortalScope,
  identity: { campus_student?: string | null; person?: string | null },
): Promise<Record<string, unknown>> {
  if (scope.isArea) {
    const collection = identity.campus_student
      ? '/items/campus_students'
      : '/items/people'
    const id = identity.campus_student ?? identity.person
    const found = await directusFetch<{
      data: Array<Record<string, unknown>>
    }>(event, collection, {
      accessToken: scope.token,
      query: {
        fields:
          collection === '/items/campus_students'
            ? 'id,branch,zone,person'
            : 'id,branch,zone',
        limit: 1,
        filter: { id: { _eq: id } },
      },
    }).catch(() => {
      throw createError({
        statusCode: 404,
        statusMessage: 'That student was not found in your scope',
        data: { code: 'not_found' },
      })
    })
    const row = found.data[0]
    if (!row) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That student was not found in your scope',
        data: { code: 'not_found' },
      })
    }
    return row
  }
  const collection = identity.campus_student
    ? '/items/campus_students'
    : '/items/people'
  const id = identity.campus_student ?? identity.person
  const found = await directusFetch<{
    data: Array<Record<string, unknown>>
  }>(event, collection, {
    accessToken: scope.token,
    query: {
      fields:
        collection === '/items/campus_students'
          ? 'id,branch,zone,person'
          : 'id,branch,zone',
      limit: 1,
      filter: { id: { _eq: id } },
    },
  }).catch(() => {
    throw createError({
      statusCode: 404,
      statusMessage: 'That student was not found in your scope',
      data: { code: 'not_found' },
    })
  })
  const row = found.data[0]
  const inBranch =
    row?.branch != null && scope.branchIds.includes(String(row.branch))
  const inZone = row?.zone != null && scope.zoneIds.includes(String(row.zone))
  if (!inBranch && !inZone) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That student was not found in your scope',
      data: { code: 'not_found' },
    })
  }
  return row
}

/**
 * Safeguarding write guard (AFC-524 F2). Refuses a write that links a minor
 * without a guardian, using the same 400 shape as POST /api/people. Reads
 * the stored `is_minor`/`guardian`/`date_of_birth` so a stale `is_minor`
 * flag cannot bypass the DOB check.
 */
export async function assertPersonGuardian(
  event: H3Event,
  scope: PortalScope,
  personId: string,
): Promise<void> {
  const found = await directusFetch<{
    data: Array<Record<string, unknown>>
  }>(event, `/items/people/${personId}`, {
    accessToken: scope.token,
    query: { fields: 'id,is_minor,guardian,date_of_birth' },
  }).catch(() => {
    throw createError({
      statusCode: 404,
      statusMessage: 'That person was not found in your scope',
      data: { code: 'not_found' },
    })
  })
  const row = (
    found as unknown as { data: Record<string, unknown> }
  ).data as Record<string, unknown> | undefined
  // Directus single-item reads return `{ data: {...} }`; tolerate the list
  // shape as well so stubbed fetches in tests cannot slip through.
  const person =
    row && typeof row.id !== 'undefined'
      ? row
      : (found as unknown as { data: Array<Record<string, unknown>> }).data?.[0]
  if (!person) {
    throw createError({
      statusCode: 404,
      statusMessage: 'That person was not found in your scope',
      data: { code: 'not_found' },
    })
  }
  const guardian = person.guardian
  if (guardian != null && String(guardian).length > 0) return
  if (person.is_minor === true) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A guardian is required for a person under 18',
      data: {
        code: 'validation_error',
        fields: { guardian: 'Add a guardian before saving a minor' },
      },
    })
  }
  const age = ageFromDob(person.date_of_birth as string | null | undefined)
  if (age !== null && age < 18) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A guardian is required for a person under 18',
      data: {
        code: 'validation_error',
        fields: { guardian: 'Add a guardian before saving a minor' },
      },
    })
  }
}

/**
 * Result/support scope (AFC-484, US-C3/US-C4). Neither collection carries
 * a programme column on every row (results never, support nullable), so
 * the scope resolves through the student (or person) branch/zone. The
 * caller names the student-side relations the collection actually owns
 * (`campus_student`+`person` for results, `student` for support).
 */
export function campusOutcomeScopeFilter(
  scope: PortalScope,
  relations: ReadonlyArray<'campus_student' | 'student' | 'person'>,
): Record<string, unknown> | undefined {
  if (scope.isArea) return undefined
  const paths = relations
    .map((relation) => studentRelationScope(scope, relation))
    .filter((path): path is Record<string, unknown> => Boolean(path))
  if (paths.length === 0) return { id: { _eq: '__none__' } }
  if (paths.length === 1) return paths[0]
  return { _or: paths }
}

export interface TimetableSlot {
  id?: string | number
  programme?: string | null
  subject?: string | null
  facilitator?: string | null
  day_of_week?: string | null
  start_time?: string | null
  end_time?: string | null
  location?: string | null
}

function minutesOf(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * US-C1 AC1 clash flag. Two slots clash when they share a day and their time
 * ranges overlap AND they share a facilitator or a location. Slots without a
 * day or without both times cannot clash (missing data is reported blank,
 * never flagged). Pure function so the route and the contract test share it.
 */
export function timetableClashes(
  candidate: TimetableSlot,
  existing: readonly TimetableSlot[],
): TimetableSlot[] {
  const day = (candidate.day_of_week ?? '').trim().toLowerCase()
  if (!day) return []
  const start = minutesOf(candidate.start_time)
  const end = minutesOf(candidate.end_time)
  if (start === null || end === null) return []
  return existing.filter((slot) => {
    if (String(slot.id ?? '') === String(candidate.id ?? '__new__')) return false
    if ((slot.day_of_week ?? '').trim().toLowerCase() !== day) return false
    const otherStart = minutesOf(slot.start_time)
    const otherEnd = minutesOf(slot.end_time)
    if (otherStart === null || otherEnd === null) return false
    const overlap = start < otherEnd && otherStart < end
    if (!overlap) return false
    const sameFacilitator =
      candidate.facilitator != null &&
      slot.facilitator != null &&
      String(candidate.facilitator) === String(slot.facilitator)
    const sameLocation =
      candidate.location != null &&
      slot.location != null &&
      String(candidate.location).trim().toLowerCase() ===
        String(slot.location).trim().toLowerCase()
    return sameFacilitator || sameLocation
  })
}

/**
 * Validate an NYSC transition against the seeded `nysc_status_transitions`
 * graph (the route reads the table; terminal completed/exempt carry no
 * outgoing edge by construction). Same-status writes are no-ops.
 */
export async function assertNyscTransition(
  event: H3Event,
  scope: PortalScope,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return
  const rows = await listItems<Record<string, unknown>>(
    event,
    scope,
    'nysc_status_transitions',
    {
      filter: { from_status: { _eq: from }, to_status: { _eq: to } },
      fields: ['from_status', 'to_status'],
      limit: 1,
    },
  )
  if (rows.data.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: `NYSC cannot move from ${from} to ${to}`,
      data: { code: 'invalid_nysc_transition', fields: { nysc_status: `Cannot move from ${from} to ${to}` } },
    })
  }
}

/** Derived support total = Σ disbursed amounts (shown per US-C4 AC3). */
export function supportTotal(rows: readonly Record<string, unknown>[]): number {
  let total = 0
  for (const row of rows) {
    if (row.status !== 'disbursed') continue
    const amount = Number(row.amount ?? 0)
    if (Number.isFinite(amount)) total += amount
  }
  return Math.round(total * 100) / 100
}

export function stripStudent(
  scope: PortalScope,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return stripHidden(scope, 'campus_students', row)
}

export function stripStudents(
  scope: PortalScope,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return stripHiddenMany(scope, 'campus_students', rows)
}

export function stripResult(
  scope: PortalScope,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return stripHidden(scope, 'exam_results', row)
}

export function stripResults(
  scope: PortalScope,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return stripHiddenMany(scope, 'exam_results', rows)
}

export function stripSupport(
  scope: PortalScope,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return stripHidden(scope, 'campus_financial_support', row)
}

export function stripSupportMany(
  scope: PortalScope,
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return stripHiddenMany(scope, 'campus_financial_support', rows)
}

export function progressToCsv(
  rows: Array<Record<string, unknown>>,
): string[][] {
  return [
    ['programme', 'student', 'assessment', 'score', 'max_score', 'date', 'remarks'],
    ...rows.map((row) => [
      String(row.programme_name ?? row.programme ?? ''),
      String(row.student_name ?? row.campus_student ?? row.person ?? ''),
      String(row.assessment ?? ''),
      row.score == null ? '' : String(row.score),
      row.max_score == null ? '' : String(row.max_score),
      String(row.progress_date ?? ''),
      String(row.remarks ?? ''),
    ]),
  ]
}
