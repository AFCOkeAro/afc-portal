<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const { data, pending, refresh } = await useAsyncData(`announcement-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/announcements/${id}`,
  ),
)

async function setStatus(status: string) {
  error.value = ''
  try {
    await api.patch(`/api/announcements/${id}`, { status })
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not move the announcement'
  }
}

const title = computed(() => String(data.value?.data?.title ?? 'Announcement'))
</script>

<template>
  <div>
    <PageHeader
      :title="title"
      description="Draft, scheduled and published lifecycle with approval."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Announcements"
          to="/announcements"
        />
      </template>
    </PageHeader>

    <div v-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Announcement</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Window</dt>
            <dd>
              {{ data.data.publish_from ?? '—' }} → {{ data.data.publish_to ?? '—' }}
            </dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Body</dt>
            <dd class="mt-1">{{ data.data.body ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Schedule and publish</h2>
        </template>
        <UAlert
          v-if="error"
          class="mb-3"
          color="error"
          variant="subtle"
          :description="error"
        />
        <PermissionGate :collection="COLLECTIONS.announcements" action="update">
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Schedule"
              color="neutral"
              variant="outline"
              icon="i-lucide-calendar-clock"
              @click="setStatus('scheduled')"
            />
            <UButton
              label="Approve & publish"
              icon="i-lucide-megaphone"
              @click="setStatus('published')"
            />
            <UButton
              label="Cancel"
              color="neutral"
              variant="outline"
              icon="i-lucide-x"
              @click="setStatus('cancelled')"
            />
          </div>
        </PermissionGate>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Audit trail</h2>
        </template>
        <ul v-if="(data.audit ?? []).length > 0" class="space-y-2 text-sm">
          <li v-for="row in data.audit ?? []" :key="String(row.id)">
            <span class="font-medium">{{ row.event_type }}</span>
            <span v-if="row.detail" class="text-gray-500"> · {{ row.detail }}</span>
            <span class="text-gray-400"> ({{ row.created_at }})</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No audit rows.</p>
      </UCard>
    </div>
  </div>
</template>
