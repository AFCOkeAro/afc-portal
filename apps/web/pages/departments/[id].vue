<script setup lang="ts">
import { COLLECTIONS, renderMarkdownSafe } from '@afc/shared'
import type { DepartmentDetail, Paginated, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const auth = useAuth()
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

interface DepartmentGuide {
  id: string
  department: string
  title: string
  body: string
  sort_order: number
  created_at: string
  updated_at: string
}

const {
  data: guidesResponse,
  pending: guidesPending,
  error: guidesError,
  refresh: refreshGuides,
} = await useAsyncData(`department-guides-${departmentId}`, () =>
  api.get<{ data: DepartmentGuide[] }>(`/api/departments/${departmentId}/guides`),
)

const guides = computed(() => guidesResponse.value?.data ?? [])

/**
 * Guides tab (AFC-800). Two tabs: Members | Guides. Guide reads are open
 * to every department reader; the editor is visible only to writers —
 * mirroring the API gate client-side: the departments update grant, or the
 * signed-in user holding an active leader link (matched by person id in the
 * already-loaded members list). The server enforces the same check, so this
 * is defence in depth, never authorisation.
 */
const guideTabs = [
  { label: 'Members', icon: 'i-lucide-users', slot: 'members' as const },
  { label: 'Guides', icon: 'i-lucide-book-open', slot: 'guides' as const },
]

const myPersonId = computed(() => auth.user.value?.personId ?? null)

const canEdit = computed(() => permissions.can(COLLECTIONS.peopleDepartments, 'create'))
const canUnlink = computed(() => permissions.can(COLLECTIONS.peopleDepartments, 'update'))
const canWriteGuides = computed(
  () =>
    permissions.can(COLLECTIONS.departments, 'update') ||
    (myPersonId.value !== null &&
      (department.value?.members ?? []).some(
        (member) => member.id === myPersonId.value && member.role === 'leader',
      )),
)

const showGuideForm = ref(false)
const editingGuide = ref<DepartmentGuide | null>(null)
const guideForm = ref({ title: '', body: '', sort_order: 0 })
const guideSaving = ref(false)
const guideError = ref('')

function guideHtml(guide: DepartmentGuide): string {
  return renderMarkdownSafe(String(guide.body ?? ''))
}

function openNewGuide(): void {
  editingGuide.value = null
  guideForm.value = { title: '', body: '', sort_order: guides.value.length }
  guideError.value = ''
  showGuideForm.value = true
}

function openEditGuide(guide: DepartmentGuide): void {
  editingGuide.value = guide
  guideForm.value = { title: guide.title, body: guide.body, sort_order: guide.sort_order }
  guideError.value = ''
  showGuideForm.value = true
}

async function saveGuide(): Promise<void> {
  guideSaving.value = true
  guideError.value = ''
  try {
    const payload = {
      title: guideForm.value.title,
      body: guideForm.value.body,
      sort_order: Number(guideForm.value.sort_order),
    }
    if (editingGuide.value) {
      await api.patch(
        `/api/departments/${departmentId}/guides/${editingGuide.value.id}`,
        payload,
      )
    } else {
      await api.post(`/api/departments/${departmentId}/guides`, payload)
    }
    showGuideForm.value = false
    editingGuide.value = null
    await refreshGuides()
  } catch (cause) {
    guideError.value =
      (cause as { message?: string }).message ?? 'Could not save the guide'
  } finally {
    guideSaving.value = false
  }
}

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

        <div class="xl:col-span-2">
          <UTabs :items="guideTabs">
            <template #members>
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
            </template>

            <template #guides>
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold" tabindex="-1">
                      Guides ({{ guides.length }})
                    </h2>
                    <UButton
                      v-if="canWriteGuides"
                      size="sm"
                      icon="i-lucide-plus"
                      label="New guide"
                      @click="openNewGuide"
                    />
                  </div>
                </template>

                <div v-if="guidesPending" class="flex justify-center py-8">
                  <UIcon
                    name="i-lucide-loader-circle"
                    class="size-5 animate-spin text-gray-400"
                  />
                </div>

                <UAlert
                  v-else-if="guidesError"
                  color="error"
                  variant="subtle"
                  title="Could not load the guides"
                  :description="guidesError.message"
                />

                <EmptyState
                  v-else-if="guides.length === 0"
                  title="No guides yet"
                  description="Guides are ordered instructions for this department. Editors and department leaders can add the first one."
                />

                <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
                  <li
                    v-for="guide in guides"
                    :key="guide.id"
                    class="py-4 first:pt-0 last:pb-0"
                  >
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <h3 class="font-medium text-gray-900 dark:text-white">
                          {{ guide.title }}
                        </h3>
                        <p class="text-xs text-gray-500 dark:text-gray-400">
                          Updated {{ formatDate(guide.updated_at) }}
                        </p>
                      </div>
                      <UButton
                        v-if="canWriteGuides"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        icon="i-lucide-pencil"
                        aria-label="Edit guide"
                        @click="openEditGuide(guide)"
                      />
                    </div>
                    <!-- guideHtml comes from the shared XSS-safe renderer
                      (escape-first, allowlisted tags), never from raw user HTML. -->
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <div class="markdown-body mt-2 text-sm" v-html="guideHtml(guide)" />
                  </li>
                </ul>
              </UCard>
            </template>
          </UTabs>
        </div>
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

      <UModal
        :open="showGuideForm"
        :title="editingGuide ? 'Edit guide' : 'New guide'"
        description="Guides are ordered Markdown instructions for this department."
        @update:open="showGuideForm = $event"
      >
        <template #body>
          <div class="space-y-4">
            <UFormField label="Title" required>
              <UInput
                v-model="guideForm.title"
                placeholder="Name the guide"
                aria-label="Guide title"
              />
            </UFormField>
            <UFormField label="Body">
              <UTextarea
                v-model="guideForm.body"
                placeholder="Markdown instructions for this department"
                aria-label="Guide body"
                :rows="8"
              />
            </UFormField>
            <UFormField label="Order" hint="Lower sorts first">
              <UInput
                v-model="guideForm.sort_order"
                type="number"
                min="0"
                max="9999"
                aria-label="Guide sort order"
              />
            </UFormField>
          </div>
          <UAlert
            v-if="guideError"
            class="mt-4"
            color="error"
            variant="subtle"
            :description="guideError"
          />
        </template>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="showGuideForm = false"
            />
            <UButton label="Save guide" :loading="guideSaving" @click="saveGuide" />
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
