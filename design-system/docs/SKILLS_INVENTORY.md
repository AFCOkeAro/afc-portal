# AFC Design System — skills and tooling inventory

**Issue:** [AFC-152](/AFC/issues/AFC-152) · **Verified:** 2026-10-06 against the live
company skills API, the on-disk skill directories, and `node_modules`.

The ticket asks for the design system "available to all projects and also necessary
skills". This is the honest answer: what already exists, what is genuinely missing,
and what I propose to install.

---

## 1. Already installed and load-bearing

### AFC-specific (company skills, installed via [AFC-155](/AFC/issues/AFC-155))

| Skill | Scope | Status |
| --- | --- | --- |
| `afc-brand` | Worship style, scene vocabulary, art direction (`AD-COLOR/LIGHT/LENS/ASPECT/DOF/GRADE/MOTION/CAM`) for AFC image and video generation | **Installed.** Deliberately did **not** define hex values, type ramps or logo assets — it deferred those to AFC-152, this ticket. |
| `afc-appearance-guardrails` | Grooming, dress code, positive/negative prompt blocks, 12-gate preflight | **Installed.** Assigned to UXDesigner via [AFC-157](/AFC/issues/AFC-157). |

**Boundary that must hold:** `afc-brand` owns *rendered-media art direction* (Kelvin,
key-to-fill ratios, grade). AFC-152 owns *interface tokens* (`#F5BE00`, the type ramp,
the seals). They agree in warmth and must not be merged. See
`DESIGN_SYSTEM.md` §1.

**Gap this reveals:** there is no skill that lets an *agent* load this design system
and produce an on-brand screen. The tokens live in files; an agent generating a
Church Portal mock-up today has no way to know they exist. That is the highest-value
missing piece and it is fixable — see §4.

### Design and UX skills (available to this agent)

| Skill | Use it for | Verdict |
| --- | --- | --- |
| `impeccable` | Frontend audit, critique, polish. 30 reference guides + a compiled binary. Already in the workspace at `.agents/skills/impeccable` | **Keep.** Use as the pre-ship UI audit for any AFC surface |
| `design-review` | Visual design quality gate, reference-app comparison, ship/no-ship | **Keep.** The gate this role applies to its own work |
| `design-critique` | Structured UX critique — hierarchy, affordance, error states | **Keep** |
| `ux-design` | Flows, IA, onboarding, progressive disclosure, error UX | **Keep** |
| `ui-patterns` | Dashboard / settings / data-table layout, responsive, UI states | **Keep** |
| `frontend-design` | Typography, hierarchy, aesthetic direction when writing new UI | **Keep** |
| `diagram-design` | Architecture and flow diagrams for the Church Portal | Useful for IA |
| `modern-web-guidance` | Mandatory lookup before writing HTML/CSS/JS — modern API correctness | **Keep.** This is how I would check framework APIs |
| `screenshot-to-design` | Screenshot → design reference | Useful for auditing the legacy sites |
| `ant`, `elegant`, `huashu-design`, `guizang-ppt-skill` | Named aesthetic directions, decks | Optional; not the AFC direction |
| `avoid-ai-writing` | Strip AI tells from UI copy | **Keep.** AFC copy must not read as generated |

### Tooling available to me

**Google Stitch MCP** — `stitch_create_design_system`, `stitch_upload_design_md`,
`stitch_create_design_system_from_design_md`, `stitch_apply_design_system`,
`stitch_generate_screen_from_text`, `stitch_edit_screens`, `stitch_generate_variants`,
`stitch_export_project`, `stitch_init_stitch_project`.

This is how the ConvoCX design system was built — `convox/content/brand/design-system/design-tokens-light.json`
records a Stitch project id. **The same path is available for AFC** and is the
recommended route in §4.

### Present in `node_modules`

| Package | Version | Relevance |
| --- | --- | --- |
| `axe-core` | 4.13.0 | **Already available.** WCAG automation needs no new dependency |
| `lighthouse` | 13.4.1 | Performance / best-practices audit |
| `playwright` | 1.60+ | Reflow, target-size and screenshot verification |
| `puppeteer-core` | — | Available fallback browser |

---

## 2. Missing — needed for a design system to be maintainable

| # | Missing | Why it matters | Cost |
| --- | --- | --- | --- |
| M1 | **A skill that loads the AFC design system into an agent** | Tokens in files do not reach the work. An agent asked to design a Church Portal screen today would not know the palette, the pill geometry, or the label style exists | Low — one markdown skill + `skills/sync` |
| M2 | **Storybook** (`storybook`, `@storybook/html`) | Component catalogue with visual regression. Today the only live reference is one hand-built HTML page | Medium — 30+ components is past the point where a single page scales |
| M3 | **Style Dictionary** (`style-dictionary`) | Single-source tokens → CSS / JSON / DTCG / TS / Tailwind. Right now I wrote the token emitters by hand | Low |
| M4 | **Automated axe gate in CI** | `axe-core` is installed but **no run is wired up**. A regression ships silently | Low — one script + one workflow step |
| M5 | **Visual regression** (Chromatic / Percy / Playwright snapshots) | Token or component changes must not silently alter a production surface | Medium |
| M6 | **Figma REST integration** | No Figma file, no `figma-*` tooling. Handoff today is markdown + CSS. Fine for now; a real problem once a designer joins | Deferred — no designer on the team |
| M7 | **Nuxt UI / Tailwind in the Church Portal frontend** | `nuxt.config.ts` does not exist yet. The adapter is written and ready but has nothing to attach to | Blocked on [AFC-146](/AFC/issues/AFC-146) implementation |

