<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const { data, refresh } = await useAsyncData(`transfer-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/transfers/${id}`,
  ),
)

async function setStatus(status: string) {
  error.value = ''
  try {
    await api.patch(`/api/transfers/${id}`, { status })
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not update the transfer'
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <NuxtLink to="/transfers" class="text-sm text-blue-600">← Transfers</NuxtLink>
    <h1 class="mt-2 text-2xl font-semibold">Transfer</h1>
    <div v-if="data?.data" class="mt-4 rounded border p-4 text-sm">
      <p>
        Status: <strong>{{ data.data.status }}</strong>
      </p>
      <p>From: {{ data.data.from_branch }} → To: {{ data.data.to_branch }}</p>
      <p>Effective: {{ data.data.effective_date ?? '—' }}</p>
      <p>Reason: {{ data.data.reason ?? '—' }}</p>
      <div class="mt-3 flex gap-2">
        <button class="rounded border px-2 py-1" @click="setStatus('approved')">
          Approve (moves home branch)
        </button>
        <button class="rounded border px-2 py-1" @click="setStatus('completed')">
          Complete
        </button>
        <button class="rounded border px-2 py-1" @click="setStatus('rejected')">
          Reject
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
