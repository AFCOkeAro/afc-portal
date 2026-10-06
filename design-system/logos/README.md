# AFC logo and seal assets

Five marks. Four were supplied directly by the brand owner on **2026-10-06**; one
(Youth Development) is an archived recovery. Provenance is recorded per file so a
future replacement can be verified rather than assumed. Every colour quoted here
was **sampled from the pixels of the file named**, using
`node design-system/tools/sample-logo.mjs` — not eyeballed.

> **Revision 2 note.** Revision 1 shipped a *reconstructed* Africa for Christ
> emblem built on the assumption that no original existed, and an olive WECA
> accent sampled from a 2013 archive masthead. Both were wrong. The brand owner
> supplied the real Africa for Christ artwork, and sampling the actual WECA
> lockup showed it contains **no olive at all**. The reconstruction has been
> deleted. Do not restore it.

Do not re-colour, re-draw, or re-space any of these files. If a mark is wrong,
raise it with the brand owner — a modified logo is a new logo and needs their
sign-off.

---

## 1. `afc-jesus-light-of-world.png` — global AFC seal

| | |
| --- | --- |
| Source | `cdn.prod.website-files.com/60f82ad12067d1d904335cc9/60f82f570b7e63261d8ddb7b_5f7f5ce7a4ccd86f986d7491_AFCLogo_CMYK_reversed.png` |
| Retrieved | live, HTTP 200, from `apostolicfaith.org` |
| Format | PNG RGBA, 612 × 388 |
| Sampled | `#FFC51B` peak, H 45° S 1.00 L 0.55 → token `--afc-gold-400: #F5BE00` |
| Ink fills frame | 58.8% of canvas height — **largest transparent padding of the set** |
| Use | Global AFC wordmark. Homepage hero, letterhead, official documents. |

The mark is a gold calligraphic "Jesus" with a flame rising from the capital J
and a soft grey offset shadow. It is the origin of two system decisions: the gold
ramp, and the "light/radiance" motif.

**It is the reversed (white-ink) variant.** On a white surface it reads as very
light — pair it with `--afc-bg-inverse`, exactly as production does.

## 2. `weca-lockup-print.png` + `weca-lockup.svg` — WECA council lockup

| | |
| --- | --- |
| Source | `apostolicfaithweca.org/themes/custom/afmweca_vbs4/logo-print.png` and `.../logo.svg` |
| Retrieved | live, HTTP 200 |
| Format | PNG RGBA 170 × 80 · SVG (outlined paths, 226.67 × 106.67 viewBox, no `<text>`) |
| Sampled | gold `#FFD567` H 43° · strapline grey `#666666` |
| Ink fills frame | 91.2% |

Gold script "Jesus" over "THE LIGHT of THE WORLD" in tracked caps.

> **Revision 2 correction.** Revision 1 gave WECA an olive accent `#425A2A`,
> sampled from `_archive-africa4christ-masthead-2013.jpg`. Sampling this lockup
> directly proves the olive is **not in the mark** — the SVG contains only
> `#ffffff`, `#666666` and the gold. The olive was an artefact of an adjacent
> 2013 document, not the WECA identity. WECA's accent is now gold, the same
> family as AFC, and the ink token is derived from the strapline grey.

## 3. `afcmf-logo.jpg` — AFCMF, "Outstanding for Christ" · NEW IN REVISION 2

| | |
| --- | --- |
| Source | supplied by the brand owner on AFC-152, 2026-10-06 |
| Format | JPEG, 544 × 413, **opaque white background**, no alpha |
| Sampled | ring gold `#FBD959` H 47° · script orange `#EB7D26` H 26° · caption red `#DB393A` H 0° · shield slate `#6A6D7E` |
| Ink fills frame | 99.0% — the crest is a full-bleed shield |

A full-colour heraldic crest: shield, torch, teeth, gold ring reading
"ETERNAL YOUTH · SERVICE CORPS · SERVICE and HUMILITY", the script word
"Outstanding", the red caption "Outstanding for Christ", and "(AFCMF)".

**This is the only multi-ink mark in the set.** The others are single-ink or
two-ink, so its accent is taken from the most specific ink — the orange script —
rather than the gold ring, which it shares with AFC and WECA. Tokens:
`--afc-dept-afcmf-{accent,ink,red,ring,slate}`.

**Format caveat:** JPEG on white, no alpha. On a dark surface it will show a
white rectangle. Use the `.afc-seal` plate, or request a transparent PNG master.

## 4. `youth-development-logo.png` — Youth Development Department

| | |
| --- | --- |
| Source | `youth.afmweca.com/ydd_logo.png` — **host is dead** (TCP 80 and 443 closed) |
| Retrieved | Internet Archive capture `20221029071311` of the same path, HTTP 200 |
| Format | PNG RGBA, 1041 × 1080 |
| Sampled | teal `#0184B1` H 195° · red `#AD332E` H 2° · navy `#2B305C` H 234° |
| Ink fills frame | 99.3% |

