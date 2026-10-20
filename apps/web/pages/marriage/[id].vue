<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)

const { data } = await useAsyncData(`marriage-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/marriage/${id}`,
  ),
)
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-8">
    <NuxtLink to="/marriage" class="text-sm text-blue-600">← Marriage matters</NuxtLink>
    <h1 class="mt-2 text-2xl font-semibold">Marriage matter</h1>
    <div v-if="data?.data" class="mt-4 rounded border p-4 text-sm">
      <p>
        Type: <strong>{{ data.data.matter_type }}</strong> · Status:
        {{ data.data.status }}
      </p>
      <p>Wedding date: {{ data.data.wedding_date ?? '—' }}</p>
      <p>Notes: {{ data.data.notes ?? '—' }}</p>
    </div>
    <h2 class="mt-6 font-semibold">Audit trail</h2>
    <ul class="mt-2 text-sm">
      <li v-for="row in data?.audit ?? []" :key="String(row.id)" class="border-t py-1">
        {{ row.event_type }} — {{ row.detail }} ({{ row.created_at }})
      </li>
    </ul>
  </div>
</template>
