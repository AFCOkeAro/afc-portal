<script setup lang="ts">
/**
 * The staff shell.
 *
 * Navigation is filtered by `usePermissions`, so what appears here is what the
 * session's capabilities allow. A volunteer sees four links and no Welfare; an
 * area admin sees all six. Nothing in this file names a role.
 */
import type { NavigationItem } from '~/utils/navigation'

const { user, logout } = useAuth()
const permissions = usePermissions()

const items = computed(() =>
  NAVIGATION.filter(
    (item) => permissions.can(...item.requires) && item.inSidebar !== false,
  ),
)

/**
 * Sidebar sections (AFC-549). Groups render in NAVIGATION_GROUPS order and
 * groups with no permitted items are dropped, so capability-gating stays
 * per item: a volunteer sees only the sections their grants allow.
 */
const sections = computed(() =>
  NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: items.value.filter((item: NavigationItem) => item.group === group.key),
  })).filter((section) => section.items.length > 0),
)

/**
 * Collapsible sidebar state (AFC-565). All groups render collapsed on fresh
 * load; the expanded set persists per browser in localStorage so users are
 * not forced to re-expand on every navigation. SSR renders collapsed (empty
 * set) and hydration restores the stored set on mount.
 */
const SIDEBAR_EXPANDED_KEY = 'afc:sidebar-expanded-v1'
const expandedKeys = ref<string[]>([])

function isExpanded(key: string): boolean {
  return expandedKeys.value.includes(key)
}

function persistExpanded(): void {
  try {
    window.localStorage.setItem(SIDEBAR_EXPANDED_KEY, JSON.stringify(expandedKeys.value))
  } catch {
    // Storage unavailable (private mode, disabled) — sidebar still works,
    // state just resets to collapsed on next load.
  }
}

function toggleSection(key: string): void {
  expandedKeys.value = isExpanded(key)
    ? expandedKeys.value.filter((k: string) => k !== key)
    : [...expandedKeys.value, key]
  persistExpanded()
}

onMounted(() => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed))
      expandedKeys.value = parsed.filter((k): k is string => typeof k === 'string')
  } catch {
    expandedKeys.value = []
  }
})

const initials = computed(() => {
  const name = user.value?.firstName?.trim()
  return name ? name.slice(0, 1).toUpperCase() : '?'
})

/**
 * Account menu (AFC-574). `UDropdownMenu` supplies focus management and
 * Escape-to-close via the kit default; no custom trap is added. The header
 * row renders through `#content-top` so name/email + role stay visible in
 * the open menu. Sign out reuses the existing `useAuth` logout flow.
 */
const displayName = computed(
  () => user.value?.firstName?.trim() || user.value?.email || 'Signed in',
)

const menuItems = computed(() => [
  [
    {
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: '/settings',
    },
  ],
  [
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      onSelect(e: Event) {
        e.preventDefault()
        void logout()
      },
    },
  ],
])
</script>

<template>
  <div class="min-h-screen lg:flex">
    <aside
      class="border-b border-gray-200 bg-white lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900"
    >
      <NuxtLink
        to="/dashboard"
        class="flex h-16 items-center gap-2 px-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <UIcon name="i-lucide-church" class="size-6 text-primary-500" />
        <span class="font-semibold">AFC Portal</span>
      </NuxtLink>

      <nav aria-label="Portal sections" class="px-3 pb-4 lg:pb-0">
        <div v-for="section in sections" :key="section.key" class="mt-4 first:mt-1">
          <button
            type="button"
            :aria-expanded="isExpanded(section.key) ? 'true' : 'false'"
            :aria-controls="`sidebar-section-${section.key}`"
            class="flex w-full items-center justify-between rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-400 dark:hover:bg-gray-800"
            @click="toggleSection(section.key)"
          >
            <span>{{ section.label }}</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-4 shrink-0 transition-transform"
              :class="{ 'rotate-180': isExpanded(section.key) }"
            />
          </button>
          <ul
            v-if="isExpanded(section.key)"
            :id="`sidebar-section-${section.key}`"
            class="mt-1 space-y-1"
          >
            <li v-for="item in section.items" :key="item.to">
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
        </div>

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

        <UDropdownMenu :items="menuItems" :content="{ align: 'end' }">
          <UButton
            color="neutral"
            variant="ghost"
            square
            :aria-label="`Account menu for ${displayName}`"
            class="rounded-full"
          >
            <UAvatar :alt="initials" size="sm" />
          </UButton>

          <template #content-top>
            <div class="min-w-0 px-3 py-2">
              <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
                {{ displayName }}
              </p>
              <p class="truncate text-xs text-gray-500 dark:text-gray-400">
                {{ user?.staffRole?.replace(/_/g, ' ') ?? '' }}
              </p>
            </div>
            <USeparator />
          </template>
        </UDropdownMenu>
      </header>

      <main class="min-w-0 flex-1 p-5 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
