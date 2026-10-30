/**
 * AFC-929 contract tests — sticky icon panel + compact attendance chart +
 * static household panel (approved mockup AFC-928 v3).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Person page: sticky left rail (profile hero with icon contact rows +
 *     static household panel); right column starts with the compact
 *     attendance card carrying an Enlarge/Collapse affordance.
 *  2. Icon rows keep text labels as sr-only content + title tooltips, so
 *     nothing is lost (Recognition over Recall).
 *  3. Attendance chart: compact 120px, enlarged 190px with per-week
 *     counts; existing widget contract (SVG, Sunday School default,
 *     single-session links, screen-reader summary) is untouched.
 *  4. Household panel is static and minimised: head, phone, first names +
 *     roles; the full roster stays on the household page. Preview reads
 *     the existing scoped GET /api/households/:id behind households:read
 *     with a null fallback — no migration, no new endpoint, no widened
 *     privilege.
 *  5. Deliberate mockup deviations stay encoded: no invented membership
 *     statuses, no address map without geodata, photo upload stays a
 *     disabled affordance on the PersonAvatar wire point.
 *  6. Household page: sticky summary rail + roster initial dots; anchors
 *     and capability gates preserved on both pages.
 *
 * Run: node --test tests/web/profile-household-parity.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const page = () => read('apps/web/pages/people/[id].vue')
const widget = () => read('apps/web/components/PersonAttendanceChart.vue')
const household = () => read('apps/web/pages/households/[id].vue')

describe('sticky left rail (AFC-929)', () => {
  it('person overview uses a sticky rail column beside the content', () => {
    const src = page()
    assert.ok(src.includes('lg:grid-cols-[340px_minmax(0,1fr)]'), 'rail + content grid')
    assert.ok(src.includes('lg:sticky'), 'rail pins while the content scrolls')
    assert.ok(src.includes('lg:top-20'), 'sticky offset clears the tab strip')
    assert.ok(src.includes('aria-label="Member summary"'), 'rail is labelled')
    assert.ok(src.includes('lg:self-start'), 'rail does not stretch')
  })

  it('household summary rail is sticky too', () => {
    assert.match(household(), /lg:sticky lg:top-20 lg:self-start/)
  })
})

describe('icon contact rows (mockup v3 §2)', () => {
  it('renders one icon row per contact field with icons', () => {
    const src = page()
    for (const icon of [
      'i-lucide-mail',
      'i-lucide-phone',
      'i-lucide-map-pin',
      'i-lucide-id-card',
      'i-lucide-cake',
      'i-lucide-circle-user-round',
      'i-lucide-user',
    ]) {
      assert.ok(src.includes(icon), `icon row uses ${icon}`)
    }
  })

  it('keeps a text label per row as sr-only content plus a title tooltip', () => {
    const src = page()
    for (const label of ['Email', 'Phone', 'Address', 'Membership date', 'Birthday', 'Age', 'Gender']) {
      assert.ok(src.includes(`>${label}: </span>`) || src.includes(`${label}: </span>`), `sr-only label for ${label}`)
    }
    for (const title of ['title="Email"', 'title="Phone"', 'title="Address"']) {
      assert.ok(src.includes(title), `tooltip ${title}`)
    }
    assert.ok(src.includes('sr-only'), 'screen-reader labels exist')
  })

  it('disambiguates membership vs birthday and withholds the birth year', () => {
    const src = page()
    assert.ok(src.includes('tenureSince'), 'membership row carries tenure')
    assert.ok(src.includes('birthdayDayMonth'), 'birthday renders day + month only')
    assert.ok(src.includes('birth year'), 'withholding is stated, not silent')
  })

  it('photo edit stays a disabled affordance on the PersonAvatar wire point', () => {
    const src = page()
    assert.ok(src.includes('<PersonAvatar'), 'uses the existing photo pattern')
    assert.ok(src.includes(':photo="null"'), 'no photo storage invented')
    assert.ok(src.includes('coming with photo storage'), 'disabled state is explained')
    assert.doesNotMatch(src, /photo.*upload.*post|multipart|FormData/i, 'no upload path added')
  })
})

describe('compact attendance chart with enlarge affordance (mockup v3 §3)', () => {
  it('page owns the Enlarge/Collapse control beside the card title', () => {
    const src = page()
    assert.ok(src.includes('attendanceExpanded'), 'expanded state exists')
    assert.ok(src.includes("attendanceExpanded ? 'Collapse' : 'Enlarge'"), 'label toggles')
    assert.ok(src.includes(':aria-expanded="attendanceExpanded"'), 'state is exposed')
    assert.ok(src.includes('aria-controls="person-attendance-chart"'), 'control targets the chart')
    assert.ok(src.includes('min-h-11 rounded-full'), '44px pill target (Fitts)')
  })

  it('chart is compact by default and grows with per-week counts when expanded', () => {
    const src = widget()
    assert.match(src, /expanded\?: boolean/, 'expanded prop is optional')
    assert.ok(src.includes("'190px' : '120px'"), '120px compact, 190px expanded')
    assert.ok(src.includes('id="person-attendance-chart"'), 'control target exists')
    assert.ok(src.includes('aria-label="Per-week detail (expanded view)"'), 'counts list is labelled')
    assert.ok(src.includes('Present') && src.includes('Absent'), 'counts name both states')
  })

  it('attendance card keeps its anchor inside the overview right column', () => {
    const src = page()
    assert.ok(src.includes('id="attendance"'), 'deep link target preserved')
    assert.ok(src.includes('v-if="canAttendance"'), 'capability gate preserved')
    assert.ok(src.includes('<PersonAttendanceChart :person-id="id"'), 'widget wiring preserved')
  })
})

describe('static household panel (mockup v3 §4)', () => {
  it('panel is static, minimised, and links to the full roster', () => {
    const src = page()
    assert.ok(src.includes('Static · limited info'), 'static nature is stated')
    assert.ok(src.includes('householdPreview.head_name'), 'head shown')
    assert.ok(src.includes('householdPreview.phone'), 'phone shown')
    assert.ok(src.includes('firstNameOf(member.display_name)'), 'first names only')
    assert.ok(src.includes('householdRoleLabel(member)'), 'family roles shown')
    assert.ok(src.includes('data minimisation'), 'minimisation note links to the household page')
  })

  it('preview is a scoped pure read of the existing endpoint with a null fallback', () => {
    const src = page()
    assert.ok(src.includes("COLLECTIONS.households, 'read'"), 'gated on households:read')
    assert.ok(src.includes('/api/households/${person.value.household}'), 'reuses the existing route')
    assert.ok(src.includes('householdPreview.value = null'), 'failures fall back to null')
    assert.doesNotMatch(src, /createItem|updateItem|deleteItem/, 'no writes added')
  })

  it('household page keeps the full roster with roles and adds initial dots', () => {
    const src = household()
    assert.ok(src.includes('memberInitials(member.display_name)'), 'roster rows carry dots')
    assert.ok(src.includes('size-10'), '40px dots per mockup')
    assert.ok(src.includes('household_role'), 'roles stay on the full roster')
  })
})

describe('contract anchors and gates preserved', () => {
  it('person page keeps every contract anchor with its gates', () => {
    const src = page()
    for (const anchor of [
      'overview',
      'attendance',
      'registrations',
      'follow-ups',
      'welfare-with-scope',
      'leadership',
      'timeline',
    ]) {
      assert.ok(src.includes(`id="${anchor}"`), `person page must declare #${anchor}`)
    }
    assert.ok(src.includes('SectionNav'), 'shell preserved')
    assert.ok(src.includes("COLLECTIONS.welfareCases, 'read'"), 'welfare gate preserved')
  })

  it('household page keeps its anchors and member link/unlink gates', () => {
    const src = household()
    for (const anchor of ['overview', 'members', 'contact']) {
      assert.ok(src.includes(`id="${anchor}"`), `household page must declare #${anchor}`)
    }
    assert.ok(src.includes('SectionNav'), 'shell preserved')
    assert.doesNotMatch(src, /stub/i, 'still a real page, not a stub')
  })
})

describe('mockup deviations stay encoded (no invented model)', () => {
  it('no invented membership statuses', () => {
    const src = page()
    assert.doesNotMatch(src, /data-status=/, 'no mockup status menu options')
    assert.doesNotMatch(src, /status-menu/, 'no mockup status menu markup')
    assert.ok(src.includes('Archive') && src.includes('Restore'), 'existing toggle stands')
  })

  it('no address map without geodata', () => {
    const src = page()
    assert.doesNotMatch(src, /class="[^"]*mini-map/, 'no mini-map markup')
    assert.doesNotMatch(src, /map-foot/, 'no map footer markup')
    assert.doesNotMatch(src, /Get directions/, 'no directions link without geodata')
  })
})

describe('gate hygiene on the touched paths', () => {
  const touched = [page(), widget(), household()]

  it('names no breach clock and no retention period', () => {
    for (const source of touched) {
      assert.doesNotMatch(source, /awareness_at/)
      assert.doesNotMatch(source, /INTERVAL\s*'[^']*(year|month|day)/i)
    }
  })

  it('names no role names', () => {
    for (const source of touched) {
      for (const role of ['volunteer', 'branch_admin', 'area_admin', 'super_admin']) {
        assert.ok(
          !source.includes(`'${role}'`) && !source.includes(`"${role}"`),
          `must not name role ${role}`,
        )
      }
    }
  })
})
