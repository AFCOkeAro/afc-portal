/**
 * Update check (AFC-821). Client-only.
 *
 * After a staging deploy the open page still runs the previous bundle (and
 * the previous capability snapshot) until the browser loads the new build —
 * previously that took a logout plus a hard reset to discover. This plugin
 * polls `/api/health` and compares its `sha` to the SHA baked into this
 * bundle (`public.buildSha`, from `NUXT_PUBLIC_BUILD_SHA` at build time).
 * On mismatch it flips the shared `afc:update-available` flag; the default
 * layout renders a one-click refresh banner from it.
 *
 * Silent by design: polling failures (offline, container restarting) leave
 * the flag alone rather than crying wolf. Role changes still need a fresh
 * sign-in — capabilities derive from the sealed session snapshot, and this
 * banner only covers code updates.
 */
export default defineNuxtPlugin(() => {
  const updateAvailable = useState<boolean>('afc:update-available', () => false)
  const baked = String(useRuntimeConfig().public.buildSha ?? '')
  if (!baked) return

  let lastCheck = 0
  async function check(): Promise<void> {
    const now = Date.now()
    if (now - lastCheck < 60_000) return
    lastCheck = now
    try {
      const health = await $fetch<{ sha?: string }>('/api/health', { timeout: 10000 })
      const served = String(health?.sha ?? '')
      if (served && served !== baked) updateAvailable.value = true
    } catch {
      // Offline or mid-deploy: stay silent; the next poll retries.
    }
  }

  const timer = setInterval(() => void check(), 5 * 60 * 1000)
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    ;(timer as unknown as { unref: () => void }).unref()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  setTimeout(() => void check(), 60_000)
})
