<script setup lang="ts">
/**
 * ImpersonationBanner — visible preview marker with one-click exit (AFC-684).
 *
 * Renders only while `GET /api/auth/me` reports an `impersonatedBy` claim.
 * The banner names the actor, the target, the reason, and the expiry, and the
 * exit button restores the actor session. No role names are branched on here:
 * visibility comes from the claim's presence, which the server sets.
 */

import type { AuthState } from '~/server/api/auth/me.get'

const api = useApi()
const { invalidate } = useAuth()

// Exposed before the top-level await below: vue/no-expose-after-await
// forbids defineExpose after an await expression. The wrapper closes over
// the binding, so it resolves once setup completes.
defineExpose({ refresh: () => refresh() })

const { data, refresh } = await useAsyncData<AuthState>('afc:impersonation-banner', () =>
  api.get<AuthState>('/api/auth/me'),
)

const claim = computed(() => data.value?.impersonatedBy ?? null)

async function exit(): Promise<void> {
  await api.post('/api/admin/impersonate-exit')
  invalidate()
  await refresh()
  await navigateTo('/dashboard', { replace: true })
}
</script>

<template>
  <div
    v-if="claim"
    role="status"
    aria-live="polite"
    class="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
  >
    <p class="min-w-0">
      Previewing as
      <strong>{{ claim.targetKind }} {{ claim.targetId }}</strong>
      — started by {{ claim.actorEmail }} ({{ claim.reason }}). Ends
      {{ claim.expiresAt }}.
    </p>
    <UButton
      size="xs"
      color="warning"
      variant="solid"
      aria-label="Exit preview"
      @click="exit"
    >
      Exit preview
    </UButton>
  </div>
</template>
