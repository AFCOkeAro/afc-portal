<script setup lang="ts">
/**
 * Demo data admin (AFC-1086): plant or clear the linked demo dataset.
 *
 * Super-admin only. The page itself sits behind the staff middleware like
 * every other staff page; non-super-admins see a refusal notice, and the
 * routes refuse them again server-side (403) regardless of what the UI
 * renders. Clearing needs the exact typed phrase `DELETE DEMO DATA` --
 * the route rejects anything else with a 400 before running anything.
 */

definePageMeta({ middleware: 'staff' })

const api = useApi()
const { user: sessionUser } = useAuth()

const isSuperAdmin = computed(() => sessionUser.value?.staffRole === 'super_admin')

const confirmPhrase = ref('')
const running = ref<'seed' | 'clear' | null>(null)
const actionError = ref('')
const lastResult = ref<{
  action: string
  total: number
  tables: Record<string, number>
} | null>(null)

const CONFIRM_PHRASE = 'DELETE DEMO DATA'
const canClear = computed(
  () => confirmPhrase.value === CONFIRM_PHRASE && running.value === null,
)

interface DemoResponse {
  ok: boolean
  action: string
  total: number
  tables: Record<string, number>
}

async function runSeed() {
  running.value = 'seed'
  actionError.value = ''
  try {
    lastResult.value = await api.post<DemoResponse>('/api/admin/demo/seed')
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : 'Seeding failed'
  } finally {
    running.value = null
  }
}

async function runClear() {
  if (!canClear.value) return
  running.value = 'clear'
  actionError.value = ''
  try {
    lastResult.value = await api.post<DemoResponse>('/api/admin/demo/clear', {
      confirmPhrase: confirmPhrase.value,
    })
    confirmPhrase.value = ''
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : 'Clearing failed'
  } finally {
    running.value = null
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Demo data"
      description="Plant or clear the linked demo dataset (Adeyemi, Okafor, Eze across gatherings, care and finance)."
    />

    <UAlert
      v-if="!isSuperAdmin"
      color="error"
      variant="subtle"
      title="Super admins only"
      description="Only a super admin may seed or clear demo data."
    />

    <template v-else>
      <UAlert
        v-if="actionError !== ''"
        class="mb-4"
        color="error"
        variant="subtle"
        title="Action failed"
        :description="actionError"
      />

      <div class="grid gap-4 md:grid-cols-2">
        <UCard>
          <template #header>
            <h2 class="font-semibold">Seed</h2>
            <p class="mt-1 text-sm text-gray-500">
              Plants the linked dataset. Idempotent: re-running adds nothing.
            </p>
          </template>
          <UButton
            label="Seed demo data"
            icon="i-lucide-sprout"
            :loading="running === 'seed'"
            :disabled="running !== null"
            @click="runSeed"
          />
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">Clear</h2>
            <p class="mt-1 text-sm text-gray-500">
              Removes only planted rows. Type the phrase exactly to confirm.
            </p>
          </template>
          <div class="flex flex-col gap-3">
            <UInput
              v-model="confirmPhrase"
              placeholder="DELETE DEMO DATA"
              autocomplete="off"
            />
            <UButton
              label="Clear demo data"
              icon="i-lucide-trash-2"
              color="error"
              :loading="running === 'clear'"
              :disabled="!canClear"
              @click="runClear"
            />
          </div>
        </UCard>
      </div>

      <UCard v-if="lastResult" class="mt-4">
        <template #header>
          <h2 class="font-semibold">
            Last run: {{ lastResult.action }} — {{ lastResult.total }} rows
          </h2>
        </template>
        <ul class="grid gap-1 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="(count, table) in lastResult.tables" :key="table">
            {{ table }}: {{ count }}
          </li>
        </ul>
      </UCard>

      <p class="mt-4 text-sm text-gray-500">
        Scripts and safety notes:
        <code>services/directus/seeds/demo/README.md</code>. Audit history lives in
        <code>demo_admin_actions</code> and is never cleared.
      </p>
    </template>
  </div>
</template>
