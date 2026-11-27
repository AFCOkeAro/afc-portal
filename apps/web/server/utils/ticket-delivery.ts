import { deflateSync } from 'node:zlib'
import { encodeQR } from '@paulmillr/qr'
import { createEvent } from 'ics'

/**
 * QR ticket delivery builders — email + WhatsApp (AFC-1250).
 *
 * FREE event, Nuxt + Directus. The Directus Flow assigns `ticket_code`
 * (UNIQUE, NULL until the Flow runs; see 20261020_0021 header choice 4).
 * `register.post.ts` returns that column as-is, so it may be null on the
 * first response. Decision, documented here per the issue:
 *
 *   - Nuxt does NOT assign the code and does NOT poll the Flow. A bounded
 *     read-back inside an anonymous proxy would turn one registration into
 *     N privileged reads and still race the Flow.
 *   - The confirmation send is Flow-triggered: after the Flow stamps
 *     `ticket_code`, it renders this module's email (same builders the
 *     contract test pins) and sends via the SMTP transport. The text code
 *     stays the source of truth; the QR is convenience.
 *   - A staff resend path reuses the same builders and refuses when
 *     `ticket_code` is still null (`ticket_not_ready`), so staff know to
 *     wait for the Flow rather than sending a codeless ticket.
 *
 * QR contract (matches TicketQr.vue + KioskBadge.vue, AFC-828/AFC-985):
 * the payload is the raw `ticket_code` string exactly — no signing, no
 * URL wrapping, no new crypto. Scan verifies via the existing
 * POST /api/events/[id]/check-in (exact ticket or single-name match,
 * typed fallback works when the camera cannot read the code).
 *
 * WhatsApp (integrations-spec §5): Meta Cloud API via BSP. Business-
 * initiated messages need a provider-approved template
 * (`approval_status = approved` + non-blank `provider_template_id`,
 * same gate as campaign-tick.ts `templateAllowed`). Consent is explicit
 * opt-in; minors need guardian consent (same rule as
 * `comms_resolve_consent` / reachable.get.ts). Per-message cost is
 * recorded on the communications row; a WhatsApp refusal or send
 * failure falls back to email. Rate limits are honoured by the caller
 * (see WHATSAPP_MAX_SENDS_PER_MINUTE). No secrets in code: the BSP
 * token / phone-number id live only in env (see .env.example).
 *
 * Retention-gate note: this file deals in counts only, never in quoted
 * duration strings, and the engine reads no table created here.
 *
 * Board amendment 2026-11-27 (applies on top of the above):
 *   - .ics is generated server-side with the `ics` npm package (no
 *     hand-rolled folding/escaping): `buildTicketIcs` delegates escaping +
 *     folding to `createEvent` and only tags the TZID. Dates come from the
 *     `events` row (source of truth, no hardcoded times); TZID
 *     `Africa/Lagos` (WAT, no DST). Single multi-day VEVENT (DTSTART Dec 25,
 *     DTEND exclusive Dec 29 for YSTC26, or per event times); stable UID
 *     from `ticket_code`; ORGANIZER `YDD Lagos North`; DESCRIPTION = name +
 *     code + event facts only (F3: never DOB/medical/allergies/emergency
 *     contacts; QR = code only).
 *   - Email is the guarantee: `shouldSendTicketEmail` is true whenever a
 *     stored address exists, even with WhatsApp opt-in. WhatsApp is
 *     best-effort via the approved template; its body carries code + QR +
 *     calendar-prompt text, never the .ics (templates cannot carry files).
 *   - F1: the recipient is derived only from the stored registration row
 *     (one send per registration id; `resolveTicketSend` refuses
 *     `already_sent`); there is deliberately NO standalone resend endpoint
 *     in this slice — a staff resend reuses the same builders against the
 *     stored row and refuses while the code is null (`ticket_not_ready`).
 *   - F2: WhatsApp needs the separate `whatsapp` opt-in checkbox; minors
 *     are contacted only via the guardian contact
 *     (`minor_no_guardian_consent` otherwise). `consentWhatsapp` and
 *     `consentSms` are independent flags, not one checkbox.
 *   - F4: `NUXT_WHATSAPP_TOKEN` is server-only (`runtimeConfig.whatsappToken`,
 *     never `runtimeConfig.public`); nothing in this module reads env, logs
 *     tokens, contacts, or send errors — it returns reasons for the caller
 *     to record without PII.
 *   - F5: sender stays display-name-only (`formatTicketFromHeader`);
 *     mailbox + reply-to + SPF/DKIM/DMARC untouched.
 */

