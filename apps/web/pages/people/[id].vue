<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { BranchSummary, HouseholdDetail, PersonDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const api = useApi()
const permissions = usePermissions()
const id = String(route.params.id)
const showEdit = ref(false)
const savingStatus = ref(false)
const actionError = ref('')

const {
  data: person,
  pending,
  error,
  refresh,
} = await useAsyncData(`person-${id}`, () => api.get<PersonDetail>(`/api/people/${id}`))

const branches = await useAsyncData('people-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

/**
 * Static household preview (AFC-929, approved mockup v3). The person
 * detail route returns only the household id + name, so the panel reads
 * the existing GET /api/households/:id — a scoped pure read behind
 * households:read, no migration. Any failure (403 outside scope, 404,
 * offline) resolves to null and the panel falls back to a name link or
 * hides; the route stays fail-closed and nothing is widened.
 */
const canHouseholds = computed(() => permissions.can(COLLECTIONS.households, 'read'))

const householdPreview = ref<HouseholdDetail | null>(null)
if (person.value?.household && canHouseholds.value) {
  try {
    householdPreview.value = await api.get<HouseholdDetail>(
      `/api/households/${person.value.household}`,
    )
  } catch {
    householdPreview.value = null
  }
}

/** Compact attendance chart state (AFC-929): collapsed 120px, enlarged 190px + counts. */
const attendanceExpanded = ref(false)

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
  return row.preferred_name || [row.first_name, row.last_name].filter(Boolean).join(' ')
})

/**
 * AFC-929 icon-panel helpers. Initials mirror PersonAvatar (first + last
 * initial, never raw ids); first names are the display-name head token
 * (data minimisation — the full roster lives on the household page).
 */
function initialsFor(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase()
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  return (first.charAt(0) + last.charAt(0)).toUpperCase() || '?'
}

function firstNameOf(name: string | null | undefined): string {
  const head = (name ?? '').trim().split(/\s+/).filter(Boolean)[0]
  return head || '—'
}

function formatMonthYear(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function tenureSince(value: string | null | undefined): string | null {
  if (!value) return null
  const start = new Date(value)
  if (Number.isNaN(start.getTime())) return null
  const now = new Date()
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 0) return null
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} mo${rest === 1 ? '' : 's'}`
  return `${years} yr${years === 1 ? '' : 's'} ${rest} mo${rest === 1 ? '' : 's'}`
}

/** Birthday renders day + month only; the birth year is withheld on this surface. */
function birthdayDayMonth(value: string | null | undefined): string {
  if (!value) return '—'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const monthNames = [
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
  if (match) {
    const month = monthNames[Number(match[2]) - 1] ?? match[2]
    return `${Number(match[3])} ${month}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function householdRoleLabel(member: {
  is_head: boolean
  household_role: string | null
}): string {
  if (member.is_head) return 'Head'
  return member.household_role?.replace(/_/g, ' ') || 'member'
}

const photoUrl = computed(() =>
  person.value?.photo_file ? `/api/people/${person.value.id}/photo` : null,
)

const photoInput = ref<HTMLInputElement | null>(null)
const photoSaving = ref(false)

async function uploadPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0] ?? null
  input.value = ''
  if (!picked || !person.value) return
  photoSaving.value = true
  actionError.value = ''
  try {
    const form = new FormData()
    form.append('photo', picked)
    await api.post(`/api/people/${person.value.id}/photo`, form)
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not upload the photo'
  } finally {
    photoSaving.value = false
  }
}

const attendanceItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'attendance') ?? [],
)
const eventItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'registration') ?? [],
)
const visitorItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'visitor') ?? [],
)
const welfareItems = computed(
  () => person.value?.timeline.filter((item) => item.kind === 'welfare') ?? [],
)

/**
 * ChurchCRM timeline parity (AFC-866): Notes / Events / System filter over
 * the existing kinds, where data exists. Mapping is the smallest
 * defensible reading of the sample — Notes are pastoral follow-ups
 * (visitor), Events are gatherings (attendance + registration), System
 * is the confidential case trail (welfare, still gated on
 * welfare_cases:read). No new kinds are invented; an empty filter shows
 * the empty state, never foreign rows.
 */
