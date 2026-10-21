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
    <!-- Desktop: inline field -->
    <div ref="desktopWrap" class="hidden w-full max-w-md md:block">
      <UInput
        v-model="text"
        icon="i-lucide-search"
        placeholder="Search…  ( / )"
        aria-label="Site search"
        class="w-full"
        @keyup.enter="submit"
        @keyup.escape="onEscape"
      />
    </div>

    <!-- Mobile: icon that expands inline -->
    <div class="flex w-full items-center justify-end gap-1 md:hidden">
      <UButton
        v-if="!mobileOpen"
        color="neutral"
        variant="ghost"
        square
        icon="i-lucide-search"
        aria-label="Open search"
        @click="mobileOpen = true"
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
  </div>
</template>
