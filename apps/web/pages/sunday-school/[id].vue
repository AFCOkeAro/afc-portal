<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { Paginated, PersonRow } from '~/types/portal'
import type { SundaySchoolClassDetail } from '~/server/api/sunday-school/[id].get'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)

/**
 * Sunday School class page (AFC-870, ChurchCRM English-Adult shape).
 *
 * The model holds no enrolment join, so this page does not invent one:
 * - Stat cards come from the class row (Enrolled = students_count).
 * - Students = the existing scoped /api/people pool for the class branch
 *   with a searchable select (EntitySelect server-search pattern, no new
 *   endpoint, no new privilege).
 * - Events rail = recent sunday_school attendance sessions for the
 *   class branch (existing helper, read-only).
 * - Birthdays rail = month counts only (no DOB, year, or age leaves the
 *   server — see the route comment).
 */
const {
  data: classRow,
  pending,
  error,
  refresh,
} = await useAsyncData(`sunday-school-${id}`, () =>
  api.get<SundaySchoolClassDetail>(`/api/sunday-school/${id}`),
)

const studentSearch = ref('')
const studentPage = ref(1)
const studentLimit = 10

let studentTimer: ReturnType<typeof setTimeout> | undefined
const studentSearchInput = ref('')
watch(studentSearchInput, (value: string) => {
  clearTimeout(studentTimer)
  studentTimer = setTimeout(() => {
    studentSearch.value = value.trim()
    studentPage.value = 1
  }, 300)
})

const studentQuery = computed(() => ({
  page: studentPage.value,
  limit: studentLimit,
  status: 'active',
  ...(classRow.value?.branch ? { branch: classRow.value.branch } : {}),
  ...(studentSearch.value ? { search: studentSearch.value } : {}),
}))

const { data: students, pending: studentsPending } = await useAsyncData(
  `sunday-school-${id}-students`,
  () =>
    classRow.value
      ? api.get<Paginated<PersonRow>>('/api/people', { query: studentQuery.value })
      : Promise.resolve(null),
  { watch: [studentQuery, classRow] },
)

const studentRows = computed(() => students.value?.data ?? [])
const studentTotal = computed(() => students.value?.meta.total ?? 0)

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const maxBirthdays = computed(() =>
  Math.max(1, ...(classRow.value?.birthdaysByMonth ?? []).map(Number)),
)

