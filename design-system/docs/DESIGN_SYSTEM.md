# AFC Design System — v1.0.0

**Revision 2** — supersedes revision 1 following brand-owner review.

**Issue:** [AFC-152](/AFC/issues/AFC-152)
**Owner:** UXDesigner
**Status:** **Approved** by the board on 2026-10-06 (revision 2, interaction `2039345d`). Nothing is merged into a product surface until a consuming project wires it.
**Live reference:** `design-system/styleguide/index.html` — open it in a browser; it renders every token and component in light and dark.

## What changed in revision 2

| # | Change | Driver |
| --- | --- | --- |
| 1 | **Africa for Christ emblem deleted.** The reconstruction is gone; the supplied artwork is installed as `africa-for-christ-logo.png`. | Brand owner: the logo was wrong, replace it |
| 2 | **AFCMF added** as a sixth seal and a department scope, with its own ink tokens. | Brand owner: "Include AFCMF with their logo" |
| 3 | **AFCF master replaced** with the supplied file; the portal copy is superseded. | Brand owner: "I also include the AFCF png" |
| 4 | **The deep blue family is named `--afc-blue-*`** and documented as a deep blue, not purple. | Brand owner: "It is deep blue not purple colour" |
| 5 | **WECA olive `#425A2A` removed.** The WECA lockup contains no olive. | Found while sampling; same error class as #1 |
| 6 | **Colour can no longer be claimed to identify a department** — three marks share gold, two share deep blue. | Forced by the measured hue table |
| 7 | **Seal optical weight normalised**: ink height spread 1.70x → **1.11x**. | Found by rendering, not by reading the spec |
| 8 | Two new gate failures found and fixed; contrast coverage 34 → **50 pairs**. | New department inks needed grading |
| 9 | Two new tools: `sample-logo.mjs` and `seal-weight-check.mjs`. | Make every colour and size claim reproducible |

The theme of revision 1's two errors is the same: **a claim about brand colour made
from something other than the mark.** Revision 2 samples pixels from artwork and
gates the result.

## Revision history

| Version | Revision | Date | Change | Issue |
| --- | --- | --- | --- | --- |
| 1.0.0 | rev 1 | 2026-10-05 | First complete package: tokens, component layer, seals, gates | [AFC-152](/AFC/issues/AFC-152) |
| 1.0.0 | rev 2 | 2026-10-06 | Brand-owner corrections (see above); approved by the board | [AFC-152](/AFC/issues/AFC-152) |
| 1.0.1 | rev 3 | 2026-10-06 | **S-1 fix:** `.afc-tab[aria-current='true']` added as an alias selector, sharing one declaration block with `aria-selected`, so the active state renders on anchor navs (the 7 single-page surfaces). §6.5 publishes the anchor-nav active-state and focus-move contract as prose. `tools/tab-role-check.mjs` added as a control that fails if `aria-selected` is used on a `.afc-tab` link in a consuming app. No token changed; `aria-selected` still renders wherever a real tab panel exists. | [AFC-199](/AFC/issues/AFC-199) |

---

## 0. What this is, in one paragraph

AFC has five real marks, three colour families, two production
websites with no shared CSS, and no shared interface language. This package is the
single token layer and component layer that all AFC surfaces can consume without a
build step. Every value in it was either **measured** from production AFC/WECA
stylesheets or **derived** from a measured value to pass a WCAG 2.2 threshold that
production currently fails. Nothing is invented, and the contrast claims are
computed by a script that fails the build rather than asserted in prose.

---

## 1. Sources and method

| Source | What was taken |
| --- | --- |
| `apostolicfaith.org` production CSS (652 KB, Webflow) | Ink ramp, page ground, label type, button shape, radii, letter-spacing, easing curve |
| `apostolicfaithweca.org` production CSS (4 files, Bootstrap 4 based) | Council seal colours, gold `#d39e00` |
| Brand owner, via AFC-152 (2026-10-06) | Africa for Christ, AFCF and AFCMF artwork — the authoritative source for all five marks |
| `afcf-portal.afmweca.org` | AFCF campus seal, superseded by the supplied master |
| Internet Archive (`youth.afmweca.com`, host now dead) | Youth Development seal |
| Workspace: `church-records/aporeneur/registration-form.html`, `flyers/aporeneur-2026-flyer.html` | The only prior AFC interface values: navy `#1a3a6b`, gold `#c8963e`, cream `#f5f0e8`, Inter + Playfair Display |

