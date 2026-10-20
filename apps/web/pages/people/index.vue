<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const showForm = ref(false)
const searchInput = ref('')
const search = ref('')
const branch = ref('all')
const membership = ref('all')
const status = ref('active')
const page = ref(1)
const limit = 25

let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchInput, (value: string) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    search.value = value.trim()
  }, 300)
})

watch([branch, membership, status, search], () => {
  page.value = 1
})

const query = computed(() => ({
  page: page.value,
  limit,
  ...(search.value ? { search: search.value } : {}),
  ...(branch.value !== 'all' ? { branch: branch.value } : {}),
  ...(membership.value !== 'all' ? { membership_status: membership.value } : {}),
  status: status.value,
}))

const { data, pending, error, refresh } = await useAsyncData(
  'people-list',
  () => api.get<Paginated<PersonRow>>('/api/people', { query: query.value }),
  { watch: [query] },
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? 0)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / limit)))

const branches = await useAsyncData(
  'people-branches',
  () => api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'All branches', value: 'all' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const membershipOptions = [
  { label: 'Any membership', value: 'all' },
  { label: 'Member', value: 'member' },
  { label: 'Regular attendee', value: 'regular_attendee' },
  { label: 'Visitor', value: 'visitor' },
  { label: 'Youth', value: 'youth' },
  { label: 'Child', value: 'child' },
  { label: 'Staff', value: 'staff' },
  { label: 'Inactive', value: 'inactive' },
]

const statusOptions = [
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
  { label: 'All statuses', value: 'all' },
]

const restricted = computed(() => permissions.hiddenFields(COLLECTIONS.people))
const showDob = computed(() => permissions.isFieldVisible(COLLECTIONS.people, 'date_of_birth'))

function fullName(person: PersonRow): string {
  return (
    person.preferred_name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ')
  )
}
</script>

<template>
  <div>
    <PageHeader
      title="People"
      description="Members, visitors, youth and children across the branches this account can see."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.people" action="create">
          <UButton
            label="Add person"
            icon="i-lucide-user-plus"
            @click="showForm = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UAlert
      v-if="restricted.length"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Restricted on this account"
      :description="`Not shown here: ${restricted.join(', ')}. Access is limited to branch, area and super administrators (data-model §10.1).`"
    />

    <UCard>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <UInput
          v-model="searchInput"
          icon="i-lucide-search"
          placeholder="Search name, phone or email"
          aria-label="Search people"
        />
        <USelect v-model="branch" :items="branchOptions" class="w-full" />
        <USelect v-model="membership" :items="membershipOptions" class="w-full" />
        <USelect v-model="status" :items="statusOptions" class="w-full" />
      </div>

      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not load people"
        :description="error.message"
      />

      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No people match these filters"
        description="Clear a filter or add the first person for this branch."
      >
        <PermissionGate :collection="COLLECTIONS.people" action="create">
          <UButton class="mt-4" label="Add person" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="mt-4 overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-3 py-2 font-medium">Person</th>
              <th class="px-3 py-2 font-medium">Contact</th>
              <th class="px-3 py-2 font-medium">Branch</th>
              <th class="px-3 py-2 font-medium">Membership</th>
              <th v-if="showDob" class="px-3 py-2 font-medium">Age</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="person in rows"
              :key="person.id"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/people/${person.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ fullName(person) }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ person.gender }}<span v-if="person.is_minor"> · minor</span>
                </p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                <p>{{ person.phone || '—' }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">{{ person.email || '' }}</p>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ person.branch_name || '—' }}
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">
                  {{ person.membership_status.replace(/_/g, ' ') }}
                </UBadge>
              </td>
              <td v-if="showDob" class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ person.age ?? '—' }}
              </td>
              <td class="px-3 py-3">
                <UBadge :color="person.status === 'active' ? 'success' : 'neutral'" variant="subtle">
                  {{ person.status }}
                </UBadge>
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/people/${person.id}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open person"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="total > limit" class="mt-4 flex items-center justify-between text-sm">
        <p class="text-gray-500 dark:text-gray-400">
          {{ total }} people · page {{ page }} of {{ pageCount }}
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

    <PeopleFormModal
      v-model:open="showForm"
      :branches="branches.data.value ?? []"
      :show-dob="showDob"
      @saved="refresh()"
    />
  </div>
</template>
