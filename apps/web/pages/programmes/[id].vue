<script setup lang="ts">
/**
 * Signed-out programme detail (AFC-871 slice 2).
 *
 * Reads GET /api/public/events/:id, which serves a section only at
 * `public` and nulls everything else (draft/private/login/custom fail
 * closed). No session, no staff data, no registration write here — the
 * register stepper at /register?event=<id> owns the write.
 */
definePageMeta({ layout: 'public' })

const route = useRoute()
const id = String(route.params.id)

interface PublicDetail {
  id: string
  title: string
  summary: string | null
  description: string | null
  event_type: string
  start_at: string
  end_at: string
  location: string | null
  address: string | null
  registration_open: boolean
  speakers: Array<Record<string, unknown>> | null
  resources: Array<Record<string, unknown>> | null
  schedule: Array<Record<string, unknown>> | null
}

const { data, pending, error } = await useAsyncData(`programme-${id}`, () =>
  $fetch<{ data: PublicDetail }>(`/api/public/events/${id}`).then((r) => r.data),
)

const registerHref = computed(() => `/register?event=${id}`)
</script>

<template>
  <div>
    <PageHeader
      :title="data?.title ?? 'Programme'"
      description="Signed-out programme page. Sections appear only where staff marked them public."
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Not published publicly"
      description="That programme is not available on the public page."
    />
    <div v-else-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>
    <div v-else-if="data" class="space-y-4">
      <UCard>
        <p class="text-sm text-gray-600 dark:text-gray-300">
          {{ data.summary || data.description || 'Details coming soon.' }}
        </p>
        <p class="mt-2 text-xs text-gray-500">
          {{ data.start_at }} → {{ data.end_at }} · {{ data.location || 'Venue TBA' }}
        </p>
        <template #footer>
          <UButton
            v-if="data.registration_open"
            :to="registerHref"
            label="Register"
            icon="i-lucide-arrow-right"
          />
          <p v-else class="text-xs text-gray-500">
            Registration is not open publicly for this programme.
          </p>
        </template>
      </UCard>

      <UCard>
        <template #header><h2 class="text-sm font-semibold">Speakers</h2></template>
        <ul v-if="data.speakers" class="space-y-1 text-sm">
          <li v-for="(row, i) in data.speakers" :key="i">
            {{ String(row.name ?? `Speaker ${i + 1}`) }}
          </li>
          <li v-if="data.speakers.length === 0" class="text-gray-500">
            No speakers listed yet.
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">
          Speakers are not shared publicly for this programme.
        </p>
      </UCard>

      <UCard>
        <template #header><h2 class="text-sm font-semibold">Resources</h2></template>
        <ul v-if="data.resources" class="space-y-1 text-sm">
          <li v-for="(row, i) in data.resources" :key="i">
            {{ String(row.title ?? `Resource ${i + 1}`) }}
          </li>
          <li v-if="data.resources.length === 0" class="text-gray-500">
            No resources listed yet.
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">
          Resources are not shared publicly for this programme.
        </p>
      </UCard>

      <UCard>
        <template #header><h2 class="text-sm font-semibold">Schedule</h2></template>
        <ul v-if="data.schedule" class="space-y-1 text-sm">
          <li v-for="(row, i) in data.schedule" :key="i">
            {{ String(row.title ?? `Session ${i + 1}`) }}
          </li>
          <li v-if="data.schedule.length === 0" class="text-gray-500">
            No schedule listed yet.
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">
          The schedule is not shared publicly for this programme.
        </p>
      </UCard>
    </div>
  </div>
</template>