Pixel sampling is `design-system/tools/sample-logo.mjs`, which reads the image in a
browser canvas and reports each ink's hex, coverage and HSL. Results are recorded in
`logos/README.md`. Contrast is computed by `tools/contrast-check.mjs`; seal optical
weight by `tools/seal-weight-check.mjs`.

**Sampling discipline (learned the hard way in revision 2).** Sample the mark itself,
never a document that happens to sit near it. Revision 1 gave WECA an olive accent
taken from a 2013 archived masthead; sampling the WECA lockup proves the lockup
contains no olive at all. Brand colour comes from brand artwork.

### Scope boundary — this is not the image/video art-direction spec

[AFC-154](/AFC/issues/AFC-154) owns **rendered-media art direction** for AFC imagery
and video: `AD-COLOR` (white balance 4500–5600 K, warm practicals 2900–3200 K),
`AD-LIGHT` (3:1–4:1 key-to-fill, 30–45° backlight), `AD-GRADE`, and the scene and
worship vocabulary. **AFC-152 owns interface tokens only.**

The two must not be merged. A 2900 K sanctuary practical is a photographic
instruction; `--afc-gold-400: #F5BE00` is a screen value. They happen to agree in
warmth, and AFC-154's note that "the gold-and-warm family AFC imagery has
traditionally used" is part of why the gold ramp here is warm rather than yellow —
but they are separate authorities and neither overrides the other. AFC-154
deliberately declined to define hex values, hex codes, type ramps or logo assets
because they belonged here.

---

## 2. Principles

1. **Measured, not tasteful.** Every colour, size, radius, duration and easing curve
   traces to production or to an accessibility threshold. "It looks nicer" is not a
   reason to add a value.
2. **Gold is sacred, therefore reserved.** Gold appears **zero** times in the AFC
   production stylesheet. It exists only in the logo. So in this system gold is a
   *brand seal* token, never a UI surface — no gold buttons, no gold badges, no gold
   text on white.
3. **Cool ink, generous space.** Near-black indigo `#090B19` on cool paper `#F3F6FC`
   is the measured ground. Space is the primary luxury signal; the system spends it.
4. **Pills are for interactive; containers are near-square.** Production uses
   `border-radius:100px` 35 times against `1px` 18 times. That asymmetry *is* the
   brand geometry. Preserve it.
5. **One signature voice in type.** A wide-tracked uppercase micro-label
   (`letter-spacing:4px` at 12px) marks every section and status. It is the AFC
   signifier and the cheapest way to make a new surface look like an AFC surface.
6. **Department seals change; the chrome does not.** Five marks, one interface.
7. **Accessibility is a token invariant, not a review step.** If it is not asserted
   by `contrast-check.mjs`, it is not a rule.

---

## 3. Colour

### 3.1 Measured ink ramp — the ground truth

| Token | Value | Production usage |
| --- | --- | --- |
| `--afc-ink-900` | `#090B19` | 116 occurrences — the dominant ink |
| `--afc-paper-100` | `#F3F6FC` | 73 — the page ground |
| `--afc-ink-300` | `#6E7488` | 51 — production `--body-display` |
| `--afc-ink-50` | `#E2E7F1` | 38 — borders |
| `--afc-ink-100` | `#D4DDEE` | borders |
| `--afc-ink-700` | `#1E2029` | body ink |
| `--afc-ink-500` | `#444752` | strong secondary |
| `--afc-ink-200` | `#8A94A6` | icons, disabled |
| `--afc-ink-150` | `#969CAA` | quietest non-text |

Full ramp in `tokens/afc-tokens.css` §1.

### 3.2 Three derivations, each fixing a measured failure

