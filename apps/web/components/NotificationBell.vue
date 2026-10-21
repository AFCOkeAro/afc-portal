<script setup lang="ts">
import { COLLECTIONS, type CalendarItem } from '@afc/shared'
import type { Paginated, VisitorRow } from '~/types/portal'
import {
  computeUnread,
  isOverdueFollowUp,
  latestTimestamp,
  notificationsSeenKey,
  todayKey,
} from '~/utils/headerNotifications'

/**
 * Notification bell (AFC-585). Aggregates CLIENT-SIDE from endpoints the
 * session may already load — no new API routes, no new collections, no
 * polling (fetch on open + on login/user change).
 *
 * Sections, each gated by the same capability the source page needs:
 *   - overdue visitor follow-ups → GET /api/visitors?status=open
 *   - upcoming birthdays/anniversaries → GET /api/celebrations/calendar
 *     (staff-only: requires visitors read AND celebrations read, mirroring
 *     the dashboard AFC-577 rule so volunteers see no birthday content)
 *   - latest announcements → GET /api/announcements?limit=5
 *
 * Failures hide their section (a 403 means the grant is gone; anything else
 * surfaces one short error line). The bell never shows what the session
 * could not fetch itself.
 *
 * A server-backed notification centre is explicitly out of scope and is the
 * tracked follow-up.
 */

interface AnnouncementRow {
  id: string | number
  title: string
  publish_from?: string | null
}

const api = useApi()
const permissions = usePermissions()
const { user } = useAuth()

const open = ref(false)
const loading = ref(false)
const loadedFor = ref<string | null>(null)
const loadError = ref('')
const lastSeenAt = ref<string | null>(null)

const overdue = ref<VisitorRow[]>([])
const celebrations = ref<CalendarItem[]>([])
const announcements = ref<AnnouncementRow[]>([])

const canFollowUps = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
/** Birthdays/anniversaries stay staff-only (dashboard AFC-577 rule). */
const canCelebrations = computed(
  () =>
    permissions.can(COLLECTIONS.visitors, 'read') &&
    permissions.can(COLLECTIONS.celebrations, 'read'),
)
const canAnnouncements = computed(() =>
  permissions.can(COLLECTIONS.announcements, 'read'),
)

const userId = computed(() => user.value?.id ?? null)

function readStoredSeen(id: string): string | null {
  try {
    return window.localStorage.getItem(notificationsSeenKey(id))
  } catch {
    return null
  }
}

function writeSeenNow(id: string): string {
  const now = new Date().toISOString()
  try {
    window.localStorage.setItem(notificationsSeenKey(id), now)
  } catch {
    // Storage unavailable — the bell still works, the dot just returns.
  }
  lastSeenAt.value = now
  return now
}

function visitorName(row: VisitorRow): string {
  return (
    [row.visitor_first_name, row.visitor_last_name].filter(Boolean).join(' ') ||
    'Unnamed visitor'
  )
}

function formatDay(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString()
}

async function load(): Promise<void> {
  const id = userId.value
  if (!id || loading.value || loadedFor.value === id) return
  loading.value = true
  loadError.value = ''
  try {
    const jobs: Promise<void>[] = []

    if (canFollowUps.value) {
      jobs.push(
        api
          .get<Paginated<VisitorRow>>('/api/visitors', {
            query: { status: 'open', limit: 25 },
          })
          .then((res) => {
            const today = todayKey()
            overdue.value = (res.data ?? [])
              .filter((row) => isOverdueFollowUp(row.next_follow_up_date, today))
              .sort((a, b) =>
                (a.next_follow_up_date ?? '').localeCompare(b.next_follow_up_date ?? ''),
              )
              .slice(0, 5)
          })
          .catch(() => {
            overdue.value = []
          }),
      )
    }

    if (canCelebrations.value) {
      const from = new Date()
      const to = new Date()
      to.setDate(to.getDate() + 14)
      jobs.push(
        api
          .get<{ data: CalendarItem[] }>('/api/celebrations/calendar', {
            query: {
              date_from: from.toISOString().slice(0, 10),
              date_to: to.toISOString().slice(0, 10),
            },
          })
          .then((res) => {
            celebrations.value = (res.data ?? []).slice(0, 5)
          })
          .catch(() => {
            celebrations.value = []
          }),
      )
    }

    if (canAnnouncements.value) {
      jobs.push(
        api
          .get<{ data: AnnouncementRow[] }>('/api/announcements', {
            query: { limit: 5 },
          })
          .then((res) => {
            announcements.value = (res.data ?? []).slice(0, 5)
          })
          .catch(() => {
            announcements.value = []
          }),
      )
    }

    await Promise.all(jobs)
    loadedFor.value = id
  } catch {
    loadError.value = 'Could not load notifications.'
  } finally {
    loading.value = false
  }
}

const latestItemTime = computed(() =>
  latestTimestamp([
    ...overdue.value.map((row: VisitorRow) => row.next_follow_up_date ?? row.visit_date),
    ...celebrations.value.map((item: CalendarItem) => item.date),
    ...announcements.value.map((row: AnnouncementRow) => row.publish_from ?? null),
  ]),
)

