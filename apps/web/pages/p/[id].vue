<script setup lang="ts">
/**
 * Public event landing page (AFC-828 phase 1).
 *
 * One public page per event: details + a register call-to-action that
 * lands on the existing public registration form with the event
 * preselected. Reads the session-free /api/public/events/:id feed, so the
 * only rows that ever render are visibility=public AND status=published.
 *
 * Later phases (recorded on AFC-828, not built here): resources download,
 * feedback form, registration code + QR display, blessings.
 */
definePageMeta({ layout: 'public' })

interface PublicEvent {
  id: string
  title: string
  summary: string | null
  event_type: string
  start_at: string | null
  end_at: string | null
  branch_name: string | null
}

const route = useRoute()
const id = String(route.params.id ?? '')

const { data, pending, error } = await useAsyncData(`public-event-${id}`, () =>
  $fetch<{ data: PublicEvent }>(`/api/public/events/${id}`),
)

const event = computed(() => data.value?.data ?? null)

function formatDate(value: string | null): string {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10)
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
</script>

<template>
  <div class="mx-auto max-w-2xl px-4 py-10">
    <p v-if="pending" class="text-sm text-gray-500">Loading event…</p>
    <p v-else-if="error || !event" class="text-sm text-gray-500">
      That event was not found, or registration is not open for it.
    </p>
    <article v-else>
      <p class="text-xs font-medium uppercase tracking-wide text-gray-500">
        {{ event.event_type }}{{ event.branch_name ? ` · ${event.branch_name}` : '' }}
      </p>
      <h1 class="mt-2 text-3xl font-bold">{{ event.title }}</h1>
      <p v-if="event.start_at" class="mt-2 text-sm text-gray-600">
        {{ formatDate(event.start_at) }}
        <span
          v-if="event.end_at && event.end_at.slice(0, 10) !== event.start_at.slice(0, 10)"
        >
          — {{ formatDate(event.end_at) }}
        </span>
      </p>
      <p v-if="event.summary" class="mt-4 whitespace-pre-line text-gray-700">
        {{ event.summary }}
      </p>
      <div class="mt-8 flex flex-wrap gap-3">
        <UButton
          :to="`/register?event=${event.id}`"
          label="Register for this event"
          icon="i-lucide-user-plus"
          size="lg"
        />
        <UButton
          to="/calendar/public"
          label="All public events"
          color="neutral"
          variant="outline"
          icon="i-lucide-calendar-days"
          size="lg"
        />
      </div>
    </article>
  </div>
</template>