| Production value | Measured problem | This system | Result |
| --- | --- | --- | --- |
| `#6E7488` as body text (`--body-display`) | **4.29:1** on `#F3F6FC` — fails AA 1.4.3 | `--afc-ink-400 #525968` as `--afc-text-secondary` | **6.49:1** ✓ |
| `#3F8CD1` primary button with `#FFF` text (`--dark-outline`) | **3.57:1** — fails AA 1.4.3 at 11px | `--afc-action-600 #1A63B4`, same hue family | **6.02:1** ✓ |
| Gold `#F5BE00` as text or fill with white | **1.71:1** on white | Gold demoted to graphic-only; `--afc-gold-600 #7A5C00` for gold-toned text | **6.25:1** ✓ |

The old values are **retained** as non-text tokens (`--afc-ink-300`, `--afc-action-500`)
so existing artwork and historical references do not break. They must not be used for
text.

### 3.3 Gold — the brand seal

`--afc-gold-400 #F5BE00` is sampled from the logo (H 47°, S 0.90, V 0.97). Its ramp
runs `--afc-gold-200 #FFE9A3` → `--afc-gold-700 #5E4700`.

**Rules.**
- Gold may be a fill behind ink text, a rule, a progress bar, a graphic accent.
- Gold may **never** be text on a light surface. Use `--afc-gold-600` for that.
- Gold may **never** be a button or badge background with white type.
- This mirrors production, where gold is used zero times in the stylesheet.

### 3.4 Department seals

Five marks, **three colour families**. Each overrides `--afc-dept-accent` and nothing else.

| Scope | Department | Accent | Sampled from | Hue |
| --- | --- | --- | --- | --- |
| `data-dept="afc"` | Apostolic Faith global | `#F5BE00` gold | `afc-jesus-light-of-world.png` | H 45 |
| `data-dept="weca"` | West & Central Africa | `#F5BE00` gold | `weca-lockup.svg` | H 43 |
| `data-dept="afcmf"` | AFCMF, Outstanding for Christ | `#EB7D26` orange | `afcmf-logo.jpg` script | H 26 |
| `data-dept="afcf"` | Campus Fellowship | `#29186B` deep blue | `afcf-logo.png` | H 252 |
| `data-dept="afc4c"` | Africa for Christ | `#24155C` deep blue | `africa-for-christ-logo.png` | H 253 |
| `data-dept="ydd"` | Youth Development | `#0184B1` teal | `youth-development-logo.png` | H 195 |

**Colour cannot identify a department.** Three marks share gold, two share deep blue,
and only Youth Development has a hue unique to it. `--afc-dept-accent` is therefore a
**family marker, not an identity key**. Any control that switches between departments
must pair the seal artwork with the department name — a hue-only switcher fails WCAG
1.4.1 Use of Color, and would be unreadable to a deuteranopic user regardless.

**The deep blue name.** H 252 sits on the blue/violet boundary in HSL. The brand owner
confirmed on review of revision 1 that this family is a **deep blue, not purple and not
indigo**. At production lightness it is unambiguously blue; only lightened copies drift
toward violet. The token layer names it `--afc-blue-*` for that reason.

**The governance rule:** a department changes its seal, its badge tint and its accent
rule. It does **not** change neutrals, type, spacing, radii or motion. Neutrals are
what make five departments look like one organisation. If a department needs a
different neutral ramp, that is a board-level brand decision, not a CSS variable.

### 3.5 Dark theme

Dark is not an inversion. Every surface is re-picked so text ratios hold, and it is
a first-class theme rather than a filter — the primary AFC photographic context is a
candlelit sanctuary during an evening service, so a dark interface is the natural
default there, not an afterthought. Nine dark pairs are asserted in CI.

---

## 4. Type

### 4.1 The licence problem, stated plainly

Production loads **The Bohemian** (display serif), **Chronicle** (text), **Varche
Caps** and **Eudoxus Sans**. All four are commercial licences. Reproducing them in a
shared package the company cannot legally redistribute is not an option.

