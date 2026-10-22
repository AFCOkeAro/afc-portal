/**
 * AFC Portal service worker (AFC-686).
 *
 * Installability + offline resilience with no build step: this file ships
 * verbatim from `public/`, so keep it dependency-free and version the cache
 * name on every behavioural change.
 *
 * Strategy (deliberately conservative — the portal holds children's
 * records, so nothing authenticated is ever cached):
 * - Navigations: network-first (with navigation preload when available),
 *   falling back to the offline page. No HTML is stored, so a signed-out
 *   device can never replay another session.
 * - Versioned static assets (/_nuxt/), icons, screenshots and the manifest:
 *   cache-first with background refresh.
 * - Everything else (including /api/*): network only, untouched.
 * - Messages: SKIP_WAITING activates an updated worker on demand; the app
 *   triggers it after user confirmation. Periodic sync (when granted)
 *   refreshes the precached offline shell.
 */
const VERSION = 'afc-portal-v2'
const CORE = ['/offline', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      if ('navigationPreload' in self.registration) {
        try {
          await self.registration.navigationPreload.enable()
        } catch (error) {
          // Unsupported or denied: navigations still work, just slower.
        }
      }
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'afc-refresh-shell') {
    event.waitUntil(
      caches
        .open(VERSION)
        .then((cache) =>
          Promise.allSettled(
            CORE.map((path) => fetch(path).then((response) => cache.put(path, response))),
          ),
        ),
    )
  }
})

function isCacheableStatic(pathname) {
  return (
    pathname.startsWith('/_nuxt/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/screenshots/') ||
    pathname === '/manifest.webmanifest'
  )
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse
          if (preload) return preload
          return await fetch(request)
        } catch (error) {
          const cached = await caches.match('/offline')
          return cached || Response.error()
        }
      })(),
    )
    return
  }

  if (isCacheableStatic(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(VERSION).then((cache) => cache.put(request, copy))
            return response
          }),
      ),
    )
  }
})
