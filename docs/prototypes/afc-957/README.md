# AFC-957 — Portal resilient states (P1–P6)

Static, self-contained prototypes for the ten states in the AFC-954 plan v2 /
AFC-956 spec, built on the AFC design system (`design-system/tokens` +
`design-system/components`).

| State | Surface | Source |
| --- | --- | --- |
| P1 (9) registration + inline validation | `registration-form.html` | AFC-958 |
| P2 (4, 8) offline queue + session draft | `afc-sync-queue.{css,js}`, `attendance-capture.html`, `newcomer-intake.html`, `welfare-visit-notes.html`, `sync-settings.html` | AFC-959 |
| P3 (3, 6, 7) scoped error cards | `design-system/components/afc-resilient-states.css` | AFC-960 |
| P4 (1, 6) first-run empties | `events.html`, `welfare-cases.html`, `campus-groups.html`, `reports.html` | AFC-960 |
| P5 (2, 5, 10) loading / slow / success | `attendance-capture.html`, `finance-export.html` | AFC-959 |
| QA | determinate progress + cancel regions, brand/logo contrast | AFC-962 |

Open any `.html` directly, or serve the repo root over HTTP (the pages read
token CSS at runtime, so `file://` blocks that request):

```
python3 -m http.server 8899 --bind 127.0.0.1
# http://127.0.0.1:8899/docs/prototypes/afc-957/reports.html
```

## Gate evidence (2026-10-31)

Design-system gates, run against this tree:

```
node design-system/tools/contrast-check.mjs   -> 50/50 pairs pass
node design-system/tools/reflow-check.mjs     -> 5/5 viewports pass (1440/1280/768/390/320)
node design-system/tools/seal-weight-check.mjs-> 6/6 marks pass
node design-system/tools/tab-role-check.mjs   -> all checks pass
```

Per-screen gate (`tools/p6-state-gate.mjs`), 10 screens x 2 viewports:

```
PASS  P1 registration-form      overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P2+P5 attendance-capture  overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P2 newcomer-intake        overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P2 welfare-visit-notes    overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P2 sync-settings          overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P5 finance-export         overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P4 events                 overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P4 welfare-cases          overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P4 campus-groups          overflow=0 targets<44=0 axe=0 jsErr=0
PASS  P4 reports                overflow=0 targets<44=0 axe=0 jsErr=0
```

Queue behaviour suite:

```
node docs/prototypes/afc-957/afc-sync-queue.test.mjs
11 checks passed.
```

## P6 compliance notes

- **Contrast/reflow:** covered by the design-system gates above; no new pair
  ships without a `pairs.json` entry.
- **Targets:** 44px cozy default; zero controls below it at either viewport.
- **Focus:** `:focus-visible` ring from `--afc-shadow-focus` on every
  interactive; no outline removed without replacement.
- **Motion:** reduced-motion blocks in `afc-sync-queue.css` and
  `afc-resilient-states.css`; information (%, status) still updates.
- **Screen reader:** banner/queue/progress use `role="status"`/`aria-live`;
  P1 wires `aria-describedby` + `aria-invalid` dynamically; status is never
  colour-alone.
- **Data minimisation:** no input carries `checked`; consent is an explicit
  unchecked opt-in; fields limited to what the task needs. Finance surfaces
  write a durable ledger row, not just a toast.
- **Synthetic data only:** "Adaeze Okafor", `0803 123 456 7`-style numbers,
  `example.org` addresses. No real member or child data.

## Scope note

The P3 card **CSS** is delivered here. The React implementation written
during AFC-960 targeted `convox/frontend` (ConvoCX), which is a different
product and has no AFC token layer — that code is not part of this delivery.
The Portal app (`apps/web`, Vue/Nuxt) still needs the card wired into its
pages; tracked as a follow-up.
