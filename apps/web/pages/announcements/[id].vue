<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const { data, refresh } = await useAsyncData(`announcement-${id}`, () =>
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
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <NuxtLink to="/announcements" class="text-sm text-blue-600">← Announcements</NuxtLink>
    <h1 class="mt-2 text-2xl font-semibold">{{ data?.data?.title }}</h1>
    <div v-if="data?.data" class="mt-4 rounded border p-4 text-sm">
      <p>
        Status: <strong>{{ data.data.status }}</strong>
      </p>
      <p>{{ data.data.body ?? '' }}</p>
      <div class="mt-3 flex gap-2">
        <button class="rounded border px-2 py-1" @click="setStatus('scheduled')">
          Schedule
        </button>
        <button class="rounded border px-2 py-1" @click="setStatus('published')">
          Approve & publish
        </button>
        <button class="rounded border px-2 py-1" @click="setStatus('cancelled')">
          Cancel
        </button>
      </div>
      <p v-if="error" class="mt-2 text-red-600">{{ error }}</p>
    </div>
    <h2 class="mt-6 font-semibold">Audit trail</h2>
    <ul class="mt-2 text-sm">
      <li v-for="row in data?.audit ?? []" :key="String(row.id)" class="border-t py-1">
        {{ row.event_type }} — {{ row.detail }} ({{ row.created_at }})
      </li>
    </ul>
  </div>
</template>
