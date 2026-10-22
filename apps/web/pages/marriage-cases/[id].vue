<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const route = useRoute()
const id = String(route.params.id)

const { personOptions, personPending, onPersonSearch } = usePersonSearch()
const { branchOptions, branchesPending } = useBranchOptions()

const { data, pending, error, refresh } = await useAsyncData(`marriage-case-${id}`, () =>
  api.get<{
    data: Record<string, unknown>
    audit: Record<string, unknown>[]
    tasks: Record<string, unknown>[]
    meta: { tasksTotal: number; tasksDone: number }
  }>(`/api/marriage-cases/${id}`),
)

const actionError = ref('')
const toStage = ref('')
const haltReason = ref('')
const transferBranch = ref('')
const sisterLink = ref('')
const verifyTick = ref(false)

async function callAction(path: string, body: Record<string, unknown>) {
  actionError.value = ''
  try {
    await api.post(path, body)
    toStage.value = ''
    haltReason.value = ''
    transferBranch.value = ''
    sisterLink.value = ''
    verifyTick.value = false
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'That move did not go through'
  }
}

function advance() {
  if (!toStage.value) return
  void callAction(`/api/marriage-cases/${id}/transition`, {
    to_stage: toStage.value,
    ...(haltReason.value ? { halt_reason: haltReason.value } : {}),
    ...(transferBranch.value ? { transfer_to_branch: transferBranch.value } : {}),
    ...(verifyTick.value ? { wedding_info_verified: true } : {}),
  })
}

function approve(gate: string) {
  void callAction(`/api/marriage-cases/${id}/approve`, { gate })
}

function transfer() {
  if (!transferBranch.value) return
  void callAction(`/api/marriage-cases/${id}/transfer`, {
    transfer_to_branch: transferBranch.value,
  })
}

async function linkSister() {
  if (!sisterLink.value) return
  actionError.value = ''
  try {
    await api.patch(`/api/marriage-cases/${id}/link-sister`, {
      sister_person: sisterLink.value,
    })
    sisterLink.value = ''
    await refresh()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not link the sister'
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Marriage case"
      description="Pipeline stage, approvals and the task checklist."
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
      </template>
    </PageHeader>

    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      title="Could not load this case"
      :description="error.message"
    />

    <div v-if="pending" class="mt-8 flex justify-center py-10">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <div v-else-if="data?.data" class="grid gap-4">
      <UCard>
        <template #header>
          <h2 class="font-semibold">Case · {{ data.data.stage }}</h2>
        </template>
        <p class="text-sm text-gray-500">
          Checklist {{ data.meta.tasksDone }} of {{ data.meta.tasksTotal }} done.
        </p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Move the stage</h2>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Next stage">
            <UInput v-model="toStage" placeholder="e.g. zonal_review" class="w-full" />
          </UFormField>
          <UFormField label="Halt reason (halted only)">
            <UInput v-model="haltReason" placeholder="Reason" class="w-full" />
          </UFormField>
          <UFormField label="Receiving branch (transfer only)">
            <EntitySelect
              v-model="transferBranch"
              :items="branchOptions"
              placeholder="Select branch…"
              :loading="branchesPending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Wedding info verified (leaving wedding_info)">
            <USwitch v-model="verifyTick" />
          </UFormField>
        </div>
        <div class="mt-4 flex justify-end">
          <UButton label="Move" icon="i-lucide-arrow-right" @click="advance" />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Approvals</h2>
        </template>
        <div class="flex gap-2">
          <UButton
            label="Zonal approval"
            icon="i-lucide-check"
            @click="approve('zonal')"
          />
          <UButton
            label="Overseer approval"
            icon="i-lucide-check-check"
            @click="approve('overseer')"
          />
        </div>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Transfer out / link sister</h2>
        </template>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Transfer to branch (closes the file)">
            <EntitySelect
              v-model="transferBranch"
              :items="branchOptions"
              placeholder="Select branch…"
              :loading="branchesPending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Sister in DB (keeps the case open)">
            <EntitySelect
              v-model="sisterLink"
              :items="personOptions"
              placeholder="Type a name to search…"
              :loading="personPending"
              server-search
              class="w-full"
              @update:search-term="onPersonSearch"
            />
          </UFormField>
        </div>
        <div class="mt-4 flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            label="Link sister"
            @click="linkSister"
          />
          <UButton label="Transfer out" icon="i-lucide-send" @click="transfer" />
        </div>
      </UCard>

      <UAlert v-if="actionError" color="error" variant="subtle" :title="actionError" />

      <UCard>
        <template #header>
          <h2 class="font-semibold">Checklist</h2>
        </template>
        <ul v-if="(data.tasks ?? []).length > 0" class="space-y-2 text-sm">
          <li v-for="row in data.tasks ?? []" :key="String(row.id)">
            <span class="font-medium">{{ row.title }}</span>
            <span class="text-gray-500"> · {{ row.status }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No tasks yet.</p>
      </UCard>

      <UCard>
        <template #header>
          <h2 class="font-semibold">Trail</h2>
        </template>
        <ul v-if="(data.audit ?? []).length > 0" class="space-y-2 text-sm">
          <li v-for="row in data.audit ?? []" :key="String(row.id)">
            <span class="font-medium">{{ row.event_type }}</span>
            <span v-if="row.detail" class="text-gray-500"> · {{ row.detail }}</span>
          </li>
        </ul>
        <p v-else class="text-sm text-gray-500">No trail rows.</p>
      </UCard>
    </div>
  </div>
</template>
