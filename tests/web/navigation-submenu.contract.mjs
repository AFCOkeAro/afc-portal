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

describe('AFC-831 submenu entries (Reporting / Attendance)', () => {
  const NAV = 'apps/web/utils/navigation.ts'
  const LAYOUT = 'apps/web/layouts/default.vue'

  it('Attendance nests under Reporting instead of standing alone', () => {
    const src = codeOf(NAV)
    assert.match(src, /children: \[/, 'nav model carries one level of children')
    assert.doesNotMatch(
      src,
      /label: 'Attendance',\s*\n\s*to: '\/attendance',\s*\n\s*icon:.*\n\s*requires:.*\n\s*group: 'worship',/,
      'no standalone top-level Attendance entry',
    )
    assert.match(src, /label: 'Reporting'/, 'Reporting stays the parent')
    assert.match(src, /to: '\/attendance'/, 'the child still routes to /attendance')
  })

  it('the sidebar filters children by capability and renders them nested', () => {
    const src = codeOf(LAYOUT)
    assert.match(src, /item\.children/, 'sections carry filtered children')
    assert.match(src, /v-for="child in item\.children"/, 'nested list renders children')
  })

  it('the palette and section matcher follow children', () => {
    assert.match(
      codeOf('apps/web/components/CommandPalette.vue'),
      /flatMap/,
      'palette flattens children into go-to entries',
    )
    assert.match(
      codeOf(LAYOUT),
      /candidates\.push\(\{ to: child\.to/,
      'section matching follows child routes',
    )
  })
})
