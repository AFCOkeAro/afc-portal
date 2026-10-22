<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchDetail, PersonRow } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const permissions = usePermissions()
const id = computed(() => String(route.params.id))

/**
 * Section gates are capabilities, never role names (data-model §13 rule 7).
 * The welfare section and card are absent — not zeroed — for sessions without
 * welfare_cases:read, so a volunteer never sees a misleading "0 open cases".
 */
const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))
const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canPeople = computed(() => permissions.can(COLLECTIONS.people, 'read'))
const canEvents = computed(() => permissions.can(COLLECTIONS.events, 'read'))
const canVisitors = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
const canLeadership = computed(() => permissions.can(COLLECTIONS.departments, 'read'))
const canBlessings = computed(() => permissions.can(COLLECTIONS.blessings, 'read'))

const { data, pending, error, refresh } = await useAsyncData(
  () => `branch-${id.value}`,
  () => api.get<BranchDetail>(`/api/branches/${id.value}`),
  { watch: [id] },
)

const sections = computed(() => [
  { id: 'overview', label: 'Overview' },
  ...(canAttendance.value ? [{ id: 'attendance', label: 'Attendance' }] : []),
  ...(canPeople.value ? [{ id: 'people', label: 'People' }] : []),
  ...(canEvents.value ? [{ id: 'events', label: 'Events' }] : []),
  ...(canVisitors.value ? [{ id: 'follow-ups', label: 'Follow-ups' }] : []),
  ...(canWelfare.value ? [{ id: 'welfare-with-scope', label: 'Welfare' }] : []),
  ...(canBlessings.value ? [{ id: 'blessings', label: 'Blessings' }] : []),
  ...(canLeadership.value ? [{ id: 'leadership', label: 'Leadership' }] : []),
])

const trendMax = computed(() =>
  Math.max(1, ...(data.value?.attendance_trend.map((point) => point.total) ?? [1])),
)

function fullName(person: PersonRow): string {
  return (
    person.preferred_name ||
    [person.first_name, person.last_name].filter(Boolean).join(' ') ||
    'Unnamed'
  )
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
}
</script>