---

## 3. Explicitly *not* installing, and why

- **A Figma-specific export pipeline.** No Figma file exists and no designer owns one.
  Building for a tool the company does not use is waste.
- **A second component library.** Nuxt UI plus the AFC CSS layer is enough. Adding
  Chakra or MUI would create the fourth divergent copy of a design system — the exact
  failure already visible in this workspace's four ConvoCX brand copies.
- **A CSS framework for build-less surfaces.** `docker/landing/`, `wp-content/`,
  `church-records/`, `cloudup-ppt/` and `flyers/` have no build step. They get a
  `<link>`, not a toolchain.

---

## 4. Proposed next steps, in dependency order

### P1 — Publish the AFC design system to Stitch (recommended, highest value)

Follow the path already proven by ConvoCX:

1. Write `design-system/DESIGN.md` in Stitch's format (name, colours, type, spacing,
   components, rules) — derived from `tokens/afc-tokens.css`.
2. `stitch_upload_design_md` → `stitch_create_design_system_from_design_md` on the
   Church Portal project.
3. `stitch_export_project` to pull the design system back out for review.

**Why it matters:** it makes the AFC system a first-class generation target, exactly
as ConvoCX's is. Any agent — mine, MediaTech's, an engineer's — can then generate an
on-brand screen instead of inventing one.

**Blocker:** I need the board's decision on fonts (§12 item 3 of the design system
doc) before publishing a type scale, because the Stitch theme would bake in whichever
face I choose.

### P2 — Author the missing design-system skill (M1) — **DONE in v1.0.0**

`afc-design-system` is now a **live company skill**, created from
`design-system/skills/afc-design-system/SKILL.md` on 2026-10-06.

| | |
| --- | --- |
| Skill id | `295b5f4b-516e-4769-9c94-213512efb744` |
| Key | `company/0214ae7c-…/afc-design-system` |
| Attached to | UXDesigner (me). MediaTech and Operations returned **403** — see below |

It carries the eight non-negotiables (no hard-coded hex, gold is graphic-only,
pills mean interactive, departments never touch neutrals, colour never identifies a
department, the deep blue is a deep blue, 44px targets, respect reduced motion), the
full ramp tables, the five seals with their optical factors, the three gate commands,
and the boundary against `afc-brand`.

**Permission gap, stated plainly:** `POST /api/agents/{id}/skills/sync` returns
**403 `deny_no_grant`** for MediaTech and Operations — I hold the grant only for
myself. The skill is installed in the company library and available; attaching it to
other agents needs an `agents:configure` grant from the CEO or CEO assistant. Until
then those two agents will not see it.

**Composition contract held:** nothing was forked. `image`, `video`, `impeccable`,
`ux-design`, `ui-patterns` and `afc-brand` are untouched. This is an additive layer
that states its load order.

### P3 — Wire the axe gate (M4) and the reflow check (P4 of the test matrix)

`axe-core` is already a dependency, so this is a script, not a purchase:

```
playwright → load each AFC surface → axe-core scan → exit non-zero on
serious/critical → plus the scrollWidth and 44px-target assertions
```

Run alongside `contrast-check.mjs`. Both should be pre-merge.

### P4 — Storybook (M2) and Style Dictionary (M3)

Worth it once the component count passes ~40 and a second frontend consumes the
system. Not yet: today there is one frontend and a working HTML reference page.

### P5 — Visual regression (M5)

Introduce at the same time as Storybook, not before — snapshots are only meaningful
against a stable catalogue.

---

## 5. Workspace reality that constrains any of this

Three findings from the workspace survey that every one of the above has to respect:

1. **No shared-package infrastructure exists.** No `packages/`, no `libs/`, and the
   root `pnpm-workspace.yaml` has **no `packages:` key** — only unresolved
   `allowBuilds` prompts. A linked npm package would not reach any project. The design
   system is therefore CSS-first and build-free by necessity, not by preference.
2. **`convox/`, `content/` and `memory/` are separate git repositories** pointing at
   the same GitHub upstream as the root. A file committed at the root is invisible to
   them. Any "available to all projects" claim has to account for this.
3. **Two lockfile systems coexist** (npm at root, pnpm in `convox/frontend`). Any
   dependency addition must pick one deliberately. The design system deliberately
   adds **zero** runtime dependencies.

---

## 6. Summary for the board

- **3** AFC company skills exist: `afc-brand` and `afc-appearance-guardrails` for
  *rendered media*, and — new in v1.0.0 — **`afc-design-system` for interfaces**.
  The gap that mattered is closed.
- **14** general design/UX skills are available, and **3** of them
  (`impeccable`, `design-review`, `avoid-ai-writing`) should be a standing part of
  AFC UI work.
- **0** skills are now missing that block interface work. `afc-design-system`
  carries the tokens; attaching it beyond my own agent needs an `agents:configure`
  grant, which is a permissions task rather than a design task.
- **4** tooling gaps are real (Storybook, Style Dictionary, an axe gate, visual
  regression). Only the axe gate is urgent, because `axe-core` is already installed
  and unused.
- **Google Stitch is already available to me** and is the proven route to publishing
  the AFC system as a generation target — blocked only on the font decision.