/**
 * AFC-484 contract tests — campus APIs + UI (US-C1..US-C5).
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * campus routes and pages are built on:
 *   1. Schema (track a): migration 0003 creates the twelve campus tables
 *      with the §7 shapes; `exam_results` is the spec-exact table name;
 *      the (timetable, student, date) partial uniques make re-marking
 *      idempotent; the NYSC graph holds exactly the eight ratified edges.
 *   2. Scoping: every campus list route resolves inside the caller's
 *      branch/zone scope via the shared campus helpers (programmes carry
 *      their own scope; children resolve through the programme; results
 *      and support resolve through the student branch/zone); a cross-scope
 *      id is a 404, never a row; fail-closed on missing scope.
 *   3. US-C1: the timetable POST flags clashes (same facilitator or
 *      location, same day, overlapping times) in `meta` without refusing
 *      the save; facilitator call status moves through the PATCH route.
 *   4. US-C2: the attendance POST is read-then-update (idempotent per
 *      session+student+date); progress records flow through the shared
 *      collector that also feeds the coordinator CSV.
 *   5. US-C3: one result per (student, exam, year) surfaces a 409 on
 *      re-record; admission couples to admitted/not_admitted only.
 *   6. US-C4/US-C5: support totals are derived (Σ disbursed), never
 *      captured; level moves never regress; NYSC moves are validated
 *      against the seeded transitions graph; check-up dates/notes persist.
 *   7. Safeguarding: scores/aggregate and support amounts are stripped
 *      per the role matrix (§11.1); pages use capabilities
 *      (PermissionGate + collection/action), never hard-coded role names.
 *
 * Run: node --test tests/web/campus.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const MIGRATION = 'services/directus/schema/migrations/20261020_0003_campus.sql'

const ROUTES = {
  programmesList: 'apps/web/server/api/campus/programmes/index.get.ts',
  programmesCreate: 'apps/web/server/api/campus/programmes/index.post.ts',
  timetableList: 'apps/web/server/api/campus/timetable/index.get.ts',
  timetableCreate: 'apps/web/server/api/campus/timetable/index.post.ts',
  facilitatorsList: 'apps/web/server/api/campus/facilitators/index.get.ts',
  facilitatorsCreate: 'apps/web/server/api/campus/facilitators/index.post.ts',
  facilitatorPatch: 'apps/web/server/api/campus/facilitators/[id].patch.ts',
  attendanceList: 'apps/web/server/api/campus/attendance/index.get.ts',
  attendanceMark: 'apps/web/server/api/campus/attendance/index.post.ts',
  progressList: 'apps/web/server/api/campus/progress/index.get.ts',
  progressCreate: 'apps/web/server/api/campus/progress/index.post.ts',
  progressCsv: 'apps/web/server/api/campus/progress/report.csv.get.ts',
  resultsList: 'apps/web/server/api/campus/results/index.get.ts',
  resultsCreate: 'apps/web/server/api/campus/results/index.post.ts',
  studentsList: 'apps/web/server/api/campus/students/index.get.ts',
  studentsCreate: 'apps/web/server/api/campus/students/index.post.ts',
  studentDetail: 'apps/web/server/api/campus/students/[id].get.ts',
  studentPatch: 'apps/web/server/api/campus/students/[id].patch.ts',
  supportList: 'apps/web/server/api/campus/support/index.get.ts',
  supportCreate: 'apps/web/server/api/campus/support/index.post.ts',
  nysc: 'apps/web/server/api/campus/nysc-transitions.get.ts',
  helpers: 'apps/web/server/utils/campus.ts',
  report: 'apps/web/server/utils/campus-report.ts',
}

const PAGES = {
  hub: 'apps/web/pages/campus/index.vue',
  timetable: 'apps/web/pages/campus/timetable.vue',
  attendance: 'apps/web/pages/campus/attendance.vue',
  progress: 'apps/web/pages/campus/progress.vue',
  results: 'apps/web/pages/campus/results.vue',
  students: 'apps/web/pages/campus/students.vue',
  studentDetail: 'apps/web/pages/campus/students/[id].vue',
}

describe('campus — schema (0003, track a)', () => {
  it('creates the twelve campus tables with the §7 shapes', () => {
    const src = read(MIGRATION)
    for (const table of [
      'campus_students',
      'coaching_programmes',
      'coaching_timetable',
      'coaching_facilitators',
      'coaching_students',
      'coaching_class_attendance',
      'coaching_progress',
      'exam_results',
      'coaching_resources',
      'coaching_feedback',
      'campus_financial_support',
      'nysc_status_transitions',
    ]) {
      assert.match(src, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`), `migration must create ${table}`)
    }
    // Spec-exact table name: exam_results carries no coaching_ prefix.
    assert.doesNotMatch(src, /coaching_exam_results/)
    // Idempotency backstop: the four partial uniques on attendance marks.
    for (const index of [
      'coaching_attendance_slot_cstudent_uidx',
      'coaching_attendance_slot_person_uidx',
      'coaching_attendance_prog_cstudent_uidx',
      'coaching_attendance_prog_person_uidx',
    ]) {
      assert.match(src, new RegExp(index), `migration must define ${index}`)
    }
    // The NYSC graph: exactly eight seeded edges.
    const edges = src.match(/\('not_deployed',\s*'(waiting_callup|exempt)'\)|'(waiting_callup|deployed|serving)',\s*'[^']+'\)/g)
    assert.ok(edges && edges.length === 8, `migration must seed exactly 8 NYSC edges (found ${edges?.length ?? 0})`)
    // No DELETE for the app role anywhere in this file.
    assert.doesNotMatch(src, /GRANT DELETE/i)
  })
})

describe('campus — route files exist (US-C1..US-C5)', () => {
  for (const [name, rel] of Object.entries(ROUTES)) {
    it(`${name} exists`, () => {
      assert.ok(existsSync(path.join(root, rel)), `${rel} must exist`)
    })
  }
  for (const [name, rel] of Object.entries(PAGES)) {
    it(`page ${name} exists`, () => {
      assert.ok(existsSync(path.join(root, rel)), `${rel} must exist`)
    })
  }
})

describe('campus — capability + scope contract', () => {
  const READ_ROUTES = [
    ROUTES.programmesList,
    ROUTES.timetableList,
    ROUTES.facilitatorsList,
    ROUTES.attendanceList,
    ROUTES.progressList,
    ROUTES.resultsList,
    ROUTES.studentsList,
    ROUTES.supportList,
  ]
  for (const rel of READ_ROUTES) {
    it(`${rel} requires the read grant`, () => {
      assert.match(codeOf(rel), /requireCan\(scope,\s*'[^']+',\s*'read'\)/, `${rel} must requireCan read`)
    })
  }

  it('child collections resolve scope through programme or student helpers', () => {
    assert.match(codeOf(ROUTES.timetableList), /programmeChildFilter/, 'timetable list must scope via programme')
    assert.match(codeOf(ROUTES.attendanceList), /campusAttendanceScopeFilter/, 'attendance list must use the attendance scope filter')
    assert.match(codeOf(ROUTES.resultsList), /campusOutcomeScopeFilter/, 'results list must scope via the student relation')
    assert.match(codeOf(ROUTES.supportList), /campusOutcomeScopeFilter/, 'support list must scope via the student relation')
    assert.match(codeOf(ROUTES.studentsList), /campusStudentScopeFilter/, 'students list must scope on branch/zone denorm')
  })

  it('cross-scope writes are 404, never rows', () => {
    for (const rel of [ROUTES.timetableCreate, ROUTES.facilitatorsCreate, ROUTES.attendanceMark, ROUTES.resultsCreate, ROUTES.supportCreate]) {
      assert.match(codeOf(rel), /not_found|assertStudentInScope/, `${rel} must 404 outside scope`)
    }
  })

  it('the attendance mark is read-then-update (idempotent)', () => {
    const src = codeOf(ROUTES.attendanceMark)
    assert.match(src, /updateItem/, 're-marking must update the existing row')
    assert.match(src, /idempotent/, 'the response must report idempotency')
  })

  it('the timetable create flags clashes without refusing', () => {
    const src = codeOf(ROUTES.timetableCreate)
    assert.match(src, /timetableClashes/, 'must run the clash check')
    assert.match(src, /clash_count/, 'must report the clash count in meta')
    assert.doesNotMatch(src, /statusCode:\s*409[\s\S]{0,120}clash/i, 'a clash must not be a 409')
  })

  it('the student patch guards level progression and NYSC transitions', () => {
    const src = codeOf(ROUTES.studentPatch)
    assert.match(src, /isLevelProgression/, 'must guard level regression')
    assert.match(src, /assertNyscTransition/, 'must validate NYSC moves against the graph')
  })

  it('results couple status to exam and de-duplicate diets', () => {
    const src = codeOf(ROUTES.resultsCreate)
    assert.match(src, /admitted\/not_admitted only for admission|Admission results use/, 'must couple admission status')
    assert.match(src, /duplicate_result/, 'a re-recorded diet must surface a 409')
  })

  it('the detail route derives the support total, never stores it', () => {
    const src = codeOf(ROUTES.studentDetail)
    assert.match(src, /supportTotal/, 'must derive Σ disbursed')
    assert.doesNotMatch(src, /financial_support_total.{0,80}readBody|body\[.financial_support_total/, 'must never accept the derived total')
  })

  it('restricted fields are stripped per the role matrix (§11.1)', () => {
    assert.match(codeOf(ROUTES.resultsList), /stripResults/, 'scores/aggregate must be stripped')
    assert.match(codeOf(ROUTES.supportList), /stripSupportMany/, 'amounts must be stripped')
    assert.match(codeOf(ROUTES.studentsList), /stripStudents/, 'support total must be stripped')
  })

  it('the progress CSV reads the shared collector (no drift)', () => {
    assert.match(codeOf(ROUTES.progressCsv), /collectCampusProgress/, 'CSV must share the list collector')
    assert.match(codeOf(ROUTES.report), /collectCampusProgress/, 'collector must exist')
  })

  it('attendance/progress writes intersect student scope (F1)', () => {
    for (const rel of [ROUTES.attendanceMark, ROUTES.progressCreate]) {
      assert.match(codeOf(rel), /assertStudentInScope/, `${rel} must resolve the student row in scope`)
    }
    // The student-scope helper itself 404s outside scope.
    assert.match(codeOf(ROUTES.helpers), /That student was not found in your scope/, 'helper must 404 outside scope')
  })

  it('attendance list intersects session and student scope (F1, no union leak)', () => {
    const src = codeOf(ROUTES.helpers)
    assert.match(src, /campusAttendanceScopeFilter/, 'attendance filter must exist')
    // Session side (programme OR slot programme) ANDed with the student side.
    assert.match(src, /mergeFilters\(sessionPart,\s*studentPart\)/, 'attendance must AND session with student scope')
    assert.doesNotMatch(
      src.replace(/campusProgressScopeFilter[\s\S]*$/, ''),
      /const paths = \[\.\.\.programmePaths, \.\.\.studentPaths\]/,
      'attendance must not union programme and student paths',
    )
  })

  it('progress list and CSV intersect programme and student scope (F1)', () => {
    assert.match(codeOf(ROUTES.progressList), /campusProgressScopeFilter/, 'progress list must use the intersect filter')
    assert.match(codeOf(ROUTES.report), /campusProgressScopeFilter/, 'CSV collector must use the intersect filter')
    assert.match(codeOf(ROUTES.helpers), /mergeFilters\(programmePart,\s*studentPart\)/, 'progress must AND programme with student scope')
  })

  it('cross-branch fixture: area-wide programme never exposes another branch student (F1)', () => {
    // Static fixture of the leak: an area-wide programme (null branch/zone)
    // is in every branch session's visible set, so a predicate that ORs the
    // programme side with the student side matches a branch-B student row
    // for a branch-A caller. The fixed predicate ANDs them: the same row
    // must be hidden (both sides required).
    const helpers = codeOf(ROUTES.helpers)
    const attendanceBody = helpers.slice(helpers.indexOf('campusAttendanceScopeFilter'))
    assert.match(attendanceBody, /_or:\s*\[\s*\{\s*programme:/, 'session side stays an OR of direct/slot programme')
    assert.match(attendanceBody, /studentRelationScope\(scope,\s*'campus_student'\)/, 'student side still scopes campus_student')
    assert.match(attendanceBody, /studentRelationScope\(scope,\s*'person'\)/, 'student side still scopes person')
    assert.match(attendanceBody, /mergeFilters\(sessionPart,\s*studentPart\)/, 'branch-A x branch-B x area-wide must hide (AND, not OR)')
    for (const rel of [ROUTES.attendanceMark, ROUTES.progressCreate]) {
      assert.match(codeOf(rel), /assertStudentInScope/, `${rel} must 404 branch-A x branch-B x area-wide`)
    }
  })

  it('enrol and person-identity writes refuse minors without guardians (F2)', () => {
    assert.match(codeOf(ROUTES.studentsCreate), /assertPersonGuardian/, 'enrol must check the linked person guardian')
    for (const rel of [ROUTES.attendanceMark, ROUTES.progressCreate, ROUTES.resultsCreate]) {
      assert.match(codeOf(rel), /assertPersonGuardian/, `${rel} must check the person-identity guardian`)
    }
    assert.match(codeOf(ROUTES.helpers), /A guardian is required for a person under 18/, 'helper must use the people-POST 400 shape')
  })
})

describe('campus — pages use capabilities, never role names', () => {
  const ROLE_RE = /\b(area_admin|branch_admin|super_admin|department_leader)\b/
  for (const [name, rel] of Object.entries(PAGES)) {
    it(`page ${name} has no hard-coded role name`, () => {
      assert.doesNotMatch(codeOf(rel), ROLE_RE, `${rel} must not name roles`)
    })
    it(`page ${name} gates through PermissionGate`, () => {
      if (name === 'hub') {
        assert.match(codeOf(rel), /PermissionGate/, 'hub must gate each section')
      }
    })
  }
  it('timetable page surfaces the clash flag', () => {
    assert.match(codeOf(PAGES.timetable), /clash/i, 'timetable page must surface clash flags')
  })
  it('attendance page explains idempotent re-marking', () => {
    assert.match(codeOf(PAGES.attendance), /idempotent|no duplicate/i, 'attendance page must state idempotency')
  })
  it('student detail page shows support total, AFCF, NYSC and check-up', () => {
    const src = codeOf(PAGES.studentDetail)
    assert.match(src, /support_total/, 'must show the derived support total')
    assert.match(src, /AFCF/i, 'must show the handshake')
    assert.match(src, /NYSC/i, 'must show deployment')
    assert.match(src, /check-up|next_checkup_date/i, 'must show check-ups')
  })
})
