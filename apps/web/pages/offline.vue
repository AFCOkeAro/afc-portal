<script setup lang="ts">
/**
 * Offline fallback (AFC-686). Rendered by the service worker when a
 * navigation fails with no connectivity. Uses the signed-out layout and no
 * session, so it renders identically online or off.
 */
definePageMeta({ layout: 'auth' })

function retry(): void {
  window.location.reload()
}
</script>

<template>
  <div class="text-center">
    <UIcon name="i-lucide-wifi-off" class="mx-auto size-10 text-gray-300 dark:text-gray-600" />
    <h2 class="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
      You are offline
    </h2>
    <p class="mt-2 text-sm text-gray-500 dark:text-gray-400">
      The portal needs a connection to load programmes, people and tasks.
      Reconnect and try again — nothing you submitted is lost on this device.
    </p>
    <UButton label="Retry" icon="i-lucide-rotate-cw" class="mt-6" @click="retry()" />
  </div>
</template>
