<script setup lang="ts">
/**
 * Badge print view (AFC-985 Phase 1).
 *
 * Renders exactly one badge per page from query params — no fetch, no list,
 * no roster: the kiosk navigates here with the single matched row it already
 * holds (name, ticket code, category), so this route can never enumerate
 * anyone. Query params carry only what the attendee just proved (their own
 * ticket) plus the display name the check-in response returned.
 *
 * Print sizes: @page 76x102mm (3x4in direct-thermal) with a 102x152mm (4x6in)
 * fallback class and an A4-cardstock fallback class, toggled by `?size=`.
 * One badge per page always (page-break-after). The QR prints at min 25mm:
 * TicketQr's SVG scales losslessly, and the print rules below pin it.
 */
import KioskBadge from '~/components/KioskBadge.vue'

definePageMeta({ layout: 'public' })

const route = useRoute()

const ticketCode = computed(() => String(route.query.ticket ?? ''))
const registrantName = computed(() => String(route.query.name ?? 'Guest'))
const eventName = computed(() => String(route.query.event ?? 'Church event'))
const category = computed(() => String(route.query.category ?? ''))
const checkedInAt = computed(() => {
  const value = route.query.at
  return typeof value === 'string' && value ? value : null
})
/* size=thermal (default 76x102mm) | large (102x152mm) | a4 (cardstock) */
const size = computed(() => {
  const value = String(route.query.size ?? 'thermal')
  return value === 'large' || value === 'a4' ? value : 'thermal'
})

function printBadge(): void {
  window.print()
}
</script>

<template>
  <main class="badge-print" :data-size="size">
    <div class="badge-print__actions no-print">
      <NuxtLink :to="`/events/${route.params.id}/kiosk`" class="badge-print__back">
        ← Back to kiosk
      </NuxtLink>
      <button type="button" class="badge-print__button" @click="printBadge">
        ⎙ Print badge
      </button>
      <p class="badge-print__hint">
        One badge per page. If the printer jams, the check-in is already saved — reprint
        from the kiosk queue, never re-tap check-in.
      </p>
    </div>
    <div class="badge-print__sheet">
      <KioskBadge
        :event-name="eventName"
        :registrant-name="registrantName"
        :category="category"
        :ticket-code="ticketCode"
        :checked-in-at="checkedInAt"
      />
    </div>
  </main>
</template>

<style>
/* 76x102mm (3x4in) direct-thermal default. */
@page {
  size: 76mm 102mm;
  margin: 4mm;
}
.badge-print {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--afc-space-4, 16px);
  padding: var(--afc-space-4, 16px);
  background: var(--afc-bg-canvas);
}
.badge-print__actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--afc-space-2, 8px);
}
.badge-print__back {
  font-size: var(--afc-text-sm, 14px);
  color: var(--afc-action-600, blue);
  min-height: var(--afc-control-min, 44px);
  display: inline-flex;
  align-items: center;
}
/* Pills mean interactive (AFC design system); 44px minimum target. */
.badge-print__button {
  border-radius: var(--afc-radius-pill, 999px);
  background: var(--afc-action-600, blue);
  color: white;
  font-weight: 600;
  padding: 0 var(--afc-space-5, 24px);
  min-height: var(--afc-control-min, 44px);
  min-width: var(--afc-control-min, 44px);
  border: none;
  cursor: pointer;
}
.badge-print__hint {
  margin: 0;
  max-width: 420px;
  text-align: center;
  font-size: var(--afc-text-xs, 12px);
  color: var(--afc-ink-400, gray);
}
.badge-print__sheet {
  display: flex;
  justify-content: center;
}
/* One badge per page — a second badge never shares the sheet. */
.badge-print__sheet .kiosk-badge {
  page-break-after: always;
  break-after: page;
}
/* QR prints at min 25mm with its quiet zone (TicketQr's viewBox padding). */
.badge-print__sheet .kiosk-badge__qr svg {
  width: 28mm;
  height: 28mm;
}
/* Fallback: 102x152mm (4x6in) sleeves. */
.badge-print[data-size='large'] .kiosk-badge__qr svg {
  width: 38mm;
  height: 38mm;
}
/* Fallback: A4 cardstock — badge centred on the sheet. */
.badge-print[data-size='a4'] .badge-print__sheet {
  width: 100%;
}
@media print {
  .no-print {
    display: none !important;
  }
  .badge-print {
    background: white;
    padding: 0;
    min-height: auto;
    display: block;
  }
  .badge-print__sheet {
    display: block;
  }
  .badge-print__sheet .kiosk-badge {
    border: none;
    max-width: none;
  }
  .badge-print[data-size='large'] {
    @page {
      size: 102mm 152mm;
      margin: 5mm;
    }
  }
  .badge-print[data-size='a4'] {
    @page {
      size: A4;
      margin: 12mm;
    }
  }
}
@media (prefers-reduced-motion: reduce) {
  .badge-print *,
  .badge-print *::before,
  .badge-print *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
