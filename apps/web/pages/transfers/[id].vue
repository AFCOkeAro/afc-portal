<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)
const error = ref('')

const { data, pending, refresh } = await useAsyncData(`transfer-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/transfers/${id}`,
  ),
)

async function setStatus(status: string) {
  error.value = ''
  try {
    await api.patch(`/api/transfers/${id}`, { status })
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not update the transfer'
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Transfer"
      description="Branch-to-branch move. Approval moves the home branch."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Transfers"
          to="/transfers"
        />
      </template>
    </PageHeader>

    <div v-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Transfer</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Effective</dt>
            <dd>{{ data.data.effective_date ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">From</dt>
            <dd>{{ data.data.from_branch }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">To</dt>
            <dd>{{ data.data.to_branch }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Reason</dt>
            <dd class="mt-1">{{ data.data.reason ?? '—' }}</dd>
          </div>
        </dl>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Decide</h2>
        </template>
        <UAlert
          v-if="error"
          class="mb-3"
          color="error"
          variant="subtle"
          :description="error"
        />
        <PermissionGate :collection="COLLECTIONS.transfers" action="update">
          <div class="flex flex-wrap gap-2">
            <UButton
              label="Approve (moves home branch)"
              icon="i-lucide-check"
              @click="setStatus('approved')"
            />
            <UButton
              label="Complete"
              color="neutral"
              variant="outline"
              icon="i-lucide-flag"
              @click="setStatus('completed')"
            />
            <UButton
              label="Reject"
              color="neutral"
              variant="outline"
              icon="i-lucide-x"
              @click="setStatus('rejected')"
            />
          </div>
        </PermissionGate>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Audit trail</h2>
        </template>
        <ul v-if="(data.audit ?? []).length > 0" class="space-y-2 text-sm">
          <li v-for="row in data.audit ?? []" :key="String(row.id)">
            <span class="font-medium">{{ row.event_type }}</span>
            <span v-if="row.detail" class="text-gray-500"> · {{ row.detail }}</span>
            <span class="text-gray-400"> ({{ row.created_at }})</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No audit rows.</p>
      </UCard>
    </div>
  </div>
</template>
