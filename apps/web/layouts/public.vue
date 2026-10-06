<script setup lang="ts">
/**
 * Layout for the public surface: the event registration form.
 *
 * No session, no navigation, nothing that implies staff tooling. The only link
 * out is to sign in, for a staff member who arrived here by mistake.
 */
</script>

<template>
  <div class="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
    <header
      class="border-b border-gray-200 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-church" class="size-6 text-primary-500" />
          <span class="font-semibold">AFC Church Portal</span>
        </div>
        <UButton
          to="/login"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Staff sign in"
        />
      </div>
    </header>

    <main class="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <slot />
    </main>

    <footer
      class="border-t border-gray-200 px-5 py-4 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
    >
      Apostolic Faith Church · Lagos North Area
    </footer>
  </div>
</template>
