<script setup lang="ts">
import type { BranchSummary } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const search = ref('')

const { data, pending, error } = await useAsyncData('branches-list', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => {
  const term = search.value.trim().toLowerCase()
  const list = data.value ?? []
  if (!term) return list
  return list.filter((branch) =>
    [branch.name, branch.code, branch.city, branch.state]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(term)),
  )
})

function typeLabel(value: string): string {
  return value.replace(/_/g, ' ')
}
</script>

<template>
  <div>
    <PageHeader
      title="Branches"
      description="Every branch this account can see, with its people, attendance and care at a glance."
    />

    <UCard>
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="Search branches"
        aria-label="Search branches"
      />

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load branches"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No branches match this search"
        description="Try another branch name or code."
      />

      <div v-else class="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <NuxtLink
          v-for="branch in rows"
          :key="branch.id"
          :to="`/branches/${branch.id}`"
          class="rounded-lg border border-gray-200 p-4 transition hover:border-primary-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-primary-700 dark:hover:bg-gray-900/60"
        >
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="font-medium text-gray-900 dark:text-white">{{ branch.name }}</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ branch.code }} · {{ typeLabel(branch.branch_type) }}
              </p>
            </div>
            <UBadge
              :color="branch.status === 'active' ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ branch.status }}
            </UBadge>
          </div>
          <p class="mt-3 text-sm text-gray-600 dark:text-gray-300">
            {{
              [branch.city, branch.state].filter(Boolean).join(', ') ||
              'No address on file'
            }}
          </p>
        </NuxtLink>
      </div>
    </UCard>
  </div>
</template>
