# AFC Design System — accessibility contract

**Target:** WCAG 2.2 **AA**, with two deliberate exceptions that are stricter than AA
(44px targets) and one documented exemption (disabled control text).

**Gate:** `node design-system/tools/contrast-check.mjs` — 50/50 pairs pass. Exits
non-zero on any failure, so an inaccessible token change cannot merge unnoticed.

---

## 1. Contrast — computed, not claimed

| Requirement | Threshold | How it is met | Verified |
| --- | --- | --- | --- |
| 1.4.3 Contrast (Minimum), text | 4.5:1 | `--afc-text-*` and `--afc-status-*` on their surfaces | 20 light + 9 dark pairs in `pairs.json` |
| 1.4.3, large text (≥24px or ≥18.66px bold) | 3:1 | display and stat figures use `--afc-text-primary` at 18.6:1 | ✓ |
| 1.4.11 Non-text contrast | 3:1 | `--afc-border-strong` 3.06:1 light, 4.04:1 dark composited; `--afc-focus-outer` 19.6:1 | ✓ |

### Two production values this system had to correct

| Production | Measured | Verdict | Replacement |
| --- | --- | --- | --- |
| `#6E7488` body text on `#F3F6FC` | **4.29:1** | fails 1.4.3 | `--afc-text-secondary: #525968` → **6.49:1** |
| `#3F8CD1` button with `#FFF` text | **3.57:1** | fails 1.4.3 at 11px | `--afc-bg-action: #1A63B4` → **6.02:1** |
| `#F5BE00` gold as text or white-on-gold | **1.71:1** | unusable | gold demoted to graphic-only; `#7A5C00` for gold-toned text → **6.25:1** |

### One documented exemption

`--afc-text-disabled` (`#8A94A6` on `--afc-bg-sunken`) is below 4.5:1. WCAG 1.4.3
explicitly exempts inactive user-interface components. It is used **only** on
`[disabled]` / `aria-disabled` controls, and those controls are also non-interactive
and cursor-`not-allowed`.

---

## 2. Use of colour — 1.4.1

No state in this system is signalled by colour alone.

- **Status** — every badge and alert pairs colour with a word (`Confirmed`, `Follow
  up`, `Overdue`, `Saved`) *and* a glyph (`●`, `⚠`, `✓`).
- **Form errors** — colour + a `⚠` glyph + a 3px heavier left rule + an
  `aria-describedby` message that names the fix.
- **Selected state** — `aria-selected` / `aria-pressed` / `aria-current` carry the
  state; the colour follows. Use `aria-selected` only for a real ARIA tab panel;
  use `aria-current` for an anchor nav, where a link points at a section and nothing
  is selected. See `DESIGN_SYSTEM.md` §6.5.
- **Validation charts** (future) must use pattern or shape, not hue alone. Not yet
  built; recorded here as a constraint on that work.
- **Departments** — the sharpest case in this system, because the artwork forces
  it. The five marks occupy only **three** colour families:

  | Mark | Sampled hue | Family |
  | --- | --- | --- |
  | Apostolic Faith (JTLW) | H 45 | gold |
  | WECA | H 43 | gold |
  | AFCMF | H 26 | orange |
  | AFCF | H 252 | deep blue |
  | Africa for Christ | H 253 | deep blue |
  | Youth Development | H 195 | teal |

  Three marks share gold, two share deep blue, and only Youth Development has a
  hue unique to it. So `--afc-dept-accent` is a **family marker, not an identity
  key**:

  - Any control that switches or identifies a department **must** show the seal
    artwork and the department name. A hue-only switcher, tab underline, or
    colour-coded legend fails 1.4.1 — and under deuteranopia the two shared
    families compress toward each other in lightness, so it fails for sighted
    users too.
  - Never encode status by department accent. Status uses `--afc-status-*`,
    which always carries a label and a glyph as well as a colour.
  - Charts that plot departments must use the seal mark or a direct series
    label. Five series told apart by three hues is a 1.4.1 failure by
    construction.

---

## 3. Target size — 2.5.8 (AA, 24px)

