<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, EventRow, Paginated } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const when = ref('upcoming')
const type = ref('')
const branch = ref('')
const status = ref('')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([when, type, branch, status, search], () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  limit,
  when: when.value,
  ...(search.value ? { search: search.value } : {}),
  ...(type.value ? { event_type: type.value } : {}),
  ...(branch.value ? { branch: branch.value } : {}),
  ...(status.value ? { status: status.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'events-list',
  () => api.get<Paginated<EventRow>>('/api/events', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('events-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const whenOptions = [
  { label: 'Upcoming', value: 'upcoming' },
  { label: 'Past', value: 'past' },
  { label: 'All dates', value: 'all' },
]

const typeOptions = [
  { label: 'Any type', value: '' },
  { label: 'Service', value: 'service' },
  { label: 'Summit', value: 'summit' },
  { label: 'Camp', value: 'camp' },
  { label: 'Training', value: 'training' },
  { label: 'Outreach', value: 'outreach' },
  { label: 'Social', value: 'social' },
  { label: 'Other', value: 'other' },
]

const statusOptions = [
  { label: 'Any status', value: '' },
  { label: 'Draft', value: 'draft' },
  { label: 'Published', value: 'published' },
  { label: 'Closed', value: 'closed' },
  { label: 'Cancelled', value: 'cancelled' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: '' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  published: 'success',
  draft: 'neutral',
  closed: 'warning',
  cancelled: 'error',
}
</script>

<template>
  <div>
    <PageHeader
      title="Events"
      description="Services, summits, camps, training and outreach across the area."
    >
      <template #actions>
        <UButton
          to="/register"
          color="neutral"
          variant="ghost"
          icon="i-lucide-external-link"
          label="Public form"
        />
        <PermissionGate :collection="COLLECTIONS.events" action="create">
          <UButton
            label="Create event"
            icon="i-lucide-calendar-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search events"
          aria-label="Search events"
        />
        <USelect v-model="when" :items="whenOptions" class="w-full" />
        <USelect v-model="type" :items="typeOptions" class="w-full" />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load events"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No events match these filters"
        description="Try a different date range or create the first event."
      >
        <PermissionGate :collection="COLLECTIONS.events" action="create">
          <UButton class="mt-4" label="Create event" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">Event</th>
              <th class="px-3 py-2 font-medium">Starts</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Registered</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="event in rows"
              :key="event.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/events/${event.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ event.title }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ event.event_type }} · {{ event.location || 'No location' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDateTime(event.start_at) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ event.branch_name || 'Area-wide' }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ event.registered_count }}<span v-if="event.capacity"> / {{ event.capacity }}</span>
              </td>
              <td class="px-3 py-3">
                <UBadge :color="statusColor[event.status] ?? 'neutral'" variant="subtle">
                  {{ event.status }}
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/events/${event.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open event"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} events · page {{ page }} of {{ pageCount }}
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Previous"
            :disabled="page <= 1"
            @click="page -= 1"
          />
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Next"
            :disabled="page >= pageCount"
            @click="page += 1"
          />
        </div>
      </div>
    </UCard>

    <EventFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
