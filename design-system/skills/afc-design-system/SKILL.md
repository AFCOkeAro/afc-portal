---
name: afc-design-system
description: "The AFC Design System v1.0.0 — measured tokens, the component layer, and the five AFC seals. Use whenever you are building, restyling or reviewing ANY user interface for AFC: web page, dashboard, form, table, modal, email template, slide, or component. Load this before writing any markup or CSS for AFC, and before choosing a colour, font size, spacing value, radius, shadow or duration. Covers the ink, paper, gold and deep-blue ramps; the pill-means-interactive rule; the six department scopes and their seals; the WCAG thresholds that production AFC fails; and the three executable gates. For generated images and video of AFC people, use afc-brand and afc-appearance-guardrails instead — this skill owns interfaces, not rendered media."
---

# AFC Design System v1.0.0 — interface tokens, components and seals

**Authoritative source:** `design-system/` in the workspace repo.
**Design document:** [AFC-152](/AFC/issues/AFC-152) · approved 2026-10-06.

This skill is the AFC layer that sits **on top of** generic UI skills (`ui-patterns`,
`impeccable`, `ux-design`). It does not replace them. Load this one **first**.

---

## 1. Load order

| Work | Load |
| --- | --- |
| Any AFC **interface** — page, form, dashboard, component | `afc-design-system` (this) → `ui-patterns` or `impeccable` |
| A generated **image or video** of AFC, especially depicting a person | `afc-brand` → `afc-appearance-guardrails` → `image` / `video` |
| A **press release, letterhead or certificate** | this skill for the seal plate and type; `afc-brand` for the wording |

**The boundary is not negotiable.** This skill owns interface tokens: hex values,
type ramp, spacing, radii, motion, seals. `afc-brand` owns rendered-media art
direction: Kelvin, grade, key-to-fill ratio. They agree in warmth and must not be
merged. If a request is about an interface, a value here wins. If it is about a
photograph or a generated frame, `afc-brand` wins.

---

## 2. Non-negotiables

Read these before you write a line. Each one is a measured fact or a computed
threshold, not a preference.

1. **Never hard-code a hex value.** Every colour, size, radius, shadow and duration
   comes from a token in `design-system/tokens/afc-tokens.css`. If the token you need
   does not exist, that is a **system proposal** — say so, do not invent a one-off.
2. **Gold is graphic-only.** `--afc-gold-400 #F5BE00` measures **1.71:1** on white.
   Never use it as text, never as a button or badge background with white type. For
   gold-toned *text* use `--afc-gold-600 #7A5C00` (6.25:1). Gold appears **zero times**
   in AFC production CSS — it lives only in the logo.
3. **Pills mean interactive.** `border-radius:100px` appears 35× in production against
   `1px` 18×. Buttons, tabs and chips are pills; cards, inputs and panels stay
   near-square. That asymmetry *is* the brand.
4. **A department never touches the neutrals.** `data-dept="…"` may change the seal,
   the badge tint and `--afc-dept-accent`. It may not change ink, paper, type,
   spacing, radii or motion. That rule is what keeps six marks looking like one
   organisation.
5. **Colour never identifies a department.** Three of the five seals share gold and
   two share deep blue. Any switcher, tab set or legend that changes department must
   show the **seal artwork and the name**. A hue-only switcher fails WCAG 1.4.1.
6. **The deep blue is a deep blue** — not purple, not indigo. Measured H 252–253. It
   only reads violet when lightened; do not lighten `--afc-blue-*` without
   re-checking the name with the brand owner.
7. **Minimum interactive target is 44px** in the default `cozy` density, via
   `--afc-control-min`. WCAG 2.2 AA 2.5.8 floor is 24px; AFC holds 44px.
8. **Respect `prefers-reduced-motion`.** The token layer already collapses every
   duration. Never add a hand-written `transition` that bypasses the tokens.

---

## 3. The ramps

### Ink — cool neutrals, measured from `apostolicfaith.org` production CSS

| Token | Value | Note |
| --- | --- | --- |
| `--afc-ink-900` | `#090B19` | primary text. 116 uses in production |
| `--afc-ink-400` | `#525968` | secondary text. **Derived** — replaces `#6E7488`, which fails AA |
| `--afc-ink-300` | `#6E7488` | **non-text only.** 4.29:1 on paper — never a text colour |
| `--afc-ink-50` | `#E2E7F1` | borders, dividers |

### Paper — surfaces

| Token | Value | Note |
| --- | --- | --- |
| `--afc-paper-100` | `#F3F6FC` | page canvas. 73 uses in production |
| `--afc-paper-0` | `#FFFFFF` | raised surface |
| `--afc-paper-200` | `#EDF2FA` | sunken |

### Action — the only interactive blue

`--afc-bg-action` = `--afc-action-600` = `#1A63B4`, **6.02:1** with white text.
Production ships `#3F8CD1` at **3.57:1**, which fails AA. Use the token, never the
production value.

