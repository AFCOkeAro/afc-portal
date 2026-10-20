<script setup lang="ts">
/**
 * Layout for the signed-out surface: the sign-in page only, at present.
 * Centred card, no navigation, no shell. A sign-in page that renders the staff
 * sidebar before the user has a session tells them they are somewhere they are
 * not.
 */
</script>

<template>
  <div
    class="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950"
  >
    <div class="w-full max-w-md">
      <NuxtLink
        to="/"
        class="mb-6 flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <UIcon name="i-lucide-church" class="size-7 text-primary-500" />
        <h1 class="text-xl font-semibold">AFC Church Portal</h1>
      </NuxtLink>
      <slot />
    </div>
  </div>
</template>
