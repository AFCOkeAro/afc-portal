<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated, VisitorRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const status = ref('open')
const branch = ref('all')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([status, branch, search], () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  limit,
  status: status.value,
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'visitors-list',
  () => api.get<Paginated<VisitorRow>>('/api/visitors', { query: query.value }),
  { watch: [query] },
)

const branches = await useAsyncData('visitors-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const statusOptions = [
  { label: 'Open follow-ups', value: 'open' },
  { label: 'New', value: 'new' },
  { label: 'Follow up', value: 'follow_up' },
  { label: 'Converted', value: 'converted' },
  { label: 'Closed', value: 'closed' },
  { label: 'Declined', value: 'declined' },
  { label: 'All statuses', value: 'all' },
]

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function name(row: VisitorRow): string {
  return [row.visitor_first_name, row.visitor_last_name].filter(Boolean).join(' ')
}

const statusColor: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  new: 'warning',
  follow_up: 'warning',
  converted: 'success',
  closed: 'neutral',
  declined: 'error',
}
</script>

<template>
  <div>
    <PageHeader
      title="Visitors"
      description="First-time attenders, follow-ups and newcomers in the journey."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.visitors" action="create">
          <UButton
            label="Record intake"
            icon="i-lucide-user-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UCard>
      <div class="grid gap-3 sm:grid-cols-3">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search visitors"
          aria-label="Search visitors"
        />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load visitors"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No visitors match these filters"
        description="Record an intake after a first visit, or clear the status filter."
      >
        <PermissionGate :collection="COLLECTIONS.visitors" action="create">
          <UButton class="mt-4" label="Record intake" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Visitor</th>
              <th class="px-3 py-2 font-medium">Visit</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Age group</th>
              <th class="px-3 py-2 font-medium">Follow-up</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="visitor in rows"
              :key="visitor.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/visitors/${visitor.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ name(visitor) }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ visitor.phone || visitor.email || 'No contact' }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ formatDate(visitor.visit_date) }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ visitor.branch_name || '—' }}
              </td>
              <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                {{ visitor.age_group }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                <p>{{ formatDate(visitor.next_follow_up_date) }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ visitor.follow_up_owner || 'Unassigned' }}
                </p>
              </td>
              <td class="px-3 py-3">
                <UBadge
                  :color="statusColor[visitor.status] ?? 'neutral'"
                  variant="subtle"
                >
                  {{ visitor.status.replace(/_/g, ' ') }}
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/visitors/${visitor.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open visitor"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} visitors · page {{ page }} of {{ pageCount }}
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Previous"
            :disabled="page <= 1"
            @click="page -= 1"
          />
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            label="Next"
            :disabled="page >= pageCount"
            @click="page += 1"
          />
        </div>
      </div>
    </UCard>

    <VisitorFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      @saved="refresh()"
    />
  </div>
</template>
