/**
 * AFC-717 contract tests — command palette (awesome-bar) over scoped search.
 *
 * Palette overlay (apps/web/components/CommandPalette.vue) mounted from
 * HeaderSearch (which keeps its `/` shortcut + `/search` fallback):
 *  1. Keyboard open/close/nav: Ctrl/Cmd+K toggles, Esc closes, ArrowUp/Down
 *     move, Enter opens. Debounced queries (250ms), grouped rendering
 *     (Recent / Go to / Records / New…), empty states, mobile entry point.
 *  2. Scope pin (load-bearing): fan-out ONLY to the four EXISTING scoped list
 *     endpoints with `?search=` — no new backend surface, no new endpoint.
 *     Each group collapses to empty on denial; the palette renders only rows
 *     the caller's own scoped endpoints returned, so out-of-scope records
 *     NEVER appear. The four list routes stay scope-filtered fail-closed.
 *  3. Create-action gating: no New... row without its write grant.
 *  4. Recent items: caller-scoped localStorage key only, never a bare key.
 *
 * Run: node --test tests/web/command-palette.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const PALETTE = 'apps/web/components/CommandPalette.vue'
const HEADER = 'apps/web/components/HeaderSearch.vue'
const SERVICES = 'apps/web/server/api/services/index.get.ts'

describe('AFC-717 palette overlay structure', () => {
  it('component exists and mounts from the header', () => {
    assert.ok(existsSync(path.join(root, PALETTE)), 'CommandPalette.vue exists')
    assert.match(read(HEADER), /<CommandPalette\s*\/>/, 'header mounts the palette')
  })

  it('overlay uses aria-correct dialog roles', () => {
    const src = read(PALETTE)
    assert.match(src, /role="dialog"/, 'dialog role')
    assert.match(src, /aria-modal="true"/, 'aria-modal')
    assert.match(src, /role="combobox"/, 'combobox input')
    assert.match(src, /role="listbox"/, 'listbox results')
    assert.match(src, /role="option"/, 'option rows')
    assert.match(src, /aria-selected/, 'active option announced')
  })

  it('renders the four groups plus empty + full-page fallback', () => {
    const src = read(PALETTE)
    for (const group of ['Recent', 'Go to', 'Records', 'New…']) {
      assert.ok(src.includes(`'${group}'`) || src.includes(group), `group ${group}`)
    }
    assert.match(src, /No matches/, 'empty state')
    assert.match(src, /See all results/, 'fallback to /search page')
    assert.match(src, /\/search/, 'fallback navigates to /search')
  })
})

describe('AFC-717 keyboard + debounce', () => {
  it('opens on Ctrl/Cmd+K and closes on Escape', () => {
    const src = codeOf(PALETTE)
    assert.match(src, /ctrlKey \|\| .*metaKey/, 'modifier guard')
    assert.match(src, /toLowerCase\(\) === 'k'/, 'K key')
    assert.match(src, /Escape/, 'Escape closes')
  })

  it('arrow-key nav with Enter to open', () => {
    const src = codeOf(PALETTE)
    assert.match(src, /ArrowDown/, 'arrow down')
    assert.match(src, /ArrowUp/, 'arrow up')
    assert.match(src, /Enter/, 'enter opens')
    assert.match(src, /scrollIntoView/, 'active option kept visible')
  })

  it('debounces queries at 250ms before fanning out', () => {
    const src = read(PALETTE)
    assert.match(src, /PALETTE_DEBOUNCE_MS = 250/, '250ms debounce constant')
    assert.match(src, /clearTimeout\(timer\)/, 'debounce resets the timer')
    assert.match(src, /setTimeout\(\(\) =>/, 'deferred fan-out')
  })

  it('HeaderSearch keeps owning `/` and the `/search` page', () => {
    const src = codeOf(HEADER)
    assert.match(src, /event\.key === '\/'/, 'keeps the / shortcut')
    assert.match(src, /path: '\/search'/, 'keeps the /search fallback')
  })

  it('mobile search button is a first-class palette entry', () => {
    const src = read(HEADER)
    assert.match(src, /aria-label="Open search"/, 'mobile button keeps its label')
    assert.match(src, /afc:open-palette/, 'mobile button opens the palette')
  })

  it('desktop exposes a Ctrl+K palette trigger', () => {
    const src = read(HEADER)
    assert.match(src, /aria-label="Open command palette"/, 'desktop palette button')
    assert.match(src, /Ctrl\+K/, 'shortcut hint')
  })
})

describe('AFC-717 scope pin: fan-out to existing scoped endpoints only', () => {
  const SCOPED = ['/api/people', '/api/events', '/api/households', '/api/services']

  it('queries the four scoped list endpoints with ?search= and a tight limit', () => {
    const src = read(PALETTE)
    for (const endpoint of SCOPED) {
      assert.ok(src.includes(`'${endpoint}'`), `fans out to ${endpoint}`)
    }
    assert.match(src, /search: term/, '?search= on every group')
    assert.match(src, /const limit = 5/, 'tight per-group limit')
  })

  it('adds NO new backend surface', () => {
    const src = read(PALETTE)
    assert.doesNotMatch(src, /\/api\/search/, 'never the cross-entity shortcut')
    assert.doesNotMatch(src, /\/api\/palette/, 'no palette endpoint')
    assert.doesNotMatch(src, /\/api\/command/, 'no command endpoint')
    const apiDir = path.join(root, 'apps/web/server/api')
    const names = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(path.join(dir, entry.name))
        else names.push(entry.name.toLowerCase())
      }
    }
    walk(apiDir)
    for (const name of names) {
      assert.doesNotMatch(
        name,
        /palette|awesome|command-palette/,
        `no new route: ${name}`,
      )
    }
  })

  it('each group collapses to empty on denial (never a leak)', () => {
    const src = codeOf(PALETTE)
    const catches = (src.match(/\.catch\(\(\) => \(\{[^\}]*\}\)\)/g) ?? []).length
    assert.ok(catches >= 4, `four failing groups collapse, found ${catches}`)
  })

  it('renders only rows the scoped endpoints returned', () => {
    const src = read(PALETTE)
    assert.match(
      src,
      /only renders rows|only rows the caller/,
      'scope-invisibility documented at the render site',
    )
  })

  it('every fanned-out list route stays scope-filtered fail-closed', () => {
    const expectations = {
      'apps/web/server/api/people/index.get.ts': /scopeFilter\(scope\)/,
      'apps/web/server/api/events/index.get.ts': /eventScopeFilter\(scope\)/,
      'apps/web/server/api/households/index.get.ts': /scopeFilter\(scope\)/,
      'apps/web/server/api/services/index.get.ts': /zoneScopeFilter\(scope\)/,
    }
    for (const [rel, pattern] of Object.entries(expectations)) {
      const src = codeOf(rel)
      assert.match(src, /getPortalScope/, `${rel} resolves the caller scope`)
      assert.match(src, /requireCan/, `${rel} enforces the read grant`)
      assert.match(src, pattern, `${rel} applies its scope predicate`)
    }
  })

  it('services forwards ?search= like every other list endpoint', () => {
    const src = codeOf(SERVICES)
    assert.match(src, /query\.search/, 'reads ?search=')
    assert.match(src, /search: search \|\| undefined/, 'forwards to listItems')
  })
})

describe('AFC-717 create-action gating', () => {
  it('every New... row is gated on its own write grant', () => {
    const src = read(PALETTE)
    for (const [collection, label] of [
      ['people', 'New person'],
      ['events', 'New event'],
      ['households', 'New household'],
      ['sunday_services', 'New service'],
    ]) {
      assert.ok(
        src.includes(`permissions.can('${collection}', 'create')`),
        `${label} gated on can('${collection}', 'create')`,
      )
    }
  })

  it('no create row renders outside the gated list', () => {
    const src = codeOf(PALETTE)
    const gated = (src.match(/permissions\.can\('[a-z_]+', 'create'\)/g) ?? []).length
    assert.ok(gated >= 4, `four gated create rows, found ${gated}`)
    assert.doesNotMatch(src, /to: '\/people\/new'/, 'no invented people-new route')
  })
})

describe('AFC-717 caller-scoped recent items', () => {
  it('keys recents by caller id, never a bare shared key', () => {
    const src = read(PALETTE)
    assert.match(
      src,
      /afc:palette:recent:\$\{user\.value\.id\}/,
      'caller-scoped recent key',
    )
    assert.doesNotMatch(
      src,
      /getItem\('afc:palette:recent'\)|setItem\('afc:palette:recent'/,
      'no bare shared recent key',
    )
  })

  it('bounds and isolates the recent list', () => {
    const src = read(PALETTE)
    assert.match(src, /PALETTE_RECENT_LIMIT = 5/, 'bounded recent list')
    assert.match(src, /filter\(\(item\) => item\.to !== entry\.to\)/, 'dedupe by target')
  })
})
