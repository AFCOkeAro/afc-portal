<script setup lang="ts">
import { RESOURCE_KINDS } from '@afc/shared'

/**
 * Resource library (AFC-844): the approved shelf plus the approval queue.
 *
 * Only approved rows render as the library; pending items wait in the
 * queue for a manager (approve/reject). Uploads go to the resources
 * upload endpoint first and the file id rides the create (receipt
 * precedent); links carry their URL. Nothing renders without approval.
 */
interface Props {
  eventId: string
  canManage: boolean
}

const props = defineProps<Props>()

const api = useApi()

interface LibraryItem {
  id: string
  speaker: string | null
  speaker_name: string | null
  title: string
  source_type: string
  kind: string
  url: string | null
  file_id: string | null
  status: string
}

interface SpeakerOption {
  id: string
  name: string
}

const KIND_LABELS: Record<string, string> = {
  document: 'Document',
  spreadsheet: 'Spreadsheet',
  pdf: 'PDF',
  image: 'Image',
  video: 'Video',
  archive: 'Zip',
  other: 'Other',
}

const library = ref<LibraryItem[]>([])
const queue = ref<LibraryItem[]>([])
const libraryPending = ref(false)
const libraryError = ref('')
const speakers = ref<SpeakerOption[]>([])
const newItem = ref({
  title: '',
  kind: 'document',
  source_type: 'link',
  url: '',
  speaker: '',
})
const pickedFile = ref<File | null>(null)
const pickedName = ref('')
const itemSaving = ref(false)
const itemError = ref('')
const actionError = ref('')

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

function itemHref(item: LibraryItem): string {
  if (item.source_type === 'link' && item.url) return item.url
  if (item.source_type === 'upload' && item.file_id)
    return `/api/events/${props.eventId}/resources/file?file=${item.file_id}`
  return '#'
}

async function loadLibrary(): Promise<void> {
  libraryPending.value = true
  libraryError.value = ''
  try {
    const [approved, pending, speakerRows] = await Promise.all([
      api.get<{ data: LibraryItem[] }>(`/api/events/${props.eventId}/resources`),
      props.canManage
        ? api.get<{ data: LibraryItem[] }>(`/api/events/${props.eventId}/resources`, {
            query: { status: 'pending' },
          })
        : Promise.resolve({ data: [] as LibraryItem[] }),
      api
        .get<{ data: Array<{ id: string; name: string }> }>(
          `/api/events/${props.eventId}/speakers`,
        )
        .catch(() => ({ data: [] as Array<{ id: string; name: string }> })),
    ])
    library.value = approved.data ?? []
    queue.value = pending.data ?? []
    speakers.value = (speakerRows.data ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? 'Speaker'),
    }))
  } catch (cause) {
    libraryError.value =
      (cause as { message?: string }).message ?? 'Could not load resources'
  } finally {
    libraryPending.value = false
  }
}

function pickFile(target: EventTarget | null): void {
  const files = (target as HTMLInputElement | null)?.files
  const first = files && files.length > 0 ? files[0] : null
  pickedFile.value = first
  pickedName.value = first?.name ?? ''
}

async function addItem(): Promise<void> {
  if (newItem.value.title.trim() === '') {
    itemError.value = 'Name the resource.'
    return
  }
  if (newItem.value.source_type === 'link' && newItem.value.url.trim() === '') {
    itemError.value = 'Paste the link.'
    return
  }
  if (newItem.value.source_type === 'upload' && !pickedFile.value) {
    itemError.value = 'Choose a file to upload.'
    return
  }
  itemSaving.value = true
  itemError.value = ''
  try {
    let fileId: string | undefined
    if (newItem.value.source_type === 'upload' && pickedFile.value) {
      const uploadBody = new FormData()
      uploadBody.append('file', pickedFile.value)
      try {
        const uploaded = await api.post<{ data: { id: string } }>(
          `/api/events/${props.eventId}/resources/upload`,
          uploadBody,
        )
        fileId = uploaded.data.id
      } catch {
        itemError.value = 'Could not upload that file — check the type and try again'
        return
      }
    }
    await api.post(`/api/events/${props.eventId}/resources`, {
      title: newItem.value.title.trim(),
      source_type: newItem.value.source_type,
      kind: newItem.value.kind,
      ...(newItem.value.source_type === 'link' ? { url: newItem.value.url.trim() } : {}),
      ...(fileId ? { file_id: fileId } : {}),
      ...(newItem.value.speaker === '' ? {} : { speaker: newItem.value.speaker }),
    })
    newItem.value = {
      title: '',
      kind: 'document',
      source_type: 'link',
      url: '',
      speaker: '',
    }
    pickedFile.value = null
    pickedName.value = ''
    await loadLibrary()
  } catch (cause) {
    itemError.value =
      (cause as { message?: string }).message ?? 'Could not share the resource'
  } finally {
    itemSaving.value = false
  }
}

