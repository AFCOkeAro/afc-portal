<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Funeral detail (AFC-884, AFC-899 tabbed submenu): one Family menu entry,
 * sub-sections as tabs — Overview (facts + notes), Paper trail (document
 * checklist + uploads), Programme (songs + music-director approval),
 * Dates & attendance (both days + headcounts).
 *
 * Uploading a document to an approved programme sends it back for
 * re-approval; held/cancelled cases are history and cannot change.
 */
definePageMeta({ middleware: 'staff' })

const route = useRoute()
const router = useRouter()
const api = useApi()
const id = String(route.params.id)

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'papers', label: 'Paper trail' },
  { id: 'programme', label: 'Programme' },
  { id: 'dates', label: 'Dates & attendance' },
] as const

type TabId = (typeof TABS)[number]['id']

const tab = computed<TabId>(() => {
  const raw = route.query.tab
  const value = Array.isArray(raw) ? raw[0] : raw
  return (TABS as readonly { id: string }[]).some((entry) => entry.id === value)
    ? (value as TabId)
    : 'overview'
})

function goTab(next: TabId): void {
  void router.replace({ query: { ...route.query, tab: next } })
}

interface FuneralDetail {
  id: string
  deceased_display: string
  stage: string
  deceased_person: string | null
  deceased_name: string | null
  death_certificate_file: string | null
  consent_letter_file: string | null
  songs: string[]
  programme_approved_by: string | null
  programme_approved_at: string | null
  service_of_songs_date: string | null
  funeral_date: string | null
  service_of_songs_attendance: number | null
  funeral_attendance: number | null
  notes: string | null
}

const detail = ref<FuneralDetail | null>(null)
const pending = ref(false)
const error = ref('')
const actionError = ref('')
const saving = ref(false)
const uploading = ref<'death_certificate' | 'consent_letter' | null>(null)
const newSong = ref('')
const datesForm = ref({ service_of_songs_date: '', funeral_date: '' })
const attendanceForm = ref({ service_of_songs_attendance: '', funeral_attendance: '' })
const notesForm = ref('')

function docHref(slot: 'death_certificate' | 'consent_letter'): string {
  return `/api/funerals/${id}/documents?slot=${slot}`
}

async function loadFuneral(): Promise<void> {
  pending.value = true
  error.value = ''
  try {
    const res = await api.get<{ data: FuneralDetail }>(`/api/funerals/${id}`)
    detail.value = res.data
    datesForm.value = {
      service_of_songs_date: res.data.service_of_songs_date ?? '',
      funeral_date: res.data.funeral_date ?? '',
    }
    attendanceForm.value = {
      service_of_songs_attendance:
        res.data.service_of_songs_attendance === null ||
        res.data.service_of_songs_attendance === undefined
          ? ''
          : String(res.data.service_of_songs_attendance),
      funeral_attendance:
        res.data.funeral_attendance === null || res.data.funeral_attendance === undefined
          ? ''
          : String(res.data.funeral_attendance),
    }
    notesForm.value = res.data.notes ?? ''
  } catch (cause) {
    error.value = (cause as { message?: string }).message ?? 'Could not load this funeral'
  } finally {
    pending.value = false
  }
}

async function uploadDoc(
  slot: 'death_certificate' | 'consent_letter',
  target: EventTarget | null,
): Promise<void> {
  const files = (target as HTMLInputElement | null)?.files
  const picked = files && files.length > 0 ? files[0] : null
  if (target) (target as HTMLInputElement).value = ''
  if (!picked || !detail.value) return
  uploading.value = slot
  actionError.value = ''
  try {
    const form = new FormData()
    form.append('file', picked)
    await api.post(`/api/funerals/${detail.value.id}/documents?slot=${slot}`, form)
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not upload the document'
  } finally {
    uploading.value = null
  }
}

async function addSong(): Promise<void> {
  const title = newSong.value.trim()
  if (!title || !detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, {
      songs: [...detail.value.songs, title],
    })
    newSong.value = ''
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not add the song'
  } finally {
    saving.value = false
  }
}

async function removeSong(index: number): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, {
      songs: detail.value.songs.filter((_: string, i: number) => i !== index),
    })
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not remove the song'
  } finally {
    saving.value = false
  }
}

async function approveProgramme(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.post(`/api/funerals/${detail.value.id}/approve`, {})
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not approve the programme'
  } finally {
    saving.value = false
  }
}

