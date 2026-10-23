import { createHash } from 'node:crypto'
import type { HouseholdWizardMember } from '@afc/shared'
import { householdWizardSchema, toPersonPayload } from '@afc/shared'
import type { H3Event } from 'h3'
import {
  ageFromDob,
  createItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
  updateItem,
  zoneScopeFilter,
  type PortalScope,
} from '../../utils/portal'

/**
 * POST /api/households/wizard — the guided New Family submit (AFC-590).
 *
 * One staff submit creates the household, its members (with
 * `people.household_role`), the `households.household_head` link, and one
 * `consent_records` row per checked channel — nothing for unchecked boxes.
 *
 * STATED LIMITS (spec-silent, smallest defensible, named for review):
 * 1. NO CROSS-COLLECTION TRANSACTION. Directus REST writes one
 *    collection per request, so the household, the people rows, the head
 *    patch and the consent rows land sequentially. A mid-submit failure
 *    returns `wizard_partial_write` naming the completed steps so staff
 *    can see what exists and finish or escalate it; nothing is silently
 *    half-created. Duplicate-family merge is the flagged follow-up.
 * 2. HEAD MUST BE AN ADULT. A head row with a DOB under 18 is a 400 with
 *    a named field error. A head with no DOB is treated as an adult (the
 *    DOB is optional on the form; absence is not evidence of minority).
 * 3. MINORS TRAVEL WITH THE HEAD. A member under 18 is linked with
 *    `guardian` set to the head person, satisfying the person-form
 *    guardian rule without a second staff lookup. A checked box on a
 *    minor writes basis `guardian` (the head consents at intake); on an
 *    adult it writes `explicit_opt_in`. Unchecked writes nothing.
 * 4. MEMBERSHIP STATUS FOLLOWS THE AGE BAND. Under 13 → `child`,
 *    13–17 → `youth`, otherwise `member`: the enum already carries those
 *    values and a 5-year-old stored as `member` would be a mislabel.
 *    Staff can reclassify on the person record afterwards.
 * 5. CONSENT HASHING MATCHES THE INVITE PATH. `contact_hash` is
 *    `sha256:` over the trimmed number with cosmetic separators removed
 *    (no country-code rewriting — the route stores what the member
 *    typed, same as `normalizeInvitePhone`).
 *
 * AFC-771 EXTENSIONS (hybrid-row build, same transaction shape):
 *  a. wedding_date + structured address persist on the household; the
 *     legacy `address` is composed from the parts so old reads survive.
 *  b. Per-member branch (defaults to the household branch), status
 *     (explicit or the age band), and BSC (scope-checked, 403 outside).
 *  c. middle_name → people.other_names; suffix appends to last_name.
 *     Both columns already exist — no new person name columns invented.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'households', 'create')
  requireCan(scope, 'people', 'create')
  requireCan(scope, 'consent_records', 'create')

  const parsed = householdWizardSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  // The BSC read grant is only needed when a member names a centre.
  if (form.members.some((member) => member.bsc)) {
    requireCan(scope, 'bible_study_centres', 'read')
  }

  // Scoped branches only: a requested branch outside the caller's scope is
  // a 403; branch staff without a request default to their own branch.
  const branch = resolveBranch(scope, form.branch)

  const headIndex = form.members.findIndex(
    (member) => member.role === 'head_of_household',
  )
  // Unreachable: the schema admits exactly one head row. The guard keeps
  // the compiler honest instead of trusting array indexing.
  const head = form.members[headIndex]
  if (!head || headIndex < 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Mark one person as head of household',
      data: {
        code: 'validation_error',
        fields: { members: 'Mark one person as head of household' },
      },
    })
  }
  const headAge = ageFromDob(head.date_of_birth)
  if (headAge !== null && headAge < 18) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The head of household must be an adult',
      data: {
        code: 'validation_error',
        fields: {
          [`members.${headIndex}.date_of_birth`]:
            'The head of household must be 18 or older',
        },
      },
    })
  }

  const householdName =
    form.name && form.name.trim().length > 0
      ? form.name.trim()
      : `${head.last_name.trim()} family`

  const progress: {
    household_id: string | null
    member_ids: string[]
    consents: number
  } = {
    household_id: null,
    member_ids: [],
    consents: 0,
  }

  try {
    const structured = hasStructuredAddress(form)
    const legacyAddress = structured ? composeAddress(form) : (form.address ?? null)
    const household = await createItem<{ id: string | number }>(
      event,
      scope,
      'households',
      {
        name: householdName,
        branch: branch ?? null,
        address: legacyAddress,
        address_1: structured ? (form.address_1 ?? null) : null,
        address_2: structured ? (form.address_2 ?? null) : null,
        city: structured ? (form.city ?? null) : null,
        state: structured ? (form.state ?? null) : null,
        zip: structured ? (form.zip ?? null) : null,
        country: structured ? (form.country ?? null) : null,
        latitude: structured ? (form.latitude ?? null) : null,
        longitude: structured ? (form.longitude ?? null) : null,
        phone: firstPhone(form.members) ?? null,
        wedding_date: form.wedding_date ?? null,
        household_head: null,
        primary_contact: null,
        notes: null,
        status: 'active',
      },
    )
    const householdId = String(household.id)
    progress.household_id = householdId

    // The head lands first so minors can point at it as guardian.
    const ordered = [head, ...form.members.filter((_, index) => index !== headIndex)]
    let headId: string | null = null
    for (const member of ordered) {
      const phone = member.phone?.trim() ? member.phone.trim() : undefined
      const email = member.email?.trim() ? member.email.trim() : undefined
      const age = ageFromDob(member.date_of_birth)
      const isMinor = age !== null && age < 18
      // Per-member branch defaults to the household branch; an explicit
      // out-of-scope branch is a 403 (fail-closed, same as the household).
      const memberBranch = member.branch ? resolveBranch(scope, member.branch) : branch
      // Per-member BSC is scope-checked like the /api/bscs list: outside
      // the caller's branches/zones it is a 403, never an existence oracle.
      const memberBsc = member.bsc
        ? await resolveBscInScope(event, scope, member.bsc)
        : null
      const lastName = member.suffix?.trim()
        ? `${member.last_name.trim()} ${member.suffix.trim()}`
        : member.last_name.trim()
      const created: { id: string | number } = await createItem<{ id: string | number }>(
        event,
        scope,
        'people',
        {
          ...toPersonPayload({
            first_name: member.first_name.trim(),
            last_name: lastName,
            preferred_name: undefined,
            other_names: member.middle_name?.trim() || undefined,
            gender: member.gender,
            date_of_birth: member.date_of_birth,
            phone,
            email,
            address: undefined,
            branch: memberBranch ?? undefined,
            membership_status: member.membership_status ?? statusForAge(age),
            member_since: new Date().toISOString().slice(0, 10),
            guardian: undefined,
            consent_data: false,
            consent_media: false,
            is_entrepreneur: false,
          }),
          household: householdId,
          household_role: member.role,
          branch: memberBranch ?? null,
          bsc: memberBsc,
          // Minors point at the head as guardian (the head is created
          // first, so its id is known for every later member).
          guardian: isMinor ? headId : null,
          is_minor: isMinor,
          status: 'active',
        },
      )
      const personId: string = String(created.id)
      if (member === head) headId = personId
      progress.member_ids.push(personId)

      for (const channel of ['sms', 'whatsapp'] as const) {
        const checked = channel === 'sms' ? member.consent_sms : member.consent_whatsapp
        if (!checked || !phone) continue
        await createItem(event, scope, 'consent_records', {
          person: personId,
          contact_hash: hashPhone(phone),
          channel,
          granted: true,
          consent_type: 'channel',
          basis: isMinor ? 'guardian' : 'explicit_opt_in',
          related_invite: null,
          method: 'digital',
          expires_at: null,
          captured_at: new Date().toISOString(),
        })
        progress.consents += 1
      }
    }

    if (!headId) {
      throw createError({
        statusCode: 502,
        statusMessage:
          'The family was only partly saved — note what exists before retrying',
        data: {
          code: 'wizard_partial_write',
          household_id: progress.household_id,
          member_ids: progress.member_ids,
          consent_records: progress.consents,
        },
      })
    }
    await updateItem(event, scope, 'households', householdId, {
      household_head: headId,
      primary_contact: headId,
    })

    return {
      data: {
        household_id: householdId,
        member_ids: progress.member_ids,
        consent_records: progress.consents,
      },
    }
  } catch (error) {
    // Deliberate 4xx (scope 403s, validation 400s) pass through untouched.
    if ((error as { statusCode?: number })?.statusCode) throw error
    throw createError({
      statusCode: 502,
      statusMessage:
        'The family was only partly saved — note what exists before retrying',
      data: {
        code: 'wizard_partial_write',
        household_id: progress.household_id,
        member_ids: progress.member_ids,
        consent_records: progress.consents,
      },
    })
  }
})

function statusForAge(age: number | null): 'member' | 'youth' | 'child' {
  if (age !== null && age < 13) return 'child'
  if (age !== null && age < 18) return 'youth'
  return 'member'
}

/** True when the submit carries any structured address part. */
function hasStructuredAddress(form: {
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
}): boolean {
  return Boolean(
    form.address_1 ??
      form.address_2 ??
      form.city ??
      form.state ??
      form.zip ??
      form.country ??
      form.latitude ??
      form.longitude,
  )
}

