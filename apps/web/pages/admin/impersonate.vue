<script setup lang="ts">
/**
 * Admin impersonation picker (AFC-684).
 *
 * Admin-only: super/area admins preview anyone, any branch, any zone;
 * zone admins preview branches (and branch users) under their own zones.
 * The form uses the searchable EntitySelect only (AFC-631) — no manual-ID
 * inputs — plus a required reason field. Starting writes the audit row;
 * the banner (layouts/default) marks the preview and exits it.
 */
import type { EntityOption } from '~/components/EntitySelect.vue'

definePageMeta({ middleware: 'staff' })

const api = useApi()
const toast = useToast()

interface BranchRow { id: string; name: string }
interface ZoneRow { id: string; name: string }

const kind = ref<'user' | 'branch' | 'zone'>('branch')
const targetId = ref('')
const reason = ref('')
const starting = ref(false)
const fieldError = ref('')

const { data: branches } = await useAsyncData('afc:impersonate-branches', async () => {
  try {
    const res = await api.get<{ data: BranchRow[] }>('/api/branches?limit=200')
    return res.data
  } catch {
    return [] as BranchRow[]
  }
})

const { data: zones } = await useAsyncData('afc:impersonate-zones', async () => {
  try {
    const res = await api.get<{ data: ZoneRow[] }>('/api/zones?limit=200')
    return res.data
  } catch {
    return [] as ZoneRow[]
  }
})

const branchOptions = computed<EntityOption[]>(() =>
  (branches.value ?? []).map((b) => ({ label: b.name, value: b.id })),
)
const zoneOptions = computed<EntityOption[]>(() =>
  (zones.value ?? []).map((z) => ({ label: z.name, value: z.id })),
)
const userOptions = computed<EntityOption[]>(() => [])

const targetOptions = computed<EntityOption[]>(() => {
  if (kind.value === 'branch') return branchOptions.value
  if (kind.value === 'zone') return zoneOptions.value
  return userOptions.value
})

watch(kind, () => {
  targetId.value = ''
})

async function start(): Promise<void> {
  fieldError.value = ''
  if (!targetId.value) {
    fieldError.value = 'Choose a target to preview.'
    return
  }
  if (reason.value.trim().length < 8) {
    fieldError.value = 'Say why in at least 8 characters — the audit log keeps it.'
    return
  }
  starting.value = true
  try {
    const body: Record<string, string> =
      kind.value === 'user'
        ? { targetUserId: targetId.value, reason: reason.value.trim() }
        : kind.value === 'zone'
          ? { zoneId: targetId.value, reason: reason.value.trim() }
          : { branchId: targetId.value, reason: reason.value.trim() }
    await api.post('/api/admin/impersonate', body)
    toast.add({ title: 'Preview started', description: 'The banner marks the preview scope.' })
    await navigateTo('/dashboard', { replace: true })
  } catch (cause) {
    fieldError.value =
      cause instanceof Error ? cause.message : 'The preview could not start.'
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-6">
    <div>
      <h1 class="text-xl font-semibold">Preview a scope</h1>
      <p class="mt-1 text-sm text-gray-500">
        Start a 30-minute audited preview. Zone admins see only their own zones'
        branches; anything outside your scope is refused.
      </p>
    </div>

    <UCard>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium">Preview kind</label>
          <USelect v-model="kind" :options="['branch', 'zone', 'user']" class="w-full" />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium">Target</label>
          <EntitySelect
            v-if="kind !== 'user'"
            v-model="targetId"
            :items="targetOptions"
            placeholder="Select target…"
            class="w-full"
          />
          <!-- User targets: Directus users have no list endpoint to preload
            (AFC-631 documents the same exception for assignee_user, inviter
            filter, and Welfare-officer assignment), so the full user UUID is
            pasted. Branches and zones always use the searchable EntitySelect. -->
          <UInput
            v-else
            v-model="targetId"
            placeholder="Paste the user UUID…"
            class="w-full"
          />
          <p v-if="kind === 'user'" class="mt-1 text-xs text-gray-500">
            No user directory endpoint exists yet: paste the full user id from
            the Directus admin. Branch and zone targets stay searchable picks.
          </p>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium" for="impersonate-reason">Reason (kept in the audit log)</label>
          <UTextarea
            id="impersonate-reason"
            v-model="reason"
            :rows="3"
            placeholder="e.g. Reproduce the branch dashboard figures the pastor reported"
            class="w-full"
          />
        </div>

        <p v-if="fieldError" role="alert" class="text-sm text-red-600">{{ fieldError }}</p>

        <div class="flex justify-end gap-2">
          <UButton variant="ghost" to="/dashboard">Cancel</UButton>
          <UButton :loading="starting" @click="start">Start preview</UButton>
        </div>
      </div>
    </UCard>
  </div>
</template>
