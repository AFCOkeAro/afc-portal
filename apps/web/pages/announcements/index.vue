<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const showForm = ref(false)
const form = ref({ title: '', body: '', publish_from: '', publish_to: '', branch: '' })
const error = ref('')

const { data, pending, refresh } = await useAsyncData('announcements-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/announcements'),
)

async function create() {
  error.value = ''
  try {
    await api.post('/api/announcements', {
      title: form.value.title,
      ...(form.value.body ? { body: form.value.body } : {}),
      ...(form.value.publish_from
        ? { publish_from: new Date(form.value.publish_from).toISOString() }
        : {}),
      ...(form.value.publish_to
        ? { publish_to: new Date(form.value.publish_to).toISOString() }
        : {}),
      ...(form.value.branch ? { branch: form.value.branch } : {}),
    })
    showForm.value = false
    form.value = { title: '', body: '', publish_from: '', publish_to: '', branch: '' }
    await refresh()
  } catch (cause) {
    error.value =
      (cause as { message?: string }).message ?? 'Could not draft the announcement'
  }
}

const rows = computed(() => data.value?.data ?? [])

/** Dashboard strip (AFC-588): no server filters — display-only total, no new backend. */
const stripItems = computed(() => [
  {
    label: 'Announcements',
    value: rows.value.length,
    to: null,
    hint: 'Total in view',
  },
])
</script>

<template>
  <div>
    <PageHeader
      title="Announcements"
      description="Draft → scheduled → published, with approval. Readers see published rows inside the window."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.announcements" action="create">
          <UButton
            label="Draft announcement"
            icon="i-lucide-plus"
            @click="showForm = !showForm"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <DashboardStrip :items="stripItems" />

    <UCard v-if="showForm" class="mb-4">
      <template #header>
        <h2 class="font-semibold">New draft</h2>
      </template>
      <div class="grid gap-3">
        <UFormField label="Title">
          <UInput v-model="form.title" class="w-full" placeholder="Title" />
        </UFormField>
        <UFormField label="Body">
          <UTextarea v-model="form.body" class="w-full" placeholder="Body" />
        </UFormField>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Publish from">
            <UInput v-model="form.publish_from" type="datetime-local" class="w-full" />
          </UFormField>
          <UFormField label="Publish to">
            <UInput v-model="form.publish_to" type="datetime-local" class="w-full" />
          </UFormField>
        </div>
        <UFormField label="Branch" hint="Blank means area-wide; area staff only.">
          <UInput v-model="form.branch" class="w-full" placeholder="Branch id" />
        </UFormField>
      </div>
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="subtle"
        title="Could not save the draft"
        :description="error"
      />
      <div class="mt-4">
        <UButton label="Save draft" icon="i-lucide-check" @click="create" />
      </div>
    </UCard>

    <UCard>
      <div v-if="pending" class="mt-8 flex justify-center py-10">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
      </div>

      <EmptyState
        v-else-if="rows.length === 0"
        title="No announcements yet"
        description="Draft the first announcement for this scope."
      >
        <PermissionGate :collection="COLLECTIONS.announcements" action="create">
          <UButton class="mt-4" label="Draft announcement" @click="showForm = true" />
        </PermissionGate>
      </EmptyState>

      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
          <thead>
            <tr
              class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              <th class="px-3 py-2 font-medium">Title</th>
              <th class="px-3 py-2 font-medium">Status</th>
              <th class="px-3 py-2 font-medium">Window</th>
              <th class="px-3 py-2"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              class="hover:bg-gray-50 dark:hover:bg-gray-900/60"
            >
              <td class="px-3 py-3">
                <NuxtLink
                  :to="`/announcements/${String(row.id)}`"
                  class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                >
                  {{ row.title }}
                </NuxtLink>
              </td>
              <td class="px-3 py-3">
                <UBadge color="neutral" variant="subtle">{{ row.status }}</UBadge>
              </td>
              <td class="px-3 py-3 text-gray-600 dark:text-gray-300">
                {{ row.publish_from ?? '—' }} → {{ row.publish_to ?? '—' }}
              </td>
              <td class="px-3 py-3 text-right">
                <UButton
                  :to="`/announcements/${String(row.id)}`"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  icon="i-lucide-arrow-right"
                  aria-label="Open announcement"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
  </div>
</template>
