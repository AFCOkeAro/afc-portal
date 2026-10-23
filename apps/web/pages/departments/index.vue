<script setup lang="ts">
import type { BranchSummary, DepartmentRow } from '~/types/portal'
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const searchInput = ref('')
const search = ref('')

/** Drill-down contract: branch pages link here with ?branch=. */
function queryParam(name: string): string | null {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}
const branch = ref(queryParam('branch') ?? 'all')

/** Same-page strip navigation (AFC-588): query-only link, sync the filter. */
watch(
  () => route.query,
  (next: typeof route.query) => {
    const branchNext = typeof next.branch === 'string' ? next.branch : null
    branch.value = branchNext ?? 'all'
  },
)

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

const query = computed(() => ({
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
}))

const { data, pending, error } = await useAsyncData(
  'departments-list',
  () => api.get<{ data: DepartmentRow[] }>('/api/departments', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])

const branches = await useAsyncData('departments-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

/** Dashboard strip (AFC-588): figures from one unfiltered fetch, no new backend. */
const { data: stripAll } = await useAsyncData('departments-strip', () =>
  api.get<{ data: DepartmentRow[] }>('/api/departments'),
)

const stripItems = computed(() => {
  const all = stripAll.value?.data ?? []
  const areaWide = all.filter((row: DepartmentRow) => !row.branch_name).length
  return [
    {
      label: 'Departments',
      value: all.length,
      to: '/departments?branch=all',
      hint: 'Open filtered list',
    },
    {
      label: 'Area-wide',
      value: areaWide,
      to: null,
      hint: 'No branch set, all departments',
    },
  ]
})

const permissions = usePermissions()
const canCreateGroup = computed(() => permissions.can(COLLECTIONS.departments, 'create'))
const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const showCreate = ref(false)
const groupName = ref('')
const groupCode = ref('')
const groupDescription = ref('')
const groupArea = ref('')
const groupLeader = ref('')
const groupSaving = ref(false)
const groupMessage = ref('')
const groupIsError = ref(false)
const { data: areaRows } = await useAsyncData('departments-areas', () =>
  api.get<Array<{ id: string; name: string }>>('/api/areas'),
)
const areaOptions = computed(() =>
  (areaRows.value ?? []).map((row) => ({ label: row.name, value: String(row.id) })),
)
async function submitGroup(): Promise<void> {
  groupMessage.value = ''
  if (
    groupName.value.trim() === '' ||
    groupCode.value.trim() === '' ||
    groupArea.value === ''
  ) {
    groupIsError.value = true
    groupMessage.value = 'Name, code and area are required.'
    return
  }
  groupSaving.value = true
  try {
    await api.post('/api/departments', {
      name: groupName.value.trim(),
      code: groupCode.value.trim().toUpperCase(),
      department_type: 'group',
      area: groupArea.value,
      description:
        groupDescription.value.trim() === '' ? null : groupDescription.value.trim(),
      leader_person: groupLeader.value === '' ? null : groupLeader.value,
    })
    groupIsError.value = false
    groupMessage.value = 'Group created.'
    groupName.value = ''
    groupCode.value = ''
    groupDescription.value = ''
    groupArea.value = ''
    groupLeader.value = ''
    showCreate.value = false
    await refresh()
  } catch (cause) {
    groupIsError.value = true
    groupMessage.value =
      cause instanceof ApiRequestError
        ? cause.status === 409
          ? 'That group code is already in use.'
          : cause.message
        : 'Could not create the group.'
  } finally {
    groupSaving.value = false
  }
}

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])
</script>

<template>
  <div>
    <PageHeader
      title="Departments"
      description="Ministry departments and their members, within the branches this account can see. Area-wide departments carry no branch."
    />

    <DashboardStrip :items="stripItems" />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search department name"
          aria-label="Search departments"
        />
        <EntitySelect
          v-model="branch"
          :items="branchOptions"
          placeholder="Select branch…"
          class="w-full"
        />
      </div>

      <div v-if="canCreateGroup" class="mt-3 flex justify-end">
        <UButton label="New group" icon="i-lucide-plus" @click="showCreate = true" />
      </div>

      <UModal v-model:open="showCreate" title="New group">
        <p class="text-sm text-gray-500">
          Groups are area-level member subsets (only Area HQ uses them). Departments
          themselves stay board-managed.
        </p>
        <div class="mt-4 grid gap-3">
          <UFormField label="Name" required>
            <UInput v-model="groupName" class="w-full" />
          </UFormField>
          <UFormField label="Code" required hint="Capitals, digits, dashes">
            <UInput v-model="groupCode" class="w-full" placeholder="USHERS" />
          </UFormField>
          <UFormField label="Area" required>
            <EntitySelect
              v-model="groupArea"
              :items="areaOptions"
              placeholder="Select area…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Description">
            <UTextarea v-model="groupDescription" class="w-full" />
          </UFormField>
          <UFormField
            label="Group leader"
            hint="Optional — member of the church database"
          >
            <EntitySelect
              v-model="groupLeader"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
        </div>
        <p
          v-if="groupMessage !== ''"
          class="mt-3 text-sm"
          :class="groupIsError ? 'text-red-600' : 'text-green-700'"
        >
          {{ groupMessage }}
        </p>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="showCreate = false"
            />
            <UButton
              label="Create group"
              icon="i-lucide-plus"
              :loading="groupSaving"
              @click="submitGroup"
            />
          </div>
        </template>
      </UModal>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load departments"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No departments match these filters"
        description="Clear a filter. Departments themselves are board-shaped data — membership is managed on the department page."
      />

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Department</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Leader</th>
              <th class="px-3 py-2 font-medium">Members</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="department in rows"
              :key="department.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/departments/${department.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ department.name }}
                </NuxtLink>
                <p class="text-xs capitalize text-gray-500 dark:text-gray-400">
                  {{ department.department_type }}
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ department.branch_name || 'Area-wide' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ department.leader_name || '—' }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ department.member_count }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/departments/${department.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open department"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
