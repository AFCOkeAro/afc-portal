/**
 * PWA service-worker registration (AFC-686). Client-only: `pwa-sw.js`
 * ships verbatim from `public/`. After registration, a daily periodic sync
 * refresh of the offline shell is requested where the platform grants it —
 * everything is best-effort and swallowed; the portal works fully without
 * a worker.
 */
export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator && !import.meta.dev) {
    window.addEventListener('load', () => {
      // Versioned query string: a fresh edge-cache entry on every worker
      // revision, so updates propagate instead of sticking behind the CDN.
      // Bump the version whenever public/pwa-sw.js changes behaviour.
      navigator.serviceWorker
        .register('/pwa-sw.js?v=2')
        .then((registration) => {
          const periodic = (
            registration as unknown as {
              periodicSync?: {
                register: (
                  tag: string,
                  options?: Record<string, unknown>,
                ) => Promise<void>
              }
            }
          ).periodicSync
          if (!periodic) return
          periodic
            .register('afc-refresh-shell', { minInterval: 24 * 60 * 60 * 1000 })
            .catch(() => {})
        })
        .catch(() => {})
    })
  }
})
