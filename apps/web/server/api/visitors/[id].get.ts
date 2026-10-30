import type { VisitorRow } from '../../../types/portal'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
} from '../../utils/portal'
import { JOURNEY_FIELDS, loadJourneyStages } from '../../utils/visitor-journey'

export default defineEventHandler(
  async (
    event,
  ): Promise<
    VisitorRow & {
      campaign_name: string | null
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

    // AFC-583: the detail read hits the 0025 register — map an unreadable
    // store to the named error, never a bare 500. Deliberate 4xx (scope
    // 404s) pass through; the journey-vocabulary enrichment below keeps its
    // own fail-soft try.
    let row: VisitorRow
    try {
      row = await findScopedItem<VisitorRow>(event, scope, 'visitors', id, {
        fields: JOURNEY_FIELDS,
      })
    } catch (error) {
      if ((error as { statusCode?: number })?.statusCode) throw error
      throwStoreUnavailable(error, 'visitor_store', '0025')
    }
    const names = await branchNames(event, scope)
    // Resolve the source campaign server-side so the UI renders names,
    // never bare uuids. A missing campaign fails the label, never the page.
    let campaignName: string | null = null
    const campaignId = row.campaign
    if (typeof campaignId === 'string' && campaignId !== '') {
      try {
        const found = await listItems<Record<string, unknown>>(
          event,
          scope,
          'campaigns',
          {
            filter: { id: { _eq: campaignId } },
            fields: ['id', 'name'],
            limit: 1,
          },
        )
        campaignName = String(found.data[0]?.name ?? '') || null
      } catch {
        campaignName = null
      }
    }
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
      campaign_name: campaignName,
      journey_stage_key: journeyStageKey,
      journey_stages: journeyStages,
    }
  },
)
