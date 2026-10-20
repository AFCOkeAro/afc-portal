<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { DepartmentDetail, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const departmentId = String(route.params.id)
const showLink = ref(false)
const actionError = ref('')
const saving = ref(false)

const {
  data: department,
  pending,
  error,
  refresh,
} = await useAsyncData(`department-${departmentId}`, () =>
  api.get<DepartmentDetail>(`/api/departments/${departmentId}`),
)

const canEdit = computed(() => permissions.can(COLLECTIONS.peopleDepartments, 'create'))
const canUnlink = computed(() => permissions.can(COLLECTIONS.peopleDepartments, 'update'))

const memberIds = computed(
  () => new Set((department.value?.members ?? []).map((member) => member.id)),
)

const linkSearch = ref('')
const linkResults = ref<PersonRow[]>([])
const linkPending = ref(false)
const linkRole = ref('member')
const roleOptions = [
  { label: 'Member', value: 'member' },
  { label: 'Leader', value: 'leader' },
  { label: 'Assistant', value: 'assistant' },
]
let linkTimer: ReturnType<typeof setTimeout> | undefined
watch(linkSearch, (value: string) => {
  clearTimeout(linkTimer)
  linkTimer = setTimeout(() => void searchPeople(value.trim()), 300)
})

async function searchPeople(term: string): Promise<void> {
  linkResults.value = []
  if (term.length < 2) return
  linkPending.value = true
  try {
    const response = await api.get<Paginated<PersonRow>>('/api/people', {
      query: { search: term, limit: 8, status: 'active' },
    })
    linkResults.value = response.data.filter((person) => !memberIds.value.has(person.id))
  } catch {
    linkResults.value = []
  } finally {
    linkPending.value = false
  }
}

async function linkMember(personId: string): Promise<void> {
  saving.value = true
  actionError.value = ''
  try {
    await api.post(`/api/departments/${departmentId}/members`, {
      person: personId,
      role: linkRole.value,
    })
    showLink.value = false
    linkSearch.value = ''
    linkResults.value = []
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not link that member'
  } finally {
    saving.value = false
  }
}

async function unlinkMember(personId: string): Promise<void> {
  saving.value = true
  actionError.value = ''
  try {
    await api.remove(`/api/departments/${departmentId}/members`, {
      query: { person: personId },
    })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not unlink that member'
  } finally {
    saving.value = false
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/departments"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to departments"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this department"
      :description="error.message"
    />

    <template v-else-if="department">
      <PageHeader
        :title="department.name"
        :description="`${department.member_count} member${department.member_count === 1 ? '' : 's'} · ${department.branch_name || 'Area-wide'} · ${department.department_type}`"
      />

      <UAlert
        v-if="actionError"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />

      <div class="grid gap-6 xl:grid-cols-3">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Details</h2>
          </template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Leader</dt>
              <dd class="text-right">{{ department.leader_name || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
              <dd class="text-right">{{ department.branch_name || 'Area-wide' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Status</dt>
              <dd>
                <UBadge
                  :color="department.status === 'active' ? 'success' : 'neutral'"
                  variant="subtle"
                >
                  {{ department.status }}
                </UBadge>
              </dd>
            </div>
          </dl>
          <p
            v-if="department.description"
            class="mt-4 border-t border-gray-100 pt-4 text-sm whitespace-pre-line dark:border-gray-800"
          >
            {{ department.description }}
          </p>
        </UCard>

        <UCard class="xl:col-span-2">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Members</h2>
              <UButton
                v-if="canEdit"
                size="sm"
                icon="i-lucide-user-plus"
                label="Link member"
                @click="showLink = true"
              />
            </div>
          </template>
          <EmptyState
            v-if="department.members.length === 0"
            title="No members linked yet"
            description="Link people into this department. Re-linking a past member reactivates their row instead of creating a duplicate."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="member in department.members"
              :key="member.id"
              class="flex items-center justify-between gap-3 py-3"
            >
              <div class="min-w-0">
                <NuxtLink
                  :to="`/people/${member.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ member.display_name }}
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ member.role }} · joined {{ formatDate(member.joined_at) }}
                </p>
              </div>
              <UButton
                v-if="canUnlink"
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-unlink"
                aria-label="Unlink member"
                :disabled="saving"
                @click="unlinkMember(member.id)"
              />
            </li>
          </ul>
        </UCard>
      </div>

      <UModal
        :open="showLink"
        title="Link a member"
        description="Search active people, pick a junction role, then link."
        @update:open="showLink = $event"
      >
        <template #body>
          <div class="space-y-4">
            <UFormField label="Role">
              <USelect v-model="linkRole" :items="roleOptions" class="w-full" />
            </UFormField>
            <UInput
              v-model="linkSearch"
              icon="i-lucide-search"
              placeholder="Type at least two letters of a name"
              aria-label="Search people to link"
            />
          </div>
          <div v-if="linkPending" class="mt-4 flex justify-center py-4">
            <UIcon
              name="i-lucide-loader-circle"
              class="size-5 animate-spin text-gray-400"
            />
          </div>
          <ul
            v-else-if="linkResults.length > 0"
            class="mt-4 divide-y divide-gray-100 dark:divide-gray-800"
          >
            <li
              v-for="person in linkResults"
              :key="person.id"
              class="flex items-center justify-between gap-3 py-2"
            >
              <span class="text-sm">
                {{
                  person.preferred_name ||
                  [person.first_name, person.last_name].filter(Boolean).join(' ')
                }}
              </span>
              <UButton
                size="xs"
                label="Link"
                :disabled="saving"
                @click="linkMember(person.id)"
              />
            </li>
          </ul>
          <p
            v-else-if="linkSearch.trim().length >= 2"
            class="mt-4 text-sm text-gray-500 dark:text-gray-400"
          >
            No matching people outside this department.
          </p>
        </template>
      </UModal>
    </template>
  </div>
</template>
