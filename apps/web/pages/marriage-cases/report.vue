<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()

const { data, pending, error, refresh } = await useAsyncData(
  'marriage-cases-report',
  () =>
    api.get<{
      data: Record<string, unknown>[]
      meta: { total: number; page: number; limit: number }
    }>('/api/marriage-cases/report', { query: { limit: 100 } }),
)

const rows = computed(() => data.value?.data ?? [])
const total = computed(() => data.value?.meta.total ?? rows.value.length)
</script>

<template>
  <div>
    <PageHeader
      title="Conducted marriages"
      description="Every brother and sister joined in marriage, with the officiating minister, the Bible passage and the certificate record."
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-arrow-left"
          label="Pipeline"
          to="/marriage-cases"
        />
        <UButton
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Refresh"
          @click="refresh()"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load the report"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UCard v-else>
      <template #header>
        <h2 class="font-semibold">Marriages conducted · {{ total }}</h2>
      </template>

      <EmptyState
        v-if="rows.length === 0"
        title="No conducted marriages yet"
        description="Couples appear here once their file reaches the reported stage."
      />

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Brother</th>
              <th class="px-3 py-2 font-medium">Sister</th>
              <th class="px-3 py-2 font-medium">Church (branch)</th>
              <th class="px-3 py-2 font-medium">Wedding date</th>
              <th class="px-3 py-2 font-medium">Officiating minister</th>
              <th class="px-3 py-2 font-medium">Bible passage</th>
              <th class="px-3 py-2 font-medium">Certificate</th>
              <th class="px-3 py-2 font-medium">Scanned certificate</th>
              <th class="px-3 py-2 font-medium">Couple photo</th>
              <th class="px-3 py-2 font-medium">Presentation photo</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3 font-medium">
                {{ row.brother_name ?? row.brother_person ?? '—' }}
              </td>
              <td class="px-3 py-3 font-medium">
                {{ row.sister_name ?? row.sister_person ?? '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.branch_name ?? row.branch ?? '—' }}
              </td>
              <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                {{ row.wedding_date ?? '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.officiating_minister_name ?? row.officiating_minister ?? '—' }}
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.bible_passage ?? '—' }}
              </td>
              <td class="px-3 py-3 capitalize text-gray-600 dark:text-gray-300">
                {{ row.certificate_type ?? '—' }}
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ row.marriage_certificate_file ?? '—' }}
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ row.couple_photo_file ?? '—' }}
              </td>
              <td class="px-3 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">
                {{ row.presentation_photo_file ?? '—' }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/marriage-cases/${String(row.id)}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open marriage case"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
