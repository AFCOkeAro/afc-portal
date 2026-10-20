<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const q = ref('')
const domain = ref('all')
const error = ref('')

const { data, pending, refresh } = await useAsyncData('cross-search', () =>
  api.get<{ data: Record<string, unknown[]> }>('/api/search', {
    query: {
      q: q.value || '  ',
      ...(domain.value !== 'all' ? { domain: domain.value } : {}),
    },
  }),
)

async function run() {
  error.value = ''
  if (q.value.trim().length < 2) {
    error.value = 'Type at least 2 characters'
    return
  }
  await refresh()
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="text-2xl font-semibold">Search</h1>
    <p class="mt-2 text-sm text-gray-600">
      People, households, branches, BSCs, events, tasks and minutes — within your scope
      only.
    </p>
    <div class="mt-4 flex gap-2 text-sm">
      <input
        v-model="q"
        placeholder="Search…"
        class="rounded border px-2 py-1"
        @keyup.enter="run"
      />
      <select v-model="domain" class="rounded border px-2 py-1">
        <option value="all">All</option>
        <option value="people">People</option>
        <option value="households">Households</option>
        <option value="branches">Branches</option>
        <option value="bscs">BSCs</option>
        <option value="events">Events</option>
        <option value="tasks">Tasks</option>
        <option value="minutes">Minutes</option>
      </select>
      <button class="rounded bg-blue-600 px-3 py-1 text-white" @click="run">
        Search
      </button>
    </div>
    <p v-if="error" class="mt-2 text-sm text-red-600">{{ error }}</p>
    <p v-if="pending" class="mt-4">Loading…</p>
    <div v-else class="mt-4 grid gap-4">
      <section v-for="(rows, name) in data?.data ?? {}" :key="name">
        <h2 class="font-semibold capitalize">
          {{ name }} ({{ (rows as unknown[]).length }})
        </h2>
        <ul class="text-sm">
          <li
            v-for="row in (rows as Record<string, unknown>[]).slice(0, 10)"
            :key="String(row.id)"
            class="border-t py-1"
          >
            {{ row.title ?? row.name ?? row.first_name ?? row.id }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
