import type { VisitorRow } from '../../../types/portal'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
} from '../../utils/portal'
import { JOURNEY_FIELDS, loadJourneyStages } from '../../utils/visitor-journey'

export default defineEventHandler(
  async (
    event,
  ): Promise<
    VisitorRow & {
      journey_stage_key: string | null
      journey_stages: Array<{
        key: string
        name: string
        sequence: number
        requires_pack: boolean
        requires_visit_outcome: boolean
      }>
    }
  > => {
    const scope = await getPortalScope(event)
    requireCan(scope, 'visitors', 'read')

    const id = getRouterParam(event, 'id')
    if (!id)
      throw createError({ statusCode: 400, statusMessage: 'A visitor id is required' })

    const row = await findScopedItem<VisitorRow>(event, scope, 'visitors', id, {
      fields: JOURNEY_FIELDS,
    })
    const names = await branchNames(event, scope)
    // Resolve the journey vocabulary server-side so the UI renders stage keys,
    // never bare uuids. A missing stages collection fails the journey cards,
    // not the whole page.
    let journeyStageKey: string | null
    let journeyStages: Array<{
      key: string
      name: string
      sequence: number
      requires_pack: boolean
      requires_visit_outcome: boolean
    }>
    try {
      const stages = await loadJourneyStages(event, scope)
      journeyStages = stages.map((stage) => ({
        key: stage.key,
        name: stage.name,
        sequence: stage.sequence,
        requires_pack: stage.requires_pack,
        requires_visit_outcome: stage.requires_visit_outcome,
      }))
      const current = row.journey_stage
        ? String((row as unknown as Record<string, unknown>).journey_stage)
        : null
      journeyStageKey =
        stages.find((stage) => String(stage.id) === current)?.key ??
        (current && journeyStages.some((stage) => stage.key === current) ? current : null)
    } catch {
      journeyStageKey = null
      journeyStages = []
    }
    return {
      ...row,
      id: String(row.id),
      branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
      person_name: null,
      journey_stage_key: journeyStageKey,
      journey_stages: journeyStages,
    }
  },
)
