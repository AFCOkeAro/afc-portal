/**
 * AFC-912 contract tests — minutes detail edit.
 *
 * The minutes detail page had no edit (only attendee add). AFC-912 adds
 * PATCH /api/minutes/:id (office_minutes update, branch-scoped, same
 * minutesFormSchema validation as POST via a partial, audit row per edit)
 * and a detail-page Edit form reusing the create-page Markdown toolbar /
 * preview pattern through a shared MinutesBodyEditor with an explicit
 * Raw | Preview segmented toggle (new.vue upgraded to the same control).
 *
 * Pure node:test, no dependencies. Run: node --test tests/web/minutes-edit.contract.mjs
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

const PATCH = 'apps/web/server/api/minutes/[id].patch.ts'
const CREATE = 'apps/web/server/api/minutes/index.post.ts'
const EDITOR = 'apps/web/components/MinutesBodyEditor.vue'
const CREATE_PAGE = 'apps/web/pages/minutes/new.vue'
const DETAIL_PAGE = 'apps/web/pages/minutes/[id].vue'
const MATRIX = 'packages/shared/src/role-matrix.ts'

describe('minutes edit — PATCH route (AFC-912)', () => {
  it('registers as a sibling of the other minutes routes', () => {
    assert.doesNotThrow(() => read(PATCH), `${PATCH} exists`)
  })

  it('stays matrix-gated on office_minutes update (area-only, §11)', () => {
    assert.match(
      codeOf(PATCH),
      /requireCan\(scope, 'office_minutes', 'update'\)/,
      'update stays matrix-gated',
    )
    assert.doesNotMatch(codeOf(PATCH), /statusCode:\s*500/, 'no bare 500')
  })

  it('validates the :id at the boundary before any store read', () => {
    assert.match(codeOf(PATCH), /assertUuidParam/, ':id validated first')
    assert.match(codeOf(PATCH), /invalid_minutes_id/, 'named invalid-id code')
  })

  it('loads the row branch-scoped, so a cross-scope id is a 404', () => {
    const src = codeOf(PATCH)
    assert.match(
      src,
      /findScopedItem[\s\S]*office_minutes[\s\S]*scopeFilter\(scope\)/,
      'scoped load precedes the write',
    )
  })

  it('validates with the same minutesFormSchema as POST, partial for edits', () => {
    const src = codeOf(PATCH)
    assert.match(src, /minutesFormSchema/, 'same schema as POST')
    assert.match(src, /\.innerType\(\)/, 'unwraps the refine wrapper')
    assert.match(src, /\.partial\(\)/, 'partial so any subset may move')
    assert.match(src, /end_time > v\.start_time/, 'end-after-start rule restated')
    assert.match(src, /path: \['end_time'\]/, 'refine reports on end_time like POST')
    assert.match(src, /throwValidation\(parsed\.error\)/, '400s carry fields')
  })

  it('writes the editable columns through updateItem, branch re-scoped', () => {
    const src = codeOf(PATCH)
    for (const field of [
      'title',
      'meeting_date',
      'start_time',
      'end_time',
      'location',
      'body',
      'file',
      'branch',
    ]) {
      assert.ok(src.includes(field), `patch carries ${field}`)
    }
    assert.match(src, /updateItem/, 'writes through updateItem')
    assert.match(src, /'office_minutes',/, 'writes office_minutes')
    assert.match(src, /resolveBranch/, 'branch moves resolve against caller scope')
  })

  it('audits every edit with a CHECK-storable event type, never masking the write', () => {
    const src = codeOf(PATCH)
    assert.match(src, /writeOfficeAudit/, 'audit helper used (best-effort)')
    assert.match(src, /office_minute_events/, 'audit lands in the minute trail')
    assert.match(src, /event_type: 'updated'/, 'uses a CHECK-allowed event type')
    const write = src.indexOf('updateItem')
    const audit = src.indexOf("writeOfficeAudit(event, scope, 'office_minute_events'")
    assert.ok(write !== -1 && audit !== -1, 'write and audit calls present')
    assert.ok(audit > write, 'audit follows the successful write')
  })
})

describe('minutes edit — shared MinutesBodyEditor (AFC-912)', () => {
  it('exists as a single shared component', () => {
    assert.doesNotThrow(() => read(EDITOR), `${EDITOR} exists`)
  })

  it('carries the whole renderer toolbar set', () => {
    const src = codeOf(EDITOR)
    for (const mark of [
      "'**', '**'",
      "'*', '*'",
      "'++', '++'",
      "'~~', '~~'",
      "'# '",
      "'## '",
      "'### '",
      "'- '",
      "'1. '",
      "'> '",
      "'`', '`'",
    ]) {
      assert.ok(src.includes(mark), `toolbar inserts ${mark}`)
    }
    assert.match(src, /insertTable/, 'toolbar inserts tables')
    assert.match(src, /insertLink/, 'toolbar inserts links')
    assert.match(src, /role="toolbar"/, 'toolbar is labelled for AT')
  })

  it('toggles through an explicit Raw | Preview segmented control', () => {
    const src = codeOf(EDITOR)
    assert.match(src, /label="Raw"/, 'Raw segment present')
    assert.match(src, /label="Preview"/, 'Preview segment present')
    assert.match(src, /role="group"/, 'segments grouped as one control')
    assert.match(src, /aria-pressed/, 'active segment is exposed')
  })

  it('previews through the shared XSS-safe renderer, never raw HTML', () => {
    const src = codeOf(EDITOR)
    assert.match(src, /renderMarkdownSafe\(props\.modelValue\)/, 'safe preview')
    assert.match(src, /v-html="previewHtml"/, 'preview binds the rendered HTML')
    assert.doesNotMatch(src, /v-html="modelValue"/, 'never renders the raw source')
  })

  it('is a controlled input: v-model in, update out, no store access', () => {
    const src = codeOf(EDITOR)
    assert.match(src, /modelValue/, 'takes the body as a prop')
    assert.match(src, /update:modelValue/, 'emits body changes')
    assert.doesNotMatch(src, /useApi|api\.(get|post|patch)/, 'fetches nothing itself')
  })
})

describe('minutes edit — pages (AFC-912)', () => {
  it('both create and detail pages use the shared editor, no forked toolbar', () => {
    for (const page of [CREATE_PAGE, DETAIL_PAGE]) {
      assert.match(codeOf(page), /MinutesBodyEditor/, `${page} embeds the editor`)
    }
    assert.doesNotMatch(
      codeOf(CREATE_PAGE),
      /surround\('\*\*', '\*\*'\)/,
      'create page no longer forks the toolbar',
    )
    assert.doesNotMatch(
      codeOf(DETAIL_PAGE),
      /surround\('\*\*', '\*\*'\)/,
      'detail page does not fork the toolbar either',
    )
  })

  it('new.vue binds the editor to the form body and keeps samples + staged flow', () => {
    const src = codeOf(CREATE_PAGE)
    assert.match(src, /v-model="form\.body"/, 'editor bound to form.body')
    assert.match(src, /MINUTES_SAMPLES/, 'samples kept on create')
    assert.match(src, /stagedAttendees/, 'staged attendees kept on create')
    assert.match(
      src,
      /\/api\/minutes\/\$\{id\}\/attendees/,
      'staged attendees attach after create',
    )
  })

  it('detail gates an inline edit form on update and PATCHes the scoped row', () => {
    const src = codeOf(DETAIL_PAGE)
    assert.match(src, /PermissionGate/, 'edit stays permission-gated')
    assert.match(src, /officeMinutes.*update|update.*officeMinutes/s, 'gate names update')
    assert.match(src, /startEdit/, 'explicit edit entry point')
    assert.match(src, /cancelEdit/, 'edit cancels without writing')
    assert.match(src, /saveEdit/, 'explicit save path')
    assert.match(
      src,
      /api\.patch\(`\/api\/minutes\/\$\{id\}`/,
      'save PATCHes /api/minutes/:id',
    )
    assert.match(src, /MinutesBodyEditor/, 'body edits reuse the shared editor')
    assert.match(src, /useBranchOptions/, 'branch picker stays scoped')
  })

  it('detail edit carries every editable field with client-side time order', () => {
    const src = codeOf(DETAIL_PAGE)
    for (const name of [
      'editForm.title',
      'editForm.meeting_date',
      'editForm.start_time',
      'editForm.end_time',
      'editForm.location',
      'editForm.branch',
      'editForm.body',
    ]) {
      assert.ok(src.includes(name), `edit form binds ${name}`)
    }
    assert.match(src, /end_time.*start_time/, 'end-after-start checked client-side')
    assert.match(src, /refresh\(\)/, 'detail reloads after save')
  })

  it('detail keeps the attendee slash-path and the safe read display', () => {
    const src = codeOf(DETAIL_PAGE)
    assert.match(
      src,
      /\/api\/minutes\/\$\{id\}\/attendees/,
      'attendees still POST to the slash path',
    )
    assert.doesNotMatch(src, /\$\{id\}\.attendees/, 'never the dotted path')
    assert.match(src, /renderMarkdownSafe/, 'read display uses the safe renderer')
    assert.match(src, /v-html="bodyHtml"/, 'styled output binds the rendered HTML')
  })

  it('role matrix unchanged: branch roles gain no minutes write', () => {
    const src = codeOf(MATRIX)
    assert.match(src, /\[COLLECTIONS\.officeMinutes\]/, 'officeMinutes row present')
    assert.doesNotMatch(
      src,
      /\[COLLECTIONS\.officeMinutes\][\s\S]{0,400}branch_admin: \[ALL/,
      'branch roles gain no write grant',
    )
  })
})