The system therefore ships open substitutes and a one-token swap:

| Role | Ships with | Licence | Swap target if AFC buys licences |
| --- | --- | --- | --- |
| Display | Playfair Display | OFL | The Bohemian |
| Interface | Inter | OFL | Eudoxus Sans |
| Long-form | Source Serif 4 | OFL | Chronicle |

Playfair Display is already in use in `flyers/aporeneur-2026-flyer.html`, and Inter is
already in `convox/frontend`, so this introduces nothing new to the workspace.

**Open question for the board:** does AFC hold a licence for The Bohemian / Chronicle?
If yes, change `--afc-font-serif` and `--afc-font-read` and nothing else.

### 4.2 Scale and tracking

Type scale: 1.250 (major third) from `--afc-text-2xs 0.6875rem` to
`--afc-text-4xl 4.875rem`. Two weights do most of the work: **400** and **500**
(plus 600 for emphasis). Display uses `-0.03em`; measured production display runs
`-0.03em` to `-0.05em`.

**The AFC label** — `--afc-track-label: 0.25em` at 12px, uppercase, 400. This is
production's `.subtitle` verbatim, and it is the single highest-leverage detail in the
system: apply it to a new screen and it stops looking generic.

---

## 5. Space, shape, motion

- **Spacing** — 4px base, `--afc-space-1` (4px) to `--afc-space-9` (128px).
  `--afc-space-8` (80px) and `--afc-space-9` (128px) are the measured section
  paddings from production.
- **Radii** — `xs 2px`, `sm 4px`, `md 8px`, `lg 12px`, `xl 20px`,
  `pill 999px`, `full 50%`. Pills for buttons, chips, avatars, active nav. Near-square
  for cards, panels, fields, table cells.
- **Motion** — one signature easing, `--afc-ease-afc: cubic-bezier(0.25,0.46,0.45,0.94)`,
  measured 58 times in production. Durations: 60ms press, 120ms hover, **100ms
  feedback** (the Doherty ceiling for direct manipulation), 240ms base, 400ms
  deliberate, 600ms page.
- `prefers-reduced-motion: reduce` collapses every duration to 0.01ms globally. State
  changes stay instantaneous — they are never removed, because an instant state change
  is still a state change.

---

## 6. Components

`components/afc-components.css`. 14 groups, ~30 components, zero JavaScript, zero
framework dependency.

| Group | Components |
| --- | --- |
| Base | typography, the label, link, rule, skip link |
| Shell | topbar, sidebar rail, container, nav item + badge |
| Button | primary, secondary, ghost, danger, on-dark, sm/lg/block/icon, loading, disabled |
| Field | input, select, textarea, help, error, choice, radio, checkbox, switch, input-group |
| Containment | card (flush/raised), panel, stat tile, grid |
| Data | table with sticky header, numeric alignment, responsive card collapse |
| Feedback | badge, alert, toast, empty state, skeleton, progress bar, progress ring |
| Navigation | tabs, breadcrumb, pagination, segmented control, steps |
| Overlay | modal, destructive confirm, bottom sheet on phones |
| Seal | department seal with a plate for opaque-background artwork |
| Utilities | stack, row, visually-hidden, focus ring |
| Print | Sunday bulletin / attendance sheet / welfare receipt styles |

### 6.1 Button anatomy

Measured from production `.c_button_link`: pill radius, `letter-spacing:3px`,
uppercase, 11px Inter, 16×28px padding, `transition: all .4s`. Minimum target
`--afc-control-min` = **44px** in the default density, 32px in `compact`.

The loading state swaps the label for a spinner **inside the same box** so nothing
reflows. Disabled uses `--afc-text-disabled`, which is exempt from 1.4.3.

### 6.2 Form anatomy

Single-column, label above, help and error below. Errors name the problem in words
("Enter a full 11-digit number, for example 0803 123 4567") rather than "Invalid",
and add a `⚠` glyph plus a 3px left rule so the state survives colour-blindness and
greyscale printing. Nothing blocks submission in order to report a problem — a
park-and-error pattern is slower than forgiving one.

