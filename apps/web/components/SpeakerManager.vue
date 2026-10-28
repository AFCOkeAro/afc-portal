<script setup lang="ts">
import { SPEAKER_STATUSES } from '@afc/shared'

/**
 * Speaker manager (AFC-843): booked vs pending at a glance.
 *
 * Lists the event's speaker bookings with status, special requests and
 * bio; books directory people or external guests; moves status;
 * withdraws bookings. Scope is enforced server-side on every route.
 */
interface Props {
  eventId: string
  canManage: boolean
}

const props = defineProps<Props>()

const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

interface SpeakerBooking {
  id: string
  person: string | null
  external_name: string | null
  name: string
  status: string
  special_requests: string | null
  bio: string | null
}

const STATUS_LABELS: Record<string, string> = {
  invited: 'Invited',
  pending: 'Pending',
  booked: 'Booked',
  confirmed: 'Confirmed',
  declined: 'Declined',
}

const bookings = ref<SpeakerBooking[]>([])
const bookingsPending = ref(false)
const bookingsError = ref('')
const openBooking = ref<string | null>(null)
const newBooking = ref({
  person: '',
  external_name: '',
  status: 'pending',
  special_requests: '',
})
const bookingSaving = ref(false)
const bookingError = ref('')
const actionError = ref('')

const bookedCount = computed(
  () =>
    bookings.value.filter(
      (row: SpeakerBooking) => row.status === 'booked' || row.status === 'confirmed',
    ).length,
)
const pendingCount = computed(
  () =>
    bookings.value.filter(
      (row: SpeakerBooking) => row.status === 'pending' || row.status === 'invited',
    ).length,
)

async function loadBookings(): Promise<void> {
  bookingsPending.value = true
  bookingsError.value = ''
  try {
    const res = await api.get<{ data: SpeakerBooking[] }>(
      `/api/events/${props.eventId}/speakers`,
    )
    bookings.value = res.data ?? []
  } catch (cause) {
    bookingsError.value =
      (cause as { message?: string }).message ?? 'Could not load speakers'
  } finally {
    bookingsPending.value = false
  }
}

async function createBooking(): Promise<void> {
  if (newBooking.value.person === '' && newBooking.value.external_name.trim() === '') {
    bookingError.value = 'Choose a directory person or type an external name.'
    return
  }
  bookingSaving.value = true
  bookingError.value = ''
  try {
    await api.post(`/api/events/${props.eventId}/speakers`, {
      ...(newBooking.value.person === '' ? {} : { person: newBooking.value.person }),
      ...(newBooking.value.external_name.trim() === ''
        ? {}
        : { external_name: newBooking.value.external_name.trim() }),
      status: newBooking.value.status,
      ...(newBooking.value.special_requests.trim() === ''
        ? {}
        : { special_requests: newBooking.value.special_requests.trim() }),
    })
    newBooking.value = {
      person: '',
      external_name: '',
      status: 'pending',
      special_requests: '',
    }
    await loadBookings()
  } catch (cause) {
    bookingError.value =
      (cause as { message?: string }).message ?? 'Could not book the speaker'
  } finally {
    bookingSaving.value = false
  }
}

async function moveStatus(id: string, status: string): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/events/speakers/${id}`, { status })
    await loadBookings()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not move the booking'
  }
}

async function withdraw(id: string): Promise<void> {
  actionError.value = ''
  try {
    await api.remove(`/api/events/speakers/${id}`)
    await loadBookings()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not withdraw the booking'
  }
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

onMounted(() => {
  void loadBookings()
})
</script>

<template>
  <div>
    <p class="mb-3 text-sm text-gray-500">
      {{ bookedCount }} booked · {{ pendingCount }} pending · {{ bookings.length }} total
    </p>
    <p v-if="bookingsPending" class="text-sm text-gray-500">Loading speakers…</p>
    <p v-else-if="bookingsError !== ''" class="text-sm text-red-600">
      {{ bookingsError }}
    </p>
    <div v-else-if="bookings.length === 0">
      <UCard>
        <EmptyState
          title="No speakers yet"
          description="Book directory people or external guests, then track them from pending to confirmed."
        />
      </UCard>
    </div>
    <div v-else class="space-y-3">
      <UCard v-for="booking in bookings" :key="booking.id">
        <template #header>
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left"
            @click="openBooking = openBooking === booking.id ? null : booking.id"
          >
            <span class="font-semibold">{{ booking.name }}</span>
            <UBadge
              :color="
                booking.status === 'booked' || booking.status === 'confirmed'
                  ? 'success'
                  : 'neutral'
              "
              variant="subtle"
            >
              {{ statusLabel(booking.status) }}
            </UBadge>
            <UIcon
              :name="
                openBooking === booking.id
                  ? 'i-lucide-chevron-up'
                  : 'i-lucide-chevron-down'
              "
              class="ml-auto size-4 text-gray-400"
            />
          </button>
        </template>
        <div v-if="openBooking === booking.id" class="text-sm">
          <p v-if="booking.special_requests" class="text-gray-600">
            Special requests: {{ booking.special_requests }}
          </p>
          <p v-if="booking.bio" class="mt-1 text-gray-600">{{ booking.bio }}</p>
          <div v-if="props.canManage" class="mt-2 flex flex-wrap gap-1">
            <UButton
              v-for="next in ['invited', 'pending', 'booked', 'confirmed', 'declined']"
              :key="next"
              size="xs"
              :color="booking.status === next ? 'success' : 'neutral'"
              :variant="booking.status === next ? 'soft' : 'outline'"
              :label="statusLabel(next)"
              :disabled="booking.status === next"
              @click="moveStatus(booking.id, next)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              :aria-label="`Withdraw ${booking.name}`"
              @click="withdraw(booking.id)"
            />
          </div>
        </div>
      </UCard>
    </div>
    <p v-if="actionError !== ''" class="mt-3 text-sm text-red-600">{{ actionError }}</p>
    <UCard v-if="props.canManage" class="mt-4">
      <template #header>
        <h3 class="font-semibold">Book a speaker</h3>
      </template>
      <div class="grid gap-2 sm:grid-cols-2">
        <UFormField label="Directory person" class="sm:col-span-2">
          <EntitySelect
            v-model="newBooking.person"
            :items="personOptions"
            placeholder="Type a name to search…"
            :loading="personPending"
            server-search
            class="w-full"
            @update:search-term="onPersonSearch"
          />
        </UFormField>
        <UFormField label="Or external name">
          <UInput
            v-model="newBooking.external_name"
            placeholder="e.g. Guest Minister"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Starting status">
          <USelect
            v-model="newBooking.status"
            :items="
              SPEAKER_STATUSES.map((status: string) => ({
                label: statusLabel(status),
                value: status,
              }))
            "
            class="w-full"
          />
        </UFormField>
        <UFormField label="Special requests" class="sm:col-span-2">
          <UInput
            v-model="newBooking.special_requests"
            placeholder="e.g. Wheelchair access to the pulpit"
            class="w-full"
          />
        </UFormField>
      </div>
      <UButton
        class="mt-3"
        label="Book speaker"
        icon="i-lucide-plus"
        :loading="bookingSaving"
        @click="createBooking"
      />
      <p v-if="bookingError !== ''" class="mt-2 text-sm text-red-600">
        {{ bookingError }}
      </p>
    </UCard>
  </div>
</template>
