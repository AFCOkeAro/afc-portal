/**
 * PWA service-worker registration (AFC-686). Client-only: `sw.js` ships
 * verbatim from `public/`, so registration is a one-liner. Failures are
 * swallowed — the portal works fully without a worker.
 */
export default defineNuxtPlugin(() => {
  if ('serviceWorker' in navigator && !import.meta.dev) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
})