### 6.3 Table → card collapse

Below 48rem the table becomes one card per row, with the column header rendered from
`data-label`. The breakpoint is **content-driven** — 48rem is where the columns stop
fitting — not a device name. This matters for the Church Portal, which is used on
phones in the field.

### 6.4 Destructive confirm

Always confirms. The **safe** action is authored first in the DOM so it is both first
in tab order and visually dominant; there is no CSS `order` reordering, because DOM
order is the accessibility contract. On phones the footer stacks full-width so two
tracked uppercase pills never fight for 390px.

### 6.5 Anchor navigation — the active-state and focus-move contract

`.afc-tabs` / `.afc-tab` has **two consumers with two different semantics**, and the
CSS must render the active state for both:

| Consumer | Markup | Active hook | Meaning |
| --- | --- | --- | --- |
| Real tab panel | `role="tablist"` > `role="tab"` with a controlled panel | `aria-selected="true"` | a panel is selected |
| Anchor nav (the Church Portal single-page surfaces) | `<nav>` > `<a class="afc-tab" href="#section">` | `aria-current="true"` | the reader is at that section |

Both hooks resolve to the **same declaration block** in `afc-components.css`. The
component layer ships no JavaScript, so the behaviour below is a **contract the
consuming app must implement**, not something the stylesheet can enforce. An app can
pass every executable gate in this system and still get the anchor nav wrong; the
contract is the control for that gap.

**`aria-selected` is for real tab panels and must not be used on a link.** A link has
no panel and nothing is selected — a screen reader announcing "selected" for a
navigation state is a false state, not a cosmetic difference. The correct attribute
for the anchor nav is `aria-current="true"` on the active item. This misuse is
mechanically caught by `tools/tab-role-check.mjs`.

The consuming app must implement all of the following:

1. **Sticky strip.** The anchor strip is sticky to the top of the scroll container so
   the reader can change section without scrolling back. It keeps its bottom rule and
   does not overlap the section heading it scrolls under (use `scroll-margin-top` on
   the section headings equal to the strip height).
2. **Mobile horizontal scroll, strip pinned.** On narrow viewports the strip scrolls
   horizontally and the strip itself stays pinned; the page must not scroll
   horizontally. Do not wrap the items onto multiple rows, and do not hide items
   behind a "more" control.
3. **`aria-current` on the active item.** Exactly one item carries
   `aria-current="true"` at a time. It is set as the reader scrolls (scroll-spy) and
   on activation, and it is removed from the previous item in the same update.
4. **Focus moves to the section heading on jump.** Activating a tab must move focus
   to the target section's heading (give it `tabindex="-1"` and call `.focus()`), not
   leave focus on the tab. The heading is then the start of the reader's next move
   through the section. Do not use `scrollIntoView` without moving focus.
5. **The strip never traps keyboard focus.** Tab order must be able to leave the strip
   in both directions. Do not add roving `tabindex` to the anchor nav (that is for a
   real tab panel), and do not add a key handler that swallows Tab, Escape or the
   arrow keys. Every item is a real link and is reachable with Tab.

The scroll-spy implementation is the app's; the observable contract is: one
`aria-current="true"` on the active item, focus on the section heading after a jump,
a pinned strip, and no focus trap.

---

## 7. Density and mobile

`--afc-control-min` is **44px** by default. WCAG 2.2 AA 2.5.8 sets the floor at 24px;
44px is the practical touch target for a portal used by field workers on mid-range
Android phones, and it is a deliberate choice above the letter of the spec.

`data-density="compact"` drops controls to 32px for desktop data tables.

Verified reflow, no horizontal overflow at any width:

| Viewport | Result |
| --- | --- |
| 1440 × 900 | no overflow, 0 JS errors |
| 1280 × 800 | no overflow |
| 768 × 1024 | no overflow |
| 390 × 844 | no overflow |
| 320 × 844 | no overflow |

Three real reflow bugs were found and fixed during that pass, all of them general:
grid/flex children flooring at `min-content` (fixed with `min-width:0`), a modal
floor at `min-content` in a grid, and two tracked uppercase pills exceeding a phone
width in a dialog footer.

