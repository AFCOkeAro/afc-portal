/**
 * AFC-1209 WP surface gate — focused tests for the code written in this task.
 *
 * Run: node --test tests/wp/test-wp-surface.mjs
 *
 * Asserts the AFC-1208 ADR acceptance that is checkable without a live WP:
 * pinned infra tags, exactly the shared pattern family + 3 templates, FREE on
 * every route, TBA badges for missing board inputs, zero speaker names,
 * FREE registration form with audience selector and no payment fields,
 * server-side-only portal submit (no browser-direct Directus, no token).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WP = join(ROOT, 'services', 'wp');
const THEME = join(WP, 'theme', 'afc-pathway-child');
const read = (p) => readFileSync(p, 'utf8');

const EXPECTED_PATTERNS = [
  'hero.php',
  'event-meta-band.php',
  'programme-accordion.php',
  'tba-speakers.php',
  'free-panel.php',
  'faq.php',
  'registration-embed.php',
  'final-cta.php',
];

test('infra: compose pins wp + db tags and keeps previous tags', () => {
  const compose = read(join(WP, 'compose.yml'));
  assert.match(compose, /image: wordpress:6\.8\.3-php8\.3-apache/);
  assert.match(compose, /image: mariadb:11\.4\.7/);
  assert.match(compose, /Previous tag kept for rollback/);
  assert.match(compose, /wordpress:6\.8-php8\.3-apache/);
  assert.match(compose, /mariadb:11\.4/);
  // Names only: no secret values.
  assert.ok(!/PASSWORD=\S+/.test(compose.replaceAll('${WP_DB_PASSWORD}', '').replaceAll('$$MARIADB_ROOT_PASSWORD', '')), 'compose must stay names-only');
});

test('infra: caddy snippet proxies wp behind existing pattern', () => {
  const snippet = read(join(WP, 'Caddyfile.snippet'));
  assert.match(snippet, /reverse_proxy wp:80/);
  assert.match(snippet, /http:\/\//);
  assert.match(snippet, /X-Content-Type-Options/);
});

test('theme: child declaration + tokens, no page builders', () => {
  const css = read(join(THEME, 'style.css'));
  assert.match(css, /Template: twentytwentyfive/);
  const tokens = JSON.parse(read(join(THEME, 'theme.json')));
  const palette = Object.fromEntries(tokens.settings.color.palette.map((p) => [p.slug, p.color]));
  assert.equal(palette.ink, '#090B19');
  assert.equal(palette.action, '#1A63B4');
  assert.equal(palette.success, '#175A35');
  const all = EXPECTED_PATTERNS.map((f) => read(join(THEME, 'patterns', f))).join('\n')
    + read(join(THEME, 'functions.php'));
  assert.ok(!/elementor|divi/i.test(all), 'no Elementor/Divi');
});

test('routes: exactly 3 templates, shared pattern family complete', () => {
  for (const f of EXPECTED_PATTERNS) {
    assert.ok(existsSync(join(THEME, 'patterns', f)), `missing pattern ${f}`);
  }
  assert.ok(existsSync(join(THEME, 'templates', 'page-home.html')), 'missing / template');
  assert.ok(existsSync(join(THEME, 'templates', 'page-ystc26.html')), 'missing /ystc26 template');
  assert.ok(existsSync(join(THEME, 'templates', 'page-register-confirmation.html')), 'missing confirmation template');
  const seed = read(join(WP, 'content', 'seed-pages.md'));
  assert.match(seed, /\/ystc26/);
  assert.match(seed, /\/register\/confirmation/);
  assert.match(seed, /No `\/app` page/);
});

test('fidelity: FREE label + TBA badges on all routes, zero speaker names', () => {
  const bodies = [
    ...EXPECTED_PATTERNS.map((f) => read(join(THEME, 'patterns', f))),
    read(join(THEME, 'templates', 'page-home.html')),
    read(join(THEME, 'templates', 'page-ystc26.html')),
    read(join(THEME, 'templates', 'page-register-confirmation.html')),
    read(join(THEME, 'parts', 'header.html')),
    read(join(THEME, 'parts', 'footer.html')),
    read(join(WP, 'content', 'seed-pages.md')),
    read(join(WP, 'README.md')),
  ].join('\n');
  assert.ok(/FREE/.test(bodies), 'FREE label must appear');
  const patternBody = (slug) => read(join(THEME, 'patterns', `${slug}.php`));
  const expand = (file) => file.replace(/<!-- wp:pattern \{"slug":"afc-pathway-child\/([\w-]+)"\} \/-->/g,
    (_, slug) => { try { return patternBody(slug); } catch { return ''; } });
  for (const scope of ['hero.php', 'event-meta-band.php', 'free-panel.php', 'registration-embed.php',
    'page-home.html', 'page-ystc26.html', 'page-register-confirmation.html']) {
    const file = scope.includes('page-')
      ? expand(read(join(THEME, 'templates', scope)))
      : read(join(THEME, 'patterns', scope));
    assert.ok(/FREE/.test(file), `FREE missing in ${scope}`);
  }
  assert.ok(/TBA/.test(bodies), 'TBA badges must appear');
  // Zero speaker names: forbid plausible person-name patterns in display copy.
  // Placeholders are generic ("Enter your full name"); no personal names.
  assert.ok(!/Adaeze|Okonkwo|Pastor [A-Z][a-z]+ [A-Z][a-z]+|Minister [A-Z]/i.test(bodies), 'speaker/personal names must not appear');
  // No photos of people: no img/media references at all (synthetic placeholders only).
  const themeMarkup = EXPECTED_PATTERNS.map((f) => read(join(THEME, 'patterns', f))).join('\n')
    + ['page-home.html', 'page-ystc26.html', 'page-register-confirmation.html'].map((f) => read(join(THEME, 'templates', f))).join('\n');
  assert.ok(!/<img|wp:image|unsplash|placeholder\.com|picsum/i.test(themeMarkup), 'no photographic imagery without consented photos');
});

test('registration: FREE, audience selector, no payment fields, server-side only', () => {
  const form = read(join(THEME, 'patterns', 'registration-embed.php'));
  assert.match(form, /name="audience"/);
  assert.match(form, /youth-self/);
  assert.match(form, /guardian-teen/);
  assert.match(form, /guardian_consent/);
  assert.match(form, /admin-post\.php/);
  assert.ok(!/name="[^"]*(pay|fee|amount|card|bank)[^"]*"|paystack|flutterwave|<input[^>]*card|type="number"[^>]*amount/i.test(form), 'no payment fields on a FREE form');
  const fn = read(join(THEME, 'functions.php'));
  assert.match(fn, /wp_remote_post/);
  assert.match(fn, /AFC_PORTAL_REGISTER_URL/);
  const fnCode = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/directus/i.test(fnCode), 'WP must never call Directus directly');
  assert.ok(!/token/i.test(fnCode.replaceAll('public token in WP', '')), 'no public token in WP');
  assert.match(fn, /AFC_YSTC_REGISTRATION_OPEN/);
});

test('content: programme dates + Isaiah 30:21 + PATHWAY present', () => {
  const ystc = read(join(THEME, 'templates', 'page-ystc26.html'))
    + read(join(THEME, 'patterns', 'hero.php'))
    + read(join(THEME, 'patterns', 'programme-accordion.php'));
  assert.ok(/Dec 25[–-]28, 2026/.test(ystc), 'event dates Dec 25-28 2026');
  assert.ok(/Isaiah 30:21/.test(ystc), 'PATHWAY + Isaiah 30:21');
  assert.ok(/PATHWAY/.test(ystc), 'PATHWAY theme');
});
