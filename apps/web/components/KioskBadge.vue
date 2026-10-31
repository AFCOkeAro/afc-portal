<script setup lang="ts">
import TicketQr from './TicketQr.vue'

/**
 * Kiosk badge (AFC-985 Phase 1).
 *
 * One badge: event name, registrant name, category, ticket code text plus a
 * scannable QR. The QR payload is the ticket_code string exactly as issued —
 * the signed eventID+attendeeID lives server-side inside ticket_code, so no
 * new crypto is invented here. QR rendering (EC-M, quiet zone via TicketQr's
 * viewBox padding) is reused from TicketQr; this component only guarantees
 * the printed size (min 25mm) and the one-badge-per-page print rules, which
 * live in the badge print route's stylesheet.
 *
 * Synthetic fixture names only in tests — never a real registrant.
 */
const props = defineProps<{
  eventName: string
  registrantName: string
  category: string
  ticketCode: string
  checkedInAt?: string | null
}>()

const displayName = computed(() => props.registrantName.trim() || 'Guest')
</script>

<template>
  <article class="kiosk-badge" aria-label="Event badge">
    <p class="kiosk-badge__event">{{ eventName }}</p>
    <h2 class="kiosk-badge__name">{{ displayName }}</h2>
    <p class="kiosk-badge__category">{{ category }}</p>
    <div class="kiosk-badge__qr">
      <TicketQr :value="ticketCode" />
      <p class="kiosk-badge__code">{{ ticketCode }}</p>
    </div>
    <p v-if="checkedInAt" class="kiosk-badge__meta">Checked in {{ checkedInAt }}</p>
    <p class="kiosk-badge__meta">Please keep this badge and take your seat.</p>
  </article>
</template>

<style scoped>
.kiosk-badge {
  background: var(--afc-bg-surface, white);
  color: var(--afc-ink-900, black);
  border: 1px solid var(--afc-ink-50, currentColor);
  border-radius: var(--afc-radius-md, 8px);
  padding: var(--afc-space-4, 16px);
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--afc-space-2, 8px);
  align-items: center;
  text-align: center;
}
.kiosk-badge__event {
  margin: 0;
  font-size: var(--afc-text-xs, 12px);
  text-transform: uppercase;
  letter-spacing: var(--afc-track-label, 0.25em);
  color: var(--afc-ink-400, inherit);
}
.kiosk-badge__name {
  margin: 0;
  font-size: var(--afc-text-2xl, 24px);
  font-weight: 600;
  line-height: 1.15;
}
.kiosk-badge__category {
  margin: 0;
  font-size: var(--afc-text-sm, 14px);
  color: var(--afc-ink-400, inherit);
}
.kiosk-badge__qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--afc-space-2, 8px);
  background: white;
  padding: var(--afc-space-3, 12px);
}
/* Screen size stays compact; the print stylesheet scales the QR to the
   25mm minimum — the SVG scales losslessly, so one rule covers both. */
.kiosk-badge__qr svg {
  width: 160px;
  height: 160px;
}
.kiosk-badge__code {
  margin: 0;
  font-family: ui-monospace, monospace;
  font-weight: 600;
  letter-spacing: 0.12em;
}
.kiosk-badge__meta {
  margin: 0;
  font-size: var(--afc-text-xs, 12px);
  color: var(--afc-ink-400, inherit);
}
</style>
