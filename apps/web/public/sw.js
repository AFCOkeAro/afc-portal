/**
 * AFC Portal service worker (AFC-686).
 *
 * Installability + offline resilience with no build step: this file ships
 * verbatim from `public/`, so keep it dependency-free and version the cache
 * name on every behavioural change.
 *
 * Strategy (deliberately conservative — the portal holds children's
 * records, so nothing authenticated is ever cached):
 * - Navigations: network only, falling back to the offline page. No HTML
 *   is stored, so a signed-out device can never replay another session.
 * - Versioned static assets (/_nuxt/), icons, screenshots and the manifest:
 *   cache-first with background refresh.
 * - Everything else (including /api/*): network only, untouched.
 */
const VERSION = 'afc-portal-v1'
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
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
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
      fetch(request).catch(() => caches.match('/offline')),
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
