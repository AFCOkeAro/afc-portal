/**
 * AFC-904 contract — message template tokens, compulsory for WhatsApp.
 *
 * Templates carry `{{token}}` placeholders (see the seeded
 * message_templates bodies). This pins the renderer, the declared-token
 * rule, and the compulsory WhatsApp gate, plus the compose UI wiring:
 * token chips, template picker, read-only WhatsApp text, live preview.
 *
 * Run: node --test tests/web/template-tokens.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  extractTokens,
  renderMessageTemplate,
  validateTemplateTokens,
  whatsappTemplateReady,
  personTokenValues,
  PERSON_TOKENS,
} from '../../packages/shared/src/message-tokens.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('token renderer', () => {
  it('extracts unique tokens in order', () => {
    assert.deepEqual(
      extractTokens('Dear {{invitee_name}}, {{greet}} {{invitee_name}}!'),
      ['invitee_name', 'greet'],
    )
    assert.deepEqual(extractTokens('no tokens here'), [])
  })

  it('substitutes values and reports the missing ones', () => {
    const out = renderMessageTemplate('Dear {{invitee_name}}, how are you doing?', {
      invitee_name: 'Adaeze',
    })
    assert.equal(out.text, 'Dear Adaeze, how are you doing?')
    assert.deepEqual(out.missing, [])
  })

  it('blank values render empty and count as missing', () => {
    const out = renderMessageTemplate('Hi {{first_name}} ({{branch_name}})', {
      first_name: '  ',
    })
    assert.equal(out.text, 'Hi  ()')
    assert.deepEqual(out.missing, ['first_name', 'branch_name'])
  })

  it('derives person tokens with first-name fallback', () => {
    const values = personTokenValues({
      inviteeName: 'Adaeze Okafor',
      branchName: 'Ikeja',
    })
    assert.equal(values.invitee_name, 'Adaeze Okafor')
    assert.equal(values.first_name, 'Adaeze')
    assert.equal(values.branch_name, 'Ikeja')
    assert.deepEqual([...PERSON_TOKENS], ['invitee_name', 'first_name', 'branch_name'])
  })

  it('rejects undeclared tokens', () => {
    const ok = validateTemplateTokens('Hi {{first_name}}', ['first_name'])
    assert.equal(ok.ok, true)
    const bad = validateTemplateTokens('Hi {{first_name}} {{hacker}}', ['first_name'])
    assert.equal(bad.ok, false)
    assert.deepEqual(bad.unknown, ['hacker'])
  })
})

describe('compulsory WhatsApp template rule', () => {
  const approved = {
    templateBody: 'Dear {{invitee_name}}, how are you doing?',
    approvalStatus: 'approved',
    providerTemplateId: 'wa_hello_1',
    allowedVariables: ['invitee_name'],
    values: { invitee_name: 'Adaeze' },
  }

  it('a fully resolved approved template is ready', () => {
    const out = whatsappTemplateReady(approved)
    assert.equal(out.ready, true)
    assert.equal(out.reason, 'ready')
  })

  it('no template body is refused', () => {
    const out = whatsappTemplateReady({ ...approved, templateBody: '  ' })
    assert.equal(out.ready, false)
    assert.equal(out.reason, 'no_template')
  })

  it('unapproved or provider-less templates never run', () => {
    for (const patch of [
      { approvalStatus: 'pending_provider' },
      { approvalStatus: 'approved', providerTemplateId: ' ' },
    ]) {
      const out = whatsappTemplateReady({ ...approved, ...patch })
      assert.equal(out.ready, false)
      assert.equal(out.reason, 'template_not_approved')
    }
  })

  it('unknown tokens are refused before unresolved ones', () => {
    const out = whatsappTemplateReady({
      ...approved,
      templateBody: 'Hi {{invitee_name}} {{nope}}',
      values: {},
    })
    assert.equal(out.ready, false)
    assert.equal(out.reason, 'unknown_tokens')
  })

  it('unresolved values are refused, never sent half-rendered', () => {
    const out = whatsappTemplateReady({ ...approved, values: {} })
    assert.equal(out.ready, false)
    assert.equal(out.reason, 'unresolved_tokens')
    assert.deepEqual(out.detail.includes('invitee_name'), true)
  })
})

describe('compose wiring', () => {
  it('the templates endpoint lists active channel templates read-gated', () => {
    const src = codeOf('apps/web/server/api/communications/templates.get.ts')
    assert.match(src, /requireCan\(scope, 'message_templates', 'read'\)/)
    assert.match(src, /active.*_eq.*true/)
    assert.match(src, /channel.*_eq.*channel/)
    assert.match(src, /'body'/)
    assert.match(src, /'variables'/)
  })

  it('the configure page offers tokens, preview, and the compulsory picker', () => {
    const src = codeOf('apps/web/pages/communications/new.vue')
    assert.match(src, /insertToken/, 'token chips insert into the draft')
    assert.match(src, /draftPreview/, 'live preview renders the draft')
    assert.match(src, /api\/communications\/templates/, 'picker reads the endpoint')
    assert.match(src, /WhatsApp template \(compulsory\)/, 'compulsory is stated')
    assert.match(src, /whatsappCheck/, 'readiness gates the WhatsApp send')
    assert.match(src, /readonly/, 'WhatsApp text stays exactly as approved')
  })
})
