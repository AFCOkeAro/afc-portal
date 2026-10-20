<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const status = ref('all')
const showForm = ref(false)
const form = ref({
  person: '',
  from_branch: '',
  to_branch: '',
  reason: '',
  effective_date: '',
})
const error = ref('')

const query = computed(() => ({
  ...(status.value !== 'all' ? { status: status.value } : {}),
}))
const { data, pending, refresh } = await useAsyncData(
  'transfers-list',
  () =>
    api.get<{ data: Record<string, unknown>[] }>('/api/transfers', {
      query: query.value,
    }),
  { watch: [query] },
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/transfers', {
      person: form.value.person,
      from_branch: form.value.from_branch,
      to_branch: form.value.to_branch,
      ...(form.value.reason ? { reason: form.value.reason } : {}),
      ...(form.value.effective_date ? { effective_date: form.value.effective_date } : {}),
    })
    showForm.value = false
    form.value = {
      person: '',
      from_branch: '',
      to_branch: '',
      reason: '',
      effective_date: '',
    }
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not record the transfer'
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold">Transfers</h1>
      <button
        class="rounded bg-blue-600 px-3 py-1.5 text-white"
        @click="showForm = !showForm"
      >
        Record transfer
      </button>
    </div>
    <div class="mt-4 flex gap-2">
      <label
        >Status
        <select v-model="status" class="rounded border px-2 py-1">
          <option value="all">All</option>
          <option value="requested">Requested</option>
          <option value="approved">Approved</option>
          <option value="completed">Completed</option>
          <option value="rejected">Rejected</option>
        </select></label
      >
      <a href="/api/transfers/export.csv" class="rounded border px-2 py-1">Export CSV</a>
    </div>
    <div v-if="showForm" class="mt-4 rounded border p-4">
      <div class="grid gap-2">
        <input
          v-model="form.person"
          placeholder="Person id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.from_branch"
          placeholder="From branch id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.to_branch"
          placeholder="To branch id"
          class="rounded border px-2 py-1"
        />
        <input
          v-model="form.effective_date"
          type="date"
          class="rounded border px-2 py-1"
        />
        <textarea
          v-model="form.reason"
          placeholder="Reason"
          class="rounded border px-2 py-1"
        />
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
          <th>From → To</th>
          <th>Status</th>
          <th>Requested</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data?.data ?? []" :key="String(row.id)" class="border-t">
          <td class="py-2">{{ row.person }}</td>
          <td>{{ row.from_branch }} → {{ row.to_branch }}</td>
          <td>{{ row.status }}</td>
          <td>
            <NuxtLink :to="`/transfers/${String(row.id)}`" class="text-blue-600"
              >Open</NuxtLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
