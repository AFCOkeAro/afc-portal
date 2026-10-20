<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, YouthDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const showEdit = ref(false)

const {
  data: profile,
  pending,
  error,
  refresh,
} = await useAsyncData('youth-detail', () =>
  api.get<YouthDetail>(`/api/youth/${route.params.id}`),
)

const branches = await useAsyncData('youth-detail-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

function formatYear(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : String(value)
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      :title="profile?.person_name || 'Youth profile'"
      description="Shared-DB youth record: education, employment and church history."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.youthProfiles" action="update">
          <UButton
            v-if="profile"
            label="Edit profile"
            icon="i-lucide-pencil"
            @click="showEdit = true"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load this youth profile"
      :description="error.message"
    />

    <div v-else-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="profile" class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Profile</h2>
        </template>
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-gray-500">Branch</dt>
            <dd>{{ profile.branch_name || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Status</dt>
            <dd>{{ profile.status }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Education</dt>
            <dd>{{ profile.education_level || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Institution</dt>
            <dd>{{ profile.institution || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Course</dt>
            <dd>{{ profile.course || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Study level</dt>
            <dd>{{ (profile.study_level || '—').replace(/_/g, ' ') }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Employment</dt>
            <dd>{{ (profile.employment_status || '—').replace(/_/g, ' ') }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Profession</dt>
            <dd>{{ profile.professional_status || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Entrepreneur</dt>
            <dd>{{ profile.is_entrepreneur ? 'Yes' : 'No' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Youth leadership</dt>
            <dd>{{ profile.youth_leadership_role || '—' }}</dd>
          </div>
        </dl>
        <p
          v-if="profile.person_is_minor"
          class="mt-3 text-xs text-amber-600 dark:text-amber-400"
        >
          This youth is a minor: celebrations and shout-outs need confirmed guardian
          consent.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Milestones</h2>
        </template>
        <ul v-if="profile.milestones.length > 0" class="space-y-2 text-sm">
          <li v-for="row in profile.milestones" :key="String(row.id)">
            <span class="font-medium">{{
              String(row.milestone_type).replace(/_/g, ' ')
            }}</span>
            <span class="text-gray-500">
              ·
              {{
                row.milestone_date
                  ? formatDate(String(row.milestone_date))
                  : formatYear(row.milestone_year as number | null)
              }}
            </span>
            <p v-if="row.notes" class="text-xs text-gray-500">{{ String(row.notes) }}</p>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No milestones recorded.</p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Previous branches</h2>
        </template>
        <ul v-if="profile.previous_branches.length > 0" class="space-y-2 text-sm">
          <li v-for="row in profile.previous_branches" :key="String(row.id)">
            <span class="font-medium">{{
              String(row.branch_name || row.branch || 'Unknown branch')
            }}</span>
            <span v-if="row.role" class="text-gray-500"> · {{ String(row.role) }}</span>
            <span class="text-gray-500">
              · {{ formatYear(row.from_year as number | null) }}–{{
                formatYear(row.to_year as number | null)
              }}
            </span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No previous branches recorded.</p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Audit trail</h2>
        </template>
        <ul v-if="profile.events.length > 0" class="space-y-2 text-sm">
          <li v-for="item in profile.events" :key="item.id">
            <span class="font-medium">{{ item.event_type }}</span>
            <span v-if="item.detail" class="text-gray-500"> · {{ item.detail }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No audit rows.</p>
      </UCard>
    </div>

    <YouthProfileFormModal
      v-if="profile"
      v-model:open="showEdit"
      :branches="branches.data.value ?? []"
      :profile="profile"
      @saved="refresh()"
    />
  </div>
</template>