<template>
  <div>
    <PageHeader
      :title="data?.name ?? 'Branch'"
      :description="
        data
          ? `${data.code} · ${data.branch_type.replace(/_/g, ' ')}${data.city ? ` · ${data.city}` : ''}`
          : 'Loading branch profile.'
      "
    >
      <template #actions>
        <UButton
          to="/branches"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          label="All branches"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          label="Refresh"
          :loading="pending"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load this branch"
      :description="error.message"
    />

    <div v-else-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else-if="data">
      <SectionNav :sections="sections" />

      <section id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <NuxtLink :to="`/people?branch=${data.id}`" class="block">
            <StatCard
              label="People"
              :value="data.people_count"
              :hint="`${data.minor_count} minors · ${data.youth_count} youth`"
            />
          </NuxtLink>
          <NuxtLink :to="`/attendance?branch=${data.id}`" class="block">
            <StatCard
              label="Last Sunday"
              :value="data.attendance_last_sunday"
              :hint="`${data.attendance_last_30_days} in the last 30 days`"
            />
          </NuxtLink>
          <NuxtLink
            v-if="canVisitors"
            :to="`/visitors?status=open&branch=${data.id}`"
            class="block"
          >
            <StatCard
              label="Open follow-ups"
              :value="data.open_follow_ups"
              hint="Newcomers awaiting a next step"
            />
          </NuxtLink>
          <NuxtLink
            v-if="canWelfare"
            :to="`/welfare?status=open&branch=${data.id}`"
            class="block"
          >
            <StatCard
              label="Open welfare"
              :value="data.open_welfare"
              hint="Open and in-progress cases"
            />
          </NuxtLink>
          <NuxtLink
            v-if="canBlessings"
            :to="`/blessings?branch=${data.id}`"
            class="block"
          >
            <StatCard
              label="Blessings"
              :value="data.blessings_total"
              hint="Recorded blessings, all types"
            />
          </NuxtLink>
        </div>

        <div class="mt-6 grid gap-6 xl:grid-cols-2">
          <UCard>
            <template #header>
              <h2 class="text-base font-semibold">Branch details</h2>
            </template>
            <dl class="grid gap-4 sm:grid-cols-2">
              <div>
                <dt
                  class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  Code
                </dt>
                <dd class="mt-1 text-sm">{{ data.code }}</dd>
              </div>
              <div>
                <dt
                  class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  Type
                </dt>
                <dd class="mt-1 text-sm capitalize">
                  {{ data.branch_type.replace(/_/g, ' ') }}
                </dd>
              </div>
              <div>
                <dt
                  class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  Phone
                </dt>
                <dd class="mt-1 text-sm">{{ data.phone || '—' }}</dd>
              </div>
              <div>
                <dt
                  class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  Email
                </dt>
                <dd class="mt-1 text-sm">{{ data.email || '—' }}</dd>
              </div>
              <div class="sm:col-span-2">
                <dt
                  class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  Address
                </dt>
                <dd class="mt-1 text-sm">
                  {{
                    [data.address, data.city, data.state].filter(Boolean).join(', ') ||
                    '—'
                  }}
                </dd>
              </div>
            </dl>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <h2 class="text-base font-semibold">Attendance trend</h2>
                <span class="text-xs text-gray-500 dark:text-gray-400"
                  >Last 12 weeks</span
                >
              </div>
            </template>
            <EmptyState
              v-if="data.attendance_trend.length === 0"
              title="No attendance recorded yet"
              description="Capture a session to start the trend."
            />
            <div v-else class="flex h-52 items-end gap-2 overflow-x-auto pb-2">
              <div
                v-for="point in data.attendance_trend"
                :key="point.date"
                class="flex min-w-8 flex-1 flex-col items-center justify-end gap-1"
                :title="`${point.date}: ${point.total}`"
              >
                <span class="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{{
                  point.total
                }}</span>
                <div
                  class="w-full rounded-t bg-primary-500/80"
                  :style="{ height: `${Math.max(4, (point.total / trendMax) * 156)}px` }"
                />
                <span class="whitespace-nowrap text-[10px] text-gray-400">{{
                  point.date.slice(5)
                }}</span>
              </div>
            </div>
          </UCard>
        </div>
      </section>

      <section v-if="canAttendance" id="attendance" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
              <UButton
                :to="`/attendance?branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="Open attendance"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.attendance_trend.length === 0"
            title="No sessions in this period"
            description="Sunday, midweek and event sessions will appear here."
          />
          <div v-else class="overflow-x-auto">
            <table
              class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800"
            >
              <thead>
                <tr
                  class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
                >
                  <th class="px-3 py-2 font-medium">Date</th>
                  <th class="px-3 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr
                  v-for="point in [...data.attendance_trend].reverse()"
                  :key="point.date"
                >
                  <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                    {{ formatDate(point.date) }}
                  </td>
                  <td class="px-3 py-3 font-medium tabular-nums">{{ point.total }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </UCard>
      </section>

      <section v-if="canPeople" id="people" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">People</h2>
              <UButton
                :to="`/people?branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All people"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.recent_people.length === 0"
            title="No active people yet"
            description="People added to this branch will appear here."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="person in data.recent_people" :key="person.id">
              <NuxtLink
                :to="`/people/${person.id}`"
                class="flex items-center justify-between gap-4 py-3 hover:text-primary-600"
              >
                <div>
                  <p class="text-sm font-medium">{{ fullName(person) }}</p>
                  <p class="text-xs capitalize text-gray-500 dark:text-gray-400">
                    {{ person.membership_status.replace(/_/g, ' ') }}
                    <span v-if="person.age !== null"> · {{ person.age }} years</span>
                  </p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="size-4 text-gray-400" />
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canEvents" id="events" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Upcoming events</h2>
              <UButton
                :to="`/events?branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All events"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.events.length === 0"
            title="Nothing scheduled"
            description="No published events for this branch or the wider area."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="event in data.events" :key="event.id">
              <NuxtLink
                :to="`/events/${event.id}`"
                class="flex items-center justify-between gap-4 py-3 hover:text-primary-600"
              >
                <div>
                  <p class="text-sm font-medium">{{ event.title }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ formatDateTime(event.start_at) }}
                    · {{ event.branch_name || 'Area-wide' }}
                  </p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="size-4 text-gray-400" />
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canVisitors" id="follow-ups" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Follow-ups</h2>
              <UButton
                :to="`/visitors?status=open&branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All follow-ups"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.follow_ups.length === 0"
            title="No open follow-ups"
            description="Every visitor to this branch has a next step recorded."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="visitor in data.follow_ups" :key="visitor.id">
              <NuxtLink
                :to="`/visitors/${visitor.id}`"
                class="flex items-center justify-between gap-4 py-3 hover:text-primary-600"
              >
                <div>
                  <p class="text-sm font-medium">
                    {{ visitor.visitor_first_name }} {{ visitor.visitor_last_name }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ visitor.visit_date }} ·
                    {{ visitor.follow_up_owner || 'Unassigned' }}
                  </p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="size-4 text-gray-400" />
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canWelfare" id="welfare-with-scope" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Welfare</h2>
              <UButton
                :to="`/welfare?status=open&branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="Open welfare"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.welfare_cases.length === 0"
            title="No open cases"
            description="Open welfare cases for this branch will appear here."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li v-for="record in data.welfare_cases" :key="`welfare-${record.id}`">
              <NuxtLink
                :to="`/welfare/${record.id}`"
                class="flex items-center justify-between gap-4 py-3 hover:text-primary-600"
              >
                <div>
                  <p class="text-sm font-medium">{{ record.case_ref }}</p>
                  <p class="text-xs capitalize text-gray-500 dark:text-gray-400">
                    {{ record.category.replace(/_/g, ' ') }} · {{ record.priority }} ·
                    {{ record.status.replace(/_/g, ' ') }}
                  </p>
                </div>
                <UIcon name="i-lucide-chevron-right" class="size-4 text-gray-400" />
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canBlessings" id="blessings" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold" tabindex="-1">Blessings breakdown</h2>
              <UButton
                :to="`/blessings?branch=${data.id}`"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All blessings"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.blessings_breakdown.length === 0"
            title="No blessings recorded yet"
            description="Blessings recorded for this branch will break down by type here."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="group in data.blessings_breakdown"
              :key="`blessing-${group.blessing_type}`"
            >
              <NuxtLink
                :to="`/blessings?branch=${data.id}&blessing_type=${group.blessing_type}`"
                class="flex items-center justify-between gap-4 py-3 hover:text-primary-600"
              >
                <div>
                  <p class="text-sm font-medium capitalize">
                    {{ group.blessing_type.replace(/_/g, ' ') }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ group.count }} recorded
                  </p>
                </div>
                <span class="text-sm font-semibold tabular-nums">{{ group.count }}</span>
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="canLeadership" id="leadership" class="mt-8 scroll-mt-28">
        <UCard>
          <template #header>
            <h2 class="text-base font-semibold" tabindex="-1">Leadership</h2>
          </template>
          <ManagementTeamSection level="branch" :scope-id="id" />
        </UCard>
      </section>
    </template>
  </div>
</template>
