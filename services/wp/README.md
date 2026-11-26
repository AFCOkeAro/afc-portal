# WordPress marketing surface — afcokearo.org (AFC-1209)

Child of [AFC-1208 ADR `adr-wp-build`](https://github.com/AFCOkeAro/afc-portal)
(rev `1b32693d`). Implements the CTO direction; fidelity target is the
AFC-1207 HiFi (`/` `029c1d61`, `/ystc26` `3ebad753`, confirmation `e2ed36aa`).

## Layout

- `compose.yml` — same-VPS `wp` + `wpmariadb` behind existing Caddy. Pinned
  tags (`wordpress:6.8.3-php8.3-apache`, `mariadb:11.4.7`); previous tags
  (`wordpress:6.8-php8.3-apache`, `mariadb:11.4`) kept as comments.
- `Caddyfile.snippet` — operator appends this block to the VPS Caddyfile.
  Kept separate from `services/staging/Caddyfile` (different host/domain).
- `.env.example` — names only; real values in host `.env` (mode 600).
- `theme/afc-pathway-child/` — TT5-child block theme + 8 Gutenberg patterns
  (hero, event-meta band, programme accordion, TBA-speakers, FREE panel,
  FAQ, registration-embed, final CTA) + 3 page templates + header/footer
  parts. No Elementor/Divi.
- `content/seed-pages.md` — the 3 pages, slugs, template assignment, XML
  export path.
- Registration: theme `functions.php` handler stub. WP form → admin-post.php
  → server-side `wp_remote_post` to `AFC_PORTAL_REGISTER_URL`
  (`POST /api/register` on portal staging). No browser-direct Directus, no
  public token in WP, no payment fields, no PII stored in WP.

## Deliberate choices (spec was silent)

1. **Templates over hierarchy guessing:** `/register/confirmation` uses a
   named page template (`page-register-confirmation.html`) assigned to the
   child page, not slug guessing — one `confirmation` slug can never collide.
2. **System font stack, no Google Fonts:** the HiFi references Google Fonts;
   the theme uses the system UI sans stack only (no Google Fonts, no remote font host) so the page stays under the 500KB
   budget on first load. If the board wants the exact HiFi faces, that is a
   follow-up with a self-hosted-fonts task.
3. **Generic name placeholder:** the HiFi input example names a person; the
   WP form uses “Enter your full name” — synthetic, zero names, grep-clean.
4. **No transient PII log:** the ADR allows a ≤30d transient log; this stub
   writes nothing (not even reference IDs) — the portal is the only store.

## Rollback

1. Content: Tools → Export → Pages (XML) before every change window.
2. Images: previous tags are commented in `compose.yml`; rollback =
   set image to previous tag, re-run start command.
3. Registration: `AFC_YSTC_REGISTRATION_OPEN=closed` serves the closed
   notice with no redeploy.

## Verify

`node --test tests/wp/test-wp-surface.mjs` — asserts pinned tags, 3 routes,
FREE on all pages, TBA badges, zero speaker names, no payment fields, no
Directus/token references, server-side-only submit.
