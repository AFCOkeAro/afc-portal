<script setup lang="ts">
/**
 * UserPicker (AFC-907): searchable staff-user picker with an inline
 * directory-person fallback.
 *
 * Invited by / Follow-up owner must come from the user list, not free
 * text. When the typed name matches no user, the picker offers to create
 * a directory person instead (people POST) -- creating a real system user
 * from intake is a CTO-level identity decision and stays out of scope.
 * Follow-up owner assignment itself is still verified server-side
 * (validateWelfareOfficer), so picking a name never bypasses the gate.
 */

const props = defineProps<{
  modelValue: string
  displayName?: string
  ariaLabel: string
  allowCreatePerson?: boolean
  branch?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:displayName': [value: string]
}>()

const api = useApi()

interface UserOption {
  id: string
  name: string
  email: string | null
  staff_role: string | null
}

const search = ref('')
const open = ref(false)
const options = ref<UserOption[]>([])
const pending = ref(false)
const selectedLabel = ref('')
const creating = ref(false)
const createError = ref('')

let searchTimer: ReturnType<typeof setTimeout> | undefined

async function runSearch(term: string): Promise<void> {
  pending.value = true
  try {
    const res = await api.get<{ data: UserOption[] }>('/api/users/lookup', {
      query: term.trim() === '' ? {} : { search: term.trim() },
    })
    options.value = res.data ?? []
  } catch {
    options.value = []
  } finally {
    pending.value = false
  }
}

function onSearchTerm(term: string): void {
  search.value = term
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(term), 300)
}

async function resolveLabel(id: string): Promise<void> {
  if (!id) {
    selectedLabel.value = ''
    return
  }
  try {
    const res = await api.get<{ data: UserOption[] }>('/api/users/lookup', {
      query: { id },
    })
    const found = (res.data ?? [])[0]
    selectedLabel.value = found?.name ?? ''
    emit('update:displayName', selectedLabel.value)
  } catch {
    selectedLabel.value = ''
  }
}

watch(
  () => props.displayName,
  (label: string | undefined) => {
    if (label) selectedLabel.value = label
  },
  { immediate: true },
)

watch(
  () => props.modelValue,
  (id: string) => {
    if (id && !selectedLabel.value) void resolveLabel(id)
    if (!id) selectedLabel.value = ''
  },
  { immediate: true },
)

function pick(option: UserOption): void {
  emit('update:modelValue', option.id)
  selectedLabel.value = option.name
  emit('update:displayName', option.name)
  search.value = ''
  open.value = false
}

function clear(): void {
  emit('update:modelValue', '')
  selectedLabel.value = ''
  emit('update:displayName', '')
  search.value = ''
}

function splitName(raw: string): { first: string; last: string } {
  const parts = raw.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: (parts.slice(1).join(' ') || parts[0]) ?? '' }
}

async function createPerson(): Promise<void> {
  createError.value = ''
  const { first, last } = splitName(search.value)
  if (!first) return
  creating.value = true
  try {
    const created = await api.post<{ data: { id: string } }>('/api/people', {
      first_name: first,
      last_name: last,
      ...(props.branch ? { branch: props.branch } : {}),
    })
    const id = String(created.data.id)
    emit('update:modelValue', id)
    const label = `${first} ${last}`.trim()
    selectedLabel.value = label
    emit('update:displayName', label)
    search.value = ''
    open.value = false
  } catch (cause) {
    createError.value =
      (cause as { message?: string }).message ?? 'Could not create that person'
  } finally {
    creating.value = false
  }
}

function onFocus(): void {
  open.value = true
  if (options.value.length === 0 && !pending.value) void runSearch(search.value)
}
</script>

<template>
  <div>
    <div v-if="modelValue && selectedLabel" class="flex items-center gap-2">
      <span class="min-w-0 flex-1 truncate text-sm">{{ selectedLabel }}</span>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-x"
        :aria-label="`Clear ${ariaLabel}`"
        @click="clear"
      />
    </div>
    <div v-else class="relative">
      <UInput
        :model-value="search"
        :placeholder="`Type a name to search ${ariaLabel.toLowerCase()}…`"
        :aria-label="ariaLabel"
        class="w-full"
        @focus="onFocus"
        @update:model-value="onSearchTerm(String($event ?? ''))"
      />
      <div
        v-if="open"
        class="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900"
      >
        <p v-if="pending" class="px-3 py-2 text-sm text-gray-500">Searching…</p>
        <template v-else>
          <button
            v-for="option in options"
            :key="option.id"
            type="button"
            class="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
            @click="pick(option)"
          >
            <span class="font-medium">{{ option.name }}</span>
            <span
              v-if="option.staff_role"
              class="ml-2 text-xs text-gray-500 dark:text-gray-400"
            >
              {{ option.staff_role.replaceAll('_', ' ') }}
            </span>
          </button>
          <p
            v-if="options.length === 0 && search.trim() === ''"
            class="px-3 py-2 text-sm text-gray-500"
          >
            Start typing to search users.
          </p>
          <p
            v-if="options.length === 0 && search.trim() !== ''"
            class="px-3 py-2 text-sm text-gray-500"
          >
            No users match "{{ search.trim() }}".
          </p>
        </template>
        <div
          v-if="allowCreatePerson && search.trim() !== ''"
          class="border-t border-gray-200 px-3 py-2 dark:border-gray-800"
        >
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-lucide-user-plus"
            :loading="creating"
            :label="'Add as directory person'"
            :title="'Create ' + search.trim() + ' as a directory person record'"
            @click="createPerson"
          />
          <p v-if="createError" class="mt-1 text-xs text-red-600">{{ createError }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
