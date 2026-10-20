<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const showForm = ref(false)
const form = ref({
  person: '',
  branch: '',
  matter_type: 'wedding',
  wedding_date: '',
  notes: '',
})
const error = ref('')

const { data, pending, refresh } = await useAsyncData('marriage-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/marriage'),
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/marriage', {
      person: form.value.person,
      ...(form.value.branch ? { branch: form.value.branch } : {}),
      matter_type: form.value.matter_type,
      ...(form.value.wedding_date ? { wedding_date: form.value.wedding_date } : {}),
      ...(form.value.notes ? { notes: form.value.notes } : {}),
    })
    showForm.value = false
    form.value = {
      person: '',
      branch: '',
      matter_type: 'wedding',
      wedding_date: '',
      notes: '',
    }
    await refresh()
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not record the matter'
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Marriage matters</h1>
      <button
        class="rounded bg-blue-600 px-3 py-1.5 text-white"
        @click="showForm = !showForm"
      >
        Record matter
      </button>
    </div>
    <div v-if="showForm" class="mt-4 rounded border p-4">
      <div class="grid gap-2">
        <input
          v-model="form.person"
          placeholder="Person id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.branch"
          placeholder="Branch id"
          class="rounded border px-2 py-1"
        />
        <select v-model="form.matter_type" class="rounded border px-2 py-1">
          <option value="banns">Banns</option>
          <option value="wedding">Wedding</option>
          <option value="counselling">Counselling</option>
          <option value="other">Other</option>
        </select>
        <input v-model="form.wedding_date" type="date" class="rounded border px-2 py-1" />
      </div>
      <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
      <button class="mt-2 rounded bg-blue-600 px-3 py-1.5 text-white" @click="create">
        Save
      </button>
    </div>
    <p v-if="pending" class="mt-4">Loading…</p>
    <table v-else class="mt-4 w-full text-sm">
      <thead>
        <tr class="text-left">
          <th>Person</th>
          <th>Type</th>
          <th>Wedding</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data?.data ?? []" :key="String(row.id)" class="border-t">
          <td class="py-2">{{ row.person }}</td>
          <td>{{ row.matter_type }}</td>
          <td>{{ row.wedding_date ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td>
            <NuxtLink :to="`/marriage/${String(row.id)}`" class="text-blue-600"
              >Open</NuxtLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
