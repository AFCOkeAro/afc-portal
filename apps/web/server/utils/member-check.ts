/**
 * Cross-branch first-visit probe (AFC-907).
 *
 * Answers one question with minimal disclosure: does this contact match a
 * person record in a DIFFERENT branch than the visit branch (a member
 * visiting for the first time)? Runs as the Directus administrator so a
 * branch-scoped caller still sees cross-branch matches, but returns only a
 * boolean plus the other branch's display name -- never person ids, names
 * or contact values. Follows the findDuplicateCandidates minimal-row rule:
 * this probe must not become a cross-branch directory read.
 */
import type { H3Event } from 'h3'
import { matchDuplicates } from '@afc/shared'
import { directusFetch } from './directus'
import { directusAdminToken } from './directus-admin'

export interface CrossBranchCheck {
  isCrossBranch: boolean
  branchId: string | null
  branchName: string | null
}

const BLANK: CrossBranchCheck = {
  isCrossBranch: false,
  branchId: null,
  branchName: null,
}

export async function checkCrossBranchVisit(
  event: H3Event,
  visitBranchId: string | null,
  phone: string | null | undefined,
  email: string | null | undefined,
): Promise<CrossBranchCheck> {
  const hasPhone = typeof phone === 'string' && phone.trim() !== ''
  const hasEmail = typeof email === 'string' && email.trim() !== ''
  if ((!hasPhone && !hasEmail) || !visitBranchId) return BLANK

  const token = await directusAdminToken(event).catch(() => null)
  if (!token) return BLANK

  const filters: Array<Record<string, unknown>> = []
  if (hasPhone) filters.push({ phone: { _eq: (phone as string).trim() } })
  if (hasEmail) filters.push({ email: { _eq: (email as string).trim().toLowerCase() } })

  const people = await directusFetch<{
    data: Array<Record<string, unknown>>
  }>(event, '/people', {
    accessToken: token,
    query: {
      filter: { _or: filters },
      fields: 'id,phone,email,branch',
      limit: 25,
    },
  }).catch(() => null)
  const rows = people?.data ?? []
  const hits = matchDuplicates(
    { phone: hasPhone ? phone : null, email: hasEmail ? email : null },
    rows.map((row) => ({
      id: String(row.id),
      collection: 'people' as const,
      name: null,
      branch: row.branch ? String(row.branch) : null,
      phone: typeof row.phone === 'string' ? row.phone : null,
      email: typeof row.email === 'string' ? row.email : null,
    })),
  )
  const cross = hits.find((hit) => hit.branch !== null && hit.branch !== visitBranchId)
  if (!cross || !cross.branch) return BLANK

  const branch = await directusFetch<{ data: { name: string | null } }>(
    event,
    `/branches/${cross.branch}`,
    { accessToken: token, query: { fields: 'id,name' } },
  ).catch(() => null)
  return {
    isCrossBranch: true,
    branchId: cross.branch,
    branchName:
      (branch?.data?.name ?? '').trim() !== ''
        ? String(branch?.data?.name)
        : 'another branch',
  }
}
