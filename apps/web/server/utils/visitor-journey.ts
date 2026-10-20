import type { H3Event } from 'h3'
import {
  JOURNEY_PACK_ITEMS,
  JOURNEY_STAGE_KEYS,
  JOURNEY_STAGE_META,
  buildJourneyFunnel,
  canAdvanceStage,
  dropoffOutcomeComplete,
  matchDuplicates,
  normalizeContactEmail,
  normalizeContactPhone,
  packChecklistComplete,
  type JourneyFunnel,
} from '@afc/shared'
import { directusFetch } from './directus'
import {
  countItems,
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHidden,
  updateItem,
  visibleFields,
  type PortalScope,
} from './portal'

export {
  JOURNEY_PACK_ITEMS,
  JOURNEY_STAGE_KEYS,
  JOURNEY_STAGE_META,
  buildJourneyFunnel,
  canAdvanceStage,
  dropoffOutcomeComplete,
  matchDuplicates,
  normalizeContactEmail,
  normalizeContactPhone,
  packChecklistComplete,
}
export type { JourneyFunnel }

export const JOURNEY_FIELDS = [
  'id',
  'branch',
  'visitor_first_name',
  'visitor_last_name',
  'email',
  'phone',
  'visit_date',
  'event',
  'age_group',
  'invited_by',
  'person',
  'status',
  'follow_up_owner',
  'next_follow_up_date',
  'notes',
  'journey_stage',
  'journey_stage_entered_at',
  'journey_started_at',
  'pack_checklist',
  'dropoff_outcome',
  'dropoff_visited_at',
  'next_check_in_at',
  'last_contact_at',
  'last_contact_channel',
  'welfare_officer_assigned_at',
]

export interface JourneyStageRow {
  id: string | number
  key: string
  name: string
  sequence: number
  target_days: number | null
  requires_pack: boolean
  requires_visit_outcome: boolean
  active: boolean
  branch: string | null
}

export async function loadJourneyStages(
  event: H3Event,
  scope: PortalScope,
): Promise<JourneyStageRow[]> {
  const result = await listItems<JourneyStageRow>(
    event,
    scope,
    'visitor_journey_stages',
    {
      filter: { active: { _eq: true } },
      fields: [
        'id',
        'key',
        'name',
        'sequence',
        'target_days',
        'requires_pack',
        'requires_visit_outcome',
        'active',
        'branch',
      ],
      sort: 'sequence',
      limit: -1,
    },
  )
  return result.data
}

export function stageByKey(
  stages: JourneyStageRow[],
  key: string,
): JourneyStageRow | undefined {
  return stages.find((stage) => stage.key === key)
}

function stageKeyOf(
  stages: JourneyStageRow[],
  id: string | number | null,
): string | null {
  if (id === null || id === undefined) return null
  return stages.find((stage) => String(stage.id) === String(id))?.key ?? null
}

/**
 * Officer validation (data-model-v4 §2.1 + §5: the owner must hold the Welfare
 * position in the same branch; Flow `visitor.validate_officer`).
 *
 * Chain: directus user -> linked person -> current branch-scoped welfare
 * appointment. Fail-closed throughout: an unreachable registry is a 503, a
 * missing link or appointment is a 400. There is no silent allow -- an
 * officer nobody can prove is not an officer.
 */
export async function validateWelfareOfficer(
  event: H3Event,
  scope: PortalScope,
  officerUserId: string,
  branchId: string | null,
): Promise<void> {
  if (!branchId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'An officer can only be assigned to a visitor with a branch',
      data: { code: 'officer_branch_required' },
    })
  }
  let user: { person?: string | null } | null = null
  try {
    const response = await directusFetch<{ data: { person?: string | null } }>(
      event,
      `/users/${officerUserId}`,
      { accessToken: scope.token, query: { fields: 'id,person' } },
    )
    user = response.data
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage:
        'The officer registry is unavailable, so the assignment cannot be verified',
      data: { code: 'officer_registry_unavailable' },
    })
  }
  const personId = user?.person ? String(user.person) : null
  if (!personId) {
    throw createError({
      statusCode: 400,
      statusMessage:
        'That officer has no linked person record, so the Welfare position cannot be verified',
      data: { code: 'officer_not_verifiable' },
    })
  }
  let appointments: Array<{ id: string | number }> = []
  try {
    const result = await listItems<{ id: string | number }>(
      event,
      scope,
      'leadership_appointments',
      {
        filter: {
          _and: [
            { person: { _eq: personId } },
            { status: { _eq: 'current' } },
            { scope_type: { _eq: 'branch' } },
            { branch: { _eq: branchId } },
            { position: { key: { _eq: 'welfare' } } },
          ],
        },
        fields: ['id'],
        limit: 1,
      },
    )
    appointments = result.data
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage:
        'The officer registry is unavailable, so the assignment cannot be verified',
      data: { code: 'officer_registry_unavailable' },
    })
  }
  if (appointments.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That officer does not hold the Welfare position in this branch',
      data: { code: 'officer_not_welfare' },
    })
  }
}

