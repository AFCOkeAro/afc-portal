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
const route = useRoute()

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
 * Accordion sidebar state. Exactly one section is open at a time: opening a
 * section closes the others, and the choice persists per browser in
 * localStorage. SSR renders collapsed and hydration restores on mount. The
 * section holding the current route opens automatically on navigation, so
 * the menu always reflects where the account is.
 */
const SIDEBAR_EXPANDED_KEY = 'afc:sidebar-expanded-v1'
const expandedKeys = ref<string[]>([])

/**
 * Mobile drawer state. Below the lg breakpoint the menu lives behind a
 * hamburger button in the brand row instead of pushing content down the
 * page; it closes on every navigation. Desktop is unaffected.
 */
const mobileOpen = ref(false)

/**
 * Icon-rail state. On large screens the sidebar collapses to a narrow rail
 * that shows only item icons (labels remain available as tooltips). Persisted
 * beside the section set; the narrow layout is desktop-only, so mobile keeps
 * the full menu.
 */
const SIDEBAR_RAIL_KEY = 'afc:sidebar-rail-v1'
const railCollapsed = ref(false)

function toggleRail(): void {
  railCollapsed.value = !railCollapsed.value
  try {
    window.localStorage.setItem(SIDEBAR_RAIL_KEY, JSON.stringify(railCollapsed.value))
  } catch {
    // Storage unavailable: the rail still toggles for this page view.
  }
}

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
  expandedKeys.value = isExpanded(key) ? [] : [key]
  persistExpanded()
}

/** The section holding a path: exact item match, else longest prefix (so
 *  detail pages like /tasks/:id keep their section open). */
function sectionForPath(path: string): string | null {
  let best: { key: string; length: number } | null = null
  for (const section of sections.value) {
    for (const item of section.items) {
      if (path === item.to || path.startsWith(`${item.to}/`)) {
        if (!best || item.to.length > best.length) best = { key: section.key, length: item.to.length }
      }
    }
  }
  return best?.key ?? null
}

watch(
  () => route.path,
  (path) => {
    mobileOpen.value = false
    const current = sectionForPath(path)
    if (current !== null && !isExpanded(current)) {
      expandedKeys.value = [current]
      persistExpanded()
    }
  },
)

