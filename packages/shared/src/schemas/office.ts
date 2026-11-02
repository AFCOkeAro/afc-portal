import { z } from 'zod'

const dateSchema = z.string().min(1)
const timeSchema = z.string().min(1).optional()
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(''))
const optionalNote = () => z.string().max(4000).optional().or(z.literal(''))
const branchRef = z.string().uuid().optional().or(z.literal(''))

export const minutesFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200),
    meeting_date: dateSchema,
    start_time: timeSchema.optional(),
    end_time: timeSchema.optional(),
    location: optionalText(255),
    body: optionalNote(),
    file: optionalText(36),
    branch: branchRef,
  })
  .refine((v: any) => !v.start_time || !v.end_time || v.end_time > v.start_time, {
    message: 'The end time must be after the start time',
    path: ['end_time'],
  })

export type MinutesForm = z.infer<typeof minutesFormSchema>

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
