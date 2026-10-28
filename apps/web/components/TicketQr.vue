<script setup lang="ts">
import { encodeQR } from '@paulmillr/qr'

/**
 * Ticket QR (AFC-828 phase 4): a scannable registration code for check-in.
 *
 * Encoded client-side with a zero-dependency encoder and rendered as SVG
 * rects (no image round-trip, no file store). Fail-closed: an empty value
 * or an encode failure renders nothing — the text code stays the source
 * of truth and the scanner accepts typed codes too.
 */
const props = defineProps<{ value: string }>()

const cells = computed<boolean[][]>(() => {
  if (!props.value) return []
  try {
    return encodeQR(props.value, 'raw', { ecc: 'medium' }) as unknown as boolean[][]
  } catch {
    return []
  }
})

const size = computed(() => cells.value.length)
</script>

<template>
  <svg
    v-if="size > 0"
    :viewBox="`-2 -2 ${size + 4} ${size + 4}`"
    class="mx-auto size-40 rounded-lg bg-white p-2"
    role="img"
    aria-label="Registration QR code"
  >
    <g fill="currentColor" class="text-gray-900">
      <rect
        v-for="(on, index) in cells.flat()"
        :key="index"
        :x="index % size"
        :y="Math.floor(index / size)"
        :width="1"
        :height="1"
        :fill-opacity="on ? 1 : 0"
      />
    </g>
  </svg>
</template>
