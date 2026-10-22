<script setup lang="ts">
const props = defineProps<{ caseId: string; vowType: string }>()

const api = useApi()

const selectedType = ref(props.vowType === 'A' ? 'A' : 'B')
const vowText = ref('')
const vowError = ref('')

async function preview() {
  vowError.value = ''
  vowText.value = ''
  try {
    const response = await api.get<{
      data: { vow_type: string; text: string }
    }>(`/api/marriage-cases/${props.caseId}/vow?type=${selectedType.value}`)
    vowText.value = response.data.text
    selectedType.value = response.data.vow_type
  } catch (cause) {
    vowError.value = (cause as { message?: string }).message ?? 'The vow did not render'
  }
}

watch(
  () => props.vowType,
  (next: string) => {
    selectedType.value = next === 'A' ? 'A' : 'B'
  },
)
</script>

<template>
  <UCard>
    <template #header>
      <h2 class="font-semibold">Wedding vow</h2>
    </template>
    <div class="grid gap-3">
      <UFormField label="Vow wording (B is the default)">
        <USelect
          v-model="selectedType"
          :items="[
            { label: 'A — the sister is not given away', value: 'A' },
            { label: 'B — the sister is given away (default)', value: 'B' },
          ]"
          class="w-full"
        />
      </UFormField>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          label="Preview with names"
          icon="i-lucide-eye"
          @click="preview"
        />
        <UButton
          :to="`/marriage-cases/${props.caseId}?print=1`"
          target="_blank"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-printer"
          label="Print version"
        />
      </div>
      <UAlert v-if="vowError" color="error" variant="subtle" :title="vowError" />
      <pre
        v-if="vowText"
        class="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200"
        >{{ vowText }}</pre>
      <p v-else class="text-sm text-gray-500">
        Names come from the saved vows or wedding-information form. Fill one of those
        first, then preview.
      </p>
    </div>
  </UCard>
</template>
