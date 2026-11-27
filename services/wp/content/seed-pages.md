# WP content seed — 3 pages, no more (AFC-1209)

Create exactly these pages in wp-admin (Pages → Add New). Slugs are
load-bearing: the portal, the theme templates, and the acceptance grep all
assume them.

| # | Title | Slug | Template (Page Attributes) | Notes |
|---|-------|------|----------------------------|-------|
| 1 | Home | `/` (homepage; Settings → Reading → static front page) | Home (`page-home.html`) | Church landing per AFC-1207 HiFi `029c1d61` |
| 2 | Youth Summit + Teen Camp 2026 | `/ystc26` | YSTC 2026 (`page-ystc26.html`) | Combined event per HiFi `3ebad753` |
| 3 | Registration confirmation | `/register/confirmation` (parent page `register` + child `confirmation`; parent holds no content) | Register confirmation (`page-register-confirmation.html`) | Shared pattern per HiFi `e2ed36aa`; renders success / waitlisted / error / closed variants via `?status=` |

No `/app` page. Do not create one.

## Template assignment

Each template file declares its assignment via its filename comment block;
select the matching template under Page Attributes → Template. If a template
is missing from the dropdown, the theme is not active — activate
“AFC Pathway Child” under Appearance → Themes first.

## Content export path (rollback + portability)

1. Tools → Export → Pages → Download Export File → store the resulting
   `*.wordpress.xml` next to the release tag (operator host, not git —
   exports can contain operator-entered contact details later).
2. Restore: fresh WP → Tools → Import → WordPress → assign templates per the
   table above → verify the 3-route grep in `tests/wp/test-wp-surface.mjs`
   equivalent (`FREE` present, `TBA` present, zero speaker names).

## Board inputs still TBA (badges, not blockers)

Venue final, age bands, safeguarding lead + policy, consent/medical process,
packing/pickup rules, public contacts, service times, branches, pastor
welcome, hero imagery, socials, deadline + capacity caps. Every one of these
renders as a visible `TBA` badge; none blocks launch of the surface.
