<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Welfare.
 *
 * The only page with a capability guard in addition to the staff guard, because
 * welfare is the collection with the narrowest grants (data-model §10): a
 * volunteer holds none, a department leader reads youth cases only.
 *
 * `middleware/welfare` turns a typed URL into a 403 for an account without the
 * read grant. The guard is duplicated here as a render check so the shell and the
 * route agree: a guard that lets the page render and then hides its contents
 * teaches staff that the URL is the problem.
 */
definePageMeta({ middleware: ['staff', 'welfare'] })

const permissions = usePermissions()
const restricted = computed(() => permissions.hiddenFields(COLLECTIONS.welfareCases))
</script>

<template>
  <div>
    <PageHeader
      title="Welfare"
      description="Cases, contributions and outcomes for the branches this account can see."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.welfareCases" action="create">
          <UButton
            label="Open case"
            icon="i-lucide-plus"
            disabled
            title="Not wired yet — the case route lands with the welfare feature"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <UAlert
      v-if="restricted.length"
      class="mb-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="Restricted on this account"
      :description="`Not shown here: ${restricted.join(', ')}. Case details and outcome notes are limited to the assigned owner, branch admins and area administrators (data-model §10.1).`"
    />

    <EmptyState
      title="No cases loaded"
      description="Wired to the staff guard, the capability guard and the capability endpoint. The read route is not built yet."
    />
  </div>
</template>
