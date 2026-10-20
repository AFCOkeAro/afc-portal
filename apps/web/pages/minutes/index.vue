<script setup lang="ts">
definePageMeta({ middleware: 'staff' })

const api = useApi()
const { data, pending } = await useAsyncData('minutes-list', () =>
  api.get<{ data: Record<string, unknown>[] }>('/api/minutes'),
)
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-8">
    <h1 class="text-2xl font-semibold">Minutes</h1>
    <p class="mt-2 text-sm text-gray-600">
      Minutes attach a file and attendees; writes are area-scoped per the matrix.
    </p>
    <p v-if="pending" class="mt-4">Loading…</p>
    <table v-else class="mt-4 w-full text-sm">
      <thead>
        <tr class="text-left">
          <th>Title</th>
          <th>Meeting date</th>
          <th>Status</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in data?.data ?? []" :key="String(row.id)" class="border-t">
          <td class="py-2 font-medium">{{ row.title }}</td>
          <td>{{ row.meeting_date }}</td>
          <td>{{ row.status }}</td>
          <td>
            <NuxtLink :to="`/minutes/${String(row.id)}`" class="text-blue-600"
              >Open</NuxtLink
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
