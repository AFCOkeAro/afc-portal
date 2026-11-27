import { createError, defineEventHandler, getRouterParam, setHeader } from 'h3'
import { ticketQrPng } from '../../../utils/ticket-delivery'

/**
 * Public QR image for a ticket code (AFC-1250).
 *
 * The payload is the raw `ticket_code` string exactly, matching
 * TicketQr.vue / KioskBadge.vue and the existing check-in scan path. No
 * signing, no URL wrapping, no lookup: a QR image is derivable from the code
 * alone, so this endpoint needs no database and leaks nothing beyond the code
 * the email already carries. The text code in the email remains the typed
 * fallback when a client blocks remote images.
 */
export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'code')
  const code = typeof raw === 'string' ? raw.trim() : ''
  if (!code || code.length > 64 || !/^[A-Za-z0-9._-]+$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid ticket code is required' })
  }
  const png = ticketQrPng(code)
  setHeader(event, 'Content-Type', 'image/png')
  setHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable')
  return Buffer.from(png)
})
