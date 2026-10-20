<script setup lang="ts">
/**
 * Sticky anchor navigation for the single-page profile and dashboard surfaces.
 *
 * This is deliberately a `nav` of real anchors, not an ARIA tablist: the
 * sections are laid out on one page and deep links must survive a reload. The
 * permission-filtered section list is the caller's job, so a section a user
 * cannot read is never rendered here.
 */
export interface SectionLink {
  id: string
  label: string
}

const props = defineProps<{
  sections: SectionLink[]
}>()

const route = useRoute()
const activeId = ref(props.sections[0]?.id ?? '')
let observer: IntersectionObserver | undefined

function scrollToSection(id: string, moveFocus = false): void {
  if (!import.meta.client) return
  const section = document.getElementById(id)
  if (!section) return
  section.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (moveFocus) {
    const heading = section.querySelector<HTMLElement>('h2, h1')
    heading?.focus({ preventScroll: true })
  }
  history.replaceState(null, '', `#${id}`)
}

/** Deep links from other pages (`portal/<entity>/<id>#section`, US-S1 AC6). */
function scrollToHash(hash: string): void {
  const id = hash.replace(/^#/, '')
  if (!id || !props.sections.some((section) => section.id === id)) return
  activeId.value = id
  scrollToSection(id, true)
}

function selectSection(id: string): void {
  activeId.value = id
  scrollToSection(id, true)
}

function observeSections(): void {
  if (!import.meta.client || typeof IntersectionObserver === 'undefined') return
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)
      if (visible[0]?.target.id) activeId.value = visible[0].target.id
    },
    { rootMargin: '-120px 0px -55% 0px', threshold: [0, 0.25, 0.5, 0.75] },
  )
  for (const section of props.sections) {
    const element = document.getElementById(section.id)
    if (element) observer.observe(element)
  }
}

onMounted(async () => {
  await nextTick()
  const fromHash = window.location.hash.replace('#', '')
  if (fromHash && props.sections.some((section) => section.id === fromHash)) {
    activeId.value = fromHash
    scrollToSection(fromHash, true)
  }
  observeSections()
})

watch(
  () => route.hash,
  (hash: string) => {
    if (hash) scrollToHash(hash)
  },
)

onBeforeUnmount(() => {
  observer?.disconnect()
})

watch(
  () => props.sections.map((section) => section.id).join(','),
  async () => {
    await nextTick()
    observeSections()
  },
)
</script>

<template>
  <a
    href="#main-profile-content"
    class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:underline"
  >
    Skip to content
  </a>
  <nav
    aria-label="Page sections"
    class="section-nav sticky top-16 z-[5] -mx-5 mb-4 border-y border-gray-200 bg-white/90 px-5 py-2 backdrop-blur lg:-mx-8 lg:px-8 dark:border-gray-800 dark:bg-gray-950/90"
  >
    <ul class="flex gap-1 overflow-x-auto">
      <li v-for="section in sections" :key="section.id" class="shrink-0">
        <a
          :href="`#${section.id}`"
          :aria-current="activeId === section.id ? 'true' : undefined"
          class="block rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
          :class="{
            'bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-white':
              activeId === section.id,
          }"
          @click.prevent="selectSection(section.id)"
        >
          {{ section.label }}
        </a>
      </li>
    </ul>
  </nav>
</template>
