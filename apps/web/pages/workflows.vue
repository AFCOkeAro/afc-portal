<script setup lang="ts">
import { TASK_TEMPLATES, expandTaskTemplate, getTaskTemplate } from '@afc/shared'
import { COLLECTIONS } from '@afc/shared'

/**
 * Workflows & Automations (AFC-840 phase 1): the task-template catalogue.
 *
 * Templates live in code (@afc/shared task-templates); applying one fans
 * out to ordinary task rows through POST /api/tasks/from-template, so
 * permissions, validation and audit are unchanged. An automation rules
 * engine is an explicit non-goal for phase 1 (recorded on AFC-840).
 */
definePageMeta({ middleware: 'staff' })

const api = useApi()
const permissions = usePermissions()
const { branchOptions } = useBranchOptions()

const canCreate = computed(() => permissions.can(COLLECTIONS.tasks, 'create'))

const openTemplate = ref<string | null>(null)
const applyForm = ref<Record<string, { branch: string; baseDate: string }>>({})
const applying = ref(false)
const applyError = ref('')
const applyDone = ref('')

function draftFor(id: string): { branch: string; baseDate: string } {
  const found = applyForm.value[id]
  if (found) return found
  const draft = { branch: '', baseDate: '' }
  applyForm.value = { ...applyForm.value, [id]: draft }
  return draft
}

function stepsOf(id: string) {
  const template = getTaskTemplate(id)
  if (!template) return []
  return expandTaskTemplate(template, null)
}

async function applyTemplate(id: string): Promise<void> {
  const draft = draftFor(id)
  if (draft.branch === '') {
    applyError.value = 'Choose the branch the tasks belong to.'
    return
  }
  applying.value = true
  applyError.value = ''
  applyDone.value = ''
  try {
    const res = await api.post<{ data: { created: number } }>(
      '/api/tasks/from-template',
      {
        template: id,
        branch: draft.branch,
        base_date: draft.baseDate === '' ? null : draft.baseDate,
      },
    )
    applyDone.value = `Created ${res.data.created} tasks.`
  } catch (cause) {
    applyError.value =
      (cause as { message?: string }).message ?? 'Could not apply the template'
  } finally {
    applying.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Workflows & Automations"
      description="Recurring checklists as templates. Applying one creates ordinary tasks — same permissions, same audit trail."
    />
    <div class="mt-4 grid gap-3 lg:grid-cols-2">
      <UCard v-for="template in TASK_TEMPLATES" :key="template.id">
        <template #header>
          <button
            type="button"
            class="flex w-full items-center gap-2 text-left"
            @click="openTemplate = openTemplate === template.id ? null : template.id"
          >
            <span class="font-semibold">{{ template.label }}</span>
            <UBadge color="neutral" variant="subtle" class="ml-auto">
              {{ template.steps.length }} steps
            </UBadge>
            <UIcon
              :name="
                openTemplate === template.id
                  ? 'i-lucide-chevron-up'
                  : 'i-lucide-chevron-down'
              "
              class="size-4 text-gray-400"
            />
          </button>
        </template>
        <p class="text-sm text-gray-500">{{ template.description }}</p>
        <ol v-if="openTemplate === template.id" class="mt-3 space-y-1.5">
          <li
            v-for="(step, index) in stepsOf(template.id)"
            :key="index"
            class="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-sm dark:bg-gray-900"
          >
            <span class="font-mono text-xs text-gray-500">{{ index + 1 }}</span>
            <span class="min-w-0 flex-1 truncate">{{ step.title }}</span>
            <UBadge color="neutral" variant="subtle" size="xs">{{
              step.priority
            }}</UBadge>
          </li>
        </ol>
        <div v-if="canCreate" class="mt-3 flex flex-wrap items-end gap-2">
          <UFormField label="Branch" class="min-w-40 flex-1">
            <USelect
              v-model="draftFor(template.id).branch"
              :items="branchOptions"
              placeholder="Choose a branch…"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Base date" class="w-40">
            <UInput v-model="draftFor(template.id).baseDate" type="date" class="w-full" />
          </UFormField>
          <UButton
            label="Use template"
            icon="i-lucide-play"
            :loading="applying"
            @click="applyTemplate(template.id)"
          />
        </div>
      </UCard>
    </div>
    <p v-if="applyDone !== ''" class="mt-3 text-sm text-green-700">{{ applyDone }}</p>
    <p v-if="applyError !== ''" class="mt-3 text-sm text-red-600">{{ applyError }}</p>
  </div>
</template>
