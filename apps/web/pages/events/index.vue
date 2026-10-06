<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Events.
 *
 * Shell only. The public registration form at `/register` reads events through
 * the proxy; this list is the staff-side view and needs the branch-scoped read
 * route.
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()
const canRead = computed(() => permissions.can(COLLECTIONS.events, 'read'))
</script>

<template>
  <div>
    <PageHeader
      title="Events"
      description="Services, summits, camps, training and outreach across the area."
    >
      <template #actions>
        <UButton
          to="/register"
          color="neutral"
          variant="ghost"
          icon="i-lucide-external-link"
          label="Public form"
        />
        <PermissionGate :collection="COLLECTIONS.events" action="create">
          <UButton
            label="Create event"
            icon="i-lucide-calendar-plus"
            disabled
            title="Not wired yet — the create route lands with the events feature"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <EmptyState
      v-if="canRead"
      title="No events loaded"
      description="Wired to the auth guard and the capability endpoint. The read route is not built yet, so no records are being requested."
    />
    <EmptyState
      v-else
      reason="forbidden"
      title="No access to events"
      description="This account holds no read grant on events."
    />
  </div>
</template>
