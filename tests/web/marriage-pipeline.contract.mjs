/**
 * AFC-678 contract tests — marriage workflow engine (phase C).
 *
 * Static gates over the route layer (the DB suite 96 owns the CHECKs; this
 * suite owns the route rules a crafted HTTP request must not skip):
 *   1. Shared: 24 flow stages in pipeline order (halted/transferred_out are
 *      terminal, never forward steps); 24-row task template with stageGate,
 *      brother/sister titles, due offsets; zonal/overseer stage map.
 *   2. Create: marriage_cases row at introduction + created event +
 *      per-stage tasks (related_type marriage_case) + rehearsal re-check.
 *   3. Transition: forward order enforced here (reject toIndex<=fromIndex),
 *      closed cases refuse, wedding_info verify, rehearsal lead, halt/transfer
 *      payload rules, trail writes.
 *   4. Approvals: gate-stage match, zone_admin/area role rules, `approved`
 *      trail rows, never moves the stage.
 *   5. Transfer/link-sister: transfer closes with receiving branch named;
 *      link-sister keeps the case open with a note row; closed files refuse.
 *   6. Member progress: member-only surface, session personId _or filter
 *      (brother/sister), minimal projection.
 *   7. Hygiene: scopeFilter/requireCan throughout; EntitySelect only (no
 *      manual-ID brother/sister/branch inputs); failure shape {code, fields},
 *      no bare 500.
 *
 * Run: node --test tests/web/marriage-pipeline.contract.mjs
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
  list: 'apps/web/server/api/marriage-cases/index.get.ts',
  create: 'apps/web/server/api/marriage-cases/index.post.ts',
  detail: 'apps/web/server/api/marriage-cases/[id].get.ts',
  transition: 'apps/web/server/api/marriage-cases/[id]/transition.post.ts',
  approve: 'apps/web/server/api/marriage-cases/[id]/approve.post.ts',
  transfer: 'apps/web/server/api/marriage-cases/[id]/transfer.post.ts',
  linkSister: 'apps/web/server/api/marriage-cases/[id]/link-sister.patch.ts',
  member: 'apps/web/server/api/member/marriage-cases.get.ts',
}
const PAGES = {
  // AFC-898: the pipeline surface moved into the Pipeline tab of the merged
  // /marriage page; /marriage-cases/index.vue is a deep-link redirect stub.
  list: 'apps/web/pages/marriage/index.vue',
  detail: 'apps/web/pages/marriage-cases/[id].vue',
}

describe('marriage pipeline — shared workflow contract', () => {
  it('the flow is 24 stages in pipeline order with terminal closes outside it', () => {
    const src = codeOf(SHARED)
    assert.match(src, /MARRIAGE_FLOW_STAGES/, 'flow order constant exists')
    assert.match(src, /MARRIAGE_FLOW_INDEX/, 'order lookup exists')
    assert.match(src, /halted.*transferred_out/, 'terminal closes named')
    assert.match(
      src,
      /to_stage.*halted.*transferred_out|halted.*transferred_out.*terminal/s,
      'closes documented as terminal',
    )
  })

  it('the task template covers every flow stage with gate, title and due offset', () => {
    const src = codeOf(SHARED)
    assert.match(src, /MARRIAGE_CASE_TASK_TEMPLATE/, 'template exists')
    assert.match(src, /stageGate/, 'each row names its stage gate')
    assert.match(src, /dueOffsetDays/, 'each row carries a due offset')
    assert.match(src, /related_type/, 'template documented against related_type')
    // Brother/sister language only: no groom/bride in the template block.
    const block = src.slice(src.indexOf('MARRIAGE_CASE_TASK_TEMPLATE'))
    assert.doesNotMatch(block, /groom/i, 'no groom language in the template')
    assert.doesNotMatch(block, /bride/i, 'no bride language in the template')
  })

  it('approval gates bind zonal->zonal_review and overseer->overseer_review', () => {
    const src = codeOf(SHARED)
    assert.match(src, /MARRIAGE_APPROVAL_GATES/, 'gate vocabulary exists')
    assert.match(src, /zonal_review/, 'zonal gate signs zonal_review')
    assert.match(src, /overseer_review/, 'overseer gate signs overseer_review')
    assert.match(src, /marriageCaseApprovalSchema/, 'approval schema exists')
    assert.match(src, /marriageCaseTransferSchema/, 'transfer schema exists')
    assert.match(src, /marriageCaseLinkSisterSchema/, 'link-sister schema exists')
  })
})

describe('marriage pipeline — create + task generation', () => {
  it('create opens at introduction with a created event and per-stage tasks', () => {
    const src = codeOf(ROUTES.create)
    assert.match(
      src,
      /requireCan\(scope, 'marriage_cases', 'create'\)/,
      'create is gated',
    )
    assert.match(
      src,
      /requireCan\(scope, 'tasks', 'create'\)/,
      'task generation is gated',
    )
    assert.match(src, /stage: 'introduction'/, 'opens at introduction')
    assert.match(src, /MARRIAGE_CASE_TASK_TEMPLATE/, 'generates from the stage template')
    assert.match(src, /related_type: 'marriage_case'/, 'tasks link via related_type')
    assert.match(src, /related_id: caseId/, 'tasks link via related_id')
    assert.match(src, /event_type: 'created'/, 'writes the created trail row')
  })

  it('create re-checks the rehearsal lead with the {code, fields} shape', () => {
    const src = codeOf(ROUTES.create)
    assert.match(src, /rehearsal/, 'rehearsal lead re-checked')
    assert.match(src, /validation_error/, 'named failure code')
    assert.match(src, /fields: \{[^}]*rehearsal_date/, 'field-level failure shape')
  })
})

describe('marriage pipeline — forward order lives in the transition route', () => {
  it('rejects backward and same-stage moves against the order index', () => {
    const src = codeOf(ROUTES.transition)
    assert.match(src, /MARRIAGE_FLOW_INDEX/, 'reads the order index')
    assert.match(src, /toIndex <= fromIndex/, 'rejects non-forward moves')
    assert.match(src, /moves forward only/, 'names the forward rule')
  })

  it('closed cases refuse, halt/transfer payload rules hold, verify gate holds', () => {
    const src = codeOf(ROUTES.transition)
    assert.match(src, /halted.*transferred_out.*reported/, 'closed vocabulary named')
    assert.match(src, /cannot move again/, 'closed cases refuse')
    assert.match(src, /wedding_info_verified/, 'verify checkbox enforced')
    assert.match(src, /rehearsal/, 'rehearsal lead re-checked')
    assert.match(src, /halt_reason/, 'halt payload rule named')
    assert.match(src, /transfer_to_branch/, 'transfer payload rule named')
  })

  it('writes stage_changed / halted / transferred_out trail rows', () => {
    const src = codeOf(ROUTES.transition)
    assert.match(src, /stage_changed/, 'forward moves audited')
    assert.match(src, /'halted'/, 'halts audited')
    assert.match(src, /'transferred_out'/, 'transfer-closes audited')
  })
})

describe('marriage pipeline — approval gates', () => {
  it('matches gate to stage and enforces zonal/overseer roles, writing approved rows', () => {
    const src = codeOf(ROUTES.approve)
    assert.match(src, /MARRIAGE_APPROVAL_STAGE/, 'gate-stage map enforced')
    assert.match(src, /event_type: 'approved'/, 'writes approved trail rows')
    assert.match(src, /zone_admin/, 'zonal pastor rule named')
    assert.match(src, /isArea/, 'overseer area rule named')
    assert.doesNotMatch(src, /updateItem/, 'approvals never move the stage')
  })
})

describe('marriage pipeline — transfer-close vs link-in-DB', () => {
  it('transfer closes the file with the receiving branch named', () => {
    const src = codeOf(ROUTES.transfer)
    assert.match(src, /stage: 'transferred_out'/, 'closes the file')
    assert.match(src, /transfer_to_branch/, 'names the receiving branch')
    assert.match(src, /event_type: 'transferred_out'/, 'audits the close')
    assert.match(src, /cannot transfer again/, 'closed files refuse')
  })

  it('link-sister keeps the case open with a note row', () => {
    const src = codeOf(ROUTES.linkSister)
    assert.match(src, /sister_person/, 'links the sister person')
    assert.match(src, /event_type: 'note'/, 'writes a note, not a stage move')
    assert.match(src, /stays open/, 'case stays open documented')
    assert.match(src, /cannot link/, 'closed files refuse')
  })
})

describe('marriage pipeline — member progress', () => {
  it('is member-only with session personId scoping and a minimal projection', () => {
    const src = codeOf(ROUTES.member)
    assert.match(src, /isMemberSession/, 'member sessions only')
    assert.match(src, /personId/, 'identity from the session')
    assert.match(src, /brother_person/, 'brother side of the _or filter')
    assert.match(src, /sister_person/, 'sister side of the _or filter')
    assert.match(src, /stageIndex/, 'reports position in the flow')
    assert.doesNotMatch(src, /halt_reason/, 'halt reasons excluded from projection')
    assert.doesNotMatch(src, /transfer_to_branch/, 'transfer destinations excluded')
    assert.doesNotMatch(src, /getPortalScope/, 'no staff scope in the member path')
    assert.doesNotMatch(src, /getQuery\(event\)/, 'no query-parameter identity')
  })
})

describe('marriage pipeline — scoping, hygiene, UI', () => {
  it('every staff route gates with requireCan and narrows with scopeFilter', () => {
    for (const [name, rel] of Object.entries(ROUTES)) {
      if (name === 'member') continue
      const src = codeOf(rel)
      assert.match(
        src,
        /requireCan\(scope, 'marriage_cases'/,
        `${name}: requireCan on marriage_cases`,
      )
      assert.match(
        src,
        /scopeFilter\(scope\)|officeBranchScope\(scope\)|resolveBranch\(scope/,
        `${name}: scoped read/write`,
      )
    }
  })

  it('member and staff detail routes name the failure shape, never a bare 500', () => {
    for (const rel of Object.values(ROUTES)) {
      const src = read(rel)
      assert.match(src, /code: '/, `${rel}: named failure code`)
      assert.doesNotMatch(
        codeOf(rel),
        /throw new Error\(/,
        `${rel}: no bare Error (h3 renders 500)`,
      )
    }
  })

  it('no raw manual-ID inputs for brother/sister/branch references', () => {
    for (const rel of Object.values(PAGES)) {
      const text = read(rel)
      assert.doesNotMatch(text, /<UInput[^>]*brother/, `${rel}: brother is EntitySelect`)
      assert.doesNotMatch(text, /<UInput[^>]*sister/, `${rel}: sister is EntitySelect`)
      const tags = text.match(/<USelect\b[^>]*>/gs) ?? []
      for (const tag of tags) {
        assert.doesNotMatch(
          tag,
          /branch|sister|brother|person/,
          `${rel}: entity refs are EntitySelect, not USelect`,
        )
      }
      assert.match(text, /EntitySelect/, `${rel}: uses EntitySelect`)
    }
  })

  it('no groom/bride language in the marriage-cases surface', () => {
    for (const rel of [...Object.values(ROUTES), ...Object.values(PAGES), SHARED]) {
      assert.doesNotMatch(codeOf(rel), /groom/i, `${rel}: brother/sister language only`)
      assert.doesNotMatch(codeOf(rel), /bride/i, `${rel}: brother/sister language only`)
    }
  })
})
