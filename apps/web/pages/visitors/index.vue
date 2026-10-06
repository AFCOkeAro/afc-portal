<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Visitors.
 *
 * Shell only. Note the write asymmetry from data-model §10: a volunteer may
 * create a visitor intake for their own branch but cannot read the visitor list.
 * So the guard on this page is a read grant, and the intake control is a separate
 * create grant — a volunteer gets the button on an intake form, not this list.
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()
const canRead = computed(() => permissions.can(COLLECTIONS.visitors, 'read'))
</script>

<template>
  <div>
    <PageHeader
      title="Visitors"
      description="First-time attenders, follow-ups and newcomers in the journey."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.visitors" action="create">
          <UButton
            label="Record intake"
            icon="i-lucide-user-plus"
            disabled
            title="Not wired yet — the intake route lands with the visitors feature"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <EmptyState
      v-if="canRead"
      title="No visitors loaded"
      description="Wired to the auth guard and the capability endpoint. The read route is not built yet."
    />
    <EmptyState
      v-else
      reason="forbidden"
      title="No access to the visitor list"
      description="This account may record an intake without holding a read grant on the list."
    />
  </div>
</template>
