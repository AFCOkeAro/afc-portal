<script setup lang="ts">
/**
 * ManagementTeamSection (AFC-593): read-only management-team rollup for one
 * scope level (branch, zone or area).
 *
 * Reads `GET /api/management-teams?level=&id=` — leaders resolve through the
 * existing people_departments junction (role=leader) plus the department's
 * leader_person pointer, with the same contact scope the department detail
 * route already exposes. This component issues no writes: names link to the
 * existing read-only department and person pages.
 */
import type { ManagementTeamEntry } from '~/types/portal'

const props = defineProps<{
  level: 'branch' | 'zone' | 'area'
  scopeId: string
}>()

const api = useApi()

const {
  data,
  pending,
  error,
  refresh,
} = await useAsyncData(
  () => `management-team-${props.level}-${props.scopeId}`,
  () =>
    api.get<{ data: ManagementTeamEntry[] }>(
      `/api/management-teams?level=${encodeURIComponent(props.level)}&id=${encodeURIComponent(props.scopeId)}`,
    ),
  { watch: [() => props.level, () => props.scopeId] },
)

const entries = computed(() => data.value?.data ?? [])
</script>

<template>
  <div>
    <div v-if="pending" class="flex justify-center py-8">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load the management team"
      :description="error.message"
    >
      <template #actions>
        <UButton color="neutral" variant="soft" size="xs" label="Retry" @click="refresh()" />
      </template>
    </UAlert>

    <EmptyState
      v-else-if="entries.length === 0"
      title="No departments at this level yet"
      description="Departments and groups scoped to this level appear here with their leaders once the board scopes them."
    />

    <ul v-else class="divide-y divide-gray-100 text-sm dark:divide-gray-800">
      <li v-for="entry in entries" :key="entry.department" class="py-3">
        <div class="flex items-baseline justify-between gap-2">
          <NuxtLink
            :to="`/departments/${entry.department}`"
            class="font-medium text-primary-600 underline hover:text-primary-700"
          >
            {{ entry.department_name }}
          </NuxtLink>
          <span
            v-if="entry.department_type"
            class="shrink-0 text-xs capitalize text-gray-500 dark:text-gray-400"
          >
            {{ entry.department_type.replace(/_/g, ' ') }}
          </span>
        </div>
        <p
          v-if="entry.leaders.length === 0"
          class="mt-1 text-xs text-gray-500 dark:text-gray-400"
        >
          No leader assigned yet
        </p>
        <ul v-else class="mt-1 space-y-1">
          <li
            v-for="leader in entry.leaders"
            :key="leader.person"
            class="flex items-baseline justify-between gap-2 text-sm"
          >
            <NuxtLink
              :to="`/people/${leader.person}`"
              class="text-gray-700 underline decoration-dotted hover:text-gray-900 dark:text-gray-200 dark:hover:text-white"
            >
              {{ leader.display_name }}
            </NuxtLink>
            <span
              class="shrink-0 text-xs capitalize text-gray-500 dark:text-gray-400"
            >
              {{ leader.role.replace(/_/g, ' ') }}
            </span>
          </li>
        </ul>
      </li>
    </ul>
  </div>
</template>
