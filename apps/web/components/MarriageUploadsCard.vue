<script setup lang="ts">
const props = defineProps<{ caseId: string; linked: Record<string, unknown> }>()

const emit = defineEmits<{ linked: [] }>()

const api = useApi()

const SLOTS = [
  { key: 'consent_brother_file', label: 'Brother consent letter' },
  { key: 'consent_sister_file', label: 'Sister consent letter' },
  { key: 'passport_brother_file', label: 'Brother passports' },
  { key: 'passport_sister_file', label: 'Sister passports' },
  { key: 'lga_certificate_file', label: 'LGA / FG certificate' },
  { key: 'bridal_list_file', label: 'Bridal list' },
  { key: 'marriage_certificate_file', label: 'Scanned marriage certificate' },
  { key: 'couple_photo_file', label: 'Couple photo' },
  { key: 'presentation_photo_file', label: 'Presentation photo' },
] as const

const uploadError = ref('')
const busySlot = ref('')

async function uploadAndLink(slot: string, input: Event) {
  uploadError.value = ''
  const target = input.target as HTMLInputElement | null
  const file = target?.files?.[0]
  if (!file) return
  busySlot.value = slot
  try {
    const body = new FormData()
    body.append('file', file)
    const stored = await api.post<{ data: { id: string } }>(
      '/api/marriage-cases/files',
      body,
    )
    await api.patch(`/api/marriage-cases/${props.caseId}/files`, {
      slot,
      file: stored.data.id,
    })
    emit('linked')
  } catch (cause) {
    uploadError.value =
      (cause as { message?: string }).message ?? 'That upload did not go through'
  } finally {
    busySlot.value = ''
    if (target) target.value = ''
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Uploads</h2>
    </template>
    <p class="mb-3 text-sm text-gray-500">
      Scans and photos travel to the file store first; the case keeps the file reference.
      PDF, JPEG, PNG or WebP, under 10 MB.
    </p>
    <UAlert v-if="uploadError" color="error" variant="subtle" :title="uploadError" />
    <ul class="mt-2 divide-y divide-gray-100 text-sm dark:divide-gray-800">
      <li
        v-for="slot in SLOTS"
        :key="slot.key"
        class="flex items-center justify-between gap-3 py-2"
      >
        <div>
          <p class="font-medium">{{ slot.label }}</p>
          <p class="text-xs text-gray-500">
            {{ props.linked[slot.key] ? 'Linked ✓' : 'Outstanding' }}
          </p>
        </div>
        <label class="cursor-pointer">
          <UButton
            size="xs"
            :color="props.linked[slot.key] ? 'neutral' : 'primary'"
            :variant="props.linked[slot.key] ? 'outline' : 'solid'"
            :label="
              busySlot === slot.key
                ? 'Sending…'
                : props.linked[slot.key]
                  ? 'Replace'
                  : 'Upload'
            "
            icon="i-lucide-upload"
          />
          <input
            type="file"
            class="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            @change="uploadAndLink(slot.key, $event)"
          />
        </label>
      </li>
    </ul>
  </UCard>
</template>