| Density | `--afc-control-min` | Used for |
| --- | --- | --- |
| `cozy` (default) | **44px** | buttons, fields, nav items, tabs, checkboxes, radios, pagination |
| `compact` | 32px | desktop data tables only |

44px is above the AA floor by design. The Church Portal is used by field workers on
mid-range Android phones, and thumb-zone reach (not just spec compliance) is the
binding constraint.

**The one sub-24px element** is the visual checkbox/radio glyph at 20×20. The
*target* is the wrapping `.afc-choice` label, which is `min-height: 44px` and
toggles the input on click — so the effective pointer target is 44px. This is
conformance with 2.5.8, not an exception to it, but it is recorded here because an
automated audit will flag the input element.

---

## 4. Focus — 2.4.7 / 2.4.11

The focus indicator is a **two-ring stack**:

```
0 0 0 2px var(--afc-focus-inner)   /* #FFFFFF  — inner, on dark grounds */
0 0 0 4px var(--afc-focus-outer)   /* #090B19  — outer, always visible */
```

Reversed automatically in dark theme. This is deliberate: a single-colour ring
disappears on one surface or the other, and choosing a colour that works on both
guarantees a mediocre ring on each. The stack guarantees ≥3:1 against any surface the
component can land on, and it is applied to **every** interactive atom via both the
component rules and a blanket `a/button/[tabindex]/summary:focus-visible` rule.

`--afc-shadow-focus` is the single value; never hand-roll a focus ring.

---

## 5. Keyboard — 2.1.1 / 2.1.2 / 2.4.3

- No component removes focusability. `[tabindex="-1"]` is never used for a control.
- DOM order **is** the tab order. The destructive-confirm footer authors the safe
  action first rather than using CSS `order` — reordering visually would desynchronise
  what a keyboard user hears from what a sighted user sees.
- `:focus-visible`, not `:focus`, so a mouse click does not leave a ring on a
  conversational surface.
- A skip link (`.afc-skip-link`) is the first focusable element in the shell.
- Tabs, dialogs and menus require roving `tabindex` and an arrow-key handler in the
  consuming app. **Specified, not implemented** — the system ships no JavaScript.
  This is for a real ARIA tab panel. An **anchor nav** (`.afc-tab` as a link to a
  section) must **not** use roving `tabindex` or an arrow-key handler — every item
  stays in the tab order and focus must be able to leave the strip in both
  directions. See `DESIGN_SYSTEM.md` §6.5.

---

## 6. Motion — 2.3.3 / 2.2.2

`prefers-reduced-motion: reduce` collapses every `--afc-dur-*` to `0.01ms` globally
and neutralises animation iteration counts. State changes remain **instantaneous**
rather than disappearing — a zero-duration state change is still perceivable, whereas
removing the transition entirely can leave a control looking unresponsive.

Motion is never the only signal: the loading spinner is accompanied by a state
attribute and the control is `pointer-events: none`; the active tab carries
`aria-selected` (real tab panel) or `aria-current` (anchor nav); the switch has a
native checkbox.

**100ms is the ceiling for direct manipulation feedback** (Doherty Threshold). Press
feedback is 60ms. Anything slower than 100ms on a control the finger is on reads as
unresponsive.

---

## 7. Reflow and zoom — 1.4.10 / 1.4.4

| Viewport | Horizontal overflow | Console errors |
| --- | --- | --- |
| 1440 × 900 | none | 0 |
| 1280 × 800 | none | 0 |
| 768 × 1024 | none | 0 |
| 390 × 844 | none | 0 |
| 320 × 844 | none | 0 |

Content reflows to 320px with no two-dimensional scrolling. Tables collapse to
one-card-per-row below 48rem with headers supplied by `data-label`.

Bugs found and fixed by this check, all general enough to have shipped:

1. Grid and flex children flooring at `min-content` instead of shrinking →
   `min-width: 0` on grid/flex items.
2. A modal flooring at `min-content` inside a grid, pushing past a 320px viewport.
3. Two tracked uppercase pills exceeding a phone width in a dialog footer.
4. Sticky chrome hiding content at restored scroll positions → `scroll-padding-top`.

