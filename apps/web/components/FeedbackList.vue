<script setup lang="ts">
/**
 * Feedback list (AFC-828 phase 2): scoped staff view of fan submissions
 * for one event, newest first. Ratings render as stars; contact details
 * stay in-staff (the public never lists feedback).
 */
interface Props {
  eventId: string
}

const props = defineProps<Props>()

const api = useApi()

interface FeedbackRow {
  id: string
  name: string | null
  message: string
  rating: number | null
  contact: string | null
  created_at: string
}

const rows = ref<FeedbackRow[]>([])
const pending = ref(false)
const error = ref('')

function stars(rating: number | null): string {
  if (rating === null) return ''
  return '★'.repeat(rating) + '☆'.repeat(5 - rating)
}

async function loadFeedback(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: FeedbackRow[] }>(
      `/api/events/${props.eventId}/feedback`,
    )
    rows.value = res.data ?? []
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not load feedback'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  void loadFeedback()
})
</script>

<template>
  <div>
    <p v-if="pending" class="text-sm text-gray-500">Loading feedback…</p>
    <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
    <div v-else-if="rows.length === 0">
      <EmptyState
        title="No feedback yet"
        description="Participant feedback collected for this programme will appear here."
      />
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="row in rows"
        :key="row.id"
        class="rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-medium">{{ row.name ?? 'Anonymous' }}</span>
          <span
            v-if="row.rating !== null"
            class="text-amber-500"
            :aria-label="`Rated ${row.rating} of 5`"
          >
            {{ stars(row.rating) }}
          </span>
          <span class="ml-auto text-xs text-gray-500">{{
            row.created_at.slice(0, 10)
          }}</span>
        </div>
        <p class="mt-1 text-gray-700 dark:text-gray-300">{{ row.message }}</p>
        <p v-if="row.contact" class="mt-1 text-xs text-gray-500">
          Contact: {{ row.contact }}
        </p>
      </li>
    </ul>
  </div>
</template>