async function saveDates(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, {
      ...(datesForm.value.service_of_songs_date === ''
        ? {}
        : { service_of_songs_date: datesForm.value.service_of_songs_date }),
      ...(datesForm.value.funeral_date === ''
        ? {}
        : { funeral_date: datesForm.value.funeral_date }),
    })
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not save the dates'
  } finally {
    saving.value = false
  }
}

async function saveAttendance(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, {
      ...(attendanceForm.value.service_of_songs_attendance === ''
        ? {}
        : {
            service_of_songs_attendance: Number(
              attendanceForm.value.service_of_songs_attendance,
            ),
          }),
      ...(attendanceForm.value.funeral_attendance === ''
        ? {}
        : { funeral_attendance: Number(attendanceForm.value.funeral_attendance) }),
    })
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not save attendance'
  } finally {
    saving.value = false
  }
}

async function saveNotes(): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, { notes: notesForm.value })
    await loadFuneral()
  } catch (cause) {
    actionError.value = (cause as { message?: string }).message ?? 'Could not save notes'
  } finally {
    saving.value = false
  }
}

async function setStage(next: string): Promise<void> {
  if (!detail.value) return
  saving.value = true
  actionError.value = ''
  try {
    await api.patch(`/api/funerals/${detail.value.id}`, { stage: next })
    await loadFuneral()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not move the stage'
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void loadFuneral()
})
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/funerals"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to funerals"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error !== ''"
      color="error"
      variant="subtle"
      title="Could not load this funeral"
      :description="error"
    />

    <template v-else-if="detail">
      <PageHeader
        :title="detail.deceased_display"
        :description="`Stage: ${detail.stage.replace(/_/g, ' ')}`"
      >
        <template #actions>
          <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
            <UButton
              v-if="detail.stage === 'reported' || detail.stage === 'approved'"
              size="sm"
              label="Schedule"
              :loading="saving"
              @click="setStage('scheduled')"
            />
            <UButton
              v-if="detail.stage === 'scheduled'"
              size="sm"
              label="Mark held"
              :loading="saving"
              @click="setStage('held')"
            />
            <UButton
              v-if="detail.stage !== 'held' && detail.stage !== 'cancelled'"
              size="sm"
              color="neutral"
              variant="outline"
              label="Cancel"
              :loading="saving"
              @click="setStage('cancelled')"
            />
          </PermissionGate>
        </template>
      </PageHeader>

      <UAlert
        v-if="actionError !== ''"
        class="mb-4"
        color="error"
        variant="subtle"
        :description="actionError"
      />

      <div class="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Funeral sections">
        <UButton
          v-for="entry in TABS"
          :key="entry.id"
          size="sm"
          :color="tab === entry.id ? 'primary' : 'neutral'"
          :variant="tab === entry.id ? 'solid' : 'ghost'"
          :label="entry.label"
          :aria-selected="tab === entry.id"
          role="tab"
          @click="goTab(entry.id)"
        />
      </div>

      <section v-if="tab === 'overview'" aria-label="Overview">
        <UCard>
          <dl class="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Deceased</dt>
              <dd class="mt-1 font-medium">{{ detail.deceased_display }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Stage</dt>
              <dd class="mt-1 capitalize">{{ detail.stage.replace(/_/g, ' ') }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Service of songs</dt>
              <dd class="mt-1">{{ detail.service_of_songs_date ?? '—' }}</dd>
            </div>
            <div>
              <dt class="text-gray-500 dark:text-gray-400">Funeral</dt>
              <dd class="mt-1">{{ detail.funeral_date ?? '—' }}</dd>
            </div>
          </dl>
        </UCard>
        <UCard class="mt-4">
          <template #header><h2 class="text-sm font-semibold">Notes</h2></template>
          <UTextarea
            v-model="notesForm"
            :rows="3"
            placeholder="Family requests, order of service notes…"
            class="w-full"
          />
          <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
            <UButton
              class="mt-3"
              size="sm"
              label="Save notes"
              :loading="saving"
              @click="saveNotes"
            />
          </PermissionGate>
        </UCard>
      </section>

      <section v-if="tab === 'papers'" aria-label="Paper trail">
        <UCard>
          <template #header><h2 class="text-sm font-semibold">Paper trail</h2></template>
          <ul class="space-y-3 text-sm">
            <li
              v-for="slot in [
                { key: 'death_certificate', label: 'Death certificate' },
                { key: 'consent_letter', label: 'Family consent letter' },
              ] as const"
              :key="slot.key"
              class="flex flex-wrap items-center gap-2"
            >
              <span class="min-w-0 flex-1 font-medium">{{ slot.label }}</span>
              <UBadge
                :color="
                  (
                    slot.key === 'death_certificate'
                      ? detail.death_certificate_file
                      : detail.consent_letter_file
                  )
                    ? 'success'
                    : 'neutral'
                "
                variant="subtle"
              >
                {{
                  (
                    slot.key === 'death_certificate'
                      ? detail.death_certificate_file
                      : detail.consent_letter_file
                  )
                    ? 'On file'
                    : 'Missing'
                }}
              </UBadge>
              <UButton
                v-if="
                  slot.key === 'death_certificate'
                    ? detail.death_certificate_file
                    : detail.consent_letter_file
                "
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-external-link"
                label="Open"
                :to="docHref(slot.key)"
                target="_blank"
              />
              <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
                <label
                  class="cursor-pointer text-xs text-primary-600 hover:underline dark:text-primary-400"
                >
                  {{
                    (
                      slot.key === 'death_certificate'
                        ? detail.death_certificate_file
                        : detail.consent_letter_file
                    )
                      ? 'Replace'
                      : 'Upload'
                  }}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    class="hidden"
                    @change="uploadDoc(slot.key, $event.target)"
                  />
                </label>
                <span v-if="uploading === slot.key" class="text-xs text-gray-500"
                  >Uploading…</span
                >
              </PermissionGate>
            </li>
          </ul>
        </UCard>
      </section>

      <section v-if="tab === 'programme'" aria-label="Programme">
        <UCard>
          <template #header><h2 class="text-sm font-semibold">Songs</h2></template>
          <EmptyState
            v-if="detail.songs.length === 0"
            title="No songs yet"
            description="Add the songs for the service of songs and the funeral."
          />
          <ul v-else class="divide-y divide-gray-100 text-sm dark:divide-gray-800">
            <li
              v-for="(song, index) in detail.songs"
              :key="index"
              class="flex items-center gap-2 py-1.5"
            >
              <span class="min-w-0 flex-1 truncate">{{ song }}</span>
              <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-x"
                  :aria-label="`Remove ${song}`"
                  :disabled="detail.stage === 'held' || detail.stage === 'cancelled'"
                  @click="removeSong(index)"
                />
              </PermissionGate>
            </li>
          </ul>
          <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
            <div class="mt-3 flex gap-2">
              <UInput
                v-model="newSong"
                placeholder="Song title — choir, hymn, special…"
                class="flex-1"
                aria-label="New song title"
                @keyup.enter="addSong"
              />
              <UButton size="sm" label="Add" :loading="saving" @click="addSong" />
            </div>
            <UButton
              v-if="detail.stage === 'reported'"
              class="mt-3"
              size="sm"
              label="Music director: approve programme"
              :loading="saving"
              @click="approveProgramme"
            />
            <p v-if="detail.programme_approved_at" class="mt-2 text-xs text-gray-500">
              Approved {{ detail.programme_approved_at.slice(0, 10) }}
            </p>
          </PermissionGate>
        </UCard>
      </section>

      <section v-if="tab === 'dates'" aria-label="Dates and attendance">
        <div class="grid gap-4 xl:grid-cols-2">
          <UCard>
            <template #header><h2 class="text-sm font-semibold">Dates</h2></template>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="Service of songs">
                <UInput v-model="datesForm.service_of_songs_date" type="date" />
              </UFormField>
              <UFormField label="Funeral">
                <UInput v-model="datesForm.funeral_date" type="date" />
              </UFormField>
            </div>
            <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
              <UButton
                class="mt-3"
                size="sm"
                label="Save dates"
                :loading="saving"
                @click="saveDates"
              />
            </PermissionGate>
          </UCard>
          <UCard>
            <template #header><h2 class="text-sm font-semibold">Attendance</h2></template>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="Service of songs headcount">
                <UInput
                  v-model="attendanceForm.service_of_songs_attendance"
                  type="number"
                  min="0"
                />
              </UFormField>
              <UFormField label="Funeral headcount">
                <UInput
                  v-model="attendanceForm.funeral_attendance"
                  type="number"
                  min="0"
                />
              </UFormField>
            </div>
            <PermissionGate :collection="COLLECTIONS.funeralCases" action="update">
              <UButton
                class="mt-3"
                size="sm"
                label="Save attendance"
                :loading="saving"
                @click="saveAttendance"
              />
            </PermissionGate>
          </UCard>
        </div>
      </section>
    </template>
  </div>
</template>
