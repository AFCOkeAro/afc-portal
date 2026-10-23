<script setup lang="ts">
/**
 * Header search (AFC-585). Navigates to `/search?q=<text>`; the search page
 * keeps its sidebar entry and does the permission-filtered querying.
 *
 * Keyboard: `/` focuses the field, `Escape` clears it (and collapses the
 * mobile expansion when empty). Mobile renders an icon that expands inline.
 */
const route = useRoute()

const text = ref(typeof route.query.q === 'string' ? route.query.q : '')
const mobileOpen = ref(false)

const desktopWrap = ref<HTMLElement | null>(null)
const mobileWrap = ref<HTMLElement | null>(null)

function inputIn(wrap: HTMLElement | null): HTMLInputElement | null {
  return wrap?.querySelector('input') ?? null
}

/** Keep the field in sync when arriving from a shared `/search?q=` link. */
watch(
  () => route.query.q,
  (next: unknown) => {
    text.value = typeof next === 'string' ? next : ''
  },
)

function submit(): void {
  const query = text.value.trim()
  mobileOpen.value = false
  void navigateTo({ path: '/search', query: query ? { q: query } : {} })
}

function onEscape(): void {
  text.value = ''
  inputIn(desktopWrap.value)?.blur()
  inputIn(mobileWrap.value)?.blur()
  if (text.value === '') mobileOpen.value = false
}

function focusSearch(): void {
  const desktop = inputIn(desktopWrap.value)
  if (desktop && desktop.offsetParent !== null) {
    desktop.focus()
    return
  }
  mobileOpen.value = true
  nextTick(() => inputIn(mobileWrap.value)?.focus())
}

/**
 * Command palette entry (AFC-717). The `/` shortcut and `/search` fallback
 * stay exactly as they were; this only opens the overlay. Mobile has no
 * keyboard shortcut, so the search icon is its first-class entry point.
 */
function openPalette(): void {
  if (!import.meta.client) return
  window.dispatchEvent(new CustomEvent('afc:open-palette'))
}

function onGlobalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (
    target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)
  )
    return
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault()
    focusSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <div class="flex min-w-0 flex-1 items-center justify-center px-1 sm:px-2">
    <!-- Desktop: inline field + palette trigger (AFC-717) -->
    <div ref="desktopWrap" class="hidden w-full max-w-md items-center gap-1 md:flex">
      <UInput
        v-model="text"
        icon="i-lucide-search"
        placeholder="Search…  ( / )"
        aria-label="Site search"
        class="w-full"
        @keyup.enter="submit"
        @keyup.escape="onEscape"
      />
      <UButton
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-command"
        aria-label="Open command palette"
        title="Command palette (Ctrl+K)"
        @click="openPalette"
      />
    </div>

    <!-- Mobile: search icon opens the palette (AFC-717); the inline field
      remains as the /search fallback once the palette closes. -->
    <div class="flex w-full items-center justify-end gap-1 md:hidden">
      <UButton
        v-if="!mobileOpen"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-search"
        aria-label="Open search"
        @click="openPalette"
      />
      <div v-else ref="mobileWrap" class="flex w-full items-center gap-1">
        <UInput
          v-model="text"
          icon="i-lucide-search"
          placeholder="Search…"
          aria-label="Site search"
          class="w-full"
          autofocus
          @keyup.enter="submit"
          @keyup.escape="onEscape"
        />
        <UButton
          color="neutral"
          variant="ghost"
          square
          icon="i-lucide-x"
          aria-label="Close search"
          @click="mobileOpen = false"
        />
      </div>
    </div>
    <!-- Palette overlay mounts with the header (AFC-717): Ctrl/Cmd+K plus the
      mobile search-button entry above. Kept here (not in default.vue) so the
      header owns every search entry point in one file. -->
    <CommandPalette />
  </div>
</template>
