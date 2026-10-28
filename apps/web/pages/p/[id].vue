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

/* Fan feedback (AFC-828 phase 2): session-free submit through the
 * public proxy route. The server re-checks visibility + published
 * status; nothing renders publicly — staff read it on the event
 * Reports > Feedback tab. */
const feedback = ref({ name: '', message: '', rating: 0, contact: '' })
const feedbackSaving = ref(false)
const feedbackError = ref('')
const feedbackDone = ref(false)
const testimony = ref({ name: '', message: '', contact: '' })
const testimonySaving = ref(false)
const testimonyError = ref('')
const testimonyDone = ref(false)

async function submitTestimony(): Promise<void> {
  if (testimony.value.message.trim() === '') {
    testimonyError.value = 'Share what happened in a sentence or two.'
    return
  }
  testimonySaving.value = true
  testimonyError.value = ''
  try {
    await $fetch(`/api/public/events/${id}/testimonies`, {
      method: 'POST',
      body: {
        ...(testimony.value.name.trim() === ''
          ? {}
          : { name: testimony.value.name.trim() }),
        message: testimony.value.message.trim(),
        ...(testimony.value.contact.trim() === ''
          ? {}
          : { contact: testimony.value.contact.trim() }),
      },
    })
    testimonyDone.value = true
  } catch (cause) {
    testimonyError.value =
      (cause as { data?: { message?: string }; message?: string }).data?.message ??
      (cause as { message?: string }).message ??
      'Could not share your testimony'
  } finally {
    testimonySaving.value = false
  }
}

async function submitFeedback(): Promise<void> {
  if (feedback.value.message.trim() === '') {
    feedbackError.value = 'Tell us what stood out before sending.'
    return
  }
  feedbackSaving.value = true
  feedbackError.value = ''
  try {
    await $fetch(`/api/public/events/${id}/feedback`, {
      method: 'POST',
      body: {
        ...(feedback.value.name.trim() === ''
          ? {}
          : { name: feedback.value.name.trim() }),
        message: feedback.value.message.trim(),
        ...(feedback.value.rating === 0 ? {} : { rating: feedback.value.rating }),
        ...(feedback.value.contact.trim() === ''
          ? {}
          : { contact: feedback.value.contact.trim() }),
      },
    })
    feedbackDone.value = true
  } catch (cause) {
    feedbackError.value =
      (cause as { data?: { message?: string }; message?: string }).data?.message ??
      (cause as { message?: string }).message ??
      'Could not send your feedback'
  } finally {
    feedbackSaving.value = false
  }
}

/* Downloadable resources (AFC-828 phase 3): approved items only, with
 * file downloads proxied through the event route (never a bare
 * Directus URL). Drafts and rejections never reach this feed. */
interface PublicResource {
  id: string
  title: string
  kind: string
  source_type: string
  url: string | null
  file_id: string | null
}

const KIND_LABELS: Record<string, string> = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  archive: 'Zip',
  other: 'Other',
}

const { data: resourcesData } = await useAsyncData(`public-event-resources-${id}`, () =>
  $fetch<{ data: PublicResource[] }>(`/api/public/events/${id}/resources`).catch(() => ({
    data: [] as PublicResource[],
  })),
)

const resources = computed(() => resourcesData.value?.data ?? [])

function resourceHref(item: PublicResource): string {
  if (item.source_type === 'link' && item.url) return item.url
  if (item.source_type === 'upload' && item.file_id)
    return `/api/public/events/${id}/resources/file?file=${item.file_id}`
  return '#'
}

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

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
      <section
        aria-label="Share your feedback"
        class="mt-10 rounded-xl border border-gray-200 p-5 dark:border-gray-800"
      >
        <h2 class="text-lg font-semibold">Share your feedback</h2>
        <p v-if="feedbackDone" class="mt-2 text-sm text-green-700">
          Thank you — your words have been shared with the organisers.
        </p>
        <div v-else class="mt-3 space-y-3">
          <UFormField label="Your name (optional)">
            <UInput v-model="feedback.name" placeholder="e.g. Adaeze" class="w-full" />
          </UFormField>
          <UFormField label="What stood out?" required>
            <UTextarea
              v-model="feedback.message"
              placeholder="The choir lifted the whole hall…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Rating (optional)">
            <div class="flex gap-1" role="radiogroup" aria-label="Rating">
              <button
                v-for="star in [1, 2, 3, 4, 5]"
                :key="star"
                type="button"
                class="text-2xl"
                :class="
                  star <= feedback.rating
                    ? 'text-amber-500'
                    : 'text-gray-300 dark:text-gray-600'
                "
                :aria-label="`Rate ${star} of 5`"
                :aria-pressed="feedback.rating === star"
                @click="feedback.rating = star"
              >
                ★
              </button>
            </div>
          </UFormField>
          <UFormField label="Contact for follow-up (optional)">
            <UInput
              v-model="feedback.contact"
              placeholder="Phone or email"
              class="w-full"
            />
          </UFormField>
          <UButton
            label="Send feedback"
            icon="i-lucide-send"
            :loading="feedbackSaving"
            @click="submitFeedback"
          />
          <p v-if="feedbackError !== ''" class="text-sm text-red-600">
            {{ feedbackError }}
          </p>
        </div>
      </section>
      <section v-if="resources.length > 0" aria-label="Event resources" class="mt-8">
        <h2 class="text-lg font-semibold">Resources</h2>
        <ul class="mt-3 space-y-2">
          <li
            v-for="item in resources"
            :key="item.id"
            class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
          >
            <UBadge color="neutral" variant="subtle">{{ kindLabel(item.kind) }}</UBadge>
            <span class="min-w-0 flex-1 truncate font-medium">{{ item.title }}</span>
            <UButton
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              label="Open"
              :to="resourceHref(item)"
              :target="item.source_type === 'link' ? '_blank' : undefined"
            />
          </li>
        </ul>
      </section>
      <section
        aria-label="Share your testimony"
        class="mt-10 rounded-xl border border-gray-200 p-5 dark:border-gray-800"
      >
        <h2 class="text-lg font-semibold">Share your testimony</h2>
        <p v-if="testimonyDone" class="mt-2 text-sm text-green-700">
          Thank you — your testimony has been shared with the organisers.
        </p>
        <div v-else class="mt-3 space-y-3">
          <UFormField label="Your name (optional)">
            <UInput v-model="testimony.name" placeholder="e.g. Emeka" class="w-full" />
          </UFormField>
          <UFormField label="What happened? *" required>
            <UTextarea
              v-model="testimony.message"
              placeholder="I walked in bound and walked out free…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Contact for follow-up (optional)">
            <UInput
              v-model="testimony.contact"
              placeholder="Phone or email"
              class="w-full"
            />
          </UFormField>
          <UButton
            label="Share testimony"
            icon="i-lucide-sparkles"
            :loading="testimonySaving"
            @click="submitTestimony"
          />
          <p v-if="testimonyError !== ''" class="text-sm text-red-600">
            {{ testimonyError }}
          </p>
        </div>
      </section>
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
