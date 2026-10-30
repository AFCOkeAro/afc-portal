<script setup lang="ts">
import { COLLECTIONS, CUSTOM_FORM_MODULES } from '@afc/shared'
import type { CustomFormRow } from '~/types/portal'

/**
 * Custom forms register (AFC-897, phase 1): every staff-built form in one
 * directory, plus the builder. Reads ride the custom_forms read grant;
 * saving and deleting ride the area-only routes -- the buttons below only
 * show for sessions that hold those grants, enforcement stays server-side.
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()

const MODULE_LABELS: Record<string, string> = {
  visitors: 'Visitors',
  people: 'People',
  households: 'Households',
  welfare_cases: 'Welfare cases',
  blessings: 'Blessings',
  announcements: 'Announcements',
  tasks: 'Tasks',
}

const showBuilder = ref(false)
const deleting = ref('')
const actionError = ref('')

const { data, pending, error, refresh } = await useAsyncData('custom-forms-list', () =>
  api.get<{ data: CustomFormRow[] }>('/api/custom-forms'),
)

const rows = computed(() => data.value?.data ?? [])

const canManage = computed(() => permissions.can(COLLECTIONS.customForms, 'create'))

function onCreated(): void {
  showBuilder.value = false
  void refresh()
}

async function removeForm(id: string): Promise<void> {
  deleting.value = id
  actionError.value = ''
  try {
    await api.remove(`/api/custom-forms/${id}`)
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not delete the form'
  } finally {
    deleting.value = ''
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Custom forms"
      description="Staff-built forms linked to a module. Each card opens the page that hosts its module; fills write through the linked module's own create grant."
    >
      <template #actions>
        <UButton
          v-if="canManage && !showBuilder"
          label="New custom form"
          icon="i-lucide-plus"
          @click="showBuilder = true"
        />
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load custom forms"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <CustomFormBuilder
      v-else-if="showBuilder"
      class="mt-4"
      @created="onCreated"
      @cancel="showBuilder = false"
    />

    <template v-else>
      <UAlert
        v-if="actionError"
        class="mt-4"
        color="error"
        variant="subtle"
        title="That did not work"
        :description="actionError"
      />

      <EmptyState
        v-if="rows.length === 0"
        class="mt-4"
        title="No custom forms yet"
        description="Build one to collect exactly the columns a module needs — the field list comes from the live database."
      />

      <div v-else class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <UCard v-for="row in rows" :key="row.id">
          <template #header>
            <div class="flex items-center justify-between gap-2">
              <span class="font-semibold">{{ row.name }}</span>
              <UBadge color="neutral" variant="subtle">
                {{ MODULE_LABELS[row.module] ?? row.module }}
              </UBadge>
            </div>
          </template>
          <p class="text-sm text-gray-500">
            {{ (row.schema.fields ?? []).length }} fields
          </p>
          <div class="mt-3 flex gap-2">
            <UButton
              label="Open module"
              color="neutral"
              variant="outline"
              size="sm"
              :to="`/${row.module === 'welfare_cases' ? 'welfare' : row.module}`"
            />
            <UButton
              v-if="canManage"
              label="Delete"
              color="error"
              variant="ghost"
              size="sm"
              :loading="deleting === row.id"
              @click="removeForm(row.id)"
            />
          </div>
        </UCard>
      </div>

      <p class="mt-4 text-xs text-gray-500">
        Linkable modules in phase 1:
        {{ CUSTOM_FORM_MODULES.join(', ') }}. Events and marriage need per-module handling
        and arrive later.
      </p>
    </template>
  </div>
</template>