/**
 * Compose the legacy single-line address from the structured parts so
 * reads that only know `households.address` keep working. The structured
 * columns stay authoritative; this is the readable copy.
 */
function composeAddress(form: {
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
}): string | null {
  const parts = [form.address_1, form.address_2, form.city, form.state, form.zip, form.country]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Scope-check one BSC id against the caller (same predicate as
 * GET /api/bscs). Area staff may name any active centre; zone staff are
 * limited to their zones; branch staff to their branches. Anything else
 * — unknown id or outside scope — is a 403 (fail-closed, no oracle).
 */
async function resolveBscInScope(
  event: H3Event,
  scope: PortalScope,
  bscId: string,
): Promise<string> {
  const visibleZones = await scopeZoneIds(event, scope)
  const scoped = await listItems<{ id: string | number }>(event, scope, 'bible_study_centres', {
    filter: mergeFilters(
      { id: { _eq: bscId } },
      { status: { _eq: 'active' } },
      scope.isArea
        ? undefined
        : scope.zoneIds.length > 0
          ? zoneScopeFilter('zone')
          : { parent_branch: { _in: scope.branchIds } },
      !scope.isArea && visibleZones.length > 0 && scope.zoneIds.length === 0
        ? { zone: { _in: visibleZones } }
        : undefined,
    ),
    fields: ['id'],
    limit: 1,
  })
  if (scoped.data.length === 0) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That Bible Study Centre is outside your scope',
      data: { code: 'bsc_out_of_scope' },
    })
  }
  return String(scoped.data[0].id)
}

function firstPhone(members: HouseholdWizardMember[]): string | undefined {
  const found = members.find((member) => member.phone?.trim())
  return found?.phone?.trim()
}

/** sha256: over the trimmed number minus cosmetic separators. */
function hashPhone(phone: string): string {
  const normalised = phone.trim().replace(/[\s\-().]+/g, '')
  return `sha256:${createHash('sha256').update(normalised, 'utf8').digest('hex')}`
}
