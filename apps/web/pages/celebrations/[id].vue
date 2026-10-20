<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'
import type { CelebrationDetail } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const moving = ref(false)
const moveError = ref('')
const channels = ref('whatsapp')

const {
  data: celebration,
  pending,
  error,
  refresh,
} = await useAsyncData('celebration-detail', () =>
  api.get<CelebrationDetail>(`/api/celebrations/${route.params.id}`),
)

const canApprove = computed(() => celebration.value?.status === 'draft')
const canPublish = computed(() => celebration.value?.status === 'approved')
const canArchive = computed(
  () =>
    celebration.value?.status === 'draft' ||
    celebration.value?.status === 'approved' ||
    celebration.value?.status === 'published',
)
const canReturn = computed(() => celebration.value?.status === 'approved')

function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}

async function move(to: 'approved' | 'published' | 'draft' | 'archived'): Promise<void> {
  moveError.value = ''
  moving.value = true
  try {
    await api.post(`/api/celebrations/${route.params.id}/transition`, {
      to,
      ...(to === 'published'
        ? {
            publish_channels: channels.value
              .split(',')
              .map((channel: string) => channel.trim())
              .filter(Boolean),
          }
        : {}),
    })
    await refresh()
  } catch (cause) {
    const err = cause as { message?: string }
    moveError.value = err.message ?? `Could not move this celebration to ${to}`
  } finally {
    moving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      :title="celebration?.title || celebration?.type.replace(/_/g, ' ') || 'Celebration'"
      description="Greeting lifecycle: draft, approved, published, archived."
    />

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load this celebration"
      :description="error.message"
    />

    <div v-else-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="celebration" class="grid gap-4 lg:grid-cols-2">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Greeting</h2>
        </template>
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-gray-500">Person</dt>
            <dd>{{ celebration.person_name || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Type</dt>
            <dd class="capitalize">{{ celebration.type.replace(/_/g, ' ') }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Date</dt>
            <dd>
              {{ formatDate(celebration.event_date)
              }}{{ celebration.is_recurring ? ' (yearly)' : '' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500">Branch</dt>
            <dd>{{ celebration.branch_name || '—' }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Visibility</dt>
            <dd>{{ celebration.visibility }}</dd>
          </div>
          <div>
            <dt class="text-gray-500">Status</dt>
            <dd>{{ celebration.status }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Channels</dt>
            <dd>{{ celebration.publish_channels.join(', ') || '—' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Message</dt>
            <dd>{{ celebration.message || '—' }}</dd>
          </div>
        </dl>
        <p
          v-if="celebration.person_is_minor"
          class="mt-3 text-xs text-amber-600 dark:text-amber-400"
        >
          This celebration names a minor: guardian consent is
          {{ celebration.guardian_consent ? 'confirmed' : 'NOT confirmed' }}.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Approve and publish</h2>
        </template>
        <UAlert
          v-if="moveError"
          class="mb-3"
          color="error"
          variant="subtle"
          :description="moveError"
        />
        <PermissionGate :collection="COLLECTIONS.celebrations" action="update">
          <div class="space-y-3">
            <UFormField
              label="Publish channels"
              hint="Comma-separated. Used when publishing."
            >
              <UInput
                v-model="channels"
                class="w-full"
                placeholder="whatsapp, telegram"
              />
            </UFormField>
            <div class="flex flex-wrap gap-2">
              <UButton
                v-if="canApprove"
                label="Approve"
                icon="i-lucide-check"
                :loading="moving"
                @click="move('approved')"
              />
              <UButton
                v-if="canPublish"
                label="Publish shout-out"
                icon="i-lucide-megaphone"
                :loading="moving"
                @click="move('published')"
              />
              <UButton
                v-if="canReturn"
                label="Return to draft"
                color="neutral"
                variant="outline"
                icon="i-lucide-undo-2"
                :loading="moving"
                @click="move('draft')"
              />
              <UButton
                v-if="canArchive"
                label="Archive"
                color="neutral"
                variant="outline"
                icon="i-lucide-archive"
                :loading="moving"
                @click="move('archived')"
              />
            </div>
            <p class="text-xs text-gray-500">
              Publishing writes the shout-out channels and locks the record; archiving is
              terminal.
            </p>
          </div>
        </PermissionGate>
      </UCard>

      <UCard class="lg:col-span-2">
        <template #header>
          <h2 class="font-semibold">Audit trail</h2>
        </template>
        <ul v-if="celebration.events.length > 0" class="space-y-2 text-sm">
          <li v-for="item in celebration.events" :key="item.id">
            <span class="font-medium">{{ item.event_type }}</span>
            <span v-if="item.detail" class="text-gray-500"> · {{ item.detail }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No audit rows.</p>
      </UCard>
    </div>
  </div>
</template>