### Gold — brand seal, never a surface

`200 #FFE9A3` · `300 #FFD65C` · **`400 #F5BE00`** · `500 #D9A600` · `600 #7A5C00` · `700 #5E4700`

### Deep blue — AFCF and Africa for Christ

`200 #D8D5EE` · `400 #4A3A92` · `500 #33207C` · **`600 #29186B`** · `700 #24155C` · `800 #1A0F45`

### Status

`danger #992E2E` · `success #175A35` · `warn #7A5C00` · `info #1A63B4` · `neutral #525968`

Never encode status by department accent. Status always carries a label and a glyph
as well as a colour.

---

## 4. Spacing, type, radius, motion

- **Spacing** — 4px base, `--afc-space-1` … `--afc-space-9` (4, 8, 12, 16, 24, 32,
  48, 80, 128px). There is no 5th, 7th or 20px step. Use the scale.
- **Type** — 1.250 major-third scale, `--afc-text-2xs` (11px) to `--afc-text-4xl`.
  Two weights (400, 600) and three sizes do 80% of AFC.
- **Tracking** — two measured signature values: `--afc-track-label 0.25em` for the
  uppercase 12px eyebrow label, `--afc-track-button 0.19em` for buttons.
- **Radius** — `--afc-radius-pill` for interactive, `--afc-radius-md 8px` and below
  for containers.
- **Motion** — one signature easing curve, `--afc-ease-afc`, measured 58× in
  production. Durations: `100ms` feedback (the Doherty ceiling), `240ms` base,
  `400ms` slow.

---

## 5. The five seals

`design-system/logos/` — every file has provenance and a sampled colour in
`design-system/logos/README.md`. **Never re-colour, re-draw, stretch or rotate a
seal.** Use `.afc-seal`, which supplies the plate and the optical correction.

| Scope | Department | File | Ink |
| --- | --- | --- | --- |
| `data-dept="afc"` | Apostolic Faith | `afc-jesus-light-of-world.png` | gold `#F5BE00` |
| `data-dept="weca"` | West & Central Africa | `weca-lockup-print.png` | gold `#F5BE00` |
| `data-dept="afcmf"` | Outstanding for Christ | `afcmf-logo.jpg` | orange `#EB7D26` |
| `data-dept="afcf"` | Campus Fellowship | `afcf-logo.png` | deep blue `#29186B` |
| `data-dept="afc4c"` | Africa for Christ | `africa-for-christ-logo.png` | deep blue `#24155C` |
| `data-dept="ydd"` | Youth Development | `youth-development-logo.png` | teal `#0184B1` |

**Optical weight is not automatic.** The marks do not share a canvas — JTLW fills
58.8% of its own frame, AFCF 100%. Apply the measured correction via
`data-seal="jtlw|weca|afcmf|ydd|afcf|afc4c"`, or the seal row renders 1.70× apart.
`node design-system/tools/seal-weight-check.mjs` fails if a mark file is swapped
without re-deriving its factor.

---

## 6. The three gates — run them before you claim anything works

```bash
export LD_LIBRARY_PATH=/home/paperclip/chrome-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
node design-system/tools/contrast-check.mjs     # 50/50 pairs, exit 0
node design-system/tools/seal-weight-check.mjs  # 6/6 marks,  exit 0
node design-system/tools/reflow-check.mjs <url> # 5/5 viewports, exit 0
```

All three exit non-zero on failure, so they can block a merge. **Adding a new
foreground/background pair means adding it to `design-system/tools/pairs.json`** —
a pair that is not declared there is not checked, which is the main process risk in
this system. Colour claims must be sampled, not eyeballed:
`node design-system/tools/sample-logo.mjs <image>`.

---

## 7. Consuming it

CSS-first and build-free — two `<link>` tags, zero runtime dependencies. This
workspace has **no `packages/` directory**, no pnpm `packages:` glob and no npm
`workspaces` array, so a linked npm package would reach nothing.

```html
<link rel="stylesheet" href="design-system/tokens/afc-tokens.css">
<link rel="stylesheet" href="design-system/components/afc-components.css">
```

For Nuxt 3 + Nuxt UI, add the preset and point Nuxt UI's semantic names at the AFC
primitives once, in config — see `design-system/adapters/tailwind-preset.js` and the
header comment there. Do not restyle Nuxt UI components with ad-hoc classes; that is
how a design system dies.

The live reference that renders every token and component in light and dark is
`design-system/styleguide/index.html`. Open it before you build.

---

## 8. Data and safety

This system handles **children's and members' personal data**. Never place real
member, child or household content in a spec, a screenshot, a test fixture or a
prompt. Use realistic but synthetic examples. Collect only what the task needs.

Never ship a flow that normalises a dark pattern — roach motel, confirmshaming,
sneak-into-basket, bait-and-switch. If a requested pattern needs the user to be
tricked, refuse it and propose the honest alternative.