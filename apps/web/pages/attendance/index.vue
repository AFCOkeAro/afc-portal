<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

/**
 * Attendance.
 *
 * Shell only. The capture form (PRD US-7) is mobile-first and its validation
 * already lives in `@afc/shared` — `attendanceSessionFormSchema` computes the
 * headcount total rather than accepting one, so the form cannot disagree with
 * itself. What is missing is the route.
 */
definePageMeta({ middleware: 'staff' })

const permissions = usePermissions()

const canWrite = computed(() =>
  permissions.canAny([
    [COLLECTIONS.attendanceSessions, 'create'],
    [COLLECTIONS.attendanceRecords, 'create'],
  ]),
)
</script>

<template>
  <div>
    <PageHeader
      title="Attendance"
      description="Sunday services, midweek, camps and department sessions."
    >
      <template #actions>
        <PermissionGate :collection="COLLECTIONS.attendanceSessions" action="create">
          <UButton
            label="Capture headcount"
            icon="i-lucide-plus"
            :disabled="!canWrite"
            title="Not wired yet — the capture route lands with the attendance feature"
          />
        </PermissionGate>
      </template>
    </PageHeader>

    <EmptyState
      title="No sessions loaded"
      description="Wired to the auth guard and the capability endpoint. The read and capture routes are not built yet."
    />
  </div>
</template>