---

## 8. What is deliberately *not* here

- **No JavaScript.** The design system ships CSS only. Behaviour (focus traps, dialog
  dismissal, tab roving, anchor-nav scroll-spy and focus-move) is the consuming app's
  responsibility and is specified, not implemented, here. The anchor-nav contract is
  §6.5.
- **No icon set.** Icons must be consistent in stroke width and optical size; that is
  a separate decision with a separate licence review. Slots are left for it.
- **No charts beyond a progress ring.** Data visualisation for welfare and attendance
  needs its own accessibility pass (patterns, not just hue, for multi-series charts).
- **No motion choreography beyond tokens.** Entrance choreography is product-specific.
- **No framework package build.** See §9.

---

## 9. Integration — how every project actually consumes this

The workspace has **no `packages/` directory, no pnpm `packages:` glob and no npm
`workspaces` array**, and `convox/`, `content/` and `memory/` are separate git repos
pointing at the same upstream. So the honest answer is that a linked package would not
reach the projects. The system is therefore **CSS-first and build-free**:

| Consumer | How |
| --- | --- |
| Nuxt 3 (Church Portal frontend) | `css: ['design-system/tokens/afc-tokens.css', 'design-system/components/afc-components.css']`, plus the Tailwind preset and the Nuxt UI colour bridge in `adapters/tailwind-preset.js` |
| React + Vite (`convox/frontend`) | Import the two CSS files in the app entry. The existing `src/design-tokens.css` and `src/canonical.css` can then be retired in a follow-up |
| Static HTML (`docker/landing/`, `cloudup-ppt/`, `flyers/`, `church-records/`) | `<link>` the two files. Copy them at build or vendor them — 6 of the 9 UI surfaces in this workspace have no build step |
| WordPress themes (`wp-content/themes/bluespace`, `infra/wordpress/theme/convocx`) | Enqueue the two files; or map the tokens into the existing `theme.json` |
| Nuxt UI consumers | Point `ui.colors` at the preset once. Do not restyle components ad hoc |

**No existing application file was modified.** Wiring is the CTO's call and needs a
re-lock decision given the npm/pnpm split.

### 9.1 A known mess this system should eventually resolve

Four near-duplicate ConvoCX brand copies exist in this workspace with **divergent
primary colours** — `#7c5cfc` in `.paperclip-work/brand/` and
`infra/wordpress/theme/convocx/theme.json` versus `#7C3AED` in `content/brand/`. This
package is AFC-specific and does not adjudicate ConvoCX. But the same failure mode is
what `data-dept` exists to prevent inside AFC, and the consolidation is worth a
follow-up ticket.

---

## 10. Verification

```bash
node design-system/tools/contrast-check.mjs
```

Reads `tokens/afc-tokens.css`, resolves the `var()` chains, composites translucent
tokens over the surface behind them, and grades 50 declared foreground/background
pairs against WCAG 2.2 thresholds. Exits non-zero on any failure.

**Current state: 50/50 pass.**

Revision 2 added 16 pairs covering every department accent and ink on both paper and
canvas, the deep blue ramp, and white-on-blue badge grounds. Two new failures were
found and fixed rather than documented: `--afc-blue-800` was wrongly graded as ink on
`--afc-blue-600` (1.20:1) when it is a badge ground carrying white type, and the WECA
ink had no declared pair at all.

### `tools/seal-weight-check.mjs` — the optical-weight gate

Compares each mark's ink bounding box inside its own canvas against the correction
factor declared in `afc-components.css`, and fails when a mark file is replaced
without re-deriving its factor. Revision 1 measured ink spanning **1.70x** in height
and **3.88x** in area across the seal row. Revision 2 brings ink height to **1.11x**.

Height is the gate, not area: the marks differ in aspect ratio by design, and
equalising area would mean distorting artwork.

Pairs live in `tools/pairs.json`; add a pair there to extend coverage. The tool also
reports the 24px WCAG 2.5.8 target-size floor, which the component layer enforces via
`--afc-control-min`.

