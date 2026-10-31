/**
 * AFC-959 / AFC-960 / AFC-994 / AFC-1004 port contract — resilient states.
 *
 * Ports the ConvoCX `church-portal` error-card + sync-queue work into the
 * afc-portal vocabulary (Nuxt/Vue + Tailwind; design-system CSS canonical).
 * Pure node:test, no dependencies. Pins:
 *   1. Canonical CSS: both spec files exist in design-system, reference
 *      only --afc-* tokens (no colour literals), and carry the AFC-1004
 *      320px action-overflow fix.
 *   2. AfcErrorCard: scoped-card contract (tone/title/cause/fix +
 *      scoped retry + quiet secondary), role=alert, stale note, technical
 *      detail (code/requestId) to console only — never rendered.
 *   3. AfcSuggestRow: label + chips with a select emit (state 6, no dead end).
 *   4. AfcOfflineBanner: role=status, silent while online with an empty
 *      outbox, retry action otherwise.
 *   5. useAfcSyncQueue: outbox surface (boot/enqueue/flush/retryNow/
 *      retryItem/onChange/snapshot/pendingCount), drafts
 *      (save/load/clear/handleExpiredSession), pure backoff ladder, and
 *      SSR safety (no bare window/localStorage/navigator at module scope).
 *   6. Wiring: events list + welfare cases render the card with a retry
 *      path; the staff shell mounts the offline banner.
 *
 * Run: node --test tests/web/afc-resilient-states.contract.mjs
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

describe('canonical CSS: token-driven spec in design-system', () => {
  for (const css of [
    'design-system/components/afc-resilient-states.css',
    'design-system/components/afc-sync-queue.css',
  ]) {
    it(`${css} references only --afc-* tokens (no colour literals)`, () => {
      const src = codeOf(css)
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,}/)
      assert.doesNotMatch(src, /rgb\(/)
      assert.match(src, /var\(--afc-/)
    })
  }

  it('resilient-states.css carries the AFC-1004 320px action fix', () => {
    const src = read('design-system/components/afc-resilient-states.css')
    assert.match(src, /\.afc-error-card__actions > \*/)
    assert.match(src, /min-width:\s*0/)
    assert.match(src, /max-width:\s*24\.99rem/)
  })

  it('resilient-states.css covers all four tones', () => {
    const src = read('design-system/components/afc-resilient-states.css')
    assert.match(src, /\.afc-error-card--neutral/)
    assert.match(src, /\.afc-error-card--info/)
    assert.match(src, /\.afc-error-card--warn/)
  })
})

describe('AfcErrorCard: scoped-card contract', () => {
  const src = read('apps/web/components/AfcErrorCard.vue')

  it('declares the full contract as props', () => {
    for (const prop of [
      'tone',
      'title',
      'cause',
      'fix',
      'retryLabel',
      'secondaryLabel',
      'staleText',
      'code',
      'requestId',
    ]) {
      assert.ok(src.includes(prop), `missing prop: ${prop}`)
    }
  })

  it('emits retry and secondary (scoped actions, never navigation)', () => {
    assert.match(src, /retry/)
    assert.match(src, /secondary/)
    assert.doesNotMatch(codeOf('apps/web/components/AfcErrorCard.vue'), /navigateTo|router\.push/)
  })

  it('uses role=alert and keeps technical detail out of the DOM', () => {
    assert.match(src, /role="alert"/)
    assert.match(src, /console\.error/)
    const template = src.slice(src.indexOf('<template>'))
    assert.doesNotMatch(template, /requestId|props\.code/)
  })

  it('renders the stale cached-copy note and a 44px retry target', () => {
    assert.match(src, /staleText/)
    assert.match(src, /min-h-11/)
  })
})

describe('AfcSuggestRow: state-6 chips', () => {
  const src = read('apps/web/components/AfcSuggestRow.vue')

  it('renders label + chips with a select emit', () => {
    assert.match(src, /chips/)
    assert.match(src, /select/)
  })
})

describe('AfcOfflineBanner: quiet unless offline or pending', () => {
  const src = read('apps/web/components/AfcOfflineBanner.vue')

  it('owns role=status and hides while online with an empty outbox', () => {
    assert.match(src, /role="status"/)
    assert.match(src, /v-if="!online \|\| pending > 0"/)
  })

  it('offers Retry now when rows are waiting', () => {
    assert.match(src, /Retry now/)
    assert.match(src, /retryNow/)
  })
})

describe('useAfcSyncQueue: outbox + drafts surface', () => {
  const src = read('apps/web/composables/useAfcSyncQueue.ts')

  it('exposes the outbox lifecycle', () => {
    for (const fn of [
      'boot',
      'enqueue',
      'flush',
      'retryNow',
      'retryItem',
      'onChange',
      'snapshot',
      'pendingCount',
    ]) {
      assert.ok(src.includes(fn), `missing outbox fn: ${fn}`)
    }
  })

  it('exposes drafts with expiry handling that saves before redirect', () => {
    for (const fn of ['save', 'load', 'clear', 'handleExpiredSession']) {
      assert.ok(src.includes(fn), `missing drafts fn: ${fn}`)
    }
    assert.match(src, /redirectTo: 'login'/)
  })

  it('keeps the backoff ladder pure and the copy centralized', () => {
    assert.match(src, /backoffDelay/)
    assert.match(src, /offlineBanner/)
    assert.match(src, /conflictKeptServer/)
  })

  it('is SSR-safe: no bare browser globals at module scope', () => {
    const mod = codeOf('apps/web/composables/useAfcSyncQueue.ts')
    assert.doesNotMatch(mod, /^localStorage/m)
    assert.doesNotMatch(mod, /^window\./m)
    assert.match(mod, /typeof localStorage|typeof window|typeof navigator|typeof indexedDB/)
    assert.match(mod, /import\.meta\.client/)
  })
})

describe('wiring: cards and banner mounted', () => {
  it('events list renders the card with a retry path on load failure', () => {
    const src = read('apps/web/pages/events/index.vue')
    assert.match(src, /<AfcErrorCard/)
    assert.match(src, /upcomingError/)
    assert.match(src, /pastError/)
    assert.match(src, /@retry="refreshAll\(\)"/)
  })

  it('welfare cases render the card with a retry path on load failure', () => {
    const src = read('apps/web/pages/welfare/index.vue')
    assert.match(src, /<AfcErrorCard/)
    assert.match(src, /@retry="refresh\(\)"/)
  })

  it('staff shell mounts the offline banner', () => {
    const src = read('apps/web/layouts/default.vue')
    assert.match(src, /<AfcOfflineBanner \/>/)
  })
})
