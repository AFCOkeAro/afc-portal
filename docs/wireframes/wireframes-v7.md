# Wireframes v7 — Shell UX: mobile nav, collapsible icon rail, record third column (AFC-628)

**Issue:** AFC-628 · **Parent:** AFC-460 · **Ancestor:** AFC-146 · **Owner:** UXDesigner (design only, no code) · **Version:** v7 (2026-10-21)
**Planning only — low-fidelity layout intent, not production UI.**
**Renderable:** `docs/wireframes/church-portal-wireframes-v7.html` (self-contained, open in a browser; 7 frames).

## How to view

Workspace copies: `docs/wireframes/church-portal-wireframes-v7.html` (frames) + this note (`docs/wireframes/wireframes-v7.md`).
Viewports used: mobile 390×844 · desktop 1440×900. Synthetic names/numbers only.

## Relationship to earlier sets

| Set | Status after this addendum |
| --- | --- |
| AFC-147 wireframes (14) · AFC-150 expansion (21) · AFC-151 v3 (12) · AFC-586 v4 (5) · AFC-592/596 v5 (7, hi-fi) · AFC-594 v6 (5) | All stand — v7 **replaces nothing**, adds the shell layer those sets assumed |

## Decision 1 — Mobile nav: left drawer (one recommendation)

**Recommended:** overlay left drawer with scrim; hamburger (44px) in the header; search + recent (max 3) at the drawer top; the same 5 capability-filtered groups with per-group expand/collapse (AFC-565 behaviour kept); body scroll-locked, Esc/scrim/swipe closes, focus returns to the trigger.

**Rejected:** (a) bottom bar — 25 destinations do not fit 5 tabs; the overflow "More" bucket destroys Information Scent and buries Office/Comms. (b) always-expanded inline sections — pushes first content 3+ viewports down on 390px (Cognitive Load, F-pattern). (c) top-block stack (current) — confirmed unfriendly in the user ask; kept only as the no-JS fallback.

**Rules:** drawer is the *same* `NAVIGATION` + `NAVIGATION_GROUPS` data as desktop, filtered by the same `permissions.can` gates — a group with zero grants renders nothing (fail-closed, never a disabled row). Safe-area `env()` padding bottom; landscape keeps the drawer and adds a two-pane list where width allows. 44px rows (AFC `--afc-control-min`), thumb-zone primary actions, visible focus ring.

**Lenses:** Hick's Law (5 heads, not 25 rows) · Fitts's Law · Progressive Disclosure · Recognition over Recall · Doherty Threshold (<400ms open) · POUR (focus trap, names, contrast via kit at build).

## Decision 2 — Desktop collapsible rail

**Behaviour:** two widths — expanded 256px (default, current `lg:w-64`) and collapsed 68px icon-only. A pinned toggle button above the sections switches widths (`aria-expanded`, shortcut `[`, 44px target). Rail shows ≤8 icons (Dashboard + most-used per group); overflow behind "···" opens the full drawer. Hover *and* focus show a tooltip with label + group; active item gets accent bar + `aria-current`; badges are dot + count-in-tooltip, never colour-only.

**Persistence + a11y (build contract):** `afc:shell-rail-v1 = expanded|collapsed` in localStorage (SSR defaults expanded; private-mode failure = session-only, sidebar still works). Toggle is a real `<button>`, keyboard reachable, visible focus ring. Content reflow: `lg:pl-64 → lg:pl-[76px]`; container keeps max-width, tables keep sticky first column, charts stretch without re-query. Section jump-navs live in page content and are unaffected. Motion 240ms AFC ease, collapsed to none under `prefers-reduced-motion` via tokens.

**Grouped sections + capability filtering preserved:** AFC-565 per-group collapse is kept *inside* both widths (two independent axes). Same `sections` computed — zero-grant groups absent in both widths.

**Lenses:** Miller's 7±2 · Uniform Connectedness · Von Restorff (icons alone would overload Working Memory — hence mandatory tooltips/names) · Shneiderman #8 (persistence) · colour-independence.

