<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type {
  BranchSummary,
  HouseholdDetail,
  HouseholdMemberRow,
  Paginated,
  PersonRow,
} from '~/types/portal'

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
const linkSelected = ref<string | undefined>(undefined)
let linkTimer: ReturnType<typeof setTimeout> | undefined

const linkOptions = computed(() =>
  linkResults.value.map((person: PersonRow) => ({
    label:
      person.preferred_name ||
      [person.first_name, person.last_name].filter(Boolean).join(' ') ||
      'Unnamed person',
    value: person.id,
  })),
)

function onLinkSearchTerm(term: string): void {
  linkSearch.value = term
  clearTimeout(linkTimer)
  linkTimer = setTimeout(() => void searchPeople(term.trim()), 250)
}

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
    linkSelected.value = undefined
    linkResults.value = []
    await refresh()
  } catch (cause) {
    const error = cause as { message?: string; fields?: Record<string, string> }
    actionError.value = error.message ?? 'Could not link that member'
    const fieldMessage = error.fields?.person
    if (fieldMessage) actionError.value = `Person: ${fieldMessage}`
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

const photoUrl = computed(() =>
  household.value?.photo_file ? `/api/households/${household.value.id}/photo` : null,
)

const photoInput = ref<HTMLInputElement | null>(null)

async function uploadPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  input.value = ''
  if (!picked || !household.value) return
  saving.value = true
  actionError.value = ''
  try {
    const form = new FormData()
    form.append('photo', picked)
    await api.post(`/api/households/${household.value.id}/photo`, form)
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not upload the photo'
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

/** 40px roster dots (AFC-929): first + last initial, mirrors PersonAvatar. */
function memberInitials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase()
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  return (first.charAt(0) + last.charAt(0)).toUpperCase() || '?'
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

      <UCard class="mb-6">
        <div class="flex flex-wrap items-center gap-4">
          <ProfileAvatar
            :name="household.name || 'Unnamed household'"
            :photo-url="photoUrl"
            size="lg"
          />
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-xl font-semibold">
              {{ household.name || 'Unnamed household' }}
            </h2>
            <p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {{ household.member_count }} member{{
                household.member_count === 1 ? '' : 's'
              }}
              ·
              {{ household.branch_name || 'No branch' }}
            </p>
          </div>
          <PermissionGate :collection="COLLECTIONS.households" action="update">
            <input
              ref="photoInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="hidden"
              aria-label="Upload household photo"
              @change="uploadPhoto"
            />
            <UButton
              label="Upload photo"
              icon="i-lucide-camera"
              color="neutral"
              variant="outline"
              :loading="saving"
              @click="photoInput?.click()"
            />
          </PermissionGate>
        </div>
      </UCard>

      <!-- ChurchCRM Family Profile parity: main column (members + key
        people + timeline) with a right rail (status / phone / properties).
        Every field renders only where data exists; scoping is unchanged. -->
      <!-- AFC-929 (approved mockup AFC-928 v3): right rail stays sticky
        while the roster scrolls; member rows carry 40px initial dots in
        the mockup's household language. Full names + roles stay on this
        page (it is the full roster — the person page shows first names
        only). -->
      <div class="grid gap-8 lg:grid-cols-3">
        <div class="space-y-8 lg:col-span-2">
          <section id="overview" class="scroll-mt-28">
            <h2 class="sr-only" tabindex="-1">Overview</h2>
            <UCard>
              <template #header>
                <h2 class="text-base font-semibold" tabindex="-1">Key people</h2>
              </template>
              <EmptyState
                v-if="household.members.length === 0"
                title="No key people yet"
                description="Link people into this household to name the head and household roles."
              />
              <table v-else class="w-full text-sm">
                <caption class="sr-only">
                  Key people in this family
                </caption>
                <thead>
                  <tr
                    class="border-b border-gray-100 text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400"
                  >
                    <th scope="col" class="py-2 pr-4 font-medium">Name</th>
                    <th scope="col" class="py-2 pr-4 font-medium">Role</th>
                    <th scope="col" class="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                  <tr
                    v-for="member in household.members.filter(
                      (row: HouseholdMemberRow) =>
                        row.is_head || row.household_role === 'spouse',
                    )"
                    :key="member.id"
                  >
                    <td class="py-2 pr-4">
                      <span class="flex items-center gap-2">
                        <ProfileAvatar :name="member.display_name" size="sm" />
                        <NuxtLink
                          :to="`/people/${member.id}`"
                          class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                        >
                          {{ member.display_name }}
                        </NuxtLink>
                      </span>
                      <span v-if="member.is_minor" class="ml-1 text-xs text-gray-500"
                        >· minor</span
                      >
                    </td>
                    <td class="py-2 pr-4 text-gray-600 dark:text-gray-300">
                      {{
                        member.is_head
                          ? 'Household head'
                          : member.household_role?.replace(/_/g, ' ') || 'member'
                      }}
                    </td>
                    <td class="py-2 text-gray-600 dark:text-gray-300">
                      {{ member.membership_status.replace(/_/g, ' ') }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p
                v-if="
                  household.members.length > 0 &&
                  household.members.filter(
                    (row: HouseholdMemberRow) =>
                      row.is_head || row.household_role === 'spouse',
                  ).length === 0
                "
                class="mt-2 text-sm text-gray-500 dark:text-gray-400"
              >
                Head: {{ household.head_name || 'Not set' }} — set a head from the members
                table.
              </p>
            </UCard>
          </section>

          <section id="members" class="scroll-mt-28">
            <UCard>
              <template #header>
                <div class="flex items-center justify-between">
                  <h2 class="text-base font-semibold" tabindex="-1">Family members</h2>
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
                  <div class="flex min-w-0 items-center gap-3">
                    <span
                      class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                      aria-hidden="true"
                    >
                      {{ memberInitials(member.display_name) }}
                    </span>
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

          <section id="contact" class="scroll-mt-28">
            <UCard>
              <template #header>
                <h2 class="text-base font-semibold" tabindex="-1">
                  Location and contact
                </h2>
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
                v-if="household.address_1 || household.address"
                class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800"
              >
                <p class="text-gray-500 dark:text-gray-400">Address</p>
                <p class="mt-1 whitespace-pre-line">
                  {{
                    [
                      household.address_1,
                      household.address_2,
                      household.city,
                      household.state,
                      household.zip,
                      household.country,
                    ]
                      .filter(Boolean)
                      .join(', ') || household.address
                  }}
                </p>
                <p
                  v-if="household.latitude != null && household.longitude != null"
                  class="mt-1 text-xs text-gray-500 dark:text-gray-400"
                >
                  Map pin: {{ household.latitude }}, {{ household.longitude }}
                </p>
              </div>
              <p v-else class="mt-4 text-xs text-gray-500 dark:text-gray-400">
                Address text only — the map pin is deferred.
              </p>
            </UCard>
          </section>

          <UCard>
            <template #header>
              <h2 class="text-base font-semibold" tabindex="-1">Timeline</h2>
            </template>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              Household activity lives on the person timelines — open a member above to
              see notes, events and system entries. No household-level timeline is stored.
            </p>
            <ul v-if="household.members.length > 0" class="mt-3 space-y-1 text-sm">
              <li v-for="member in household.members" :key="`timeline-${member.id}`">
                <NuxtLink
                  :to="`/people/${member.id}#timeline`"
                  class="text-primary-600 hover:underline dark:text-primary-400"
                >
                  {{ member.display_name }} timeline
                </NuxtLink>
              </li>
            </ul>
          </UCard>
        </div>

        <aside
          class="space-y-6 lg:sticky lg:top-20 lg:self-start"
          aria-label="Household summary"
        >
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold" tabindex="-1">Household</h2>
            </template>
            <div class="flex items-center gap-3">
              <ProfileAvatar
                :name="household.name || household.head_name || 'H'"
                :photo-url="photoUrl"
                size="md"
              />
              <div class="min-w-0 text-sm">
                <p class="truncate font-medium">
                  {{ household.name || 'Unnamed household' }}
                </p>
                <p class="text-gray-500 dark:text-gray-400">
                  {{ household.member_count }} member{{
                    household.member_count === 1 ? '' : 's'
                  }}
                </p>
              </div>
            </div>
            <dl class="mt-4 space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Status</dt>
                <dd><UBadge color="success" variant="subtle">active</UBadge></dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
                <dd>{{ household.phone || '—' }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Head</dt>
                <dd class="text-right">{{ household.head_name || 'Not set' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="text-base font-semibold" tabindex="-1">Properties</h2>
            </template>
            <dl class="space-y-3 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Wedding date</dt>
                <dd>{{ formatDate(household.wedding_date) }}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
                <dd class="text-right">{{ household.branch_name || '—' }}</dd>
              </div>
              <div
                v-if="household.city || household.state || household.country"
                class="flex justify-between gap-4"
              >
                <dt class="text-gray-500 dark:text-gray-400">Area</dt>
                <dd class="text-right">
                  {{
                    [household.city, household.state, household.country]
                      .filter(Boolean)
                      .join(', ')
                  }}
                </dd>
              </div>
              <div
                v-if="household.latitude != null && household.longitude != null"
                class="flex justify-between gap-4"
              >
                <dt class="text-gray-500 dark:text-gray-400">Map pin</dt>
                <dd class="tabular-nums">
                  {{ household.latitude }}, {{ household.longitude }}
                </dd>
              </div>
            </dl>
          </UCard>
        </aside>
      </div>

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
          <EntitySelect
            v-model="linkSelected"
            :items="linkOptions"
            placeholder="Type at least two letters of a name…"
            search-placeholder="Type to filter people…"
            empty-text="No matching people outside this household."
            :loading="linkPending"
            server-search
            aria-label="Search people to link"
            @update:search-term="onLinkSearchTerm"
          />
          <p v-if="linkSelected" class="mt-4 text-sm text-gray-500 dark:text-gray-400">
            Pick Link below to add the selected person to this household.
          </p>
          <p
            v-else-if="
              linkSearch.trim().length >= 2 && linkResults.length === 0 && !linkPending
            "
            class="mt-4 text-sm text-gray-500 dark:text-gray-400"
          >
            No matching people outside this household.
          </p>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="showLink = false"
            />
            <UButton
              label="Link member"
              :disabled="!linkSelected || saving"
              :loading="saving"
              @click="linkSelected && linkMember(linkSelected)"
            />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
