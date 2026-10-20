/**
 * Sunday services + roster (AFC-473, data-model §4.3/§4.4).
 *
 * `service_type` here is the §4.3 service set (sunday, midweek, special,
 * camp) -- not the eleven-key service_type_definitions set (§3.1), which
 * classifies attendance sessions and drives the capture form's category
 * resolution. Conflating them would corrupt the split capture, so the two
 * enums stay in different modules on purpose.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText } from './common'

export const SUNDAY_SERVICE_TYPES = ['sunday', 'midweek', 'special', 'camp'] as const

export type SundayServiceType = (typeof SUNDAY_SERVICE_TYPES)[number]

export const SUNDAY_SERVICE_STATUSES = ['planned', 'completed'] as const

export type SundayServiceStatus = (typeof SUNDAY_SERVICE_STATUSES)[number]

/** The ten roster roles from §4.4, in document order. */
export const SERVICE_ROLES = [
  'worship_leader',
  'preacher',
  'usher',
  'media',
  'sound',
  'children',
  'welcome',
  'prayer',
  'offering',
  'communion',
] as const

export type ServiceRole = (typeof SERVICE_ROLES)[number]

export const ASSIGNMENT_STATUSES = ['invited', 'confirmed', 'declined'] as const

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

export const SERVICE_EVENT_TYPES = [
  'created',
  'assigned',
  'status_changed',
  'note',
] as const

export type ServiceEventType = (typeof SERVICE_EVENT_TYPES)[number]

export const sundayServiceFormSchema = z.object({
  branch: optionalText(36),
  zone: optionalText(36),
  service_date: dateSchema,
  service_time: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM')
    .optional(),
  service_type: z.enum(SUNDAY_SERVICE_TYPES).default('sunday'),
  theme: optionalText(200),
  preacher: optionalText(36),
  expected_attendance: z.coerce.number().int().min(0).optional(),
  status: z.enum(SUNDAY_SERVICE_STATUSES).default('planned'),
  notes: optionalNote(),
})

export type SundayServiceForm = z.infer<typeof sundayServiceFormSchema>

export const serviceAssignmentFormSchema = z.object({
  service: z.string().trim().min(1).max(64),
  person: z.string().trim().min(1).max(64),
  role: z.enum(SERVICE_ROLES),
  status: z.enum(ASSIGNMENT_STATUSES).default('invited'),
  notes: optionalNote(),
})

export type ServiceAssignmentForm = z.infer<typeof serviceAssignmentFormSchema>

export const assignmentStatusSchema = z.object({
  status: z.enum(ASSIGNMENT_STATUSES),
  notes: optionalNote(),
})

export type AssignmentStatusForm = z.infer<typeof assignmentStatusSchema>
