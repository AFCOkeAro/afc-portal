<script setup lang="ts">
/**
 * AfcErrorCard — scoped error card (states 3/6/7).
 *
 * Vue port of the `afc-error-card` vanilla helper (AFC-994) and the
 * `ErrorDisplay` scoped-card pattern (AFC-960), restyled in the portal's
 * Tailwind / Nuxt UI vocabulary. The canonical token-driven spec lives in
 * `design-system/components/afc-resilient-states.css`; this component is
 * its Tailwind mirror for `apps/web`, which does not load design-system CSS.
 *
 * Contract (mirrors the vanilla helper):
 *   - `tone`: danger = broken (3), neutral/info = empty-but-working (6),
 *     warn = role-gate (7).
 *   - Title + cause + user-doable fix are always rendered. Technical detail
 *     (`code`, `requestId`) goes to the console only — never into the DOM.
 *   - Card uses `role="alert"`. Retry is a 44px primary target;
 *     secondary is a quiet underline action.
 *   - `staleText` renders the state-3 cached-copy note above the card.
 */
const props = withDefaults(
  defineProps<{
    tone?: 'danger' | 'neutral' | 'info' | 'warn'
    title?: string
    cause?: string
    fix?: string
    retryLabel?: string
    secondaryLabel?: string
    staleText?: string
    code?: string | number
    requestId?: string
  }>(),
  {
    tone: 'danger',
    title: 'Could not load this panel',
    cause: 'This panel did not load.',
    fix: 'Check your connection, then retry this panel.',
    retryLabel: 'Retry this panel',
    secondaryLabel: undefined,
    staleText: undefined,
    code: undefined,
    requestId: undefined,
  },
)

const emit = defineEmits<{
  retry: []
  secondary: []
}>()

const toneMap = {
  danger: {
    ring: 'border-l-red-500 bg-red-50 dark:bg-red-950/40',
    icon: 'i-lucide-circle-alert',
    iconColor: 'text-red-600 dark:text-red-400',
  },
  neutral: {
    ring: 'border-l-gray-400 bg-gray-50 dark:bg-gray-900',
    icon: 'i-lucide-inbox',
    iconColor: 'text-gray-500 dark:text-gray-400',
  },
  info: {
    ring: 'border-l-sky-500 bg-sky-50 dark:bg-sky-950/40',
    icon: 'i-lucide-info',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  warn: {
    ring: 'border-l-amber-500 bg-amber-50 dark:bg-amber-950/40',
    icon: 'i-lucide-triangle-alert',
    iconColor: 'text-amber-600 dark:text-amber-400',
  },
} as const

const tone = computed(() => toneMap[props.tone] ?? toneMap.danger)

/* Technical detail goes to console/telemetry only — never into the DOM. */
onMounted(() => {
  if (props.code !== undefined || props.requestId !== undefined) {
    const parts = ['[afc-error]', props.title]
    if (props.code !== undefined) parts.push(`(code: ${String(props.code)})`)
    if (props.requestId !== undefined) parts.push(`(ref: ${props.requestId})`)
    console.error(`${parts.join(' ')}: ${props.cause}`)
  }
})
</script>

<template>
  <div>
    <p
      v-if="staleText"
      class="mb-2 text-xs text-gray-500 dark:text-gray-400"
    >
      {{ staleText }}
    </p>
    <div
      role="alert"
      class="flex gap-4 rounded-lg border border-gray-200 border-l-4 p-5 dark:border-gray-800"
      :class="tone.ring"
    >
      <span class="grid size-11 shrink-0 place-items-center rounded-full bg-white dark:bg-gray-900" aria-hidden="true">
        <UIcon :name="tone.icon" class="size-5" :class="tone.iconColor" />
      </span>
      <div class="min-w-0 flex-1">
        <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
          {{ title }}
        </h3>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {{ cause }}
        </p>
        <p class="mt-1 text-sm text-gray-600 dark:text-gray-300">
          <strong class="font-semibold text-gray-900 dark:text-white">What you can do: </strong>{{ fix }}
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <UButton
            :label="retryLabel"
            icon="i-lucide-rotate-cw"
            class="min-h-11"
            :aria-label="`${retryLabel}: ${title}`"
            @click="emit('retry')"
          />
          <UButton
            v-if="secondaryLabel"
            :label="secondaryLabel"
            variant="link"
            color="neutral"
            class="min-h-11"
            @click="emit('secondary')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
