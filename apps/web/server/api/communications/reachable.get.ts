import {
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  resolveBranch,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'
import { HARDENING_COLLECTIONS } from '../../utils/hardening'

/**
 * Consent-gated reachable-audience preview for the New Communication
 * configure step (AFC-869, Rock-solid "Reachable Audience" badges).
 *
 * Counts only — no contact value, hash, or rendered text ever crosses this
 * route, so a staff member planning a send learns the audience size without
 * reading anyone's contact details. Requires the `communications` read
 * grant (the same proxy grant as the campaign catalogue); composing still
 * needs the create grant at send time.
 *
 * Resolution mirrors `comms_resolve_consent` (migration 0004) priority:
 * opted-out / suppressed first, then contact validity, then the minor rule,
 * then the grant. Two deliberate mappings, stated for SecurityEngineer
 * review (required on consent/classification before merge):
 * - Email reuses the SMS-channel grant, exactly as the resolver does
 *   (`p_channel = email` reads `p_consent_sms`). An email row in
 *   consent_records is neither written by any flow nor read here.
 * - Classification maps to the catalogue consent policy: personal /
 *   need-to-know behaves as operational-essential (contactable unless
 *   opted out, suppressed, invalid, or an unguarded minor — no marketing
 *   grant required, mirroring the catalogue's operational-essential note);
 *   bulk / marketing requires an explicit opt-in (or guardian) grant.
 *   Personal Preference (union) counts people reachable on at least one
 *   consented channel; there is no preferred-channel column on people.
 *
 * Caps, quiet hours and the kill switch are NOT recomputed here — they
 * apply at send time through the unchanged tick/Flow path, and the UI
 * surfaces them from the existing hardening + quota endpoints.
 */

const CHANNELS = ['email', 'sms', 'whatsapp', 'personal'] as const
type Channel = (typeof CHANNELS)[number]

const CLASSIFICATIONS = ['personal', 'bulk'] as const
type Classification = (typeof CLASSIFICATIONS)[number]

interface PersonLite {
  id: string
  is_minor: boolean | null
  phone: string | null
  email: string | null
  branch: string | null
}

interface ConsentLite {
  person: string | null
  contact_hash: string | null
  channel: string
  granted: boolean
  basis: string
}

interface SuppressionLite {
  contact_hash: string | null
  channel: string
}

function hasPhone(phone: string | null | undefined): boolean {
  if (!phone) return false
  return phone.replace(/\D/g, '').length >= 7
}

function hasEmail(email: string | null | undefined): boolean {
  if (!email) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'communications', 'read')

  const query = getQuery(event)
  const channel: Channel =
    typeof query.channel === 'string' &&
    (CHANNELS as readonly string[]).includes(query.channel)
      ? (query.channel as Channel)
      : 'email'
  if (
    typeof query.channel === 'string' &&
    !(CHANNELS as readonly string[]).includes(query.channel)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Channel must be one of email, sms, whatsapp, personal',
      data: { code: 'invalid_channel' },
    })
  }
  const classification: Classification =
    typeof query.classification === 'string' &&
    (CLASSIFICATIONS as readonly string[]).includes(query.classification)
      ? (query.classification as Classification)
      : 'personal'
  if (
    typeof query.classification === 'string' &&
    !(CLASSIFICATIONS as readonly string[]).includes(query.classification)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Classification must be personal or bulk',
      data: { code: 'invalid_classification' },
    })
  }
  const branch =
    typeof query.branch === 'string' && query.branch.length > 0
      ? resolveBranch(scope, query.branch, { allowAreaWide: true })
      : null

  let people: PersonLite[]
  let consents: ConsentLite[]
  try {
    const result = await listItems<PersonLite>(event, scope, 'people', {
      filter: mergeFilters(
        { status: { _eq: 'active' } },
        branch ? { branch: { _eq: branch } } : undefined,
        scopeFilter(scope),
      ),
      fields: ['id', 'is_minor', 'phone', 'email', 'branch'],
      limit: -1,
    })
    people = result.data
  } catch (error) {
    throwStoreUnavailable(error, 'people_store', '0004')
  }

  const ids = people.map((row) => String(row.id))
  if (ids.length === 0) {
    return {
      data: emptyPreview(channel, classification, branch, false),
    }
  }

  try {
    const result = await listItems<ConsentLite>(event, scope, 'consent_records', {
      filter: { person: { _in: ids } },
      fields: ['person', 'contact_hash', 'channel', 'granted', 'basis'],
      limit: -1,
    })
    consents = result.data
  } catch (error) {
    throwStoreUnavailable(error, 'consent_store', '0004')
  }

  // Granted / refused lookups per person (SMS-channel rows gate both SMS
  // and email, mirroring the 0004 resolver; WhatsApp has its own
  // lane (AFC-902): only explicit whatsapp-channel grants count.
  const grantedSms = new Set<string>()
  const guardianSms = new Set<string>()
  const refusedSms = new Set<string>()
  const grantedWhatsapp = new Set<string>()
  const guardianWhatsapp = new Set<string>()
  const refusedWhatsapp = new Set<string>()
  const hashes: string[] = []
  for (const row of consents) {
    const person = row.person ? String(row.person) : null
    if (!person || (row.channel !== 'sms' && row.channel !== 'whatsapp')) continue
    if (row.channel === 'whatsapp') {
      if (row.granted) {
        grantedWhatsapp.add(person)
        if (row.basis === 'guardian') guardianWhatsapp.add(person)
      } else {
        refusedWhatsapp.add(person)
      }
    } else if (row.granted) {
      grantedSms.add(person)
      if (row.basis === 'guardian') guardianSms.add(person)
    } else {
      refusedSms.add(person)
    }
    if (row.contact_hash) hashes.push(row.contact_hash)
  }

  // STOP registry: best-effort defence in depth. A failed read marks the
  // preview unverified rather than refusing the count — the tick stays
  // authoritative and still suppresses at send time.
  let suppressionsVerified = true
  const suppressedHashes = new Set<string>()
  try {
    if (hashes.length > 0) {
      const result = await listItems<SuppressionLite>(
        event,
        scope,
        HARDENING_COLLECTIONS.suppressions,
        {
          filter: {
            contact_hash: { _in: [...new Set(hashes)] },
            channel: { _in: ['sms', 'email', 'whatsapp', 'all'] },
          },
          fields: ['contact_hash', 'channel'],
          limit: -1,
        },
      )
      for (const row of result.data) {
        if (row.contact_hash) suppressedHashes.add(row.contact_hash)
      }
    }
  } catch {
    suppressionsVerified = false
  }
  const suppressedPersons = new Set<string>()
  if (suppressedHashes.size > 0) {
    for (const row of consents) {
      const person = row.person ? String(row.person) : null
      if (
        person &&
        row.contact_hash &&
        suppressedHashes.has(row.contact_hash) &&
        (row.channel === 'sms' || row.channel === 'email' || row.channel === 'whatsapp')
      ) {
        suppressedPersons.add(person)
      }
    }
  }

  const smsReasons: Record<string, number> = {}
  const emailReasons: Record<string, number> = {}
  const whatsappReasons: Record<string, number> = {}
  let smsReachable = 0
  let emailReachable = 0
  let whatsappReachable = 0
  let viaSms = 0
  let viaEmail = 0
  const bump = (bucket: Record<string, number>, reason: string) => {
    bucket[reason] = (bucket[reason] ?? 0) + 1
  }

  for (const person of people) {
    const id = String(person.id)
    const minor = person.is_minor === true
    const optedOut =
      refusedSms.has(id) || refusedWhatsapp.has(id) || suppressedPersons.has(id)
    const guardianGrant = guardianSms.has(id)
    const grant = grantedSms.has(id)
    const whatsappGrant = grantedWhatsapp.has(id)
    const whatsappGuardian = guardianWhatsapp.has(id)

    // SMS leg.
    if (optedOut) bump(smsReasons, 'opted_out')
    else if (!hasPhone(person.phone)) bump(smsReasons, 'invalid_contact')
    else if (minor && !guardianGrant) bump(smsReasons, 'minor_no_guardian_consent')
    else if (classification === 'bulk' && !grant && !guardianGrant)
      bump(smsReasons, 'no_consent')
    else {
      smsReachable += 1
    }

    // WhatsApp leg (own lane: explicit whatsapp grants only).
    if (optedOut) bump(whatsappReasons, 'opted_out')
    else if (!hasPhone(person.phone)) bump(whatsappReasons, 'invalid_contact')
    else if (minor && !whatsappGuardian)
      bump(whatsappReasons, 'minor_no_guardian_consent')
    else if (classification === 'bulk' && !whatsappGrant && !whatsappGuardian)
      bump(whatsappReasons, 'no_consent')
    else {
      whatsappReachable += 1
    }

    // Email leg (SMS-channel grant, mirroring the 0004 resolver).
    if (optedOut) bump(emailReasons, 'opted_out')
    else if (!hasEmail(person.email)) bump(emailReasons, 'invalid_contact')
    else if (minor && !guardianGrant) bump(emailReasons, 'minor_no_guardian_consent')
    else if (classification === 'bulk' && !grant && !guardianGrant)
      bump(emailReasons, 'no_consent')
    else {
      emailReachable += 1
    }
  }

  // Personal Preference is the union, preferring SMS on overlap.
  const smsSet = new Set<string>()
  const emailSet = new Set<string>()
  for (const person of people) {
    const id = String(person.id)
    const minor = person.is_minor === true
    const optedOut = refusedSms.has(id) || suppressedPersons.has(id)
    if (optedOut) continue
    if (minor && !guardianSms.has(id)) continue
    const smsOk =
      hasPhone(person.phone) &&
      (classification === 'personal' || grantedSms.has(id) || guardianSms.has(id))
    const emailOk =
      hasEmail(person.email) &&
      (classification === 'personal' || grantedSms.has(id) || guardianSms.has(id))
    if (smsOk) {
      smsSet.add(id)
      viaSms += 1
    } else if (emailOk) {
      emailSet.add(id)
      viaEmail += 1
    }
  }

  return {
    data: {
      channel,
      classification,
      branch,
      total_in_scope: people.length,
      sms: { reachable: smsReachable, excluded_reasons: smsReasons },
      whatsapp: { reachable: whatsappReachable, excluded_reasons: whatsappReasons },
      email: { reachable: emailReachable, excluded_reasons: emailReasons },
      personal_preference: {
        reachable: smsSet.size + emailSet.size,
        via_sms: viaSms,
        via_email: viaEmail,
      },
      suppressions_verified: suppressionsVerified,
      gates_note:
        'Caps, quiet hours and the kill switch apply at send time through the unchanged tick path; this preview counts consent-gated reach only.',
    },
  }
})

function emptyPreview(
  channel: Channel,
  classification: Classification,
  branch: string | null,
  suppressionsVerified: boolean,
) {
  return {
    channel,
    classification,
    branch,
    total_in_scope: 0,
    sms: { reachable: 0, excluded_reasons: {} },
    whatsapp: { reachable: 0, excluded_reasons: {} },
    email: { reachable: 0, excluded_reasons: {} },
    personal_preference: { reachable: 0, via_sms: 0, via_email: 0 },
    suppressions_verified: suppressionsVerified,
    gates_note:
      'Caps, quiet hours and the kill switch apply at send time through the unchanged tick path; this preview counts consent-gated reach only.',
  }
}