function personName(row: PersonRow): string {
  return (
    row.preferred_name ||
    [row.first_name, row.last_name].filter(Boolean).join(' ') ||
    row.id
  )
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
      :title="classRow?.class_name || 'Sunday School class'"
      description="Scoped class: stats, students from the branch people pool, birthdays by month, and recent Sunday School sessions."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          label="Refresh"
          icon="i-lucide-refresh-cw"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <PermissionGate :collection="COLLECTIONS.sundaySchoolClasses" action="read">
      <UAlert
        v-if="error"
        class="mb-4"
        color="error"
        variant="subtle"
        title="Could not load this class"
        :description="error.message"
      />

      <div v-else-if="pending" class="flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <div v-else-if="classRow" class="grid gap-4 lg:grid-cols-3">
        <div class="space-y-4 lg:col-span-2">
          <UCard>
            <template #header>
              <h2 class="font-semibold">Class at a glance</h2>
            </template>
            <dl class="grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
              <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Enrolled</dt>
                <dd class="text-xl font-semibold tabular-nums">
                  {{ classRow.students_count ?? '—' }}
                </dd>
              </div>
              <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Branch</dt>
                <dd class="text-sm font-semibold">
                  {{ classRow.branch_name || 'Area class' }}
                </dd>
              </div>
              <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Teacher</dt>
                <dd class="text-sm font-semibold">{{ classRow.teacher_name || '—' }}</dd>
              </div>
              <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-900">
                <dt class="text-xs text-gray-500 dark:text-gray-400">Status</dt>
                <dd class="text-sm font-semibold capitalize">{{ classRow.status }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold">Students</h2>
            </template>
            <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Branch people pool — the model has no class enrolment join, so this searches
              the same scoped /api/people rows the people page shows.
              {{ studentTotal }} matching people{{
                classRow.branch_name ? ` at ${classRow.branch_name}` : ''
              }}.
            </p>
            <UInput
              v-model="studentSearchInput"
              icon="i-lucide-search"
              placeholder="Search students"
              aria-label="Search students"
              class="mb-3"
            />
            <div v-if="studentsPending" class="flex justify-center py-6">
              <UIcon
                name="i-lucide-loader-circle"
                class="size-5 animate-spin text-gray-400"
              />
            </div>
            <ul
              v-else-if="studentRows.length > 0"
              class="divide-y divide-gray-100 text-sm dark:divide-gray-800"
            >
              <li
                v-for="student in studentRows"
                :key="student.id"
                class="flex items-center justify-between gap-3 py-2"
              >
                <NuxtLink
                  :to="`/people/${student.id}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ personName(student) }}
                </NuxtLink>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  {{ student.membership_status || student.status || '' }}
                </span>
              </li>
            </ul>
            <p v-else class="text-sm text-gray-500">No matching people in this branch.</p>
            <div
              v-if="studentTotal > studentLimit"
              class="mt-3 flex items-center justify-between text-sm"
            >
              <p class="text-gray-500 dark:text-gray-400">Page {{ studentPage }}</p>
              <div class="flex gap-2">
                <UButton
                  color="neutral"
                  variant="outline"
                  size="xs"
                  label="Previous"
                  :disabled="studentPage <= 1"
                  @click="studentPage -= 1"
                />
                <UButton
                  color="neutral"
                  variant="outline"
                  size="xs"
                  label="Next"
                  @click="studentPage += 1"
                />
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold">Birthdays by month</h2>
            </template>
            <p class="mb-3 text-xs text-gray-500 dark:text-gray-400">
              Month counts for this branch — no dates, years, or ages.
            </p>
            <div
              class="flex items-end gap-1"
              role="img"
              aria-label="Birthdays by month bar chart"
            >
              <div
                v-for="(count, index) in classRow.birthdaysByMonth ?? []"
                :key="index"
                class="flex-1 text-center"
              >
                <div
                  class="mx-auto w-full max-w-6 rounded-t bg-primary-400"
                  :style="{
                    height: `${Math.max(4, Math.round((Number(count) / maxBirthdays) * 72))}px`,
                  }"
                  :title="`${MONTHS[index]}: ${count}`"
                />
                <p class="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
                  {{ MONTHS[index] }}
                </p>
                <p class="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">
                  {{ count }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <div class="space-y-4">
          <UCard>
            <template #header>
              <h2 class="font-semibold">About</h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div>
                <dt class="text-gray-500">Class</dt>
                <dd class="font-medium">{{ classRow.class_name }}</dd>
              </div>
              <div>
                <dt class="text-gray-500">Branch</dt>
                <dd>{{ classRow.branch_name || 'Area class' }}</dd>
              </div>
              <div>
                <dt class="text-gray-500">Teacher</dt>
                <dd>{{ classRow.teacher_name || '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <h2 class="font-semibold">Properties</h2>
            </template>
            <dl class="space-y-2 text-sm">
              <div>
                <dt class="text-gray-500">Status</dt>
                <dd class="capitalize">{{ classRow.status }}</dd>
              </div>
              <div>
                <dt class="text-gray-500">Enrolled</dt>
                <dd class="tabular-nums">{{ classRow.students_count ?? '—' }}</dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="font-semibold">Events</h2>
                <UButton
                  to="/attendance?session_type=sunday_school"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  label="Sessions"
                />
              </div>
            </template>
            <ul v-if="classRow.sessions.length > 0" class="space-y-2 text-sm">
              <li v-for="session in classRow.sessions" :key="session.id">
                <NuxtLink
                  :to="`/attendance/${session.id}`"
                  class="flex items-center justify-between gap-3"
                >
                  <span>{{
                    session.session_name || formatDate(session.session_date)
                  }}</span>
                  <span class="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {{ session.total ?? '—' }}
                  </span>
                </NuxtLink>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatDate(session.session_date) }}
                </p>
              </li>
            </ul>
            <p v-else class="text-sm text-gray-500">
              No recent Sunday School sessions for this branch.
            </p>
          </UCard>
        </div>
      </div>
    </PermissionGate>
  </div>
</template>
