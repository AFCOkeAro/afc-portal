<script setup lang="ts">
import { COLLECTIONS } from '@afc/shared'

definePageMeta({ middleware: 'staff' })

const sections = [
  {
    to: '/campus/timetable',
    title: 'Timetable & facilitators',
    description:
      'Coaching programmes, weekly slots with clash flags, facilitator registration and call status (US-C1).',
    requires: { collection: COLLECTIONS.coachingTimetable, action: 'read' as const },
    icon: 'i-lucide-calendar-days',
  },
  {
    to: '/campus/attendance',
    title: 'Class attendance',
    description:
      'Mark attendance per class occurrence — re-marking updates the same row (US-C2).',
    requires: {
      collection: COLLECTIONS.coachingClassAttendance,
      action: 'read' as const,
    },
    icon: 'i-lucide-clipboard-check',
  },
  {
    to: '/campus/progress',
    title: 'Progress & reports',
    description: 'Assessments per student with a coordinator CSV export (US-C2).',
    requires: { collection: COLLECTIONS.coachingProgress, action: 'read' as const },
    icon: 'i-lucide-chart-line',
  },
  {
    to: '/campus/results',
    title: 'WAEC / UTME / admission results',
    description:
      'Scores, aggregates and admission outcomes per student, per year (US-C3).',
    requires: { collection: COLLECTIONS.examResults, action: 'read' as const },
    icon: 'i-lucide-award',
  },
  {
    to: '/campus/students',
    title: 'Students, AFCF & NYSC',
    description:
      'Campus-care records: AFCF handshake, AFCMF link, support totals, level progression, check-ups and NYSC deployment (US-C4, US-C5).',
    requires: { collection: COLLECTIONS.campusStudents, action: 'read' as const },
    icon: 'i-lucide-graduation-cap',
  },
]
</script>

<template>
  <div>
    <PageHeader
      title="Campus care"
      description="WAEC/UTME coaching, student care, AFCF handshake, financial support and NYSC — one church database, campus segment."
    />

    <div class="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <PermissionGate
        v-for="section in sections"
        :key="section.to"
        :collection="section.requires.collection"
        :action="section.requires.action"
      >
        <NuxtLink
          :to="section.to"
          class="block rounded-lg border border-gray-200 p-5 transition hover:border-gray-300 hover:shadow-sm dark:border-gray-800"
        >
          <div class="flex items-center gap-2">
            <UIcon :name="section.icon" class="size-5 text-gray-500" />
            <h2 class="font-semibold">{{ section.title }}</h2>
          </div>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
            {{ section.description }}
          </p>
        </NuxtLink>
      </PermissionGate>
    </div>
  </div>
</template>
