<script setup lang="ts">
/**
 * Minimal account settings (AFC-574).
 *
 * Read-only account section plus a Sign out action. No password change, no
 * profile editing, no new API routes — all explicitly out of scope. Branch
 * scope renders the IDs already exposed by `useAuth` (home branch,
 * multi-branch scope, area/zone when present) because no branch-name lookup
 * endpoint is in scope for this page.
 */
definePageMeta({ middleware: 'staff' })

const { user, logout } = useAuth()
const permissions = usePermissions()

const roleLabel = computed(() => user.value?.staffRole?.replace(/_/g, ' ') ?? '—')

const branchScope = computed<string>(() => {
  const u = user.value
  if (!u) return '—'
  if (!permissions.scoped.value && !u.branchId && u.branchIds.length === 0)
    return 'No branch assigned'
  const parts: string[] = []
  if (u.branchId) parts.push(`Home: ${u.branchId}`)
  const extra = u.branchIds.filter((id: string) => id !== u.branchId)
  if (extra.length > 0) parts.push(`Scope (${extra.length}): ${extra.join(', ')}`)
  if (u.areaId) parts.push(`Area: ${u.areaId}`)
  if (u.zoneId) parts.push(`Zone: ${u.zoneId}`)
  if (u.zoneIds?.length) parts.push(`Zones (${u.zoneIds.length}): ${u.zoneIds.join(', ')}`)
  if (u.departmentIds.length > 0)
    parts.push(`Departments (${u.departmentIds.length}): ${u.departmentIds.join(', ')}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
})
</script>

<template>
  <div>
    <PageHeader
      title="Settings"
      description="Account details for the signed-in session. Read-only."
    />

    <UCard>
      <template #header>
        <h2 class="text-base font-semibold">Account</h2>
      </template>

      <dl
        class="grid gap-x-8 gap-y-4 sm:grid-cols-[160px_1fr]"
      >
        <dt class="text-sm font-medium text-gray-500 dark:text-gray-400">Name</dt>
        <dd class="text-sm text-gray-900 dark:text-white">
          {{ user?.firstName ?? '—' }}
        </dd>

        <dt class="text-sm font-medium text-gray-500 dark:text-gray-400">Email</dt>
        <dd class="text-sm text-gray-900 dark:text-white">{{ user?.email ?? '—' }}</dd>

        <dt class="text-sm font-medium text-gray-500 dark:text-gray-400">Role</dt>
        <dd class="text-sm text-gray-900 dark:text-white">{{ roleLabel }}</dd>

        <dt class="text-sm font-medium text-gray-500 dark:text-gray-400">
          Branch scope
        </dt>
        <dd
          class="break-all font-mono text-xs text-gray-600 dark:text-gray-300"
        >
          {{ branchScope }}
        </dd>
      </dl>

      <div class="mt-6">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          label="Sign out"
          @click="logout"
        />
      </div>
    </UCard>
  </div>
</template>
