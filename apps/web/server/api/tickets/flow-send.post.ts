import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import nodemailer from 'nodemailer'
import { directusFetch } from '../../utils/directus'
import { buildTicketIcs, ticketQrPng } from '../../utils/ticket-delivery'

interface RegistrationRow {
  id: string
  ticket_code: string | null
  registrant_first_name: string
  registrant_last_name: string
  email: string | null
  registration_status: string
  event: string
  ticket_email_sent_at: string | null
}

interface EventRow {
  id: string
  title: string
  start_at: string
  end_at: string
  location: string | null
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Flow-triggered ticket email (AFC-1250).
 *
 * The Directus Flow assigns `ticket_code`, then calls this route with the
 * registration id. The route reads the stored row (never a request-supplied
 * recipient), builds the QR PNG + .ics, sends via SMTP, and stamps
 * `ticket_email_sent_at` so a second call is `already_sent` (F1).
 *
 * QR: raw ticket_code exactly, matching TicketQr/KioskBadge and the check-in
 * scan path (no signing, no URL). It is inlined as a CID attachment so the
 * image renders without a remote-image fetch; the text code is the fallback.
 * .ics: attached, generated from the event row (no hardcoded dates), TZID
 * Africa/Lagos, organizer YDD Lagos North. DESCRIPTIONS carry name + code +
 * event facts only; no DOB, medical, allergies, or emergency contacts (F3).
 *
 * Auth: the Flow sends x-afc-flow-secret; the value is server-only env
 * (NUXT_TICKET_FLOW_SECRET), never in the client bundle or logs.
 */
export default defineEventHandler(async (event) => {
  const secret = String(process.env.NUXT_TICKET_FLOW_SECRET ?? '')
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ticket delivery is not configured',
      data: { code: 'ticket_delivery_unavailable' },
    })
  }
  if (getHeader(event, 'x-afc-flow-secret') !== secret) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: { code: 'unauthorized' },
    })
  }

  const body = (await readBody(event)) as Record<string, unknown> | null
  const registrationId = String(body?.registration_id ?? '').trim()
  if (!registrationId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A registration id is required',
      data: { code: 'registration_id_required' },
    })
  }

  const registrationResponse = await directusFetch<{ data: RegistrationRow }>(
    event,
    `/items/event_registrations/${registrationId}`,
    {
      query: {
        fields:
          'id,ticket_code,registrant_first_name,registrant_last_name,email,registration_status,event,ticket_email_sent_at',
      },
    },
  )
  const row = registrationResponse.data
  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Registration not found' })
  }
  if (!row.ticket_code || row.ticket_code.trim() === '') {
    throw createError({
      statusCode: 409,
      statusMessage: 'The ticket code is not ready',
      data: { code: 'ticket_not_ready' },
    })
  }
  if (!row.email || row.email.trim() === '') {
    throw createError({
      statusCode: 409,
      statusMessage: 'No stored email for this registration',
      data: { code: 'missing_recipient' },
    })
  }
  if (row.ticket_email_sent_at) {
    return { status: 'already_sent' }
  }

  const eventResponse = await directusFetch<{ data: EventRow }>(
    event,
    `/items/events/${row.event}`,
    { query: { fields: 'id,title,start_at,end_at,location' } },
  )
  const eventRow = eventResponse.data
  if (!eventRow) {
    throw createError({ statusCode: 502, statusMessage: 'Event facts unavailable' })
  }

  const png = Buffer.from(ticketQrPng(row.ticket_code))
  const ics = buildTicketIcs({
    eventName: eventRow.title,
    startsAt: eventRow.start_at,
    endsAt: eventRow.end_at,
    location: eventRow.location ?? '',
    ticketCode: row.ticket_code,
    registrantName: `${row.registrant_first_name} ${row.registrant_last_name}`.trim(),
    organizerEmail: 'events@afcokearo.org',
  })

  const name = `${row.registrant_first_name} ${row.registrant_last_name}`.trim()
  const code = row.ticket_code
  const status = row.registration_status
  const eventName = eventRow.title
  const from = String(process.env.NUXT_TICKET_FROM ?? 'YDD Lagos North <events@afcokearo.org>')
  const subject = `Your AFC Oke Aro ticket — ${code}`

  const html = `<div style="margin:0;padding:0;background:#F3F6FC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#090B19;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#1A63B4;border-radius:16px 16px 0 0;padding:28px;color:#ffffff;">
      <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.85;">AFC Oke Aro</div>
      <div style="font-size:26px;line-height:1.2;font-weight:700;margin-top:8px;">${esc(eventName)}</div>
      <div style="font-size:14px;opacity:.9;margin-top:8px;">Registration confirmed</div>
    </div>
    <div style="background:#ffffff;padding:28px;border:1px solid #E8F0FA;border-top:0;">
      <p style="margin:0 0 16px;font-size:16px;">Hi ${esc(name)},</p>
      <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Your registration has been received. Show this QR at the door, or type the ticket code if the camera cannot read it.</p>
      <div style="text-align:center;margin:0 0 20px;">
        <img src="cid:ticket-qr" alt="Ticket QR code" width="200" height="200" style="display:inline-block;width:200px;height:200px;border:8px solid #ffffff;border-radius:12px;background:#ffffff;" />
        <div style="font-size:12px;color:#525968;margin-top:8px;">Show this QR at check-in</div>
      </div>
      <div style="background:#F3F6FC;border-left:5px solid #F5BE00;border-radius:10px;padding:18px 20px;margin:0 0 24px;">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#525968;">Ticket code</div>
        <div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:#090B19;margin-top:6px;">${esc(code)}</div>
        <div style="font-size:14px;color:#525968;margin-top:8px;">Status: <strong style="color:#175A35;">${esc(status)}</strong></div>
      </div>
      <p style="margin:0 0 12px;font-weight:700;">Add to calendar</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">The calendar file (ticket.ics) is attached. Open it to add ${esc(eventName)} to your calendar.</p>
      <p style="margin:0 0 10px;font-weight:700;">What next?</p>
      <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.7;">
        <li>Save this email or screenshot your ticket code.</li>
        <li>Bring the QR or the ticket code to check-in.</li>
        <li>Reply to this email if your details change.</li>
      </ol>
      <p style="margin:0;font-size:14px;color:#525968;">Need help? Reply to this email or contact the events team at <a href="mailto:events@afcokearo.org" style="color:#1A63B4;">events@afcokearo.org</a>.</p>
    </div>
    <div style="background:#29186B;border-radius:0 0 16px 16px;padding:18px 28px;color:#ffffff;font-size:12px;line-height:1.5;">
      YDD Lagos North · events@afcokearo.org
    </div>
  </div>
</div>`

  const text =
    `Hello ${name},\n\n` +
    `You are registered for ${eventName}.\n` +
    `Ticket code: ${code}\n` +
    `Status: ${status}\n\n` +
    `Show the QR at the door, or type the ticket code if the camera cannot read it.\n` +
    `The attached ticket.ics adds the event to your calendar.\n\n` +
    `AFC Oke Aro\n`

  const smtpHost = String(process.env.NUXT_SMTP_HOST ?? '')
  const smtpPort = Number(process.env.NUXT_SMTP_PORT ?? 587)
  const smtpUser = String(process.env.NUXT_SMTP_USER ?? '')
  const smtpPassword = String(process.env.NUXT_SMTP_PASSWORD ?? '')
  if (!smtpHost || !smtpUser || !smtpPassword) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Ticket mail transport is not configured',
      data: { code: 'ticket_mail_unavailable' },
    })
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: String(process.env.NUXT_SMTP_SECURE ?? 'false').toLowerCase() === 'true',
    auth: { user: smtpUser, pass: smtpPassword },
  })

  try {
    await transporter.sendMail({
      from,
      to: row.email,
      subject,
      text,
      html,
      attachments: [
        {
          filename: 'ticket-qr.png',
          content: png,
          contentType: 'image/png',
          cid: 'ticket-qr',
        },
        {
          filename: `afc-ticket-${code}.ics`,
          content: ics,
          contentType: 'text/calendar; charset=utf-8',
        },
      ],
    })
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'The ticket email could not be sent',
      data: { code: 'ticket_email_failed' },
    })
  }

  try {
    await directusFetch(event, `/items/event_registrations/${row.id}`, {
      method: 'PATCH',
      body: { ticket_email_sent_at: new Date().toISOString() },
    })
  } catch {
    // The message is already out; fail loudly so the Flow run is not silently
    // green while the single-send marker is missing.
    throw createError({
      statusCode: 502,
      statusMessage: 'Ticket email sent but the send marker could not be stored',
      data: { code: 'ticket_email_mark_failed' },
    })
  }

  return { status: 'sent' }
})
