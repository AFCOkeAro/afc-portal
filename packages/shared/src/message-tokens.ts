/**
 * Message template tokens (AFC-904).
 *
 * Token syntax is `{{token}}` (double braces, lowercase letters, digits,
 * underscores), matching the seeded `message_templates` bodies. Tokens let a
 * single approved template read personally for every recipient, e.g.
 * `Dear {{invitee_name}}, how are you doing?`
 *
 * Pure: no I/O, safe for the worker, the UI preview, and contract tests.
 * Unresolved tokens render as empty text and are reported in `missing`, so
 * the strict caller (WhatsApp) can refuse instead of sending a broken
 * greeting. Nothing here sends, stores, or logs message content.
 */

export const TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

/** Tokens every recipient carries: name and branch for personalisation. */
export const PERSON_TOKENS = ['invitee_name', 'first_name', 'branch_name'] as const
export type PersonToken = (typeof PERSON_TOKENS)[number]

export interface PersonTokenSource {
  inviteeName?: string | null
  firstName?: string | null
  branchName?: string | null
}

/** Resolve the canonical person tokens from a recipient record. */
export function personTokenValues(
  source: PersonTokenSource,
): Record<PersonToken, string> {
  const full = (source.inviteeName ?? '').trim()
  const firstPart = full.split(/\s+/).filter(Boolean)[0] || ''
  const first = (source.firstName ?? '').trim() || firstPart
  return {
    invitee_name: full,
    first_name: first,
    branch_name: (source.branchName ?? '').trim(),
  }
}

/** Unique token names in order of first appearance. */
export function extractTokens(body: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const match of (body ?? '').matchAll(TOKEN_PATTERN)) {
    const name: string | undefined = match[1]
    if (typeof name !== 'string' || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export interface RenderResult {
  /** Body with every known token substituted; unknown tokens render empty. */
  text: string
  /** Token names with no usable value, in order of first appearance. */
  missing: string[]
}

/**
 * Substitute `{{token}}` placeholders. A value that is null, undefined, or
 * blank counts as missing and renders as empty text.
 */
export function renderMessageTemplate(
  body: string,
  values: Record<string, string | null | undefined>,
): RenderResult {
  const missing: string[] = []
  const seenMissing = new Set<string>()
  const text = (body ?? '').replace(TOKEN_PATTERN, (_all, name: string) => {
    const value = (values[name] ?? '').trim()
    if (value === '' && !seenMissing.has(name)) {
      seenMissing.add(name)
      missing.push(name)
    }
    return value
  })
  return { text, missing }
}

export interface TokenValidation {
  ok: boolean
  /** Body tokens outside the template's declared variables. */
  unknown: string[]
}

/** A template body may only use tokens from its declared variables list. */
export function validateTemplateTokens(
  body: string,
  allowed: readonly string[],
): TokenValidation {
  const allow = new Set(allowed ?? [])
  const unknown = extractTokens(body).filter((name) => !allow.has(name))
  return { ok: unknown.length === 0, unknown }
}

export type WhatsappReadiness =
  | 'ready'
  | 'no_template'
  | 'template_not_approved'
  | 'unknown_tokens'
  | 'unresolved_tokens'

export interface WhatsappTemplateCheck {
  ready: boolean
  reason: WhatsappReadiness
  detail: string
}

/**
 * Compulsory WhatsApp template rule: a WhatsApp send must name an approved
 * template whose tokens are all declared and all resolvable for the
 * recipient. Anything else is refused before any send is queued.
 */
export function whatsappTemplateReady(input: {
  templateBody: string | null
  approvalStatus: string | null
  providerTemplateId: string | null
  allowedVariables: readonly string[]
  values: Record<string, string | null | undefined>
}): WhatsappTemplateCheck {
  if (!input.templateBody || input.templateBody.trim() === '') {
    return {
      ready: false,
      reason: 'no_template',
      detail: 'WhatsApp needs a message template — pick an approved one.',
    }
  }
  if (input.approvalStatus !== 'approved' || !input.providerTemplateId?.trim()) {
    return {
      ready: false,
      reason: 'template_not_approved',
      detail: 'This WhatsApp template is not approved yet, so it cannot send.',
    }
  }
  const validation = validateTemplateTokens(input.templateBody, input.allowedVariables)
  if (!validation.ok) {
    return {
      ready: false,
      reason: 'unknown_tokens',
      detail: `Remove unknown ${validation.unknown.length === 1 ? 'token' : 'tokens'}: ${validation.unknown.join(', ')}.`,
    }
  }
  const rendered = renderMessageTemplate(input.templateBody, input.values)
  if (rendered.missing.length > 0) {
    return {
      ready: false,
      reason: 'unresolved_tokens',
      detail: `Missing ${rendered.missing.length === 1 ? 'value' : 'values'} for: ${rendered.missing.join(', ')}.`,
    }
  }
  return {
    ready: true,
    reason: 'ready',
    detail: 'Template approved and every token resolves.',
  }
}
