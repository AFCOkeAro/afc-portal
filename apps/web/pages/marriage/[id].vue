<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)

const { data, pending, error } = await useAsyncData(`marriage-${id}`, () =>
  api.get<{ data: Record<string, unknown>; audit: Record<string, unknown>[] }>(
    `/api/marriage/${id}`,
  ),
)
</script>

<template>
  <div>
    <PageHeader
      title="Marriage matter"
      description="Banns, wedding or counselling with its audit trail."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Marriage matters"
          to="/marriage"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load this matter"
      :description="error.message"
    />

    <div v-if="pending" class="flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Matter</h2>
        </template>
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Type</dt>
            <dd class="capitalize">
              {{ String(data.data.matter_type).replace(/_/g, ' ') }}
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Status</dt>
            <dd>
              <UBadge color="neutral" variant="subtle">{{ data.data.status }}</UBadge>
            </dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-gray-500">Wedding date</dt>
            <dd>{{ data.data.wedding_date ?? '—' }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-gray-500">Notes</dt>
            <dd class="mt-1">{{ data.data.notes ?? '—' }}</dd>
          </div>
        </dl>
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