export const TICKET_SENDER_DISPLAY_NAME = 'YDD Lagos North'

export const TICKET_EMAIL_TEMPLATE_KEY = 'ticket_confirmation'
export const TICKET_WHATSAPP_TEMPLATE_KEY = 'ticket_confirmation_wa'

export const TICKET_EMAIL_SUBJECT_PREFIX = 'Your ticket for'

/** Conservative per-number ceiling the caller enforces before sending. */
export const WHATSAPP_MAX_SENDS_PER_MINUTE = 20
/** WhatsApp unit cost is procurement-set; null means unset (no zero-guess). */
export type WhatsappUnitCost = number | null

export type TicketChannel = 'whatsapp' | 'email'

export type TicketDeliveryDecision =
  | { channel: 'whatsapp'; providerTemplateId: string; fallbackToEmail: false }
  | { channel: 'email'; fallbackToEmail: boolean; reason: TicketBlockReason }

export type TicketBlockReason =
  | 'no_consent'
  | 'minor_no_guardian_consent'
  | 'opted_out'
  | 'invalid_contact'
  | 'template_not_approved'
  | 'rate_limited'
  | 'whatsapp_failed'

export interface TicketRecipient {
  phone: string | null
  consentWhatsapp: boolean
  consentSms: boolean
  isMinor: boolean
  guardianConsent: boolean
  optedOut: boolean
}

export interface TicketTemplateRef {
  approvalStatus: string | null
  providerTemplateId: string | null
}

/** A ticket code is usable when it is a non-blank string. */
export function isTicketCodeUsable(ticketCode: unknown): ticketCode is string {
  return typeof ticketCode === 'string' && ticketCode.trim() !== ''
}

/**
 * Format the RFC 5322 From header with the ratified display name.
 * The mailbox stays the configured sender; only the display name is set
 * here so SPF/DKIM/DMARC and reply-to are untouched.
 */
export function formatTicketFromHeader(senderMailbox: string): string {
  const mailbox = (senderMailbox ?? '').trim()
  if (mailbox === '') return TICKET_SENDER_DISPLAY_NAME
  if (mailbox.includes('<') && mailbox.includes('>')) return mailbox
  return `${TICKET_SENDER_DISPLAY_NAME} <${mailbox}>`
}

/**
 * Encode the raw ticket code to the QR boolean matrix both the client
 * (TicketQr.vue) and this server module share. Fail-closed: blank input
 * yields an empty matrix and the caller falls back to the text code.
 */
export function ticketQrMatrix(ticketCode: string): boolean[][] {
  if (!isTicketCodeUsable(ticketCode)) return []
  try {
    return encodeQR(ticketCode, 'raw', { ecc: 'medium' }) as unknown as boolean[][]
  } catch {
    return []
  }
}

/**
 * Render the matrix as a standalone SVG string (same geometry as
 * TicketQr.vue: quiet zone of 2 modules, currentColor modules on white).
 * Embedded inline in the confirmation email so no image store is needed.
 */
