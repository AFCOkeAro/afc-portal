<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated, SundaySchoolClassRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const searchInput = ref('')
const search = ref('')

function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const branch = ref(queryParam('branch') ?? 'all')
const status = ref(queryParam('status') ?? 'active')
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

/** Same-page strip navigation (AFC-588 pattern): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const statusNext = typeof next.status === 'string' ? next.status : null
    status.value = statusNext ?? 'active'
  },
)

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(status.value !== 'all' ? { status: status.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error, refresh } = await useAsyncData(
  'sunday-school-list',
  () =>
    api.get<Paginated<SundaySchoolClassRow>>('/api/sunday-school', {
      query: query.value,
    }),
  { watch: [query] },
)

const branches = await useAsyncData('sunday-school-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const statusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
  { label: 'Any status', value: 'all' },
]
</script>

<template>
  <div>
    <PageHeader
      title="Sunday School"
      description="Scoped classes. Enrolment is the class students count; students are found through the scoped people pool on each class page."
    />

    <PermissionGate :collection="COLLECTIONS.sundaySchoolClasses" action="read">
      <UCard>
        <div class="grid gap-3 sm:grid-cols-3">
          <UInput
            v-model="searchInput"
            icon="i-lucide-search"
            placeholder="Search classes"
            aria-label="Search classes"
          />
          <EntitySelect
            v-model="branch"
            :items="branchOptions"
            placeholder="Select branch…"
            aria-label="Filter by branch"
            class="w-full"
          />
          <USelect v-model="status" :items="statusOptions" class="w-full" />
        </div>

        <UAlert
          v-if="error"
          class="mt-4"
          color="error"
          variant="subtle"
          title="Could not load classes"
          :description="error.message"
        />

        <div v-if="pending" class="mt-8 flex justify-center py-10">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>

        <EmptyState
          v-else-if="rows.length === 0"
          title="No classes match these filters"
          description="No Sunday School classes in scope."
        />

        <div v-else class="mt-4 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr
                class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                <th class="px-3 py-2 font-medium">Class</th>
                <th class="px-3 py-2 font-medium">Branch</th>
                <th class="px-3 py-2 font-medium">Enrolled</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2"><span class="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr
                v-for="row in rows"
                :key="row.id"
                class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
              >
                <td class="px-3 py-3">
                  <NuxtLink
                    :to="`/sunday-school/${row.id}`"
                    class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                  >
                    {{ row.class_name }}
                  </NuxtLink>
                </td>
                <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                  {{ row.branch_name || 'Area class' }}
                </td>
                <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                  {{ row.students_count ?? '—' }}
                </td>
                <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                  {{ row.status }}
                </td>
                <td class="px-3 py-3 text-right">
                  <UButton
                    :to="`/sunday-school/${row.id}`"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-arrow-right"
                    aria-label="Open class"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
          <p class="text-gray-500 dark:text-gray-400">
            {{ total }} classes · page {{ page }} of {{ pageCount }}
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

      <div class="mt-4 flex justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          label="Refresh"
          icon="i-lucide-refresh-cw"
          @click="refresh()"
        />
      </div>
    </PermissionGate>
  </div>
</template>