onMounted(() => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPANDED_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const keys = parsed.filter((k): k is string => typeof k === 'string')
        if (keys.length > 0) expandedKeys.value = [keys[0]]
      }
    }
  } catch {
    expandedKeys.value = []
  }
  if (expandedKeys.value.length === 0) {
    const current = sectionForPath(route.path)
    if (current !== null) expandedKeys.value = [current]
  }

  try {
    railCollapsed.value = window.localStorage.getItem(SIDEBAR_RAIL_KEY) === 'true'
  } catch {
    railCollapsed.value = false
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
      class="border-b border-gray-200 bg-white transition-[width] lg:fixed lg:inset-y-0 lg:border-b-0 lg:border-r dark:border-gray-800 dark:bg-gray-900"
      :class="railCollapsed ? 'lg:w-16' : 'lg:w-64'"
    >
      <div class="flex h-16 items-center justify-between gap-1 px-3">
        <NuxtLink
          to="/dashboard"
          class="flex min-w-0 items-center gap-2 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          :class="railCollapsed ? 'lg:mx-auto' : ''"
        >
          <UIcon name="i-lucide-church" class="size-6 shrink-0 text-primary-500" />
          <span v-if="!railCollapsed" class="truncate font-semibold">AFC Portal</span>
        </NuxtLink>
        <button
          type="button"
          class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 lg:hidden dark:text-gray-400 dark:hover:bg-gray-800"
          :aria-label="mobileOpen ? 'Close menu' : 'Open menu'"
          :aria-expanded="mobileOpen ? 'true' : 'false'"
          aria-controls="portal-sections-nav"
          @click="mobileOpen = !mobileOpen"
        >
          <UIcon :name="mobileOpen ? 'i-lucide-x' : 'i-lucide-menu'" class="size-5" />
        </button>
      </div>

      <div class="hidden px-3 lg:block">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-400 dark:hover:bg-gray-800"
          :class="railCollapsed ? 'justify-center px-0' : ''"
          :aria-label="railCollapsed ? 'Expand menu' : 'Collapse menu'"
          :aria-pressed="railCollapsed ? 'true' : 'false'"
          @click="toggleRail"
        >
          <UIcon
            :name="railCollapsed ? 'i-lucide-chevrons-right' : 'i-lucide-chevrons-left'"
            class="size-4 shrink-0"
          />
          <span v-if="!railCollapsed">Collapse menu</span>
        </button>
      </div>

      <nav aria-label="Portal sections" class="px-3 pb-4 lg:pb-6">
        <!-- Full menu: mobile behind the hamburger, desktop while expanded. -->
        <div
          id="portal-sections-nav"
          :class="[railCollapsed ? 'lg:hidden' : '', mobileOpen ? 'block' : 'hidden lg:block']"
        >
          <div v-for="section in sections" :key="section.key" class="mt-4 first:mt-1">
            <div class="flex items-center gap-1">
              <NuxtLink
                :to="section.to"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-400 dark:hover:bg-gray-800"
                :title="`Open ${section.label}`"
              >
                <UIcon :name="section.icon" class="size-4 shrink-0" />
                <span class="truncate">{{ section.label }}</span>
              </NuxtLink>
              <button
                type="button"
                :aria-expanded="isExpanded(section.key) ? 'true' : 'false'"
                :aria-controls="`sidebar-section-${section.key}`"
                :aria-label="`${isExpanded(section.key) ? 'Collapse' : 'Expand'} ${section.label}`"
                class="rounded-md p-1 text-gray-500 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-400 dark:hover:bg-gray-800"
                @click="toggleSection(section.key)"
              >
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 shrink-0 transition-transform"
                  :class="{ 'rotate-180': isExpanded(section.key) }"
                />
              </button>
            </div>
            <ul
              v-if="isExpanded(section.key)"
              :id="`sidebar-section-${section.key}`"
              class="mt-1 space-y-1"
            >
              <li v-for="(item, index) in section.items" :key="`${section.key}:${index}:${item.to}`">
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
        </div>

        <!-- Icon rail: desktop only, flattened items with a divider per section. -->
        <div v-if="railCollapsed" class="hidden lg:block">
          <div
            v-for="(section, index) in sections"
            :key="section.key"
            class="space-y-1"
            :class="{ 'mt-2 border-t border-gray-200 pt-2 dark:border-gray-800': index > 0 }"
          >
            <NuxtLink
              v-for="(item, index) in section.items"
              :key="`${section.key}:${index}:${item.to}`"
              :to="item.to"
              :title="item.label"
              :aria-label="item.label"
              class="flex items-center justify-center rounded-lg p-2 text-gray-700 hover:bg-gray-200 dark:text-gray-200 dark:hover:bg-gray-800"
              active-class="bg-gray-200 text-gray-900 dark:bg-gray-800 dark:text-white"
            >
              <UIcon :name="item.icon" class="size-5 shrink-0" />
            </NuxtLink>
          </div>
        </div>
      </nav>
    </aside>

    <div
      class="flex min-w-0 flex-1 flex-col"
      :class="railCollapsed ? 'lg:pl-16' : 'lg:pl-64'"
    >
      <header
        class="sticky top-0 z-10 flex h-16 items-center justify-between gap-2 border-b border-gray-200 bg-white/80 px-3 backdrop-blur sm:px-5 dark:border-gray-800 dark:bg-gray-950/80"
      >
        <div class="min-w-0 shrink-0">
          <p class="truncate text-sm font-medium text-gray-900 dark:text-white">
            {{ user?.email ?? 'Not signed in' }}
          </p>
          <p class="truncate text-xs text-gray-500 dark:text-gray-400">
            {{ user?.staffRole?.replace(/_/g, ' ') ?? '' }}
          </p>
        </div>

        <!-- Header search (AFC-585): desktop field, mobile icon-expands. -->
        <HeaderSearch />

        <div class="flex shrink-0 items-center gap-1">
          <!-- Notification bell (AFC-585): client-aggregated from endpoints
            the session may already load; no new backend. Sits next to the
            AFC-574 avatar menu. -->
          <NotificationBell />

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
        </div>
      </header>

      <main class="min-w-0 flex-1 p-5 lg:p-8">
        <slot />
      </main>
    </div>
  </div>
</template>
