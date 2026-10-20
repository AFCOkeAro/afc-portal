<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const showForm = ref(false)
const form = ref({ title: '', body: '', publish_from: '', publish_to: '', branch: '' })
const error = ref('')

const { data, pending, refresh } = await useAsyncData('announcements-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/announcements'),
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/announcements', {
      title: form.value.title,
      ...(form.value.body ? { body: form.value.body } : {}),
      ...(form.value.publish_from
        ? { publish_from: new Date(form.value.publish_from).toISOString() }
        : {}),
      ...(form.value.publish_to
        ? { publish_to: new Date(form.value.publish_to).toISOString() }
        : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
    })
    showForm.value = false
    form.value = { title: '', body: '', publish_from: '', publish_to: '', branch: '' }
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not draft the announcement'
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Announcements</h1>
      <button
        class="rounded bg-blue-600 px-3 py-1.5 text-white"
        @click="showForm = !showForm"
      >
        Draft announcement
      </button>
    </div>
    <p class="mt-2 text-sm text-gray-600">
      Draft → scheduled → published, with approval. Readers see published rows inside the
      window.
    </p>
    <div v-if="showForm" class="mt-4 rounded border p-4">
      <div class="grid gap-2">
        <input
          v-model="form.title"
          placeholder="Title"
          class="rounded border px-2 py-1"
        />
        <textarea
          v-model="form.body"
          placeholder="Body"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.publish_from"
          type="datetime-local"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.publish_to"
          type="datetime-local"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.branch"
          placeholder="Branch id (blank = area-wide, area staff only)"
          class="rounded border px-2 py-1"
        />
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
      <button class="mt-2 rounded bg-blue-600 px-3 py-1.5 text-white" @click="create">
        Save draft
      </button>
    </div>
    <p v-if="pending" class="mt-4">Loading…</p>
    <table v-else class="mt-4 w-full text-sm">
      <thead>
        <tr class="text-left">
          <th>Title</th>
          <th>Status</th>
          <th>Window</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data?.data ?? []" :key="String(row.id)" class="border-t">
          <td class="py-2 font-medium">{{ row.title }}</td>
          <td>{{ row.status }}</td>
          <td>{{ row.publish_from ?? '—' }} → {{ row.publish_to ?? '—' }}</td>
          <td>
            <NuxtLink :to="`/announcements/${String(row.id)}`" class="text-blue-600"
              >Open</NuxtLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