---

## 11. Acceptance criteria

- [x] Both named sites studied; palette, type, geometry and motion measured from production CSS
- [x] Five logo/seal assets: four supplied by the brand owner, one archived recovery, all sampled and documented with provenance
- [x] Seal optical weight normalised and gated (ink height within 1.11x, was 1.70x)
- [x] Token set complete: colour, spacing, type, radii, shadows, motion, layout, density, dark theme, department scopes
- [x] Component inventory implemented in CSS, including empty / loading / error states
- [x] Accessibility asserted by an executable gate, not asserted in prose
- [x] Live reference renders light and dark at 1440×900 and 390×844 with no horizontal overflow and no console errors
- [x] Adapter for the Nuxt 3 + Nuxt UI stack the Church Portal will use
- [x] Skills inventory delivered, existing vs missing
- [x] `afc-design-system` created as a live company skill and attached, so the tokens actually reach the work (skill id `295b5f4b`)
- [x] Available to all projects without a build step (CSS-first, six documented integration paths)
- [x] **Board approval** — **granted 2026-10-06** for revision 2
- [x] ~~Brand owner decision on the Africa for Christ emblem~~ — **closed in revision 2**: artwork supplied and installed, reconstruction deleted
- [ ] **Board decision on font licensing** — outstanding; blocks publishing the system to Google Stitch

---

## 12. Open decisions for the board

**Closed:** the Africa for Christ emblem (artwork supplied and installed) and
approval of the token set and component layer as v1.0.0 (granted 2026-10-06).

Still open — none of these block use of v1.0.0:

0. ~~**Approve or reject the token set and component layer as v1.0.0.**~~ **Approved 2026-10-06.**
2. **FCM seal background.** The AFCMF crest is a JPEG on opaque white with no alpha, the only mark in the set that cannot sit on a dark surface. Request a transparent PNG master from the department, or accept the `.afc-seal` plate as the permanent treatment.
3. **Font licensing** — does AFC hold The Bohemian / Chronicle? If yes, a two-token swap. If no, the open substitutes stand permanently.
4. **Department axis** — confirm that a department may change its seal and accent but never the neutrals. This is the rule that keeps one organisation looking like one organisation across five sites.
5. **WECA site remediation** — `apostolicfaithweca.org` runs stock Bootstrap 4 (`#007bff` primary, `#6c757d` body) with no brand colour applied to the UI. The logo is gold script over grey; the interface is default Bootstrap blue. Bridging that gap is a separate project, not a design-system change.
6. **Attach `afc-design-system` to more agents.** The skill is live in the company library but only my own agent carries it; `skills/sync` returns 403 for MediaTech and Operations because I lack `agents:configure`. A CEO or CEO-assistant grant closes this. **Non-blocking** — the skill is installed and available, only the attachment is outstanding.
7. **Church Portal wiring** — now a CTO task, tracked as a child issue of [AFC-152](/AFC/issues/AFC-152). The npm/pnpm split means a linked npm package reaches nothing, so the integration is two `<link>` tags plus a documented decision on re-locking.

---

## 13. File map

```
design-system/
├── README.md                     how to consume it, in six integration paths
├── package.json                  metadata; no runtime dependency
├── tokens/afc-tokens.css         the token source of truth
├── components/afc-components.css the component layer
├── adapters/tailwind-preset.js   Tailwind + Nuxt UI bridge
├── logos/                        five seals + archive reference + provenance README
├── skills/afc-design-system/      the company skill that carries these tokens
├── tools/contrast-check.mjs      the accessibility gate
├── tools/pairs.json              the 50 declared pairs
├── tools/sample-logo.mjs         pixel sampler for mark colours
├── tools/seal-weight-check.mjs   the optical-weight gate
├── styleguide/index.html         the live reference
└── docs/
    ├── DESIGN_SYSTEM.md          this document
    ├── ACCESSIBILITY.md          the accessibility contract and test matrix
    └── SKILLS_INVENTORY.md       what exists, what is missing, what to install
```