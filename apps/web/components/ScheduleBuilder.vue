<script setup lang="ts">
/**
 * Schedule builder (AFC-826): an event's sessions with per-session
 * programme items.
 *
 * One model: schedule sessions ARE attendance_sessions (0023) — the same
 * rows capture/check-in read. This component lists the event's sessions,
 * creates new ones, and manages each session's activity breakdown
 * (session_activities, 0050). Scope is enforced server-side on every
 * route; the UI only hides what the capability list already denies.
 */
import { SESSION_ACTIVITY_TYPES } from '@afc/shared'

interface Props {
  eventId: string
  canEdit: boolean
}

const props = defineProps<Props>()

const api = useApi()

interface ScheduleSession {
  id: string
  session_date: string
  session_type: string
  session_name: string | null
}

interface ProgrammeItem {
  id: string
  session: string
  activity_type: string
  title: string
  position: number
  duration_minutes: number | null
  notes: string | null
}

const SESSION_TYPE_OPTIONS = ['event', 'sunday_service', 'midweek', 'camp', 'department']

const ACTIVITY_LABELS: Record<string, string> = {
  music: 'Music',
  prayer: 'Prayer',
  announcement: 'Announcement',
  talk: 'Talk',
  bible_reading: 'Bible reading',
  offering: 'Offering',
  testimony: 'Testimony',
  drama: 'Drama',
  communion: 'Communion',
  welcome: 'Welcome',
  closing: 'Closing',
  other: 'Other',
}

const sessions = ref<ScheduleSession[]>([])
const sessionsPending = ref(false)
const sessionsError = ref('')
const activities = ref<Record<string, ProgrammeItem[]>>({})
const openSession = ref<string | null>(null)
const newSession = ref({ session_date: '', session_type: 'event', session_name: '' })
const sessionSaving = ref(false)
const sessionError = ref('')
const newItem = ref<
  Record<string, { activity_type: string; title: string; duration: string }>
>({})
const itemSaving = ref(false)
const itemError = ref('')

const sortedSessions = computed(() =>
  [...sessions.value].sort((a, b) =>
    a.session_date === b.session_date
      ? String(a.session_name ?? '').localeCompare(String(b.session_name ?? ''))
      : a.session_date.localeCompare(b.session_date),
  ),
)

async function loadSessions(): Promise<void> {
  sessionsPending.value = true
  sessionsError.value = ''
  try {
    const res = await api.get<{ data: ScheduleSession[] }>('/api/attendance', {
      query: { event: props.eventId, limit: 100 },
    })
    sessions.value = res.data ?? []
  } catch (cause) {
    sessionsError.value =
      (cause as { message?: string }).message ?? 'Could not load sessions'
  } finally {
    sessionsPending.value = false
  }
}

async function createSession(): Promise<void> {
  if (
    newSession.value.session_date === '' ||
    newSession.value.session_name.trim() === ''
  ) {
    sessionError.value = 'Give the session a date and a name.'
    return
  }
  sessionSaving.value = true
  sessionError.value = ''
  try {
    await api.post('/api/attendance', {
      event: props.eventId,
      session_date: newSession.value.session_date,
      session_type: newSession.value.session_type,
      session_name: newSession.value.session_name.trim(),
      headcount_men: 0,
      headcount_women: 0,
      headcount_children: 0,
    })
    newSession.value = { session_date: '', session_type: 'event', session_name: '' }
    await loadSessions()
  } catch (cause) {
    sessionError.value =
      (cause as { message?: string }).message ?? 'Could not add the session'
  } finally {
    sessionSaving.value = false
  }
}

async function toggleSession(id: string): Promise<void> {
  openSession.value = openSession.value === id ? null : id
  if (openSession.value === id && !activities.value[id]) await loadActivities(id)
}

async function loadActivities(sessionId: string): Promise<void> {
  try {
    const res = await api.get<{ data: ProgrammeItem[] }>(
      `/api/attendance/sessions/${sessionId}/activities`,
    )
    activities.value = { ...activities.value, [sessionId]: res.data ?? [] }
  } catch (cause) {
    itemError.value = (cause as { message?: string }).message ?? 'Could not load items'
  }
}

function itemDraft(sessionId: string): {
  activity_type: string
  title: string
  duration: string
} {
  const found = newItem.value[sessionId]
  if (found) return found
  const draft = { activity_type: 'music', title: '', duration: '' }
  newItem.value = { ...newItem.value, [sessionId]: draft }
  return draft
}

async function addItem(sessionId: string): Promise<void> {
  const draft = itemDraft(sessionId)
  if (draft.title.trim() === '') {
    itemError.value = 'Name the programme item.'
    return
  }
  itemSaving.value = true
  itemError.value = ''
  try {
    const existing = activities.value[sessionId] ?? []
    await api.post(`/api/attendance/sessions/${sessionId}/activities`, {
      activity_type: draft.activity_type,
      title: draft.title.trim(),
      position: existing.length,
      ...(draft.duration === '' ? {} : { duration_minutes: Number(draft.duration) }),
    })
    newItem.value = {
      ...newItem.value,
      [sessionId]: { activity_type: 'music', title: '', duration: '' },
    }
    await loadActivities(sessionId)
  } catch (cause) {
    itemError.value = (cause as { message?: string }).message ?? 'Could not add the item'
  } finally {
    itemSaving.value = false
  }
}

