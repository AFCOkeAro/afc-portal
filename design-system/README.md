# @afc/design-system

The shared design system for **Apostolic Faith Church** — global, West & Central
Africa, the Youth Development department, AFCF campus fellowship, and every AFC
surface built on top of them.

**Status:** v1.0.1, **approved 2026-10-06** (v1.0.0), with the S-1 anchor-nav fix
([AFC-199](/AFC/issues/AFC-199)). See
[`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) §6.5 for the anchor-nav
active-state contract and §12 for the open decisions.

> Nothing in this package should be merged into a production surface until the board
> approves it.

---

## Try it

Open **`styleguide/index.html`** in any browser. It renders every token and component
in light and dark, at any width, with no build step and no JavaScript in the system
itself.

```bash
# macOS
open design-system/styleguide/index.html
# Linux
xdg-open design-system/styleguide/index.html
```

---

## Use it

```html
<link rel="stylesheet" href="design-system/tokens/afc-tokens.css">
<link rel="stylesheet" href="design-system/components/afc-components.css">
```

Then:

```html
<button class="afc-btn afc-btn--primary">Record attendance</button>
<div class="afc-field" data-invalid="true">
  <label class="afc-field__label" for="phone">Phone <span class="afc-field__req">*</span></label>
  <input class="afc-input" id="phone" aria-invalid="true" aria-describedby="phone-err">
  <p class="afc-field__error" id="phone-err">Enter a full 11-digit number, for example 0803 123 4567.</p>
</div>
<p class="afc-label">World headquarters</p>
```

### Scope it

```html
<html data-theme="dark" data-dept="ydd">
```

`data-theme` switches light/dark. `data-dept` (`afc` | `weca` | `afcf` | `ydd`) swaps
the department seal and accent **without touching the neutrals** — that is the rule
that keeps four departments looking like one organisation.

### Density

```html
<html data-density="compact">   <!-- 32px controls, for desktop data tables -->
```

Default is `cozy` (44px controls).

---

## Verify

```bash
# both gates
node design-system/tools/contrast-check.mjs
node design-system/tools/reflow-check.mjs

# or, if you have `playwright` resolvable:
cd design-system && npm run verify
```

**`contrast-check.mjs`** reads the token source, resolves `var()` chains, composites
translucent tokens over the surface behind them, and grades 34 foreground/background
pairs against WCAG 2.2. **Current: 50/50 pass.** Exits non-zero on any failure.

**`reflow-check.mjs`** renders at 1440 / 1280 / 768 / 390 / 320 and fails on
horizontal overflow (1.4.10 Reflow), pointer targets under the floor (2.5.8 Target
Size), or console errors. **Current: 5/5 viewports pass.** Point it at any AFC
surface: `node design-system/tools/reflow-check.mjs http://localhost:3000/`

> In this workspace the bundled Chromium needs
> `export LD_LIBRARY_PATH=/home/paperclip/chrome-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH`
> or it cannot find `libnspr4` / `libnss3`.

Zero runtime dependencies. Nothing to install.

---

## Integration paths

This workspace has no `packages/` directory, no `pnpm` `packages:` glob and no npm
`workspaces` array — and `convox/`, `content/` and `memory/` are separate git
repositories. A linked npm package would not reach the projects, so the system is
**CSS-first and build-free** by necessity.

| Consumer | How |
| --- | --- |
| **Nuxt 3** (Church Portal) | `css: [...]` in `nuxt.config.ts`, plus the Tailwind/Nuxt UI bridge in `adapters/tailwind-preset.js` |
| **React + Vite** (`convox/frontend`) | Import the two CSS files in the app entry |
| **Static HTML** (`docker/landing/`, `cloudup-ppt/`, `flyers/`, `church-records/`) | `<link>` the two files; vendor them, since these have no build step |
| **WordPress** (`wp-content/themes/bluespace`, `infra/wordpress/theme/convocx`) | Enqueue the two files, or map tokens into the existing `theme.json` |

No existing application file has been modified. Wiring is a separate decision.

---

## The rules that matter most

1. **Gold is graphic-only.** `#F5BE00` is 1.71:1 on white. Never gold text on a light
   surface, never gold behind white type. Use `--afc-gold-600 #7A5C00` for gold-toned
   text.
2. **Departments change seals, not neutrals.** Type, spacing, radii and motion are
   shared across all four departments.
3. **Pills are interactive; containers are near-square.** Production uses
   `border-radius:100px` 35× against `1px` 18×. That asymmetry is the brand.
4. **Never introduce a literal.** If the token you need does not exist, propose it as
   a system change with a reason — do not type a hex code.
5. **Nothing is a dark pattern.** No roach motel, no confirmshaming, no sneak-into-
   basket. No streak counters, no "members who stopped attending" nudges framed as
   loss aversion.
6. **Synthetic data only in artefacts.** This project holds children's and members'
   personal data.
7. **Data minimisation is a design constraint.** Do not ask for a field the task does
   not need.

---

## Contents

```
tokens/afc-tokens.css          the token source of truth
components/afc-components.css  the component layer — 14 groups, ~30 components
adapters/tailwind-preset.js    Tailwind preset + Nuxt UI colour bridge
logos/                         five seals + archive reference + provenance README
tools/contrast-check.mjs       the contrast gate (34 pairs)
tools/reflow-check.mjs         the reflow + target-size gate (5 viewports)
tools/pairs.json               the 50 declared contrast pairs
styleguide/index.html          the live reference
docs/DESIGN_SYSTEM.md          the design system document
docs/ACCESSIBILITY.md          the accessibility contract and test matrix
docs/SKILLS_INVENTORY.md       what exists, what is missing, what to install
```

---

## Boundary with AFC-154

[AFC-154](/AFC/issues/AFC-154) owns **rendered-media art direction** for AFC imagery
and video — white balance, key-to-fill ratios, grade, scene vocabulary. This package
owns **interface tokens**. The two agree in warmth; they are separate authorities and
neither overrides the other.