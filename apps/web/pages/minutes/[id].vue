<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const person = ref('')
const error = ref('')

const { data, refresh } = await useAsyncData(`minutes-${id}`, () =>
  api.get<{
    data: Record<string, unknown>
    attendees: Record<string, unknown>[]
    audit: Record<string, unknown>[]
  }>(`/api/minutes/${id}`),
)

async function addAttendee() {
  error.value = ''
  try {
    await api.post(`/api/minutes/${id}/attendees`, { person: person.value })
    person.value = ''
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not add the attendee'
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <NuxtLink to="/minutes" class="text-sm text-blue-600">← Minutes</NuxtLink>
    <h1 class="mt-2 text-2xl font-semibold">{{ data?.data?.title }}</h1>
    <div v-if="data?.data" class="mt-4 rounded border p-4 text-sm">
      <p>Meeting: {{ data.data.meeting_date }} · Status: {{ data.data.status }}</p>
      <p class="mt-2">{{ data.data.body ?? '' }}</p>
      <p v-if="data.data.file" class="mt-2">File: {{ data.data.file }}</p>
    </div>
    <h2 class="mt-6 font-semibold">Attendees</h2>
    <ul class="mt-2 text-sm">
      <li
        v-for="row in data?.attendees ?? []"
        :key="String(row.id)"
        class="border-t py-1"
      >
        {{ row.person ?? row.attendee_user }}
      </li>
    </ul>
    <div class="mt-3 flex gap-2">
      <input
        v-model="person"
        placeholder="Person id"
        class="rounded border px-2 py-1 text-sm"
      />
      <button class="rounded border px-2 py-1 text-sm" @click="addAttendee">
        Add attendee
      </button>
    </div>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    <h2 class="mt-6 font-semibold">Audit trail</h2>
    <ul class="mt-2 text-sm">
      <li v-for="row in data?.audit ?? []" :key="String(row.id)" class="border-t py-1">
        {{ row.event_type }} — {{ row.detail }} ({{ row.created_at }})
      </li>
    </ul>
  </div>
</template>