Layout is **content-driven**: the table collapse is at 48rem because that is where
columns stop fitting, not because a device is called "mobile".

---

## 8. Forced colours and high contrast — 1.4.11

Under `forced-colors: active`, `--afc-border-strong` and `--afc-border-default` map
to `CanvasText`. The system does **not** attempt to restyle itself inside forced
colours mode — fighting the OS palette produces something worse than the OS default.
The gold seal and the two-ring focus ring are the two places a design system is most
tempted to hard-code colour; both are left to the platform.

---

## 9. Forms and errors — 3.3.1 / 3.3.2 / 3.3.3

- Every field has a programmatically associated `<label>`.
- Errors are identified in text, not by colour, and are linked with
  `aria-describedby`.
- Error messages state the **fix**, not the verdict: "Enter a full 11-digit number,
  for example 0803 123 4567" — not "Invalid input".
- Invalid fields get `aria-invalid="true"`.
- Required fields use a visible asterisk *and* the `required` attribute.
- Nothing is blocked from submission in order to report a problem. Forgiveness
  (Norman) beats strictness for data entry in the field.

---

## 10. Destructive and dark-pattern policy

**Required, not optional.**

- Destructive actions always confirm, and the safe action is first and dominant.
- No roach motel, confirmshaming, sneak-into-basket or bait-and-switch anywhere in the
  component layer. There is deliberately no "cancel" that reads as a link to opt out,
  and no pre-ticked consent control.
- **Data minimisation** is a design constraint, not just a legal one: a component
  that has no reason to ask for a field must not exist. The Church Portal holds
  children's and members' personal data; the welfare form's default Notes placeholder
  is "Only what the welfare team needs."
- **No real data in design artefacts.** Every example in the styleguide is synthetic.
- No engagement metric may be surfaced that would reward behaviour harmful to the
  congregation — e.g. no streak counters, no "members who stopped attending" nudges
  framed as loss aversion.

---

## 11. Test matrix — what the consuming team must run

| Test | Tool | Gate |
| --- | --- | --- |
| Token contrast | `node design-system/tools/contrast-check.mjs` | exit 0, 50/50 |
| Seal optical weight | `node design-system/tools/seal-weight-check.mjs` | exit 0, ink height within 1.30x |
| Automated a11y | axe-core (already in `node_modules`, 4.13.0) | 0 violations, serious + critical |
| Reflow | Playwright at 320 / 390 / 768 / 1280 / 1440 | `scrollWidth <= clientWidth` |
| Target size | Playwright: every `button, a[href], input, select, textarea` | ≥ 44px in cozy |
| Keyboard | Manual: tab order, skip link, dialog focus trap, tab roving | no trap, no skip |
| Reduced motion | Emulate `prefers-reduced-motion` | transitions ≤ 0.01ms, state still visible |
| Forced colours | Emulate `forced-colors: active` | borders map to `CanvasText`, nothing invisible |
| Zoom | 200% and 400% | no loss of content or function |

`axe-core` is present but **no automated axe run is wired into the repository yet** —
see `SKILLS_INVENTORY.md` §4 for the proposed addition.

---

## 12. Known limitations, stated

1. **No automated axe gate.** `axe-core` is installed but unused. Proposed, not built.
2. **Contrast is checked for 50 declared pairs.** Any component introducing a new
   colour pair must add it to `tools/pairs.json` or it is unchecked. This is a
   process risk, mitigated by making the gate the documented pre-merge step.
3. **Disabled-control contrast is below AA** under an explicit spec exemption (§1).
4. **Behaviour is unspecified in code.** Focus traps, dialog dismissal and tab roving
   are specified in prose but not implemented, so a consuming app can get them wrong
   while still passing every check here.
5. **No screen-reader pass has been run.** Everything above is static analysis plus
   rendered verification. A manual pass with NVDA and VoiceOver is required before
   the Church Portal ships, and is listed as a follow-up.
6. **Dark-theme borders are translucent** (`rgba(255,255,255,0.42)`). The gate
   composites them onto the surface before grading. A surface the gate does not know
   about could composite differently.