export interface AdvanceJourneyInput {
  visitorId: string
  toStage: string
  note?: string
  packChecklist?: string[]
  dropoffOutcome?: string
}

/**
 * Advance a visitor one journey step: order guard, pack/drop-off gates,
 * entered_at stamp, audit row, visitor update. Returns the updated visitor
 * id and the audit row id. Throws 400 on any guard failure with the reason
 * the UI shows next to the stepper.
 */
export async function advanceJourney(
  event: H3Event,
  scope: PortalScope,
  input: AdvanceJourneyInput,
): Promise<{ visitorId: string; transitionId: string }> {
  requireCan(scope, 'visitors', 'update')
  requireCan(scope, 'visitor_journey_transitions', 'create')

  const visitor = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'visitors',
    input.visitorId,
    { fields: JOURNEY_FIELDS },
  )
  const stages = await loadJourneyStages(event, scope)
  const target = stageByKey(stages, input.toStage)
  if (!target) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown journey stage: ${input.toStage}`,
      data: { code: 'unknown_stage' },
    })
  }
  const fromKey = stageKeyOf(stages, (visitor.journey_stage as string | null) ?? null)
  if (!canAdvanceStage(fromKey, input.toStage)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        fromKey === null
          ? 'A newcomer journey always starts at Identify'
          : `A journey moves one step at a time (from ${fromKey} the next step is fixed)`,
      data: { code: 'journey_order', from: fromKey, to: input.toStage },
    })
  }

  const patch: Record<string, unknown> = {
    journey_stage: target.id,
    journey_stage_entered_at: new Date().toISOString(),
  }
  if (fromKey === null && !visitor.journey_started_at) {
    patch.journey_started_at = new Date().toISOString().slice(0, 10)
  }
  if (target.requires_pack) {
    const checklist =
      input.packChecklist ?? (visitor.pack_checklist as string[] | null) ?? []
    if (!packChecklistComplete(checklist)) {
      const missing = JOURNEY_PACK_ITEMS.filter((item) => !checklist.includes(item))
      throw createError({
        statusCode: 400,
        statusMessage: `The pack is not complete (missing: ${missing.join(', ')})`,
        data: { code: 'pack_incomplete', missing },
      })
    }
    patch.pack_checklist = checklist
  } else if (input.packChecklist !== undefined) {
    patch.pack_checklist = input.packChecklist
  }
  if (target.requires_visit_outcome) {
    const outcome = input.dropoffOutcome ?? (visitor.dropoff_outcome as string | null)
    if (!dropoffOutcomeComplete(outcome)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Record the drop-off visit outcome before leaving this stage',
        data: { code: 'dropoff_outcome_required' },
      })
    }
    patch.dropoff_outcome = outcome
    if (!visitor.dropoff_visited_at) patch.dropoff_visited_at = new Date().toISOString()
  } else if (input.dropoffOutcome !== undefined) {
    patch.dropoff_outcome = input.dropoffOutcome
  }

  const transition = await createItem<{ id: string | number }>(
    event,
    scope,
    'visitor_journey_transitions',
    {
      visitor: input.visitorId,
      from_stage: (visitor.journey_stage as string | null) ?? null,
      to_stage: target.id,
      logged_by: scope.session.user.id,
      note: input.note ?? null,
    },
  )
  await updateItem(event, scope, 'visitors', input.visitorId, patch)
  return { visitorId: input.visitorId, transitionId: String(transition.id) }
}

export interface FollowUpInput {
  visitorId: string
  contactChannel: string
  outcome: string
  contactAt?: string
  notes?: string
  nextStep?: string
  nextFollowUpAt?: string
  welfareCase?: string
}

export async function logFollowUp(
  event: H3Event,
  scope: PortalScope,
  input: FollowUpInput,
): Promise<{ id: string; needsSupport: boolean }> {
  requireCan(scope, 'visitor_follow_ups', 'create')
  const visitor = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'visitors',
    input.visitorId,
    { fields: ['id', 'branch'] },
  )
  const created = await createItem<{ id: string | number }>(
    event,
    scope,
    'visitor_follow_ups',
    {
      visitor: input.visitorId,
      branch: (visitor.branch as string | null) ?? null,
      contact_at: input.contactAt ?? new Date().toISOString(),
      contact_channel: input.contactChannel,
      outcome: input.outcome,
      notes: input.notes ?? null,
      next_step: input.nextStep ?? null,
      next_follow_up_at: input.nextFollowUpAt ?? null,
      welfare_case: input.welfareCase ?? null,
      logged_by: scope.session.user.id,
    },
  )
  // touch_contact: the log write updates the latest-summary fields.
  requireCan(scope, 'visitors', 'update')
  await updateItem(event, scope, 'visitors', input.visitorId, {
    last_contact_at: new Date().toISOString(),
    last_contact_channel: input.contactChannel,
    ...(input.nextFollowUpAt ? { next_check_in_at: input.nextFollowUpAt } : {}),
  })
  return { id: String(created.id), needsSupport: input.outcome === 'needs_support' }
}

/**
 * Duplicate probe across people + visitors in ANY branch. The caller must
 * hold visitors:read; the warning rows are minimal (id, name, branch,
 * matched-on) so the probe does not become a cross-branch directory read.
 */
export async function findDuplicateCandidates(
  event: H3Event,
  scope: PortalScope,
  probe: { phone?: string | null; email?: string | null; excludeVisitorId?: string },
): Promise<
  Array<{
    id: string
    collection: 'people' | 'visitors'
    name: string | null
    branch: string | null
    matchedOn: Array<'phone' | 'email'>
  }>
> {
  const phone = normalizeContactPhone(probe.phone)
  const email = normalizeContactEmail(probe.email)
  if (!phone && !email) return []
  requireCan(scope, 'people', 'read')
  const filters = []
  if (phone) filters.push({ phone: { _eq: probe.phone } })
  if (email) filters.push({ email: { _eq: probe.email } })
  // Directus-side exact pre-filter narrows the read; normalisation then
  // collapses formatting variants (+234/0-prefix, case) before warning.
  const [people, visitors] = await Promise.all([
    listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { _or: filters },
      fields: ['id', 'first_name', 'last_name', 'phone', 'email', 'branch'],
      limit: 25,
    }).catch(() => ({ data: [] as Record<string, unknown>[] })),
    listItems<Record<string, unknown>>(event, scope, 'visitors', {
      filter: mergeFilters({ _or: filters }),
      fields: [
        'id',
        'visitor_first_name',
        'visitor_last_name',
        'phone',
        'email',
        'branch',
      ],
      limit: 25,
    }).catch(() => ({ data: [] as Record<string, unknown>[] })),
  ])
  const candidates = [
    ...people.data.map((row) => ({
      id: String(row.id),
      collection: 'people' as const,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || null,
      branch: (row.branch as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
    })),
    ...visitors.data
      .filter((row) => String(row.id) !== probe.excludeVisitorId)
      .map((row) => ({
        id: String(row.id),
        collection: 'visitors' as const,
        name:
          [row.visitor_first_name, row.visitor_last_name].filter(Boolean).join(' ') ||
          null,
        branch: (row.branch as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        email: (row.email as string | null) ?? null,
      })),
  ]
  return matchDuplicates({ phone: probe.phone, email: probe.email }, candidates)
}

export async function buildFunnelForScope(
  event: H3Event,
  scope?: PortalScope,
): Promise<JourneyFunnel> {
  const activeScope = scope ?? (await getPortalScope(event))
  requireCan(activeScope, 'visitors', 'read')
  const query = getQuery(event)
  const requestedBranch =
    typeof query.branch === 'string' && query.branch !== 'all' ? query.branch : null
  if (
    requestedBranch &&
    !activeScope.isArea &&
    !activeScope.branchIds.includes(requestedBranch)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That branch is outside your scope',
      data: { code: 'branch_out_of_scope' },
    })
  }
  const rows = await listItems<{
    journey_stage: string | null
    journey_stage_entered_at: string | null
    journey_started_at: string | null
    follow_up_owner: string | null
    next_check_in_at: string | null
  }>(event, activeScope, 'visitors', {
    filter: mergeFilters(
      requestedBranch ? { branch: { _eq: requestedBranch } } : undefined,
      scopeFilter(activeScope),
    ),
    fields: visibleFields(activeScope, 'visitors', [
      'journey_stage',
      'journey_stage_entered_at',
      'journey_started_at',
      'follow_up_owner',
      'next_check_in_at',
    ]),
    limit: -1,
  })
  const stripped = rows.data.map((row) =>
    stripHidden(activeScope, 'visitors', row as unknown as Record<string, unknown>),
  )
  // journey_stage is a uuid (M2O); fold on keys so the funnel reads the
  // same vocabulary as the stepper. Unknown ids fall back to identify.
  const stages = await loadJourneyStages(event, activeScope).catch(() => [])
  const keyById = new Map(stages.map((stage) => [String(stage.id), stage.key]))
  return buildJourneyFunnel(
    stripped.map((row) => {
      const record = row as unknown as {
        journey_stage: string | null
        journey_stage_entered_at: string | null
        journey_started_at: string | null
        follow_up_owner: string | null
        next_check_in_at: string | null
      }
      const raw = record.journey_stage ? String(record.journey_stage) : null
      return {
        journey_stage: (raw && keyById.get(raw)) || raw || 'identify',
        journey_stage_entered_at: record.journey_stage_entered_at,
        journey_started_at: record.journey_started_at,
        follow_up_owner: record.follow_up_owner,
        next_check_in_at: record.next_check_in_at,
      }
    }),
  )
}

export async function countJourneyScoped(
  event: H3Event,
  scope: PortalScope,
  collection: string,
  filter?: Record<string, unknown>,
): Promise<number> {
  return countItems(event, scope, collection, mergeFilters(filter, scopeFilter(scope)))
}
