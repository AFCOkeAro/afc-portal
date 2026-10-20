<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, PersonDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const savingStatus = ref(false)
const actionError = ref('')

const { data: person, pending, error, refresh } = await useAsyncData(
  `person-${id}`,
  () => api.get<PersonDetail>(`/api/people/${id}`),
)

const branches = await useAsyncData('people-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const showDob = computed(() =>
  permissions.isFieldVisible(COLLECTIONS.people, 'date_of_birth'),
)

const restrictedMessage = computed(() => {
  const hidden = permissions.hiddenFields(COLLECTIONS.people)
  if (hidden.length === 0) return ''
  return `Not shown on this account: ${hidden.join(', ')}.`
})

const displayName = computed(() => {
  const row = person.value
  if (!row) return 'Person'
  return (
    row.preferred_name ||
    [row.first_name, row.last_name].filter(Boolean).join(' ')
  )
})

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

const timelineIcon: Record<string, string> = {
  attendance: 'i-lucide-clipboard-check',
  registration: 'i-lucide-ticket',
  visitor: 'i-lucide-user-plus',
  welfare: 'i-lucide-heart-handshake',
}

async function toggleStatus(): Promise<void> {
  if (!person.value) return
  savingStatus.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/people/${person.value.id}`, {
      status: person.value.status === 'active' ? 'archived' : 'active',
    })
    await refresh()
  } catch (cause) {
    actionError.value = (cause as { message?: string }).message ?? 'Could not update status'
  } finally {
    savingStatus.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/people"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to people"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this person"
      :description="error.message"
    />

    <template v-else-if="person">
      <PageHeader
        :title="displayName"
        :description="`${person.membership_status.replace(/_/g, ' ')} · ${person.branch_name || 'No branch'}`"
      >
        <template #actions>
          <PermissionGate :collection="COLLECTIONS.people" action="update">
            <UButton
              color="neutral"
              variant="outline"
              :label="person.status === 'active' ? 'Archive' : 'Restore'"
              :loading="savingStatus"
              @click="toggleStatus"
            />
            <UButton label="Edit person" icon="i-lucide-pencil" @click="showEdit = true" />
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
      <UAlert
        v-if="restrictedMessage"
        class="mb-4"
        color="warning"
        variant="subtle"
        icon="i-lucide-shield-alert"
        title="Restricted on this account"
        :description="restrictedMessage"
      />

      <div class="grid gap-6 xl:grid-cols-3">
        <UCard class="xl:col-span-1">
          <template #header>
            <h2 class="text-base font-semibold">Profile</h2>
          </template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Status</dt>
              <dd>
                <UBadge :color="person.status === 'active' ? 'success' : 'neutral'" variant="subtle">
                  {{ person.status }}
                </UBadge>
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Gender</dt>
              <dd class="capitalize">{{ person.gender }}</dd>
            </div>
            <div v-if="showDob" class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Age</dt>
              <dd class="tabular-nums">{{ person.age ?? '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
              <dd>{{ person.phone || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Email</dt>
              <dd class="break-all text-right">{{ person.email || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Member since</dt>
              <dd>{{ formatDate(person.member_since) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Guardian</dt>
              <dd class="text-right">{{ person.guardian || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Data consent</dt>
              <dd>{{ person.consent_data ? 'Yes' : 'No' }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-gray-500 dark:text-gray-400">Media consent</dt>
              <dd>{{ person.consent_media ? 'Yes' : 'No' }}</dd>
            </div>
            <div v-if="person.safeguarding_flag" class="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <UIcon name="i-lucide-shield-alert" class="size-4" />
              Safeguarding flag is set
            </div>
          </dl>
          <div v-if="person.address" class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
            <p class="text-gray-500 dark:text-gray-400">Address</p>
            <p class="mt-1 whitespace-pre-line">{{ person.address }}</p>
          </div>
          <div v-if="person.notes" class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
            <p class="text-gray-500 dark:text-gray-400">Notes</p>
            <p class="mt-1 whitespace-pre-line">{{ person.notes }}</p>
          </div>
        </UCard>

        <UCard class="xl:col-span-2">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Timeline</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ person.timeline.length }} events
              </span>
            </div>
          </template>

          <EmptyState
            v-if="person.timeline.length === 0"
            title="No activity yet"
            description="Attendance, event registrations, visitor follow-ups and welfare cases will appear here."
          />

          <ol v-else class="relative space-y-4 border-l border-gray-200 pl-6 dark:border-gray-800">
            <li v-for="item in person.timeline" :key="item.id" class="relative">
              <span class="absolute -left-[31px] flex size-6 items-center justify-center rounded-full bg-white ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
                <UIcon :name="timelineIcon[item.kind] ?? 'i-lucide-circle'" class="size-3.5 text-gray-500" />
              </span>
              <p class="text-sm font-medium">{{ item.title }}</p>
              <p v-if="item.detail" class="text-sm text-gray-600 dark:text-gray-300">
                {{ item.detail }}
              </p>
              <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {{ formatDateTime(item.at) }}
              </p>
            </li>
          </ol>
        </UCard>
      </div>

      <PeopleFormModal
        v-model:open="showEdit"
        :person="person"
        :branches="branches.data.value ?? []"
        :show-dob="showDob"
        @saved="refresh()"
      />
    </template>
  </div>
</template>
