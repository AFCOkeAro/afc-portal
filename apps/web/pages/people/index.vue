<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * People.
 *
 * Shell only. The list route (`GET /api/people`) is not written yet — it is the
 * first feature ticket, because it is where branch scoping has to be proven
 * against a real Directus policy rather than asserted in a comment.
 *
 * The restricted-field note is here, not later, because the columns of this
 * table are the thing a reviewer will check against data-model §10.1: DOB,
 * notes and `safeguarding_flag` are readable by branch, area and super admins
 * only, and the UI drops them for anyone else.
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()

const restricted = computed(() => permissions.hiddenFields(COLLECTIONS.people))
</script>

<template>
  <div>
    <PageHeader
      title="People"
      description="Members, visitors, youth and children across the branches this account can see."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.people" action="create">
          <UButton
            label="Add person"
            icon="i-lucide-user-plus"
            disabled
            title="Not wired yet — the create route lands with the people feature"
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
      :description="`Not shown here: ${restricted.join(', ')}. Access is granted to branch, area and super administrators only (data-model §10.1).`"
    />

    <EmptyState
      title="No people loaded"
      description="This screen is wired to the auth guard and the capability endpoint. The read route is not built yet, so no records are being requested."
    />
  </div>
</template>
