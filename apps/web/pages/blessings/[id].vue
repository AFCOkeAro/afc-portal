<script setup lang="ts">
import { BLESSING_TYPES, COLLECTIONS } from '@afc/shared'
import type { BlessingDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const route = useRoute()
const id = String(route.params.id)
const api = useApi()
const { personOptions, personPending, onPersonSearch } = usePersonSearch()

const {
  data: blessing,
  pending,
  error,
  refresh,
} = await useAsyncData(`blessing-${id}`, () =>
  api.get<BlessingDetail>(`/api/blessings/${id}`),
)

const showRecipientForm = ref(false)
const recipientSaving = ref(false)
const recipientError = ref('')
const recipientForm = ref({ person: '', blessing_type: 'salvation' })

const recipientTypeOptions = BLESSING_TYPES.map((value) => ({
  label: value.replace(/_/g, ' '),
  value,
}))

function typeLabel(): string {
  const row = blessing.value
  if (!row) return 'Blessing'
  if (row.blessing_type === 'other' && row.other_label) return row.other_label
  return row.blessing_type.replace(/_/g, ' ')
}

function recipientLabel(row: { blessing_type: string; other_label: string | null }): string {
  if (row.blessing_type === 'other' && row.other_label) return row.other_label
  return row.blessing_type.replace(/_/g, ' ')
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

function eventLabel(eventType: string): string {
  return eventType.replace(/_/g, ' ')
}

async function addRecipient(): Promise<void> {
  recipientError.value = ''
  const row = blessing.value
  if (!row || !recipientForm.value.person) {
    recipientError.value = 'Choose a person for this blessing'
    return
  }
  recipientSaving.value = true
  try {
    await api.post('/api/blessing-recipients', {
      blessing: row.id,
      blessing_type: recipientForm.value.blessing_type,
      person: recipientForm.value.person,
      branch: row.branch,
      zone: row.zone ?? undefined,
      bsc: row.bsc ?? undefined,
      session: row.session ?? undefined,
      event: row.event ?? undefined,
      sunday_service: row.sunday_service ?? undefined,
      service_date: row.service_date,
    })
    showRecipientForm.value = false
    recipientForm.value = { person: '', blessing_type: 'salvation' }
    await refresh()
  } catch (cause) {
    recipientError.value =
      (cause as { message?: string }).message ?? 'Could not link that person'
  } finally {
    recipientSaving.value = false
  }
}
</script>

<template>
  <div>
    <div class="mb-4">
      <UButton
        to="/blessings"
        color="neutral"
        variant="ghost"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Back to blessings"
      />
    </div>

    <div v-if="pending" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      title="Could not load this blessing record"
      :description="error.message"
    />

    <template v-else-if="blessing">
      <PageHeader
        :title="typeLabel()"
        :description="`${formatDate(blessing.service_date)} · ${blessing.branch_name || 'No branch'}`"
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Count"
          :value="blessing.count ?? blessing.total_count"
          hint="Blessings recorded"
        />
        <StatCard
          label="Individuals linked"
          :value="(blessing.recipients?.length ?? 0) + (blessing.standalone_recipients?.length ?? 0)"
          hint="People mapped to this blessing"
        />
      </div>

      <div class="mt-6 grid gap-6 xl:grid-cols-2">
        <UCard>
          <template #header><h2 class="text-base font-semibold">Record</h2></template>
          <dl class="space-y-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Type</dt>
              <dd class="text-right capitalize">
                {{ blessing.blessing_type.replace(/_/g, ' ') }}
              </dd>
            </div>
            <div v-if="blessing.other_label" class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Other label</dt>
              <dd class="text-right">{{ blessing.other_label }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Branch</dt>
              <dd class="text-right">{{ blessing.branch_name || '—' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-gray-500 dark:text-gray-400">Notes</dt>
              <dd class="text-right whitespace-pre-line">{{ blessing.notes || '—' }}</dd>
            </div>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-base font-semibold">Audit trail</h2>
              <span class="text-xs text-gray-500 dark:text-gray-400">
                {{ blessing.events.length }} events
              </span>
            </div>
          </template>

          <EmptyState
            v-if="blessing.events.length === 0"
            title="No audit events"
            description="Recording and edits are recorded here."
          />

          <ol v-else class="space-y-3">
            <li
              v-for="item in blessing.events"
              :key="item.id"
              class="flex items-start gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-900"
            >
              <UIcon
                name="i-lucide-history"
                class="mt-0.5 size-4 shrink-0 text-gray-400"
              />
              <div>
                <p class="text-sm font-medium capitalize">
                  {{ eventLabel(item.event_type) }}
                </p>
                <p class="text-sm text-gray-600 dark:text-gray-300">
                  {{ item.detail || '—' }}
                </p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {{ item.created_at ? new Date(item.created_at).toLocaleString() : '—' }}
                </p>
              </div>
            </li>
          </ol>
        </UCard>
      </div>

      <UCard class="mt-6">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-base font-semibold">Individual blessings</h2>
            <PermissionGate :collection="COLLECTIONS.blessingRecipients" action="create">
              <UButton
                size="xs"
                variant="outline"
                icon="i-lucide-plus"
                label="Link a person"
                @click="showRecipientForm = !showRecipientForm"
              />
            </PermissionGate>
          </div>
        </template>

        <div v-if="showRecipientForm" class="mb-4 grid gap-3 sm:grid-cols-3">
          <UFormField label="Person" required>
            <EntitySelect
              v-model="recipientForm.person"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
          <UFormField label="Blessing type">
            <USelect v-model="recipientForm.blessing_type" :items="recipientTypeOptions" class="w-full" />
          </UFormField>
          <div class="flex items-end gap-2">
            <UButton label="Link" :loading="recipientSaving" @click="addRecipient" />
          </div>
          <UAlert
            v-if="recipientError"
            class="sm:col-span-3"
            color="error"
            variant="subtle"
            :description="recipientError"
          />
        </div>

        <EmptyState
          v-if="(blessing.recipients?.length ?? 0) + (blessing.standalone_recipients?.length ?? 0) === 0"
          title="No individuals linked yet"
          description="Link people to this blessing so individual testimonies map to a DB person."
        />

        <ul v-else class="divide-y divide-gray-100 dark:divide-gray-800">
          <li
            v-for="item in [...(blessing.recipients ?? []), ...(blessing.standalone_recipients ?? [])]"
            :key="item.id"
            class="flex items-center justify-between gap-4 py-3"
          >
            <div>
              <p class="text-sm font-medium capitalize">
                {{ recipientLabel(item) }}
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                {{ formatDate(item.service_date) }}
              </p>
            </div>
            <NuxtLink
              v-if="item.person"
              :to="`/people/${item.person}`"
              class="text-sm text-primary-600 hover:underline dark:text-primary-400"
            >
              View person
            </NuxtLink>
          </li>
        </ul>
      </UCard>
    </template>
  </div>
</template>
