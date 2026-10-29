/**
 * AFC-681 contract tests — marriage phase F (end-to-end over the pipeline + report).
 *
 * Phases B-E each own a slice suite (forms, pipeline engine, notifications,
 * report). This suite owns the JOURNEY: one file that walks the whole couple
 * lifecycle in pipeline order and pins the cross-phase rules a slice suite
 * never sees together:
 *
 *   1. The case opens at introduction and only moves forward (order index).
 *   2. A halt closes the file and names its reason (halt_reason required).
 *   3. Zonal/overseer approvals sign their gates without moving the stage.
 *   4. Transfer closes with the receiving branch named; link-sister stays open.
 *   5. The announce step writes the wedding (+ rehearsal) to the calendar.
 *   6. Wedding-info prefill fills from people rows and never flips the
 *      verify flag (only the form submit ticks wedding_info_verified).
 *   7. Vows default to wording B with brother/sister names from saved forms.
 *   8. The report lists only conducted (reported) marriages with every
 *      migration-0035 column behind scoped reads and the shared field matrix.
 *   9. Scoped reads per role: staff routes gate + narrow, the member route
 *      is member-only with a minimal projection.
 *  10. Hygiene across the whole surface: {code, fields} everywhere, no bare
 *      500, brother/sister language only.
 *
 * Run: node --test tests/web/marriage-phase-f.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const SHARED = 'packages/shared/src/schemas/office.ts'
const ROUTES = {
  create: 'apps/web/server/api/marriage-cases/index.post.ts',
  transition: 'apps/web/server/api/marriage-cases/[id]/transition.post.ts',
  approve: 'apps/web/server/api/marriage-cases/[id]/approve.post.ts',
  transfer: 'apps/web/server/api/marriage-cases/[id]/transfer.post.ts',
  linkSister: 'apps/web/server/api/marriage-cases/[id]/link-sister.patch.ts',
  notify: 'apps/web/server/api/marriage-cases/[id]/notify.post.ts',
  schedule: 'apps/web/server/api/marriage-cases/[id]/schedule.patch.ts',
  announce: 'apps/web/server/api/marriage-cases/[id]/announce.post.ts',
  formsPost: 'apps/web/server/api/marriage-cases/[id]/forms.post.ts',
  weddingInfo: 'apps/web/server/api/marriage-cases/[id]/wedding-info.get.ts',
  vow: 'apps/web/server/api/marriage-cases/[id]/vow.get.ts',
  report: 'apps/web/server/api/marriage-cases/report.get.ts',
  member: 'apps/web/server/api/member/marriage-cases.get.ts',
}
// AFC-898: the report surface moved into the Report tab of the merged
// /marriage page; the old report route is a deep-link redirect stub.
const REPORT_PAGE = 'apps/web/pages/marriage/index.vue'

describe('marriage phase F — the case opens and only moves forward', () => {
  it('create opens at introduction; transition rejects non-forward moves', () => {
    assert.match(codeOf(ROUTES.create), /stage: 'introduction'/, 'opens at introduction')
    assert.match(
      codeOf(ROUTES.transition),
      /MARRIAGE_FLOW_INDEX/,
      'transition reads the order index',
    )
    assert.match(
      codeOf(ROUTES.transition),
      /toIndex <= fromIndex/,
      'backward/same-stage moves refused',
    )
  })

  it('a halt closes the file and the shared schema requires halt_reason', () => {
    assert.match(
      codeOf(SHARED),
      /v\.to_stage === 'halted' && !v\.halt_reason/,
      'halt without a reason is a schema violation',
    )
    assert.match(
      codeOf(SHARED),
      /path: \['halt_reason'\]/,
      'the violation names halt_reason',
    )
    assert.match(
      codeOf(ROUTES.transition),
      /toStage === 'halted'.*halt_reason|halt_reason.*halted/s,
      'the transition route carries the reason onto the halt',
    )
    assert.match(
      codeOf(ROUTES.transition),
      /cannot move again/,
      'halted files refuse further moves',
    )
  })
})

describe('marriage phase F — approvals sign gates, transfer closes', () => {
  it('zonal signs zonal_review and overseer signs overseer_review, stage untouched', () => {
    const src = codeOf(ROUTES.approve)
    assert.match(
      src,
      /MARRIAGE_APPROVAL_STAGE\[parsed\.data\.gate\]/,
      'gate maps to its stage',
    )
    assert.match(src, /zone_admin/, 'zonal pastor rule named')
    assert.match(src, /scope\.isArea/, 'overseer area rule named')
    assert.match(src, /event_type: 'approved'/, 'approvals write approved rows')
    assert.doesNotMatch(src, /updateItem/, 'approvals never move the stage')
  })

  it('transfer closes with the receiving branch named; link-sister stays open', () => {
    const transfer = codeOf(ROUTES.transfer)
    assert.match(transfer, /stage: 'transferred_out'/, 'transfer closes the file')
    assert.match(
      transfer,
      /transfer_to_branch: parsed\.data\.transfer_to_branch/,
      'the receiving branch is named',
    )
    assert.match(transfer, /event_type: 'transferred_out'/, 'the close is trailed')
    const link = codeOf(ROUTES.linkSister)
    assert.match(
      link,
      /event_type: 'note'/,
      'link-sister writes a note, not a stage move',
    )
    assert.match(link, /stays open/, 'the case stays open documented')
  })
})

describe('marriage phase F — calendar, prefill, vows', () => {
  it('announce writes the wedding (+ rehearsal) to the calendar as events', () => {
    const src = codeOf(ROUTES.announce)
    assert.match(
      src,
      /requireCan\(scope, 'events', 'create'\)/,
      'calendar creation is gated',
    )
    assert.match(src, /title: 'Wedding service'/, 'wedding calendar entry named')
    assert.match(src, /title: 'Wedding rehearsal'/, 'rehearsal calendar entry named')
  })

  it('wedding-info prefill fills from people rows and never flips the verify flag', () => {
    const src = codeOf(ROUTES.weddingInfo)
    assert.match(src, /findScopedItem.*people/s, 'people rows read in scope')
    assert.match(
      src,
      /wedding_info_verified: row\.wedding_info_verified/,
      'the flag is only echoed, never flipped',
    )
    assert.doesNotMatch(src, /updateItem/, 'prefill writes nothing')
  })

  it('vows default to wording B with names from saved forms', () => {
    const src = codeOf(ROUTES.vow)
    assert.match(src, /row\.vow_type \?\? 'B'/, 'wording B is the default')
    assert.match(src, /byKey\.vows|byKey\.wedding_info/, 'names read from saved forms')
    assert.match(
      src,
      /buildVowText\(vowType, brotherName, sisterName/,
      'names inserted by the generator',
    )
    assert.match(src, /names_missing/, 'missing names name the missing step')
  })
})

describe('marriage phase F — report of conducted marriages', () => {
  it('lists only reported cases with every migration-0035 column', () => {
    const src = codeOf(ROUTES.report)
    assert.match(src, /stage.*reported|reported.*stage/, 'conducted = reported filter')
    for (const field of [
      'brother_person',
      'sister_person',
      'branch',
      'wedding_date',
      'officiating_minister',
      'bible_passage',
      'certificate_type',
      'marriage_certificate_file',
      'couple_photo_file',
      'presentation_photo_file',
    ]) {
      assert.match(src, new RegExp(field), `report projects ${field}`)
    }
  })

  it('the report page shows every column with brother/sister language', () => {
    const text = read(REPORT_PAGE)
    assert.match(text, /Conducted marriages/, 'page names conducted marriages')
    assert.match(text, /Church \(branch\)/, 'location named as church in DB')
    assert.match(text, /Officiating minister/, 'minister column named')
    assert.match(text, /Bible passage/, 'passage column named')
    assert.doesNotMatch(codeOf(REPORT_PAGE), /groom/i, 'no groom language')
    assert.doesNotMatch(codeOf(REPORT_PAGE), /bride/i, 'no bride language')
  })
})

describe('marriage phase F — scoped reads per role', () => {
  it('every staff route gates with requireCan and narrows with a scope helper', () => {
    for (const [name, rel] of Object.entries(ROUTES)) {
      if (name === 'member') continue
      const src = codeOf(rel)
      assert.match(
        src,
        /requireCan\(scope, 'marriage_case/,
        `${name}: requireCan on the marriage surface (cases, or case_forms for the form routes)`,
      )
      assert.match(
        src,
        /scopeFilter\(scope\)|officeBranchScope\(scope\)|officeZoneScope\(scope\)|resolveBranch\(scope|findScopedItem|readScopedList/,
        `${name}: scoped read/write`,
      )
    }
  })

  it('the member route is member-only with a minimal projection', () => {
    const src = codeOf(ROUTES.member)
    assert.match(src, /isMemberSession/, 'member sessions only')
    assert.match(src, /brother_person/, 'brother side of the _or filter')
    assert.match(src, /sister_person/, 'sister side of the _or filter')
    assert.doesNotMatch(src, /halt_reason/, 'halt reasons excluded from projection')
    assert.doesNotMatch(src, /getPortalScope/, 'no staff scope in the member path')
  })
})

describe('marriage phase F — failure shape and language across the surface', () => {
  it('every route names failure codes; no bare Error, no bare 500', () => {
    for (const [name, rel] of Object.entries(ROUTES)) {
      assert.match(read(rel), /code: '/, `${name}: named failure code`)
      assert.doesNotMatch(
        codeOf(rel),
        /throw new Error\(/,
        `${name}: no bare Error (h3 renders 500)`,
      )
      assert.doesNotMatch(read(rel), /statusCode: 500/, `${name}: no bare 500`)
    }
  })

  it('no groom/bride language anywhere on the marriage surface', () => {
    for (const rel of [...Object.values(ROUTES), REPORT_PAGE, SHARED]) {
      assert.doesNotMatch(codeOf(rel), /groom/i, `${rel}: brother/sister language only`)
      assert.doesNotMatch(codeOf(rel), /bride/i, `${rel}: brother/sister language only`)
    }
  })
})
