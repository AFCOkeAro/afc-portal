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

const domainOptions = [
  { label: 'All', value: 'all' },
  { label: 'People', value: 'people' },
  { label: 'Households', value: 'households' },
  { label: 'Branches', value: 'branches' },
  { label: 'BSCs', value: 'bscs' },
  { label: 'Events', value: 'events' },
  { label: 'Tasks', value: 'tasks' },
  { label: 'Minutes', value: 'minutes' },
]

const sections = computed((): [string, unknown[]][] =>
  Object.entries(data.value?.data ?? {}),
)
const total = computed(() =>
  sections.value.reduce(
    (sum: number, [, rows]: [string, unknown[]]) => sum + rows.length,
    0,
  ),
)
</script>

<template>
  <div>
    <PageHeader
      title="Search"
      description="People, households, branches, BSCs, events, tasks and minutes — within your scope only."
    />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-[1fr_220px_auto]">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="Search…"
          aria-label="Search query"
          @keyup.enter="run"
        />
        <USelect
          v-model="domain"
          :items="domainOptions"
          class="w-full"
          aria-label="Search domain"
        />
        <UButton label="Search" icon="i-lucide-search" @click="run" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not search"
        :description="error"
      />

      <div v-if="pending" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="total === 0"
        title="No matches"
        description="Type at least 2 characters and narrow the domain if needed."
      />

      <div v-else class="mt-4 grid gap-4">
        <section v-for="[name, rows] in sections" :key="name">
          <h2 class="font-semibold capitalize text-gray-900 dark:text-white">
            {{ name }} ({{ (rows as unknown[]).length }})
          </h2>
          <ul class="mt-1 divide-y divide-gray-100 text-sm dark:divide-gray-800">
            <li
              v-for="row in (rows as Record<string, unknown>[]).slice(0, 10)"
              :key="String(row.id)"
              class="py-1.5 text-gray-600 dark:text-gray-300"
            >
              {{ row.title ?? row.name ?? row.first_name ?? row.id }}
            </li>
          </ul>
        </section>
      </div>
    </UCard>
  </div>
</template>
