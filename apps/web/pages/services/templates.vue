<script setup lang="ts">
import {
  COLLECTIONS,
  WORSHIP_TEMPLATES,
  getWorshipTemplate,
  worshipTemplateDuration,
  worshipTemplateNotes,
  type WorshipTemplate,
} from '@afc/shared'
import type { BranchSummary } from '~/types/portal'

definePageMeta({ middleware: 'staff' })

/**
 * Worship planner templates (AFC-870).
 *
 * Ten in-code order-of-service templates (Sunday Morning, Midweek,
 * Communion, Easter, Christmas Eve, Good Friday, Harvest Thanksgiving,
 * Night Vigil, Baptism Service, Youth Service). Stated choice: templates
 * live in code like task-templates (AFC-668) — staging DDL is frozen, so
 * there is no template collection and no new privilege. "Add template"
 * means planning a service from a template: the ordinary POST
 * /api/services row with the type prefilled and the item list carried as
 * notes, so the roster, permissions and audit trail are unchanged.
 */

const api = useApi()
const permissions = usePermissions()

const expandedId = ref<string | null>(null)
const planId = ref<string | null>(null)
const planBranch = ref('')
const planDate = ref(new Date().toISOString().slice(0, 10))
const planError = ref('')
const planning = ref(false)
const plannedLink = ref<string | null>(null)

const branches = await useAsyncData('worship-template-branches', () =>
  api.get<BranchSummary[]>('/api/branches'),
)

const branchOptions = computed(() => [
  { label: 'Choose a branch', value: '' },
  ...(branches.data.value ?? []).map((row) => ({ label: row.name, value: row.id })),
])

const canPlan = computed(() => permissions.can(COLLECTIONS.sundayServices, 'create'))

function toggle(template: WorshipTemplate): void {
  expandedId.value = expandedId.value === template.id ? null : template.id
}

function startPlan(template: WorshipTemplate): void {
  planId.value = template.id
  planBranch.value = ''
  planError.value = ''
  plannedLink.value = null
  planDate.value = new Date().toISOString().slice(0, 10)
}

async function submitPlan(): Promise<void> {
  const template = planId.value ? getWorshipTemplate(planId.value) : undefined
  if (!template) return
  planError.value = ''
  plannedLink.value = null
  if (!planBranch.value) {
    planError.value = 'Choose a branch for the planned service.'
    return
  }
  planning.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/services', {
      branch: planBranch.value,
      service_date: planDate.value,
      service_type: template.serviceType,
      theme: template.name,
      notes: worshipTemplateNotes(template),
      status: 'planned',
    })
    const createdId = String((created as unknown as { data: { id: string } }).data?.id ?? (created as unknown as { id: string }).id ?? '')
    plannedLink.value = createdId ? `/services/${createdId}` : '/services'
    planId.value = null
  } catch (error) {
    planError.value = error instanceof Error ? error.message : 'Could not plan the service.'
  } finally {
    planning.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Worship planner templates"
      description="Ten orders of service. Open one to see its items, then plan a service from it — the ordinary service row with the item list carried as notes."
    >
      <template #actions>
        <UButton to="/services" color="neutral" variant="ghost" size="sm" label="Services" icon="i-lucide-arrow-left" />
      </template>
    </PageHeader>

    <PermissionGate :collection="COLLECTIONS.sundayServices" action="read">
      <UAlert
        v-if="plannedLink"
        class="mb-4"
        color="success"
        variant="subtle"
        title="Service planned"
        description="The service row carries the template items as notes."
      >
        <template #actions>
          <UButton :to="plannedLink" size="xs" label="Open service" />
        </template>
      </UAlert>

      <UCard>
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th class="px-3 py-2 font-medium">Name</th>
                <th class="px-3 py-2 font-medium">Items</th>
                <th class="px-3 py-2 font-medium">Duration</th>
                <th class="px-3 py-2"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <template v-for="template in WORSHIP_TEMPLATES" :key="template.id">
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-900/60">
                  <td class="px-3 py-3">
                    <button
                      type="button"
                      class="font-medium text-gray-900 hover:text-primary-600 dark:text-white"
                      @click="toggle(template)"
                    >
                      {{ template.name }}
                    </button>
                    <p class="text-xs text-gray-500 dark:text-gray-400">{{ template.description }}</p>
                  </td>
                  <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                    {{ template.items.length }}
                  </td>
                  <td class="px-3 py-3 tabular-nums text-gray-600 dark:text-gray-300">
                    {{ worshipTemplateDuration(template) }} min
                  </td>
                  <td class="px-3 py-3 text-right">
                    <div class="flex justify-end gap-2">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :label="expandedId === template.id ? 'Hide' : 'Items'"
                        @click="toggle(template)"
                      />
                      <PermissionGate :collection="COLLECTIONS.sundayServices" action="create">
                        <UButton
                          color="primary"
                          variant="outline"
                          size="xs"
                          label="Plan service"
                          :disabled="!canPlan"
                          @click="startPlan(template)"
                        />
                      </PermissionGate>
                    </div>
                  </td>
                </tr>
                <tr v-if="expandedId === template.id">
                  <td colspan="4" class="bg-gray-50 px-6 py-3 dark:bg-gray-900/60">
                    <ol class="list-decimal space-y-1 pl-5 text-sm text-gray-700 dark:text-gray-300">
                      <li v-for="(item, index) in template.items" :key="index">
                        {{ item.title }}
                        <span class="text-xs tabular-nums text-gray-500">· {{ item.durationMin }} min</span>
                      </li>
                    </ol>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </UCard>

      <UModal
        :open="planId !== null"
        title="Plan a service from template"
        description="Pick a branch and a date — the template items are carried as notes."
        @update:open="if (!$event) planId = null"
      >
        <template #body>
          <div v-if="planId" class="space-y-3">
            <p class="text-sm text-gray-600 dark:text-gray-300">
              {{ getWorshipTemplate(planId)?.name }} ·
              {{ getWorshipTemplate(planId) ? worshipTemplateDuration(getWorshipTemplate(planId)!) : 0 }} min ·
              type {{ getWorshipTemplate(planId)?.serviceType }}
            </p>
            <UFormField label="Branch">
              <EntitySelect
                v-model="planBranch"
                :items="branchOptions"
                placeholder="Choose a branch…"
                aria-label="Branch for the planned service"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Service date">
              <UInput v-model="planDate" type="date" class="w-full" />
            </UFormField>
            <UAlert
              v-if="planError"
              color="error"
              variant="subtle"
              title="Could not plan the service"
              :description="planError"
            />
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Cancel" @click="planId = null" />
            <UButton
              color="primary"
              label="Plan service"
              :loading="planning"
              :disabled="!canPlan"
              @click="submitPlan()"
            />
          </div>
        </template>
      </UModal>
    </PermissionGate>
  </div>
</template>