## Decision 3 — Record third column + "open full record"

**Layout:** on `[id]` pages ≥1280px: main + 280px sticky right rail; 1024–1279 rail becomes a disclosure under the header; <1024 rail stacks after content. Rail holds **summary + next actions + restricted-notice only** — never the editor, never destructive actions, never a duplicate of the main table. Rail open/collapsed persists per record-type (`afc:record-rail-v1`); fuller view is URL state (`?view=full`, shareable), never stored.

**"Fuller record" = two variants only:**

| Exemplar | Fuller means | Why |
| --- | --- | --- |
| People `/people/[id]` | **Expanded layout** — rail merges into a full-width dossier (profile + all gated sections + audit), `?view=full` | Dossier is referenced/shared/printed; a modal would trap a 6-section page (Forgiveness, Peak-End) |
| Events `/events/[id]` | **Expanded layout + linked sections** — rollups + registration log + blessing queue, each card deep-linking its list | Ops compares counts side-by-side with the table; modal would hide the table |
| Office task `/tasks/[id]` (exemplar for minutes/transfers/announcements) | **Modal dossier** — task + parent-minutes excerpt + audit + status actions; Esc closes, focus returns | Triaged from lists; page navigation would lose list context (Paradox of the Active User) |

**General rule:** every `[id]` page gets the rail; the fuller affordance is always an explicit **"Open full record ⤢"** button (44px, keyboard reachable). Variant (a) expanded layout for reference dossiers (people, events, minutes, welfare, households); variant (b) modal for triage-from-list (tasks, transfers, announcements, communications). No third variant without a UX proposal. Capability gates identical in rail + fuller views (`permissions.can` / `hiddenFields` — absent, not masked; masked cells say "Restricted", never blank). Tokens/components at build: AFC kit + Nuxt UI `UCard`/`UDrawer`/`UModal`/`UTooltip`; spacing from the 4px scale; 44px targets; no one-off values (any missing token = system proposal).

**Lenses:** Hierarchy visible in 2s · Goal-Gradient (events counts) · Chunking · Information Scent (clickable counts) · POUR + colour-independence + 44px motor targets · data-minimisation (rail shows only what the session may read; synthetic data in all frames).

## Frames (7, in the HTML file)

1. Mobile page with hamburger (390px) · 2. Drawer open (search + recent + gated groups) · 3. Desktop expanded 256px · 4. Desktop collapsed 68px rail (tooltips, reflow, build contract) · 5. Person record + rail + expanded-layout fuller · 6. Event record + rail (live rollups) + expanded fuller · 7. Office task + rail + modal fuller + general rule card.

## UX summary — tradeoffs, risks, acceptance

- **Changed:** shell gains three coherent behaviours (drawer / rail / third column) sharing one nav data source and one gating rule; record pages gain a summary rail plus an explicit fuller affordance with exactly two variants.
- **Tradeoffs:** drawer over bottom-bar costs one tap to reach nav but preserves all 25 destinations with scent (bottom-bar would hide 20); icon rail saves ~188px but requires tooltip discipline; modal variant (tasks) is deliberately non-shareable — deep work uses the expanded variant instead.
- **Residual risks:** icon metaphors for Office/Comms need validation with field staff (mitigation: labels always one hover/focus away + recent shortcuts); drawer focus-trap and rail persistence need QA at 390/768/1024/1280/1440 + landscape + reduced-motion (loop in QA per working rules; states listed in frames).
- **Acceptance (AFC-628):** mobile pattern specified with rationale ✓ · rail behaviour incl. persistence + a11y specified ✓ · third-column rule with three exemplars + general rule specified ✓ · grouped nav + capability filtering preserved in all states ✓ · wireframes + spec note posted on AFC-628 ✓. Coder build follows; no implementation in this issue.

---

*Extends wireframes, wireframes-expansion, wireframes-v3, wireframes-v4, wireframes-v5, wireframes-v6. Planning only.*
