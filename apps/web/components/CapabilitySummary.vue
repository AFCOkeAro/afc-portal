<script setup lang="ts">
import type { Grant } from '@afc/shared'

/**
 * What this session is allowed to do, read back from the server.
 *
 * This panel is the visible half of the `/api/me/permissions` wiring: the
 * endpoint is real, the role-to-grant translation is real, and the list below is
 * the payload. Switching the stub identities in `NUXT_STUB_AUTH` mode produces a
 * visibly different page, which is the cheapest possible demonstration that the
 * capability path works end to end.
 */
const permissions = usePermissions()

const grants = computed<string[]>(() =>
  permissions.grants.value.map(
    (grant: Grant) => `${grant.collection} · ${grant.action} · ${grant.scope}`,
  ),
)

const hiddenFieldGroups = computed<string[]>(() => permissions.hiddenFieldGroups())
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="text-base font-semibold">This session's access</h2>
    </template>

    <p class="text-sm text-gray-500 dark:text-gray-400">
      Navigation and field visibility for the signed-in account, as resolved by
      <code class="font-mono text-xs">GET /api/me/permissions</code>. This is navigation,
      not authorisation: the Directus policy is the control.
    </p>

    <UAlert
      v-if="!permissions.scoped.value"
      class="mt-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-map-pin-off"
      title="No branch assigned"
      description="This account is not assigned to a branch and is not an area administrator, so no records are visible to it."
    />

    <div class="mt-5">
      <h3 class="text-sm font-medium">Grants</h3>
      <ul v-if="grants.length" class="mt-2 space-y-1">
        <li
          v-for="grant in grants"
          :key="grant"
          class="font-mono text-xs text-gray-600 dark:text-gray-300"
        >
          {{ grant }}
        </li>
      </ul>
      <p v-else class="mt-2 text-sm text-gray-500 dark:text-gray-400">
        No grants. This account cannot see any records.
      </p>
    </div>

    <div v-if="hiddenFieldGroups.length" class="mt-5">
      <h3 class="text-sm font-medium">Fields hidden from this session</h3>
      <ul class="mt-2 space-y-1">
        <li
          v-for="group in hiddenFieldGroups"
          :key="group"
          class="font-mono text-xs text-gray-600 dark:text-gray-300"
        >
          {{ group }}
        </li>
      </ul>
    </div>
  </UCard>
</template>