export function ticketQrSvg(ticketCode: string): string {
  const cells = ticketQrMatrix(ticketCode)
  const size = cells.length
  if (size === 0) return ''
  const rects: string[] = []
  for (let y = 0; y < size; y++) {
    const row = cells[y] ?? []
    for (let x = 0; x < size; x++) {
      if (row[x]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`)
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${size + 4} ${size + 4}" ` +
    `width="200" height="200" role="img" aria-label="Registration QR code">` +
    `<rect x="-2" y="-2" width="${size + 4}" height="${size + 4}" fill="white"/>` +
    `<g fill="black">${rects.join('')}</g></svg>`
  )
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  for (let i = 0; i < 4; i++) crcInput[i] = type.charCodeAt(i)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/**
 * Render the matrix as a PNG buffer (1-bit grayscale, scaled modules).
 * Pure: matrix in, PNG bytes out. No file store, no network.
 */
export function ticketQrPng(ticketCode: string, scale = 8): Uint8Array {
  const cells = ticketQrMatrix(ticketCode)
  const modules = cells.length
  if (modules === 0) return new Uint8Array(0)
  const clampedScale = Math.min(Math.max(Math.floor(scale), 1), 16)
  const quiet = 2
  const dimension = (modules + quiet * 2) * clampedScale
  const rowBytes = Math.ceil(dimension / 8)
  const raw = new Uint8Array((rowBytes + 1) * dimension)
  const bitAt = (px: number, py: number): boolean => {
    const mx = Math.floor(px / clampedScale) - quiet
    const my = Math.floor(py / clampedScale) - quiet
    if (mx < 0 || my < 0 || mx >= modules || my >= modules) return false
    return cells[my]?.[mx] === true
  }
  for (let y = 0; y < dimension; y++) {
    const offset = y * (rowBytes + 1)
    raw[offset] = 0
    for (let x = 0; x < dimension; x++) {
      if (!bitAt(x, y)) {
        const byteIndex = offset + 1 + (x >> 3)
        raw[byteIndex] = (raw[byteIndex] ?? 0) | (0x80 >> (x & 7))
      }
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, dimension)
  view.setUint32(4, dimension)
  ihdr[8] = 1
  ihdr[9] = 0
  const compressed = deflateSync(raw)
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
  return concatBytes([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', new Uint8Array(compressed)),
    pngChunk('IEND', new Uint8Array(0)),
  ])
}

/** PNG bytes as a data URL for the email `<img>` tag. Empty when no code. */
export function ticketQrPngDataUrl(ticketCode: string, scale = 8): string {
  const png = ticketQrPng(ticketCode, scale)
  if (png.length === 0) return ''
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

export interface TicketEmail {
  subject: string
  text: string
  html: string
}

/** Lagos wall-clock zone for the .ics VEVENT (WAT, UTC+1, no DST). */
export const TICKET_EVENT_TIMEZONE = 'Africa/Lagos'
/** Organizer display name for the .ics VEVENT (mailbox comes from config). */
export const TICKET_ORGANIZER_NAME = 'YDD Lagos North'
/** Attachment filename the Flow uses for the confirmation email. */
export const TICKET_ICS_FILENAME = 'ticket.ics'

export interface TicketCalendarInput {
  eventName: string
  registrantName: string
  ticketCode: string
  /** From the `events` row (source of truth). No hardcoded times here. */
  startsAt: string | Date
  /** Exclusive end from the `events` row. */
  endsAt: string | Date
  location?: string
  /** Mailbox of the configured church sender (organizer email). */
  organizerEmail?: string
}

/** Wall-time parts of an instant in Africa/Lagos (for the .ics local arrays). */
function lagosDateParts(instant: Date): [number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TICKET_EVENT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant)
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return [get('year'), get('month'), get('day'), get('hour'), get('minute')]
}

/** UTC stamp for Add-to-Calendar links: YYYYMMDDTHHmmssZ. */
export function toUtcCalendarStamp(instant: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${instant.getUTCFullYear()}${pad(instant.getUTCMonth() + 1)}${pad(instant.getUTCDate())}` +
    `T${pad(instant.getUTCHours())}${pad(instant.getUTCMinutes())}${pad(instant.getUTCSeconds())}Z`
  )
}

function parseInstant(value: string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Add-to-Calendar fallback links (email body). UTC dates; the .ics carries
 * the Lagos TZID. Pure: instants in, URL strings out.
 */
export function buildTicketCalendarLinks(input: {
  eventName: string
  startsAt: string | Date
  endsAt: string | Date
  details?: string
}): { google: string; outlook: string } {
  const start = parseInstant(input.startsAt) ?? new Date()
  const end = parseInstant(input.endsAt) ?? new Date(start.getTime() + 3600_000)
  const eventName = (input.eventName ?? '').trim() || 'the event'
  const details = input.details ?? `Ticket for ${eventName}. Show the QR at the door or type the code.`
  const dates = `${toUtcCalendarStamp(start)}/${toUtcCalendarStamp(end)}`
  const google =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(eventName)}&dates=${dates}` +
    `&details=${encodeURIComponent(details)}`
  const outlook =
    'https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent' +
    `&subject=${encodeURIComponent(eventName)}` +
    `&startdt=${encodeURIComponent(start.toISOString())}` +
    `&enddt=${encodeURIComponent(end.toISOString())}` +
    `&body=${encodeURIComponent(details)}`
  return { google, outlook }
}

/**
 * Build the `createEvent` args for the confirmation .ics. Folding/escaping
 * stays inside the `ics` package; this function only shapes the fields.
 * DESCRIPTION is name + code + event facts only (F3 — never DOB, medical,
 * allergies, or emergency contacts). UID is stable from the ticket_code so
 * a re-send updates the same VEVENT instead of forking it.
 */
export function buildTicketIcsArgs(input: TicketCalendarInput): Record<string, unknown> {
  const eventName = (input.eventName ?? '').trim() || 'the event'
  const name = (input.registrantName ?? '').trim() || 'Guest'
  const code = input.ticketCode
  const start = parseInstant(input.startsAt) ?? new Date()
  const end = parseInstant(input.endsAt) ?? new Date(start.getTime() + 3600_000)
  const description =
    `Hello ${name}, you are registered for ${eventName}. ` +
    `Ticket code: ${code}. Show this QR at the door, or type the code if the camera cannot read it.`
  const args: Record<string, unknown> = {
    start: lagosDateParts(start),
    end: lagosDateParts(end),
    startInputType: 'local',
    startOutputType: 'local',
    endInputType: 'local',
    endOutputType: 'local',
    title: eventName,
    description,
    location: (input.location ?? '').trim() || undefined,
    uid: `${code}@ydd-lagos-north`,
    organizer: { name: TICKET_ORGANIZER_NAME, email: (input.organizerEmail ?? '').trim() || undefined },
    calName: eventName,
  }
  return args
}

/**
 * Generate the .ics file content server-side via the `ics` package.
 * Throws on invalid input or `createEvent` error (caller maps to email-only
 * send — the .ics never blocks the guaranteed email). The TZID tag is the
 * only post-processing; folding/escaping is the library's.
 */
export function buildTicketIcs(input: TicketCalendarInput): string {
  if (!isTicketCodeUsable(input.ticketCode)) throw new Error('ticket ics: ticket_code missing')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, value } = createEvent(buildTicketIcsArgs(input) as any)
  if (error || !value) throw new Error(`ticket ics: ${error?.message ?? 'createEvent failed'}`)
  return value
    .replace('DTSTART:', `DTSTART;TZID=${TICKET_EVENT_TIMEZONE}:`)
    .replace('DTEND:', `DTEND;TZID=${TICKET_EVENT_TIMEZONE}:`)
}

/** Email is the guarantee: send whenever a stored address exists. */
export function shouldSendTicketEmail(emailAddress: string | null | undefined): boolean {
  return typeof emailAddress === 'string' && emailAddress.trim() !== ''
}

export type TicketSendRefusal = 'ticket_not_ready' | 'already_sent' | 'missing_recipient'

/**
 * F1 single-send guard: one send per registration id, recipient from the
 * stored row only. `alreadySent` comes from the communications log, never
 * from a client flag. No standalone resend endpoint in this slice.
 */
export function resolveTicketSend(input: {
  ticketCode: unknown
  emailAddress: string | null | undefined
  alreadySent: boolean
}): { allowed: true } | { allowed: false; reason: TicketSendRefusal } {
  if (input.alreadySent) return { allowed: false, reason: 'already_sent' }
  if (!isTicketCodeUsable(input.ticketCode)) return { allowed: false, reason: 'ticket_not_ready' }
  if (!shouldSendTicketEmail(input.emailAddress)) return { allowed: false, reason: 'missing_recipient' }
  return { allowed: true }
}

/**
 * WhatsApp body: code + QR note + calendar prompt. Never the .ics bytes —
 * provider templates cannot carry files, so the email stays the calendar
 * carrier and WhatsApp stays best-effort text.
 */
export function buildTicketWhatsappText(input: {
  eventName: string
  registrantName: string
  ticketCode: string
}): string {
  const eventName = (input.eventName ?? '').trim() || 'the event'
  const name = (input.registrantName ?? '').trim() || 'Guest'
  return (
    `Hello ${name}, you are registered for ${eventName}. ` +
    `Your ticket code is ${input.ticketCode}. Show the QR or type the code at the door. ` +
    `Your confirmation email carries the ticket plus an Add to Calendar link.`
  )
}

/**
 * Build the confirmation email. The QR encodes the raw code; the text
 * code is always present so a broken camera still checks in by typing.
 * Calendar links ride in the body as the fallback; the .ics attachment is
 * added by the Flow (same builders, `TICKET_ICS_FILENAME`).
 */
export function buildTicketEmail(input: {
  eventName: string
  registrantName: string
  ticketCode: string
  calendarLinks?: { google: string; outlook: string }
}): TicketEmail {
  const eventName = (input.eventName ?? '').trim() || 'the event'
  const name = (input.registrantName ?? '').trim() || 'Guest'
  const code = input.ticketCode
  const links =
    input.calendarLinks ??
    buildTicketCalendarLinks({
      eventName,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600_000),
      details: `Ticket for ${eventName}. Show the QR at the door or type the code.`,
    })
  const subject = `${TICKET_EMAIL_SUBJECT_PREFIX} ${eventName}`
  const text =
    `Hello ${name},\n\n` +
    `You are registered for ${eventName}.\n` +
    `Show this QR at the door, or type the code if the camera cannot read it.\n\n` +
    `Ticket code: ${code}\n\n` +
    `Add to calendar:\nGoogle: ${links.google}\nOutlook: ${links.outlook}\n\n` +
    `Please keep this ticket and take your seat.`
  const qr = ticketQrSvg(code)
  const pngUrl = ticketQrPngDataUrl(code)
  const img = pngUrl !== '' ? `<img src="${pngUrl}" alt="Registration QR code" width="200" height="200"/>` : qr
  const html =
    `<p>Hello ${escapeHtml(name)},</p>` +
    `<p>You are registered for ${escapeHtml(eventName)}.</p>` +
    `<p>Show this QR at the door, or type the code if the camera cannot read it.</p>` +
    img +
    `<p><strong>Ticket code: ${escapeHtml(code)}</strong></p>` +
    `<p>Add to calendar: <a href="${escapeHtml(links.google)}">Google Calendar</a> · ` +
    `<a href="${escapeHtml(links.outlook)}">Outlook</a>. ` +
    `The confirmation email also carries a calendar file (${escapeHtml(TICKET_ICS_FILENAME)}).</p>` +
    `<p>Please keep this ticket and take your seat.</p>`
  return { subject, text, html }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Template gate: WhatsApp needs approved + provider id (campaign-tick twin). */
export function ticketTemplateAllowed(template: TicketTemplateRef): boolean {
  return (
    template.approvalStatus === 'approved' &&
    typeof template.providerTemplateId === 'string' &&
    template.providerTemplateId.trim() !== ''
  )
}

/**
 * Decide the delivery channel for one ticket. WhatsApp only when every
 * gate passes; otherwise email with the blocking reason recorded so the
 * communications log can audit the fallback. Nothing here sends.
 */
export function resolveTicketChannel(input: {
  recipient: TicketRecipient
  template: TicketTemplateRef
  sendsThisMinute: number
  whatsappFailed?: boolean
}): TicketDeliveryDecision {
  const { recipient, template } = input
  if (input.whatsappFailed === true) {
    return { channel: 'email', fallbackToEmail: true, reason: 'whatsapp_failed' }
  }
  if (input.sendsThisMinute >= WHATSAPP_MAX_SENDS_PER_MINUTE) {
    return { channel: 'email', fallbackToEmail: true, reason: 'rate_limited' }
  }
  if (!ticketTemplateAllowed(template)) {
    return { channel: 'email', fallbackToEmail: true, reason: 'template_not_approved' }
  }
  if (recipient.optedOut) {
    return { channel: 'email', fallbackToEmail: true, reason: 'opted_out' }
  }
  if (recipient.isMinor && !recipient.guardianConsent) {
    return { channel: 'email', fallbackToEmail: true, reason: 'minor_no_guardian_consent' }
  }
  const phoneDigits = (recipient.phone ?? '').replace(/\D/g, '')
  if (phoneDigits.length < 7) {
    return { channel: 'email', fallbackToEmail: true, reason: 'invalid_contact' }
  }
  if (!recipient.consentWhatsapp) {
    return { channel: 'email', fallbackToEmail: true, reason: 'no_consent' }
  }
  return {
    channel: 'whatsapp',
    providerTemplateId: (template.providerTemplateId ?? '').trim(),
    fallbackToEmail: false,
  }
}

/**
 * Estimate the communications-row cost for one ticket send. Null rate
 * (procurement unset) reports null, never a zero-guess.
 */
export function estimateTicketCost(unitCost: WhatsappUnitCost): number | null {
  if (unitCost === null) return null
  if (!Number.isFinite(unitCost) || unitCost < 0) {
    throw new Error('ticket delivery: unit cost must be non-negative')
  }
  return unitCost
}
