/**
 * Nuxt 3 configuration for the AFC Church Portal.
 *
 * Two things here are deliberate and should not be "tidied":
 *
 *  1. `build.transpile` lists `@afc/shared`. The shared package ships TypeScript
 *     source and has no build step, so Nuxt compiles it into the client and
 *     server bundles. Without this the workspace link resolves but the package
 *     is not transformed.
 *
 *  2. `runtimeConfig` keeps the Directus credential on the server side only. The
 *     `public` block holds nothing secret, per repo-plan §6: client-side code
 *     uses only `NUXT_PUBLIC_*` values. The browser never receives the scoped
 *     server token.
 */
import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/eslint'],

  // SSR is a requirement of the brief, not a default: the auth guard and the
  // capabilities endpoint both have to be able to answer before hydration, or
  // an unauthenticated user sees a flash of the staff shell.
  ssr: true,

  components: [
    // Page-scoped components are the default; portal shell components such as
    // PageHeader are shared by several pages and stay in the auto-import root.
    { path: '~/components', pathPrefix: false },
  ],

  devtools: { enabled: false },

  // PWA installability (AFC-686): manifest + icons + theme wiring. The
  // service worker itself ships verbatim from public/sw.js and registers
  // in plugins/pwa.client.ts — no module, no build step.
  app: {
    head: {
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/png', href: '/icons/icon-192.png' },
        {
          rel: 'apple-touch-icon',
          sizes: '180x180',
          href: '/icons/apple-touch-icon.png',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-2048x2732.png',
          media:
            '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-1668x2388.png',
          media:
            '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-1536x2048.png',
          media:
            '(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-1125x2436.png',
          media:
            '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-1242x2688.png',
          media:
            '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-828x1792.png',
          media:
            '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-1242x2208.png',
          media:
            '(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)',
        },
        {
          rel: 'apple-touch-startup-image',
          href: '/splash/apple-750x1334.png',
          media:
            '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)',
        },
      ],
      meta: [
        { name: 'theme-color', content: '#052e16' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
        { name: 'apple-mobile-web-app-title', content: 'AFC Portal' },
        { name: 'msapplication-TileColor', content: '#052e16' },
        { name: 'msapplication-config', content: '/browserconfig.xml' },
      ],
    },
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    /** Base URL of the Directus instance. Server-side only. */
    directusUrl: '',
    /** Scoped, short-lived token used for SSR reads. Never sent to the browser. */
    directusServerToken: '',
    /**
     * Token whose Directus policy is the *public* role's. Used only by the
     * unauthenticated registration proxy: an anonymous write must be constrained
     * by a public policy, not merely by the field allowlist in application code.
     * Absent means the public form is closed, and the route answers 503.
     */
    directusPublicToken: '',
    /** Signs the session cookie. Required in any environment but local dev. */
    sessionSecret: '',
    /**
     * When true, login is answered from seeded local identities instead of
     * Directus, so the shell and the auth guard can be exercised before the API
     * exists. Off unless NUXT_STUB_AUTH=true is set explicitly, and it must be
     * off in staging and production — it authenticates nobody.
     */
    stubAuth: false,
    /**
     * Member phone-OTP enablement (AFC-482, ADR-0009 decision 6). Default
     * off: the request/verify/self-service routes answer 503
     * member_otp_disabled. Flipping to NUXT_MEMBER_OTP_ENABLED=true
     * requires the AFC-478 SecurityEngineer re-review verdict plus CTO
     * approval -- it is an enablement action, not a config tweak.
     */
    memberOtpEnabled: false,
    public: {
      appName: 'AFC Church Portal',
      /** Browser-visible Directus URL, for file links and the public form. */
      directusUrl: 'http://localhost:8055',
    },
  },

  build: {
    transpile: ['@afc/shared'],
  },

  routeRules: {
    // The public registration form is the one page that must render without a
    // session. It is a server route writing through the allowlisted proxy, so it
    // is not cacheable.
    '/register': { ssr: true },
    '/api/**': { cors: false },
    // The worker script and manifest must revalidate, never stick behind an
    // edge cache: a stale worker or manifest poisons installability checks.
    '/pwa-sw.js': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
    '/manifest.webmanifest': {
      headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
    },
  },

  // The app manifest is Nuxt's build-polling feature for a statically served
  // error page. It is experimental in Nuxt 3, the portal is SSR behind a Nitro
  // server and never serves a static error page, and leaving it on makes
  // `pnpm dev:web` print five blocks of `Failed to resolve import
  // "#app-manifest"` before it will serve anything. The next developer to run
  // the dev server reads that as a broken scaffold.
  experimental: { appManifest: false },
  compatibilityDate: '2025-07-01',

  nitro: {
    compressPublicAssets: true,
  },

  // Tailwind v4 is wired through its Vite plugin rather than through a module.
  // Nuxt UI 3 depends on `@tailwindcss/vite` itself, so this is the same version
  // it resolves; declaring it here makes the requirement visible in this package
  // instead of only in Nuxt UI's dependency tree.
  vite: {
    plugins: [tailwindcss()],
  },

  typescript: {
    strict: true,
    // `nuxt typecheck` runs in CI as its own step. Doing it on every dev build
    // as well doubles the slowest part of the loop for a check that already runs
    // on push.
    typeCheck: false,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
