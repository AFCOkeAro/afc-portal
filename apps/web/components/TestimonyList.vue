<script setup lang="ts">
/**
 * Testimony list (AFC-828 phase 4): scoped staff view of shared
 * testimonies for one event, newest first. Mirrors FeedbackList;
 * contact details stay in-staff — the public never lists testimonies.
 */
interface Props {
  eventId: string
}

const props = defineProps<Props>()

const api = useApi()

interface TestimonyRow {
  id: string
  name: string | null
  message: string
  contact: string | null
  created_at: string
}

const rows = ref<TestimonyRow[]>([])
const pending = ref(false)
const error = ref('')

async function loadTestimonies(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: TestimonyRow[] }>(
      `/api/events/${props.eventId}/testimonies`,
    )
    rows.value = res.data ?? []
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not load testimonies'
  } finally {
    pending.value = false
  }
}

onMounted(() => {
  void loadTestimonies()
})
</script>

<template>
  <div>
    <p v-if="pending" class="text-sm text-gray-500">Loading testimonies…</p>
    <p v-else-if="error !== ''" class="text-sm text-red-600">{{ error }}</p>
    <div v-else-if="rows.length === 0">
      <EmptyState
        title="No testimonies yet"
        description="Testimonies shared from this programme will appear here."
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
