/**
 * Per-event expenses (AFC-801, parent AFC-756).
 *
 * A form sends what the recorder typed, which is not the row: the amount
 * arrives as a decimal string (Postgres `numeric(12,2)` is not a float),
 * `spent_on` as a `YYYY-MM-DD` date, and branch/zone/recorded_by are
 * server-stamped from the parent event and the session -- never
 * client-sent. The category enum and the other-label pairing mirror the
 * 0044 CHECKs; the route rejects what the database would reject, with a
 * 400 that names the field instead of a 503.
 */
import { z } from 'zod'
import { dateSchema, optionalNote, optionalText, uuidSchema } from './common'
import { requiredMoneySchema } from './weca'

/** Seed keys for expense_categories (AFC-825: the register, seeded by
 * 0045, is the authority; the route rejects unknown keys. Kept for the
 * form fallback when the categories endpoint is unreachable). */
export const EXPENSE_CATEGORIES = [
  'venue',
  'feeding',
  'transport',
  'publicity',
  'honorarium',
  'equipment',
  'welfare',
  'other',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

/** events.currency precedent (NGN/USD/GBP); the 0044 default is NGN. */
const EXPENSE_CURRENCIES = ['NGN', 'USD', 'GBP'] as const

export const expenseFormSchema = z
  .object({
    // AFC-825: register-backed (expense_categories). The route verifies
    // the key exists and names unknown_category otherwise; the enum is
    // gone on purpose so admin-added categories validate.
    category: z.string().trim().min(1).max(60),
    category_other_label: optionalText(120),
    amount: requiredMoneySchema,
    currency: z.enum(EXPENSE_CURRENCIES).default('NGN'),
    spent_on: dateSchema,
    receipt: uuidSchema.optional(),
    notes: optionalNote(),
  })
  .superRefine((form, ctx) => {
    if (form.category === 'other') {
      if (!form.category_other_label || form.category_other_label.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['category_other_label'],
          message: 'Describe the expense when the category is Other',
        })
      }
    } else if (form.category_other_label !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['category_other_label'],
        message: 'Only Other expenses carry a description',
      })
    }
  })

export type ExpenseForm = z.infer<typeof expenseFormSchema>
export type ExpenseFormInput = z.input<typeof expenseFormSchema>

/**
 * Row payload for `event_expenses`. Scope (branch/zone) and attribution
 * (recorded_by) are stamped by the route, never taken from the form.
 */
export function toExpensePayload(
  form: ExpenseForm,
  scope: { branch: string | null; zone: string | null; recordedBy: string },
): Record<string, unknown> {
  return {
    category: form.category,
    category_other_label: form.category_other_label ?? null,
    amount: form.amount,
    currency: form.currency,
    spent_on: form.spent_on,
    receipt: form.receipt ?? null,
    notes: form.notes ?? null,
    branch: scope.branch,
    zone: scope.zone,
    recorded_by: scope.recordedBy,
  }
}

/**
 * Per-event budget line (AFC-825). Latest row per (event, category) wins;
 * the route resolves that, so the form never edits — it only plans.
 */
export const budgetFormSchema = z.object({
  category_key: z.string().trim().min(1).max(60),
  amount: requiredMoneySchema,
  notes: optionalNote(),
})

export type BudgetForm = z.infer<typeof budgetFormSchema>

/** Row payload for `event_budgets`. Attribution is route-stamped. */
export function toBudgetPayload(
  form: BudgetForm,
  scope: { event: string; recordedBy: string },
): Record<string, unknown> {
  return {
    event: scope.event,
    category_key: form.category_key,
    amount: form.amount,
    notes: form.notes ?? null,
    recorded_by: scope.recordedBy,
  }
}
