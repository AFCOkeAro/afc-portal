import { z } from 'zod'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
  updateItem,
} from '../../../utils/portal'
import { resolveTaskPeople, writeOfficeAudit } from '../../../utils/office'

const raciSchema = z.object({
  raci_responsible: z.string().uuid().nullish(),
  raci_accountable: z.string().uuid().nullish(),
  raci_consulted: z.string().uuid().nullish(),
  raci_informed: z.string().uuid().nullish(),
})

/**
 * PATCH /api/tasks/:id/raci — name the RACI ring (AFC-833). Null clears a
 * seat; omitted keys are left alone. Scoped like the status move (the task
 * must be in the caller's scope) and audited distinctly as raci_changed.
 * RACI refs are person ids; the register holds them even where the people
 * table is absent (bare uuids, 0013 §4 pattern) — the route does not
 * second-guess membership, it records the assignment.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'tasks', 'update')

  const parsed = raciSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const id = String(getRouterParam(event, 'id'))
  await findScopedItem(event, scope, 'tasks', id, { scope: scopeFilter(scope) })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of [
    'raci_responsible',
    'raci_accountable',
    'raci_consulted',
    'raci_informed',
  ] as const) {
    const value = form[key]
    if (value !== undefined) patch[key] = value
  }

  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'tasks',
    id,
    patch,
  )

  await writeOfficeAudit(event, scope, 'task_events', {
    task: id,
    event_type: 'raci_changed',
    detail: `RACI → R:${form.raci_responsible ?? '—'} A:${form.raci_accountable ?? '—'} C:${form.raci_consulted ?? '—'} I:${form.raci_informed ?? '—'}`,
    actor_user: scope.session.user.id,
    created_at: new Date().toISOString(),
  })

  const { ownerByTask, personNames } = await resolveTaskPeople(event, scope, [
    updated as Record<string, unknown>,
  ])
  const nameOf = (value: unknown): string | null =>
    typeof value === 'string' ? (personNames.get(value) ?? null) : null
  return {
    data: {
      ...updated,
      owner_name: ownerByTask.get(String(id)) ?? null,
      raci_names: {
        responsible: nameOf(form.raci_responsible ?? updated.raci_responsible),
        accountable: nameOf(form.raci_accountable ?? updated.raci_accountable),
        consulted: nameOf(form.raci_consulted ?? updated.raci_consulted),
        informed: nameOf(form.raci_informed ?? updated.raci_informed),
      },
    },
  }
})