async function removeItem(sessionId: string, itemId: string): Promise<void> {
  itemError.value = ''
  try {
    await api.remove(`/api/attendance/activities/${itemId}`)
    await loadActivities(sessionId)
  } catch (cause) {
    itemError.value =
      (cause as { message?: string }).message ?? 'Could not remove the item'
  }
}

async function moveItem(sessionId: string, index: number, delta: -1 | 1): Promise<void> {
  const list = [...(activities.value[sessionId] ?? [])]
  const other = index + delta
  if (other < 0 || other >= list.length) return
  const current = list[index]
  const swap = list[other]
  if (!current || !swap) return
  itemError.value = ''
  try {
    await api.patch(`/api/attendance/activities/${current.id}`, { position: other })
    await api.patch(`/api/attendance/activities/${swap.id}`, { position: index })
    await loadActivities(sessionId)
  } catch (cause) {
    itemError.value = (cause as { message?: string }).message ?? 'Could not reorder items'
  }
}

function activityLabel(type: string): string {
  return ACTIVITY_LABELS[type] ?? type
}

onMounted(() => {
  void loadSessions()
})
</script>

<template>
  <div>
    <p v-if="sessionsPending" class="text-sm text-gray-500">Loading schedule…</p>
    <p v-else-if="sessionsError !== ''" class="text-sm text-red-600">
      {{ sessionsError }}
    </p>
    <div v-else-if="sortedSessions.length === 0">
      <UCard>
        <EmptyState
          title="No schedule yet"
          description="Add days, services and sessions. Turn on check-in for any event where ushers take attendance."
        />
      </UCard>
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="session in sortedSessions" :key="session.id">
        <template #header>
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left"
            @click="toggleSession(session.id)"
          >
            <span class="font-semibold">{{ session.session_name }}</span>
            <span class="text-xs text-gray-500">{{ session.session_date }}</span>
            <UIcon
              :name="
                openSession === session.id
                  ? 'i-lucide-chevron-up'
                  : 'i-lucide-chevron-down'
              "
              class="ml-auto size-4 text-gray-400"
            />
          </button>
        </template>
        <div v-if="openSession === session.id">
          <ul v-if="(activities[session.id] ?? []).length > 0" class="space-y-1.5">
            <li
              v-for="(item, index) in activities[session.id]"
              :key="item.id"
              class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900"
            >
              <span class="font-mono text-xs text-gray-500">{{ index + 1 }}</span>
              <span class="font-medium">{{ activityLabel(item.activity_type) }}</span>
              <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
              <span v-if="item.duration_minutes !== null" class="text-xs text-gray-500">
                {{ item.duration_minutes }} min
              </span>
              <template v-if="props.canEdit">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-up"
                  :disabled="index === 0"
                  :aria-label="`Move ${item.title} up`"
                  @click="moveItem(session.id, index, -1)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-arrow-down"
                  :disabled="index === (activities[session.id] ?? []).length - 1"
                  :aria-label="`Move ${item.title} down`"
                  @click="moveItem(session.id, index, 1)"
                />
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Remove ${item.title}`"
                  @click="removeItem(session.id, item.id)"
                />
              </template>
            </li>
          </ul>
          <p v-else class="text-sm text-gray-500">No programme items yet.</p>
          <div v-if="props.canEdit" class="mt-3 flex flex-wrap items-end gap-2">
            <UFormField label="Type" class="w-36">
              <USelect
                v-model="itemDraft(session.id).activity_type"
                :items="
                  SESSION_ACTIVITY_TYPES.map((type: string) => ({
                    label: activityLabel(type),
                    value: type,
                  }))
                "
                class="w-full"
              />
            </UFormField>
            <UFormField label="Item" class="min-w-48 flex-1">
              <UInput
                v-model="itemDraft(session.id).title"
                placeholder="e.g. Opening prayer"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Minutes" class="w-24">
              <UInput
                v-model="itemDraft(session.id).duration"
                type="number"
                min="0"
                placeholder="10"
                class="w-full"
              />
            </UFormField>
            <UButton
              label="Add item"
              icon="i-lucide-plus"
              :loading="itemSaving"
              @click="addItem(session.id)"
            />
          </div>
          <p v-if="itemError !== ''" class="mt-2 text-sm text-red-600">{{ itemError }}</p>
        </div>
      </UCard>
    </div>
    <UCard v-if="props.canEdit" class="mt-4">
      <template #header>
        <h3 class="font-semibold">Add a session</h3>
      </template>
      <div class="flex flex-wrap items-end gap-2">
        <UFormField label="Date" class="w-40">
          <UInput v-model="newSession.session_date" type="date" class="w-full" />
        </UFormField>
        <UFormField label="Type" class="w-40">
          <USelect
            v-model="newSession.session_type"
            :items="
              SESSION_TYPE_OPTIONS.map((type: string) => ({ label: type, value: type }))
            "
            class="w-full"
          />
        </UFormField>
        <UFormField label="Name" class="min-w-48 flex-1">
          <UInput
            v-model="newSession.session_name"
            placeholder="e.g. Day 2 — Morning"
            class="w-full"
          />
        </UFormField>
        <UButton
          label="Add session"
          icon="i-lucide-plus"
          :loading="sessionSaving"
          @click="createSession"
        />
      </div>
      <p v-if="sessionError !== ''" class="mt-2 text-sm text-red-600">
        {{ sessionError }}
      </p>
    </UCard>
  </div>
</template>
