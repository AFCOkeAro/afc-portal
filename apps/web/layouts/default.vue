<script setup lang="ts">
/**
 * The staff shell.
 *
 * Navigation is filtered by `usePermissions`, so what appears here is what the
 * session's capabilities allow. A volunteer sees four links and no Welfare; an
 * area admin sees all six. Nothing in this file names a role.
 */
const { user, logout } = useAuth()
const permissions = usePermissions()

const items = computed(() =>
  NAVIGATION.filter(
    (item) => permissions.can(...item.requires) && item.inSidebar !== false,
  ),
)

const initials = computed(() => {
  const name = user.value?.firstName?.trim()
  return name ? name.slice(0, 1).toUpperCase() : '?'
})
</script>

<template>
  <div class="min-h-screen lg:flex">
    <aside
      class="border-b border-gray-200 bg-gray-50 lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex h-16 items-center gap-2 px-5">
        <UIcon name="i-lucide-church" class="size-6 text-primary-500" />
        <span class="font-semibold">AFC Portal</span>
      </div>

      <nav aria-label="Portal sections" class="px-3 pb-4 lg:pb-0">
        <ul class="space-y-1">
          <li v-for="item in items" :key="item.to">
            <NuxtLink
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
              active-class="bg-gray-200 font-medium text-gray-900 dark:bg-gray-800 dark:text-white"
            >
              <UIcon :name="item.icon" class="size-5 shrink-0" />
              <span>{{ item.label }}</span>
            </NuxtLink>
          </li>
        </ul>

        <p
          v-if="items.length === 0"
          class="px-3 py-4 text-sm text-gray-500 dark:text-gray-400"
        >
          No sections are available to this account yet.
        </p>
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col lg:pl-64">
      <header
        class="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-gray-200 bg-white/80 px-5 backdrop-blur dark:border-gray-800 dark:bg-gray-950/80"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
            {{ user?.email ?? 'Not signed in' }}
          </p>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">
            {{ user?.staffRole?.replace(/_/g, ' ') ?? '' }}
          </p>
        </div>

        <div class="flex items-center gap-3">
          <UAvatar :alt="initials" size="sm" />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-log-out"
            label="Sign out"
            @click="logout"
          />
        </div>
      </header>

      <main class="min-w-0 flex-1 p-5 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