Three abstract figures — raised arms, circular heads — rising from a shared base.
Teal centre figure, navy left, red right. It is the only one of the five marks
with a *people* motif, which is why it is the natural default for any surface
about people, households and welcome.

**Provenance caveat:** archived recovery, not a live asset. The mark is
byte-identical across the 2020 and 2022 site captures, so it is stable, but ask
the department to re-supply a current master with a transparent background
before this is used on a dark surface.

Also included: `youth-development-mark-103.png` (103 × 107 footer lockup) and
`youth-development-favicon.ico` (3 frames).

## 5. `afcf-logo.png` — Apostolic Faith Campus Fellowship

| | |
| --- | --- |
| Source | **supplied by the brand owner on AFC-152, 2026-10-06** (supersedes the `afcf-portal` copy used in revision 1) |
| Format | PNG RGBA, 493 × 355 |
| Sampled | `#29186B` — uniform across cross, book and rule, H 252° S 0.63 L 0.26 → `--afc-blue-600` |
| Ink fills frame | 100% |

A cross rising over an open Bible with the brush-script line "be a shining
light". Single flat ink, no gradient — the cleanest asset in the set.

## 6. `africa-for-christ-logo.png` — Africa for Christ · NEW IN REVISION 2

| | |
| --- | --- |
| Source | **supplied by the brand owner on AFC-152, 2026-10-06** |
| Format | PNG RGBA, 253 × 292, transparent background (63% of pixels) |
| Sampled | `#24155C` (island, densest) / `#28156F` (mainland) — H 252–253° S 0.63–0.68 L 0.26 |
| Ink fills frame | 82.9% |

The outline of the African continent with "AFRICA FOR CHRIST" knocked out of the
mainland and Madagascar drawn separately. The lettering is a knockout, not a
second ink, so the mark is effectively single-ink.

**This replaces the reconstruction.** Revision 1 asserted that no original
emblem existed anywhere, based on a sweep of four AFC domains plus the Internet
Archive CDX index. That sweep was thorough and still wrong — the asset was never
publicly served. The reconstruction (`africa-for-christ-emblem.svg`) has been
**deleted**. The olive-and-gold typographic lockup it contained is gone from the
system, and so is every colour token derived from it.

---

## Archive reference material (not for production use)

| File | What it is |
| --- | --- |
| `_archive-afrea4christ-masthead-2013.jpg` | 706 × 349 WECA masthead, 2013. Gold JTLW lockup + olive "WECA / West & Central Africa" wordmark over a campground photograph. Its path now 404s live. **The olive `#425A2A` here is what caused the revision 1 error — it is a 2013 document, not a brand mark. Do not sample brand colours from here.** |
| `_archive-afcf-portal-banner.jpg` | 1356 × 500 AFCF portal promo banner linking WECA to the campus app. |

`afc-favicon-32.png` (32 × 32, the "J" flame) is the current site icon.

---

## Optical weight — why the marks carry a correction factor

The five marks do not share a canvas, so one CSS `height` does not produce one
visual size. Measured ink height inside the rendered element:

| Mark | Ink fills its canvas | `--afc-seal-optical` |
| --- | --- | --- |
| JTLW | 58.8% | 1.70 |
| WECA | 91.2% | 1.13 |
| AFCMF | 99.0% | 1.00 |
| Youth Development | 99.3% | 1.08 |
| AFCF | 100% | 1.00 |
| Africa for Christ | 82.9% | 1.17 |

Without these factors the ink spans **1.70×** in height and **3.88×** in area
across six marks meant to read as equals. With them, ink height is within
**1.11×**. `node design-system/tools/seal-weight-check.mjs` re-measures this and
fails if a mark file is replaced without re-deriving its factor.

Height is the gate, not area. The marks differ in aspect ratio by design — the
WECA lockup is 2.1:1 and wide, Africa for Christ is 0.8:1 and tall — and
equalising area would require distorting artwork, which the contract forbids.

---

## Usage contract

1. **Clear space** — keep at least the height of the cross-bar (AFCF) or the
   flame height (JTLW) free on all four sides of any seal.
2. **Minimum size** — 24px tall for a favicon or app icon, 32px tall inline,
   56px tall in a topbar or masthead. Below 24px the AFCF brush script becomes
   illegible.
3. **Backgrounds** — the JTLW reversed variant and AFCMF ship with an **opaque
   white background**; Youth Development, AFCF and Africa for Christ ship with
   transparency but carry heavy padding. `.afc-seal` supplies a
   `--afc-bg-surface` plate. On a dark surface, either use the plate or request
   transparent masters — never set a white PNG directly on ink.
4. **Never** apply a department seal's colour to the interface chrome.
   Departments override `--afc-dept-accent` only; neutrals stay shared. See
   `../docs/DESIGN_SYSTEM.md` §6.
5. **Colour never identifies a department.** Three marks share gold, two share
   deep blue. A switcher that relies on accent hue alone fails WCAG 1.4.1. Pair
   the artwork with the name.
6. **Never** stretch, rotate, outline, or add effects to a seal.