<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { DashboardData } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

const { data, pending, error, refresh } = await useAsyncData('dashboard', () =>
  api.get<DashboardData>('/api/dashboard'),
)

const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))

const attendanceChange = computed(() => {
  const current = data.value?.metrics.attendanceCurrent ?? 0
  const prior = data.value?.metrics.attendancePrior ?? 0
  if (prior === 0) return current > 0 ? 'No prior period' : 'No attendance yet'
  const change = Math.round(((current - prior) / prior) * 100)
  return `${change >= 0 ? '+' : ''}${change}% vs prior 30 days`
})

const trendMax = computed(() =>
  Math.max(1, ...(data.value?.attendanceTrend.map((point) => point.total) ?? [1])),
)

function formatDateTime(value: string): string {
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

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
</script>

<template>
  <div>
    <PageHeader
      title="Dashboard"
      :description="
        data
          ? `${data.scope.label} · ${data.scope.branchCount} branches in scope`
          : 'Loading the current picture.'
      "
    >
      <template #actions>
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
      title="Could not load the dashboard"
      :description="error.message"
    />

    <div v-else-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <template v-else-if="data">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink to="/people" class="block transition hover:-translate-y-0.5">
          <StatCard
            label="People"
            :value="data.metrics.people"
            hint="Active records in scope"
          />
        </NuxtLink>
        <NuxtLink to="/events" class="block transition hover:-translate-y-0.5">
          <StatCard
            label="Upcoming events"
            :value="data.metrics.upcomingEvents"
            :hint="`${data.metrics.upcomingRegistrations} registrations`"
          />
        </NuxtLink>
        <NuxtLink to="/attendance" class="block transition hover:-translate-y-0.5">
          <StatCard
            label="Attendance · 30 days"
            :value="data.metrics.attendanceCurrent"
            :hint="attendanceChange"
          />
        </NuxtLink>
        <NuxtLink to="/visitors" class="block transition hover:-translate-y-0.5">
          <StatCard
            label="Open follow-ups"
            :value="data.metrics.openFollowUps"
            hint="Visitors awaiting a next step"
          />
        </NuxtLink>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <NuxtLink
          v-if="canWelfare"
          to="/welfare"
          class="block transition hover:-translate-y-0.5"
        >
          <StatCard
            label="Open welfare"
            :value="data.metrics.openWelfare"
            hint="Open and in-progress cases"
          />
        </NuxtLink>
        <NuxtLink to="/people?status=all" class="block transition hover:-translate-y-0.5">
          <StatCard
            label="Branches"
            :value="data.scope.branchCount"
            hint="Active branches in scope"
          />
        </NuxtLink>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-3">
        <UCard class="xl:col-span-2">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Attendance trend</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">Last 12 weeks</span>
            </div>
          </template>

          <EmptyState
            v-if="data.attendanceTrend.length === 0"
            title="No attendance recorded yet"
            description="Capture a session to start the trend."
          >
            <UButton class="mt-4" to="/attendance" label="Go to attendance" />
          </EmptyState>

          <div v-else class="flex h-56 items-end gap-2 overflow-x-auto pb-2">
            <div
              v-for="point in data.attendanceTrend"
              :key="`${point.date}-${point.branch_name ?? 'area'}`"
              class="flex min-w-8 flex-1 flex-col items-center justify-end gap-1"
              :title="`${point.date}: ${point.total}${point.branch_name ? ` · ${point.branch_name}` : ''}`"
            >
              <span class="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{{
                point.total
              }}</span>
              <div
                class="w-full rounded-t bg-primary-500/80 transition hover:bg-primary-600"
                :style="{ height: `${Math.max(4, (point.total / trendMax) * 170)}px` }"
              />
              <span class="whitespace-nowrap text-[10px] text-gray-400">{{
                point.date.slice(5)
              }}</span>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Next events</h2>
              <UButton
                to="/events"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.upcomingEvents.length === 0"
            title="Nothing scheduled"
            description="No published events in the coming weeks."
          />
          <ul v-else class="space-y-3">
            <li v-for="event in data.upcomingEvents" :key="event.id">
              <NuxtLink
                :to="`/events/${event.id}`"
                class="block rounded-lg p-2 hover:bg-gray-50 dark:hover:bg-gray-900"
              >
                <p class="text-sm font-medium">{{ event.title }}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  {{ formatDateTime(event.start_at) }} ·
                  {{ event.registered_count }} registered
                </p>
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Follow-ups</h2>
              <UButton
                to="/visitors"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.followUps.length === 0"
            title="No open follow-ups"
            description="Every visitor has a next step recorded."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="visitor in data.followUps"
              :key="visitor.id"
              class="py-3 first:pt-0 last:pb-0"
            >
              <NuxtLink
                :to="`/visitors/${visitor.id}`"
                class="flex items-start justify-between gap-3"
              >
                <div>
                  <p class="text-sm font-medium">
                    {{ visitor.visitor_first_name }} {{ visitor.visitor_last_name }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Visited {{ formatDate(visitor.visit_date) }} ·
                    {{ visitor.branch_name || 'No branch' }}
                  </p>
                </div>
                <UBadge color="warning" variant="subtle">{{
                  visitor.status.replace(/_/g, ' ')
                }}</UBadge>
              </NuxtLink>
            </li>
          </ul>
        </UCard>

        <UCard v-if="canWelfare">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Welfare cases</h2>
              <UButton
                to="/welfare"
                color="neutral"
                variant="ghost"
                size="xs"
                label="All"
              />
            </div>
          </template>
          <EmptyState
            v-if="data.welfareCases.length === 0"
            title="No open cases"
            description="No welfare case needs attention right now."
          />
          <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
            <li
              v-for="welfareCase in data.welfareCases"
              :key="welfareCase.id"
              class="py-3 first:pt-0 last:pb-0"
            >
              <NuxtLink
                :to="`/welfare/${welfareCase.id}`"
                class="flex items-start justify-between gap-3"
              >
                <div>
                  <p class="font-mono text-xs font-medium">{{ welfareCase.case_ref }}</p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ welfareCase.category }} ·
                    {{ welfareCase.branch_name || 'No branch' }}
                  </p>
                </div>
                <UBadge color="warning" variant="subtle">{{
                  (welfareCase.status ?? 'open').replace(/_/g, ' ')
                }}</UBadge>
              </NuxtLink>
            </li>
          </ul>
        </UCard>
      </div>
    </template>
  </div>
</template>
