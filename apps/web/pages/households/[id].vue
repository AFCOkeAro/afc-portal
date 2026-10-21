<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, HouseholdDetail, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const householdId = String(route.params.id)
const showEdit = ref(false)
const showLink = ref(false)
const actionError = ref('')
const saving = ref(false)

const {
  data: household,
  pending,
  error,
  refresh,
} = await useAsyncData(`household-${householdId}`, () =>
  api.get<HouseholdDetail>(`/api/households/${householdId}`),
)

const branches = await useAsyncData('household-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const canEdit = computed(
  () =>
    permissions.can(COLLECTIONS.households, 'update') &&
    permissions.can(COLLECTIONS.people, 'update'),
)

const memberIds = computed(
  () => new Set((household.value?.members ?? []).map((member) => member.id)),
)

const linkSearch = ref('')
const linkResults = ref<PersonRow[]>([])
const linkPending = ref(false)
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
    await api.post(`/api/households/${householdId}/members`, { person: personId })
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
    await api.remove(`/api/households/${householdId}/members`, {
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

async function makeHead(personId: string): Promise<void> {
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/households/${householdId}`, { household_head: personId })
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not set the household head'
  } finally {
    saving.value = false
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  { id: 'members', label: 'Members' },
  { id: 'contact', label: 'Contact' },
])
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/households"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to households"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this household"
      :description="error.message"
    />

    <template v-else-if="household">
      <PageHeader
        :title="household.name || 'Unnamed household'"
        :description="`${household.member_count} member${household.member_count === 1 ? '' : 's'} · ${household.branch_name || 'No branch'}`"
      >
        <template #actions>
          <PermissionGate :collection="COLLECTIONS.households" action="update">
            <UButton
              label="Edit household"
              icon="i-lucide-pencil"
              @click="showEdit = true"
            />
          </PermissionGate>
        </template>
      </PageHeader>

      <UAlert
        v-if="actionError"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />

      <SectionNav :sections="sections" />

      <section id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <UCard>
          <dl class="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Household head</dt>
              <dd class="mt-1 font-medium">{{ household.head_name || 'Not set' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Wedding date</dt>
              <dd class="mt-1">{{ formatDate(household.wedding_date) }}</dd>
            </div>
          </dl>
        </UCard>
      </section>

      <section id="members" class="mt-8 scroll-mt-28">
        <UCard>
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
            v-if="household.members.length === 0"
            title="No members linked yet"
            description="Link people into this household. Linking writes people.household, so it needs both household and person edit rights."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="member in household.members"
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
                  {{ member.household_role?.replace(/_/g, ' ') || 'member' }} ·
                  {{ member.membership_status.replace(/_/g, ' ') }}
                  <span v-if="member.is_head"> · household head</span>
                  <span v-if="member.is_minor"> · minor</span>
                </p>
              </div>
              <div v-if="canEdit" class="flex shrink-0 items-center gap-1">
                <UButton
                  v-if="!member.is_head"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  label="Make head"
                  :disabled="saving"
                  @click="makeHead(member.id)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-unlink"
                  aria-label="Unlink member"
                  :disabled="saving"
                  @click="unlinkMember(member.id)"
                />
              </div>
            </li>
          </ul>
        </UCard>
      </section>

      <section id="contact" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Contact</h2>
          </template>
          <dl class="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
              <dd class="mt-1">{{ household.phone || '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
              <dd class="mt-1">{{ household.branch_name || '—' }}</dd>
            </div>
          </dl>
          <div
            v-if="household.address"
            class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800"
          >
            <p class="text-gray-500 dark:text-gray-400">Address</p>
            <p class="mt-1 whitespace-pre-line">{{ household.address }}</p>
          </div>
          <p class="mt-4 text-xs text-gray-500 dark:text-gray-400">
            Address text only — the map pin is deferred.
          </p>
        </UCard>
      </section>

      <HouseholdFormModal
        v-model:open="showEdit"
        :household="household"
        :branches="branches.data.value ?? []"
        @saved="refresh()"
      />

      <UModal
        :open="showLink"
        title="Link a member"
        description="Search active people, then link one into this household."
        @update:open="showLink = $event"
      >
        <template #body>
          <UInput
            v-model="linkSearch"
            icon="i-lucide-search"
            placeholder="Type at least two letters of a name"
            aria-label="Search people to link"
          />
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
            No matching people outside this household.
          </p>
        </template>
      </UModal>
    </template>
  </div>
</template>
