import { z } from 'zod'
import type { TaskPriority } from './office'

/**
 * Task templates (AFC-668): recurring checklists such as the marriage
 * process or an event programme. A template is a named list of steps; each
 * step carries a title, a default priority and a due-date offset in days
 * relative to a base date the user picks (wedding date, event start, …).
 * Negative offsets land before the base date, positive ones after.
 *
 * Templates live in code, not in the database: staging DDL is frozen, and a
 * checklist is a workflow definition, not tenant data. Applying a template
 * fans out to ordinary POST /api/tasks rows (or the from-template
 * endpoint), so permissions, validation and the audit trail are unchanged.
 * `relatedType` lets generated tasks link back to the record they serve
 * (tasks.related_type / related_id), e.g. an event checklist links each
 * task to its event.
 */
export interface TaskTemplateStep {
  title: string
  priority: TaskPriority
  /** Days relative to the base date. Negative = before, positive = after. */
  dueOffsetDays: number | null
}

export interface TaskTemplate {
  id: string
  label: string
  description: string
  /** tasks.related_type value stamped on generated rows. */
  relatedType: string
  steps: TaskTemplateStep[]
}

export const TASK_TEMPLATES: readonly TaskTemplate[] = [
  {
    id: 'marriage_process',
    label: 'Marriage process',
    description:
      'Counselling, consent, documentation, committee review and ceremony prep, anchored on the wedding date.',
    relatedType: 'marriage',
    steps: [
      { title: 'Book initial counselling session', priority: 'high', dueOffsetDays: -60 },
      { title: 'Confirm sponsor and guardian consent', priority: 'high', dueOffsetDays: -45 },
      { title: 'Verify documentation (IDs, certificates)', priority: 'high', dueOffsetDays: -30 },
      { title: 'Marriage committee review', priority: 'normal', dueOffsetDays: -21 },
      { title: 'Complete pre-marital counselling', priority: 'high', dueOffsetDays: -14 },
      { title: 'Confirm ceremony logistics (venue, officiant)', priority: 'normal', dueOffsetDays: -7 },
      { title: 'File post-ceremony registration', priority: 'normal', dueOffsetDays: 3 },
    ],
  },
  {
    id: 'event_programme',
    label: 'Event programme',
    description:
      'Venue, publicity, registration, volunteers, rehearsal and follow-up, anchored on the event start date.',
    relatedType: 'event',
    steps: [
      { title: 'Secure venue and permits', priority: 'high', dueOffsetDays: -30 },
      { title: 'Publish publicity and comms', priority: 'high', dueOffsetDays: -21 },
      { title: 'Open registration', priority: 'high', dueOffsetDays: -14 },
      { title: 'Confirm volunteer roster', priority: 'normal', dueOffsetDays: -7 },
      { title: 'Print programme materials', priority: 'normal', dueOffsetDays: -3 },
      { title: 'Run rehearsal and sound check', priority: 'normal', dueOffsetDays: -2 },
      { title: 'Send follow-up messages', priority: 'low', dueOffsetDays: 2 },
      { title: 'File post-event reports', priority: 'normal', dueOffsetDays: 3 },
    ],
  },
]

export function getTaskTemplate(id: string): TaskTemplate | undefined {
  return TASK_TEMPLATES.find((template) => template.id === id)
}

/** Shift a YYYY-MM-DD base date by whole days, returning YYYY-MM-DD. */
export function shiftDate(baseDate: string, offsetDays: number): string {
  const [year, month, day] = baseDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + offsetDays)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface ExpandedTemplateStep extends TaskTemplateStep {
  due_date: string | null
}

/** Expand a template against a base date (null base = no due dates). */
export function expandTaskTemplate(
  template: TaskTemplate,
  baseDate: string | null,
): ExpandedTemplateStep[] {
  return template.steps.map((step) => ({
    ...step,
    due_date:
      baseDate && step.dueOffsetDays !== null
        ? shiftDate(baseDate, step.dueOffsetDays)
        : null,
  }))
}

const dateKey = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Base date must be YYYY-MM-DD')

/** POST /api/tasks/from-template body (AFC-668). */
export const taskFromTemplateSchema = z.object({
  template: z.string().trim().min(1, 'Template is required'),
  branch: z.string().trim().min(1, 'A branch is required'),
  base_date: dateKey.nullable().optional(),
  related_id: z.string().trim().min(1).max(36).nullable().optional(),
  assignee_user: z.string().trim().min(1).max(36).nullable().optional(),
  assignee_person: z.string().trim().min(1).max(36).nullable().optional(),
})
export type TaskFromTemplate = z.infer<typeof taskFromTemplateSchema>