async function decide(id: string, status: 'approved' | 'rejected'): Promise<void> {
  actionError.value = ''
  try {
    await api.patch(`/api/events/resources/${id}`, { status })
    await loadLibrary()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not record the decision'
  }
}

async function removeItem(id: string): Promise<void> {
  actionError.value = ''
  try {
    await api.remove(`/api/events/resources/${id}`)
    await loadLibrary()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not remove the resource'
  }
}

onMounted(() => {
  void loadLibrary()
})
</script>

<template>
  <div>
    <p v-if="libraryPending" class="text-sm text-gray-500">Loading resources…</p>
    <p v-else-if="libraryError !== ''" class="text-sm text-red-600">{{ libraryError }}</p>
    <div v-else-if="library.length === 0">
      <UCard>
        <EmptyState
          title="No resources yet"
          description="Guidelines, handbooks, slides and media appear here once they're shared and approved."
        />
      </UCard>
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="item in library"
        :key="item.id"
        class="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
      >
        <UBadge color="neutral" variant="subtle">{{ kindLabel(item.kind) }}</UBadge>
        <span class="min-w-0 flex-1 truncate font-medium">{{ item.title }}</span>
        <span v-if="item.speaker_name" class="hidden text-xs text-gray-500 sm:inline">
          {{ item.speaker_name }}
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          label="Open"
          :to="itemHref(item)"
          target="_blank"
        />
        <UButton
          v-if="props.canManage"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :aria-label="`Remove ${item.title}`"
          @click="removeItem(item.id)"
        />
      </li>
    </ul>
    <div v-if="props.canManage && queue.length > 0" class="mt-4">
      <h3 class="font-semibold">Awaiting approval ({{ queue.length }})</h3>
      <ul class="mt-2 space-y-2">
        <li
          v-for="item in queue"
          :key="item.id"
          class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900"
        >
          <UBadge color="neutral" variant="subtle">{{ kindLabel(item.kind) }}</UBadge>
          <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
          <span v-if="item.speaker_name" class="hidden text-xs text-gray-500 sm:inline">
            {{ item.speaker_name }}
          </span>
          <UButton
            size="xs"
            color="success"
            variant="soft"
            label="Approve"
            @click="decide(item.id, 'approved')"
          />
          <UButton
            size="xs"
            color="error"
            variant="soft"
            label="Reject"
            @click="decide(item.id, 'rejected')"
          />
        </li>
      </ul>
    </div>
    <p v-if="actionError !== ''" class="mt-3 text-sm text-red-600">{{ actionError }}</p>
    <UCard v-if="props.canManage" class="mt-4">
      <template #header>
        <h3 class="font-semibold">Share a resource</h3>
        <p class="mt-1 text-xs text-gray-500">
          New items open pending — they appear above only after approval.
        </p>
      </template>
      <div class="grid gap-2 sm:grid-cols-2">
        <UFormField label="Title" class="sm:col-span-2">
          <UInput
            v-model="newItem.title"
            placeholder="e.g. Order of service"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Kind">
          <USelect
            v-model="newItem.kind"
            :items="
              RESOURCE_KINDS.map((kind: string) => ({
                label: kindLabel(kind),
                value: kind,
              }))
            "
            class="w-full"
          />
        </UFormField>
        <UFormField label="Source">
          <USelect
            v-model="newItem.source_type"
            :items="[
              { label: 'Link', value: 'link' },
              { label: 'File upload', value: 'upload' },
            ]"
            class="w-full"
          />
        </UFormField>
        <UFormField
          v-if="newItem.source_type === 'link'"
          label="URL"
          class="sm:col-span-2"
        >
          <UInput v-model="newItem.url" placeholder="https://…" class="w-full" />
        </UFormField>
        <UFormField v-else label="File" class="sm:col-span-2">
          <input type="file" class="text-sm" @change="pickFile($event.target)" />
          <p v-if="pickedName !== ''" class="mt-1 text-xs text-gray-500">
            {{ pickedName }}
          </p>
        </UFormField>
        <UFormField label="Shared by (speaker)" class="sm:col-span-2">
          <USelect
            v-model="newItem.speaker"
            :items="[
              { label: 'No speaker', value: '' },
              ...speakers.map((row: SpeakerOption) => ({
                label: row.name,
                value: row.id,
              })),
            ]"
            class="w-full"
          />
        </UFormField>
      </div>
      <UButton
        class="mt-3"
        label="Share resource"
        icon="i-lucide-plus"
        :loading="itemSaving"
        @click="addItem"
      />
      <p v-if="itemError !== ''" class="mt-2 text-sm text-red-600">{{ itemError }}</p>
    </UCard>
  </div>
</template>