type TimelineFilter = 'all' | 'notes' | 'events' | 'system'
const timelineFilter = ref<TimelineFilter>('all')
const timelineFilters: { id: TimelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'notes', label: 'Notes' },
  { id: 'events', label: 'Events' },
  { id: 'system', label: 'System' },
]
const filteredTimeline = computed(() => {
  const items = person.value?.timeline ?? []
  switch (timelineFilter.value) {
    case 'notes':
      return items.filter((item) => item.kind === 'visitor')
    case 'events':
      return items.filter(
        (item) => item.kind === 'attendance' || item.kind === 'registration',
      )
    case 'system':
      return items.filter((item) => item.kind === 'welfare')
    default:
      return items
  }
})

/**
 * Anchor sections per prd-addendum-v4 §1 + wireframes-v3 screen 1. Gates are
 * capabilities, never role names (data-model §13 rule 7): a section the
 * session cannot read is absent from the page (US-S1 AC4 — a
 * volunteer sees no welfare section).
 *
 * AFC-1015: tab strip removed per user direction — sections render as a
 * single scrolling right rail, no SectionNav.
 */
const canAttendance = computed(() =>
  permissions.can(COLLECTIONS.attendanceSessions, 'read'),
)
const canRegistrations = computed(() => permissions.can(COLLECTIONS.events, 'read'))
const canFollowUps = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
const canWelfare = computed(() => permissions.can(COLLECTIONS.welfareCases, 'read'))
const canLeadership = computed(() => permissions.can(COLLECTIONS.departments, 'read'))

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
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update status'
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
      <!-- AFC-1015: no full-width picture banner, no tab strip.
        Compact title row lives in the scrolling right rail; the left rail
        holds the two static panels (summary + household) and never scrolls
        away (sticky). -->
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

      <div id="overview" class="scroll-mt-28">
        <h2 class="sr-only" tabindex="-1">Overview</h2>
        <!-- AFC-929 (approved mockup AFC-928 v3) + AFC-1015 layout: static
          left rail — profile hero with icon contact rows + static household
          panel; the right column scrolls with every other section.
          Deliberate deviations from the mockup: the status menu (Active /
          Under Discipline / Left / Deceased) is not built — the data model
          only carries active/archived, so the Archive/Restore toggle in the
          compact header stands; no address mini-map — there is no geodata on
          this surface (map pin deferred, as on the household page). -->
        <div class="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <aside
            class="space-y-6 lg:sticky lg:top-20 lg:self-start"
            aria-label="Member summary"
          >
            <UCard>
              <div class="flex items-start gap-3">
                <div class="relative shrink-0">
                  <PersonAvatar :name="displayName" :photo-url="photoUrl" size="md" />
                  <PermissionGate :collection="COLLECTIONS.people" action="update">
                    <input
                      ref="photoInput"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      class="hidden"
                      aria-label="Upload profile photo"
                      @change="uploadPhoto"
                    />
                    <button
                      type="button"
                      title="Change or upload photo"
                      aria-label="Change or upload photo"
                      class="absolute -bottom-1 -right-1 flex size-11 items-center justify-center rounded-full border-2 border-white bg-gray-900 text-white dark:border-gray-900"
                      @click="photoInput?.click()"
                    >
                      <UIcon name="i-lucide-camera" class="size-4" />
                    </button>
                  </PermissionGate>
                </div>
                <div class="min-w-0">
                  <h2 class="text-lg font-semibold leading-snug">{{ displayName }}</h2>
                  <p class="text-sm text-gray-500 capitalize dark:text-gray-400">
                    {{ person.membership_status.replace(/_/g, ' ') }} ·
                    {{ person.branch_name || 'No branch' }}
                  </p>
                  <UBadge
                    :color="person.status === 'active' ? 'success' : 'neutral'"
                    variant="subtle"
                    class="mt-1"
                  >
                    {{ person.status }}
                  </UBadge>
                </div>
              </div>
              <ul
                class="mt-4 space-y-1 border-t border-gray-100 pt-2 text-sm dark:border-gray-800"
                aria-label="Contact details"
              >
                <li
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Email"
                >
                  <UIcon
                    name="i-lucide-mail"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0 break-all"
                    ><span class="sr-only">Email: </span>{{ person.email || '—' }}</span
                  >
                </li>
                <li
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Phone"
                >
                  <UIcon
                    name="i-lucide-phone"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0"
                    ><span class="sr-only">Phone: </span>{{ person.phone || '—' }}</span
                  >
                </li>
                <li
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Address"
                >
                  <UIcon
                    name="i-lucide-map-pin"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0 whitespace-pre-line"
                    ><span class="sr-only">Address: </span
                    >{{ person.address || '—' }}</span
                  >
                </li>
                <li
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Membership date — the month membership started"
                >
                  <UIcon
                    name="i-lucide-id-card"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0">
                    <span class="sr-only">Membership date: </span
                    >{{ formatMonthYear(person.member_since) }}
                    <span
                      v-if="tenureSince(person.member_since)"
                      class="block text-xs text-gray-500 dark:text-gray-400"
                    >
                      Membership started {{ formatMonthYear(person.member_since) }} ·
                      {{ tenureSince(person.member_since) }}
                    </span>
                  </span>
                </li>
                <li
                  v-if="showDob"
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Birthday — day and month only, birth year withheld"
                >
                  <UIcon
                    name="i-lucide-cake"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0">
                    <span class="sr-only">Birthday: </span
                    >{{ birthdayDayMonth(person.date_of_birth) }}
                    <span class="block text-xs text-gray-500 dark:text-gray-400">
                      Day + month only · birth year not shown on this surface
                    </span>
                  </span>
                </li>
                <li
                  v-if="showDob"
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Age"
                >
                  <UIcon
                    name="i-lucide-circle-user-round"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0 tabular-nums">
                    <span class="sr-only">Age: </span>{{ person.age ?? '—'
                    }}{{ person.age == null ? '' : ' years' }}
                    <span class="block text-xs text-gray-500 dark:text-gray-400">
                      Computed · shown separately from birthday
                    </span>
                  </span>
                </li>
                <li
                  class="flex min-h-11 items-start gap-3 rounded-md px-1 py-1.5"
                  title="Gender"
                >
                  <UIcon
                    name="i-lucide-user"
                    class="mt-0.5 size-5 shrink-0 text-gray-400"
                  />
                  <span class="min-w-0 capitalize"
                    ><span class="sr-only">Gender: </span>{{ person.gender }}</span
                  >
                </li>
              </ul>
              <div
                v-if="person.safeguarding_flag"
                class="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              >
                <UIcon name="i-lucide-shield-alert" class="size-4" />
                Safeguarding flag is set
              </div>
            </UCard>

            <UCard v-if="person.household">
              <template #header>
                <div>
                  <h2 class="text-base font-semibold" tabindex="-1">Household</h2>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    Static · limited info
                  </p>
                </div>
              </template>
              <div v-if="householdPreview" class="text-sm">
                <div class="flex items-center gap-3">
                  <span
                    class="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-100 text-base font-semibold text-primary-700 dark:bg-primary-950 dark:text-primary-300"
                    aria-hidden="true"
                  >
                    {{
                      initialsFor(householdPreview.name || person.household_name).slice(
                        0,
                        1,
                      )
                    }}
                  </span>
                  <div class="min-w-0">
                    <p class="truncate font-medium">
                      {{
                        householdPreview.name ||
                        person.household_name ||
                        'Unnamed household'
                      }}
                    </p>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ householdPreview.member_count }} member{{
                        householdPreview.member_count === 1 ? '' : 's'
                      }}
                    </p>
                  </div>
                </div>
                <dl class="mt-3 space-y-3">
                  <div class="flex justify-between gap-4">
                    <dt class="text-gray-500 dark:text-gray-400">Head</dt>
                    <dd class="text-right">
                      {{ householdPreview.head_name || 'Not set' }}
                    </dd>
                  </div>
                  <div class="flex justify-between gap-4">
                    <dt class="text-gray-500 dark:text-gray-400">Phone</dt>
                    <dd>{{ householdPreview.phone || '—' }}</dd>
                  </div>
                </dl>
                <ul
                  class="mt-3 grid grid-cols-4 gap-2 border-t border-gray-100 pt-3 text-center dark:border-gray-800"
                  aria-label="Household members and family roles"
                >
                  <li
                    v-for="member in householdPreview.members"
                    :key="member.id"
                    class="flex min-h-11 flex-col items-center gap-1"
                  >
                    <span
                      class="flex size-10 items-center justify-center rounded-full border border-gray-100 bg-primary-100 text-sm font-bold text-primary-700 dark:border-gray-800 dark:bg-primary-950 dark:text-primary-300"
                      aria-hidden="true"
                    >
                      {{ initialsFor(member.display_name).slice(0, 1) }}
                    </span>
                    <span class="text-xs font-semibold leading-tight"
                      >{{ firstNameOf(member.display_name)
                      }}<span v-if="member.is_minor" class="font-normal text-gray-500">
                        · minor</span
                      ></span
                    >
                    <span
                      class="text-[11px] leading-tight text-gray-500 capitalize dark:text-gray-400"
                      >{{ householdRoleLabel(member) }}</span
                    >
                  </li>
                </ul>
                <p class="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Full roster lives on the
                  <NuxtLink
                    :to="`/households/${person.household}`"
                    class="text-primary-600 hover:underline dark:text-primary-400"
                    >household page</NuxtLink
                  >
                  (data minimisation).
                </p>
              </div>
              <p v-else class="text-sm">
                <NuxtLink
                  :to="`/households/${person.household}`"
                  class="text-primary-600 hover:underline dark:text-primary-400"
                >
                  {{ person.household_name || 'Open household' }}
                </NuxtLink>
              </p>
            </UCard>
          </aside>

          <div class="min-w-0 space-y-6">
            <!-- AFC-1015 compact header: name + meta + actions, no banner image. -->
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <h1 class="text-xl font-semibold leading-tight">{{ displayName }}</h1>
                <p class="mt-0.5 text-sm text-gray-500 capitalize dark:text-gray-400">
                  {{ person.membership_status.replace(/_/g, ' ') }} · {{ person.branch_name || 'No branch' }}
                </p>
              </div>
              <PermissionGate :collection="COLLECTIONS.people" action="update">
                <div class="flex shrink-0 gap-2">
                  <UButton
                    color="neutral"
                    variant="outline"
                    :label="person.status === 'active' ? 'Archive' : 'Restore'"
                    :loading="savingStatus"
                    @click="toggleStatus"
                  />
                  <UButton
                    label="Edit person"
                    icon="i-lucide-pencil"
                    @click="showEdit = true"
                  />
                </div>
              </PermissionGate>
            </div>

            <section v-if="canAttendance" id="attendance" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between gap-2">
                    <div>
                      <h2 class="text-base font-semibold" tabindex="-1">Attendance</h2>
                      <p class="text-xs text-gray-500 dark:text-gray-400">
                        {{ attendanceItems.length }} sessions
                      </p>
                    </div>
                    <UButton
                      :label="attendanceExpanded ? 'Collapse' : 'Enlarge'"
                      :icon="
                        attendanceExpanded ? 'i-lucide-minimize-2' : 'i-lucide-maximize-2'
                      "
                      color="neutral"
                      variant="outline"
                      class="min-h-11 rounded-full"
                      :aria-expanded="attendanceExpanded"
                      aria-controls="person-attendance-chart"
                      @click="attendanceExpanded = !attendanceExpanded"
                    />
                  </div>
                </template>
                <PersonAttendanceChart
                  :person-id="id"
                  :expanded="attendanceExpanded"
                  class="mb-4"
                />
                <ActivityList
                  :items="attendanceItems"
                  empty-title="No attendance recorded"
                  empty-description="Named check-ins for this person will appear here."
                />
              </UCard>
            </section>

            <UCard>
              <template #header>
                <h2 class="text-base font-semibold" tabindex="-1">
                  Household and consent
                </h2>
              </template>
              <dl class="space-y-3 text-sm">
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
              </dl>
              <div
                v-if="person.notes"
                class="mt-4 border-t border-gray-100 pt-4 text-sm dark:border-gray-800"
              >
                <p class="text-gray-500 dark:text-gray-400">Notes</p>
                <p class="mt-1 whitespace-pre-line">{{ person.notes }}</p>
              </div>
            </UCard>

            <section v-if="canRegistrations" id="registrations" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold" tabindex="-1">Registrations</h2>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ eventItems.length }} registrations
                    </span>
                  </div>
                </template>
                <ActivityList
                  :items="eventItems"
                  empty-title="No event registrations"
                  empty-description="Registrations and attendance for events will appear here."
                />
              </UCard>
            </section>

            <section v-if="canFollowUps" id="follow-ups" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold" tabindex="-1">Follow-ups</h2>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ visitorItems.length }} visits
                    </span>
                  </div>
                </template>
                <ActivityList
                  :items="visitorItems"
                  empty-title="No newcomer journey"
                  empty-description="Visitor intake, follow-up and connection steps will appear here."
                />
              </UCard>
            </section>

            <section v-if="canWelfare" id="welfare-with-scope" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold" tabindex="-1">Welfare</h2>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ welfareItems.length }} cases
                    </span>
                  </div>
                </template>
                <ActivityList
                  :items="welfareItems"
                  empty-title="No welfare involvement"
                  empty-description="Cases linked to this person will appear here for permitted staff."
                />
              </UCard>
            </section>

            <section v-if="canLeadership" id="leadership" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <h2 class="text-base font-semibold" tabindex="-1">Leadership</h2>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ person.departments.length }} assignment{{
                        person.departments.length === 1 ? '' : 's'
                      }}
                    </span>
                  </div>
                </template>
                <EmptyState
                  v-if="person.departments.length === 0"
                  title="No department assignments"
                  description="Department membership for this person will appear here. Gated on departments:read so volunteers never see it."
                />
                <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
                  <li
                    v-for="membership in person.departments"
                    :key="membership.id"
                    class="flex items-center justify-between gap-3 py-2"
                  >
                    <NuxtLink
                      :to="`/departments/${membership.id}`"
                      class="text-sm font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                    >
                      {{ membership.name }}
                    </NuxtLink>
                    <span class="text-xs capitalize text-gray-500 dark:text-gray-400">
                      {{ membership.role }}
                    </span>
                  </li>
                </ul>
              </UCard>
            </section>

            <section id="timeline" class="scroll-mt-28">
              <UCard>
                <template #header>
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-base font-semibold" tabindex="-1">Full timeline</h2>
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      {{ filteredTimeline.length }} of {{ person.timeline.length }} events
                    </span>
                  </div>
                  <div class="mt-3 flex flex-wrap gap-1" role="group" aria-label="Filter timeline">
                    <UButton
                      v-for="filter in timelineFilters"
                      :key="filter.id"
                      size="xs"
                      :color="timelineFilter === filter.id ? 'primary' : 'neutral'"
                      :variant="timelineFilter === filter.id ? 'solid' : 'ghost'"
                      :label="filter.label"
                      :aria-pressed="timelineFilter === filter.id"
                      @click="timelineFilter = filter.id"
                    />
                  </div>
                </template>
                <ActivityList
                  :items="filteredTimeline"
                  empty-title="No activity yet"
                  empty-description="Attendance, event registrations, visitor follow-ups and welfare cases will appear here."
                />
              </UCard>
            </section>
          </div>
        </div>
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
