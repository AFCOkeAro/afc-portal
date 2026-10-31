<script setup lang="ts">
/**
 * AfcOfflineBanner — offline / pending-sync banner (AFC-959 P2).
 *
 * Sits under the staff-shell header (next to ImpersonationBanner). Renders
 * nothing while online with an empty outbox. While offline it owns
 * `role="status"` with the offline copy; while online with pending rows it
 * shows the waiting count plus a Retry now action.
 */
const { online, pending, retryNow } = useAfcSyncQueue()

const retrying = ref(false)

async function onRetry(): Promise<void> {
  if (retrying.value) return
  retrying.value = true
  try {
    await retryNow()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div
    v-if="!online || pending > 0"
    role="status"
    class="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900 lg:px-8 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
  >
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <UIcon name="i-lucide-wifi-off" class="size-4 shrink-0" />
      <p class="min-w-0 flex-1">
        <template v-if="!online">
          You are offline — changes save on this device and sync when reconnected.
        </template>
        <template v-else>
          {{ pending === 1 ? '1 change waiting' : `${pending} changes waiting` }}
          — everything is saved on this device.
        </template>
      </p>
      <UButton
        v-if="pending > 0"
        label="Retry now"
        icon="i-lucide-rotate-cw"
        size="xs"
        variant="outline"
        :loading="retrying"
        @click="onRetry()"
      />
    </div>
  </div>
</template>