const totalCount = computed(
  () => overdue.value.length + celebrations.value.length + announcements.value.length,
)

const unread = computed(() =>
  computeUnread(totalCount.value, latestItemTime.value, lastSeenAt.value),
)

/** Fetch on open; mark seen on open. No polling. */
watch(open, (next: boolean) => {
  if (!next) return
  const id = userId.value
  if (!id) return
  if (!lastSeenAt.value) lastSeenAt.value = readStoredSeen(id)
  void load().finally(() => writeSeenNow(id))
})

/** A new login refetches on next open; the dot state is per-user. */
watch(userId, (next: string | null, prev: string | null) => {
  if (next === prev) return
  loadedFor.value = null
  overdue.value = []
  celebrations.value = []
  announcements.value = []
  lastSeenAt.value = null
  loadError.value = ''
})

onMounted(() => {
  const id = userId.value
  if (id) lastSeenAt.value = readStoredSeen(id)
})
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: 'end' }">
    <UButton
      color="neutral"
      variant="ghost"
      square
      icon="i-lucide-bell"
      class="relative"
      :aria-label="unread ? `Notifications, ${totalCount} unread` : 'Notifications'"
    >
      <template #trailing>
        <span
          v-if="unread"
          class="absolute right-2 top-2 size-2 rounded-full bg-error-500"
          aria-hidden="true"
        />
      </template>
    </UButton>

    <template #content>
      <div class="max-h-[70vh] w-80 overflow-y-auto p-2 sm:w-96">
        <div v-if="loading && totalCount === 0" class="flex justify-center py-8">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-5 animate-spin text-gray-400"
          />
        </div>

        <UAlert
          v-else-if="loadError && totalCount === 0"
          color="error"
          variant="subtle"
          title="Could not load notifications"
          :description="loadError"
        />

        <p
          v-else-if="totalCount === 0"
          class="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          You're all caught up.
        </p>

        <template v-else>
          <section v-if="canFollowUps" aria-label="Overdue follow-ups">
            <div class="flex items-center justify-between px-3 pb-1 pt-2">
              <h2
                class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                Overdue follow-ups
              </h2>
              <UButton
                to="/visitors?status=open"
                color="neutral"
                variant="link"
                size="xs"
                label="View all"
                @click="open = false"
              />
            </div>
            <p
              v-if="overdue.length === 0"
              class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400"
            >
              No overdue follow-ups.
            </p>
            <ul v-else class="space-y-0.5">
              <li v-for="row in overdue" :key="row.id">
                <NuxtLink
                  :to="`/visitors/${row.id}`"
                  class="block rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="open = false"
                >
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ visitorName(row) }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Due {{ formatDay(row.next_follow_up_date ?? row.visit_date) }}
                    {{ row.follow_up_owner ? `· ${row.follow_up_owner}` : '' }}
                  </p>
                </NuxtLink>
              </li>
            </ul>
          </section>

          <section v-if="canCelebrations" aria-label="Upcoming celebrations">
            <div class="flex items-center justify-between px-3 pb-1 pt-2">
              <h2
                class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                Birthdays &amp; anniversaries
              </h2>
              <UButton
                to="/celebrations"
                color="neutral"
                variant="link"
                size="xs"
                label="View all"
                @click="open = false"
              />
            </div>
            <p
              v-if="celebrations.length === 0"
              class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400"
            >
              Nothing in the next 14 days.
            </p>
            <ul v-else class="space-y-0.5">
              <li
                v-for="item in celebrations"
                :key="`${item.item_type}-${item.id}-${item.date}`"
              >
                <NuxtLink
                  :to="item.href ?? '/celebrations'"
                  class="block rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="open = false"
                >
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ item.title }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ formatDay(item.date) }}
                  </p>
                </NuxtLink>
              </li>
            </ul>
          </section>

          <section v-if="canAnnouncements" aria-label="Latest announcements">
            <div class="flex items-center justify-between px-3 pb-1 pt-2">
              <h2
                class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
              >
                Announcements
              </h2>
              <UButton
                to="/announcements"
                color="neutral"
                variant="link"
                size="xs"
                label="View all"
                @click="open = false"
              />
            </div>
            <p
              v-if="announcements.length === 0"
              class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400"
            >
              No announcements.
            </p>
            <ul v-else class="space-y-0.5">
              <li v-for="row in announcements" :key="String(row.id)">
                <NuxtLink
                  :to="`/announcements/${String(row.id)}`"
                  class="block rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800"
                  @click="open = false"
                >
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {{ row.title }}
                  </p>
                  <p
                    v-if="row.publish_from"
                    class="text-xs text-gray-500 dark:text-gray-400"
                  >
                    {{ formatDay(row.publish_from) }}
                  </p>
                </NuxtLink>
              </li>
            </ul>
          </section>
        </template>
      </div>
    </template>
  </UPopover>
</template>
