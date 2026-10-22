<script setup lang="ts">
/**
 * Roles & permissions admin (AFC-669): modules, bundles, custom roles and
 * assignment — replacing the old redirect-to-Directus stub.
 *
 * - Modules: every portal section with its route, collections and the roles
 *   that can see it (computed server-side; the UI never imports the matrix).
 * - Bundles: assignable presets (a staff role + scope contract). "Assign
 *   people" jumps to the People tab with the bundle preselected.
 * - Roles: Directus roles; custom roles can be created and given
 *   collection+action permissions here. Built-ins are read-only — their
 *   grants live in role-matrix.ts in code.
 * - People: search staff, set staff role plus branch/zone/area scope links.
 *
 * Data paths are area-admin-only server routes; the page itself stays behind
 * the staff middleware like every other staff page.
 */

const api = useApi()

type TabId = 'modules' | 'bundles' | 'roles' | 'people'
const tab = ref<TabId>('modules')
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'modules', label: 'Modules', icon: 'i-lucide-layout-grid' },
  { id: 'bundles', label: 'Bundles', icon: 'i-lucide-package' },
  { id: 'roles', label: 'Roles', icon: 'i-lucide-shield-check' },
  { id: 'people', label: 'People', icon: 'i-lucide-users' },
]

interface ModuleRow {
  key: string
  label: string
  to: string
  icon: string
  collections: string[]
  roles: string[]
}
interface MatrixRole {
  staffRole: string
  grants: { collection: string; action: string; scope: string }[]
}
interface BundleRow {
  id: string
  label: string
  description: string
  staffRole: string
  scope: string
  modules: ModuleRow[]
}
interface AdminRole {
  id: string
  name: string
  description: string | null
  builtIn: boolean
}
interface RolePermission {
  id: string
  collection: string
  action: string
  filter: Record<string, unknown> | null
}
interface AdminUser {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  staff_role: string | null
  status: string
  branch: string | null
  zone: string | null
  area: string | null
}
interface ZoneRow {
  id: string
  name: string
}
interface BranchRow {
  id: string
  name: string
  zone?: string | null
  area?: string | null
}

const ACTIONS = ['create', 'read', 'update', 'delete'] as const

type PermissionActionOption = (typeof ACTIONS)[number]

const actionOptions = computed(() =>
  ACTIONS.map((action: PermissionActionOption) => ({ label: action, value: action })),
)

const loading = ref(true)
const loadError = ref('')
const modules = ref<ModuleRow[]>([])
const matrixRoles = ref<MatrixRole[]>([])
const bundles = ref<BundleRow[]>([])
const roles = ref<AdminRole[]>([])
const actionError = ref('')

const collections = computed(() => {
  const set = new Set<string>()
  for (const module of modules.value) for (const name of module.collections) set.add(name)
  return [...set].sort()
})

const collectionOptions = computed(() => [
  { label: 'users (own profile)', value: 'users' },
  ...collections.value.map((name: string) => ({ label: name, value: name })),
])

const roleOptions = computed(() =>
  roles.value.map((role: AdminRole) => ({
    label: `${role.name}${role.builtIn ? ' (built-in)' : ''}`,
    value: role.name,
  })),
)

async function reloadAll(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    const [matrix, bundleRes, roleRes] = await Promise.all([
      api.get<{ roles: MatrixRole[]; modules: ModuleRow[] }>('/api/admin/roles-matrix'),
      api.get<{ data: BundleRow[] }>('/api/admin/bundles'),
      api.get<{ data: AdminRole[] }>('/api/admin/roles'),
    ])
    matrixRoles.value = matrix.roles
    modules.value = matrix.modules
    bundles.value = bundleRes.data
    roles.value = roleRes.data
  } catch (cause) {
    loadError.value =
      (cause as { message?: string }).message ?? 'Could not load the admin data'
  } finally {
    loading.value = false
  }
}

await useAsyncData('admin-access-overview', () => reloadAll())

/* ---------------- Roles tab ---------------- */
const selectedRoleId = ref('')
const selectedRole = computed(
  () => roles.value.find((role: AdminRole) => role.id === selectedRoleId.value) ?? null,
)

function selectRole(id: string): void {
  selectedRoleId.value = id
  void loadRolePermissions()
}
const rolePermissions = ref<RolePermission[]>([])
const filteredRolePermissions = computed(() =>
  rolePermissions.value.filter((entry: RolePermission) => entry.filter !== null),
)
const rolePermsPending = ref(false)
const newRole = ref({ name: '', description: '' })
const newRoleError = ref('')
const permForm = ref({ collection: '', action: 'read', filter: '' })
const permFormError = ref('')

const permKey = (collection: string, action: string): string | null => {
  const found = rolePermissions.value.find(
    (perm: RolePermission) => perm.collection === collection && perm.action === action,
  )
  return found ? found.id : null
}

async function loadRolePermissions(): Promise<void> {
  if (selectedRoleId.value === '') {
    rolePermissions.value = []
    return
  }
  rolePermsPending.value = true
  try {
    const res = await api.get<{ data: RolePermission[] }>(
      `/api/admin/roles/${selectedRoleId.value}/permissions`,
    )
    rolePermissions.value = res.data
    permForm.value.collection = collections.value[0] ?? ''
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not load permissions'
  } finally {
    rolePermsPending.value = false
  }
}

async function createRole(): Promise<void> {
  newRoleError.value = ''
  try {
    await api.post('/api/admin/roles', {
      name: newRole.value.name.trim(),
      description: newRole.value.description.trim(),
    })
    newRole.value = { name: '', description: '' }
    const res = await api.get<{ data: AdminRole[] }>('/api/admin/roles')
    roles.value = res.data
  } catch (cause) {
    newRoleError.value =
      (cause as { message?: string }).message ?? 'Could not create the role'
  }
}

async function togglePermission(collection: string, action: string): Promise<void> {
  if (!selectedRole.value || selectedRole.value.builtIn) return
  actionError.value = ''
  try {
    const existing = permKey(collection, action)
    if (existing) {
      await api.remove(`/api/admin/permissions/${existing}`)
    } else {
      await api.post(`/api/admin/roles/${selectedRoleId.value}/permissions`, {
        collection,
        action,
      })
    }
    await loadRolePermissions()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update the permission'
  }
}

async function addPermission(): Promise<void> {
  if (!selectedRole.value || selectedRole.value.builtIn) return
  permFormError.value = ''
  actionError.value = ''
  let filter: Record<string, unknown> | undefined
  if (permForm.value.filter.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(permForm.value.filter)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('not an object')
      }
      filter = parsed as Record<string, unknown>
    } catch {
      permFormError.value = 'Row filter must be a JSON object'
      return
    }
  }
  try {
    await api.post(`/api/admin/roles/${selectedRoleId.value}/permissions`, {
      collection: permForm.value.collection,
      action: permForm.value.action,
      ...(filter === undefined ? {} : { filter }),
    })
    permForm.value.filter = ''
    await loadRolePermissions()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not add the permission'
  }
}

/* ---------------- People tab ---------------- */
const userSearch = ref('')
const users = ref<AdminUser[]>([])
const usersPending = ref(false)
const pendingBundle = ref<BundleRow | null>(null)
const editing = ref<AdminUser | null>(null)
const editForm = ref({ staff_role: '', branch: '', zone: '' })
const editError = ref('')
const savingUser = ref(false)
const zones = ref<ZoneRow[]>([])
const branchesFull = ref<BranchRow[]>([])

const branchItems = computed(() => [
  { label: 'None', value: '' },
  ...branchesFull.value.map((row: BranchRow) => ({ label: row.name, value: row.id })),
])
const zoneItems = computed(() => [
  { label: 'None', value: '' },
  ...zones.value.map((row: ZoneRow) => ({ label: row.name, value: row.id })),
])
const editAreaPreview = computed(() => {
  const branch = branchesFull.value.find(
    (row: BranchRow) => row.id === editForm.value.branch,
  )
  return branch?.area ?? null
})

async function searchUsers(): Promise<void> {
  usersPending.value = true
  try {
    const res = await api.get<{ data: AdminUser[] }>('/api/admin/users', {
      query: userSearch.value.trim() === '' ? {} : { search: userSearch.value.trim() },
    })
    users.value = res.data
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not search users'
  } finally {
    usersPending.value = false
  }
}

function displayName(user: AdminUser): string {
  const full = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return full === '' ? user.email : full
}

function openEditor(user: AdminUser): void {
  editing.value = user
  editError.value = ''
  editForm.value = {
    staff_role: pendingBundle.value?.staffRole ?? user.staff_role ?? '',
    branch: user.branch ?? '',
    zone: user.zone ?? '',
  }
}

function assignBundle(bundle: BundleRow): void {
  pendingBundle.value = bundle
  tab.value = 'people'
}

async function saveUser(): Promise<void> {
  if (!editing.value) return
  editError.value = ''
  savingUser.value = true
  try {
    const branch = branchesFull.value.find(
      (row: BranchRow) => row.id === editForm.value.branch,
    )
    await api.patch(`/api/admin/users/${editing.value.id}`, {
      staff_role: editForm.value.staff_role,
      branch: editForm.value.branch === '' ? null : editForm.value.branch,
      zone: editForm.value.zone === '' ? null : editForm.value.zone,
      area: branch?.area ?? null,
    })
    editing.value = null
    await searchUsers()
  } catch (cause) {
    editError.value = (cause as { message?: string }).message ?? 'Could not save the user'
  } finally {
    savingUser.value = false
  }
}

await useAsyncData('admin-zones-branches', async () => {
  const [zoneRes, branchRes] = await Promise.all([
    api.get<ZoneRow[]>('/api/zones'),
    api.get<BranchRow[]>('/api/branches', { query: { limit: -1 } }),
  ])
  zones.value = Array.isArray(zoneRes) ? zoneRes : []
  branchesFull.value = Array.isArray(branchRes)
    ? branchRes
    : ((branchRes as unknown as { data: BranchRow[] }).data ?? [])
})
</script>

<template>
  <div>
    <PageHeader
      title="Roles & permissions"
      description="Modules, assignable bundles, custom roles and who holds them."
    />

    <div v-if="loading" class="flex justify-center py-16">
      <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-gray-400" />
    </div>

    <UAlert
      v-else-if="loadError !== ''"
      color="error"
      variant="subtle"
      title="Could not load the admin data"
      :description="loadError"
    />

    <template v-else>
      <nav aria-label="Access admin sections" class="mb-4">
        <div
          class="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
        >
          <UButton
            v-for="entry in TABS"
            :key="entry.id"
            :icon="entry.icon"
            :label="entry.label"
            size="xs"
            :color="tab === entry.id ? 'primary' : 'neutral'"
            :variant="tab === entry.id ? 'solid' : 'ghost'"
            @click="tab = entry.id"
          />
        </div>
      </nav>

      <UAlert
        v-if="actionError !== ''"
        class="mb-4"
        color="error"
        variant="subtle"
        title="Action failed"
        :description="actionError"
      />

      <!-- MODULES -->
      <UCard v-if="tab === 'modules'">
        <template #header>
          <h2 class="font-semibold">Modules</h2>
          <p class="mt-1 text-sm text-gray-500">
            Every sidebar section is a module. Visibility follows capability grants — a
            role that holds no grant on a module's collections never sees it.
          </p>
        </template>
        <div class="space-y-4">
          <section
            v-for="module in modules"
            :key="module.key"
            class="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
          >
            <div class="flex flex-wrap items-center gap-2">
              <UIcon :name="module.icon" class="size-4 text-primary-500" />
              <h3 class="font-semibold text-gray-900 dark:text-white">
                {{ module.label }}
              </h3>
              <span class="font-mono text-xs text-gray-400">{{ module.to }}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <UBadge
                v-for="collection in module.collections"
                :key="collection"
                color="neutral"
                variant="subtle"
                size="xs"
              >
                {{ collection }}
              </UBadge>
            </div>
            <p class="mt-2 text-xs text-gray-500">
              Visible to:
              <span v-if="module.roles.length === 0" class="italic"
                >no built-in role</span
              >
              <UBadge
                v-for="role in module.roles"
                :key="role"
                color="primary"
                variant="subtle"
                size="xs"
                class="mr-1"
              >
                {{ role }}
              </UBadge>
            </p>
          </section>
        </div>
      </UCard>

      <!-- BUNDLES -->
      <div v-if="tab === 'bundles'" class="grid gap-3 md:grid-cols-2">
        <UCard v-for="bundle in bundles" :key="bundle.id">
          <template #header>
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">{{ bundle.label }}</h2>
              <UBadge color="primary" variant="subtle" size="xs">{{
                bundle.staffRole
              }}</UBadge>
            </div>
            <p class="mt-1 text-sm text-gray-500">{{ bundle.description }}</p>
          </template>
          <p class="text-xs text-gray-500">
            <span class="font-semibold uppercase tracking-wide">Scope — </span
            >{{ bundle.scope }}
          </p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <UBadge
              v-for="module in bundle.modules"
              :key="module.key"
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ module.label }}
            </UBadge>
          </div>
          <template #footer>
            <UButton
              label="Assign people"
              icon="i-lucide-users"
              size="xs"
              color="neutral"
              variant="outline"
              @click="assignBundle(bundle)"
            />
          </template>
        </UCard>
      </div>

      <!-- ROLES -->
      <div v-if="tab === 'roles'" class="grid gap-3 lg:grid-cols-[280px_1fr]">
        <UCard>
          <template #header>
            <h2 class="font-semibold">Roles</h2>
          </template>
          <ul class="space-y-1">
            <li v-for="role in roles" :key="role.id">
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                :class="
                  selectedRoleId === role.id
                    ? 'bg-gray-100 font-medium dark:bg-gray-800'
                    : ''
                "
                @click="selectRole(role.id)"
              >
                <span class="min-w-0 flex-1 truncate">{{ role.name }}</span>
                <UBadge
                  :color="role.builtIn ? 'neutral' : 'success'"
                  variant="subtle"
                  size="xs"
                >
                  {{ role.builtIn ? 'built-in' : 'custom' }}
                </UBadge>
              </button>
            </li>
          </ul>
          <div class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800">
            <h3 class="text-sm font-semibold">New custom role</h3>
            <UFormField label="Name (lowercase, digits, underscores)" class="mt-2">
              <UInput
                v-model="newRole.name"
                placeholder="e.g. zone_viewer"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Description" class="mt-2">
              <UInput
                v-model="newRole.description"
                placeholder="What is it for?"
                class="w-full"
              />
            </UFormField>
            <p v-if="newRoleError !== ''" class="mt-2 text-xs text-red-600">
              {{ newRoleError }}
            </p>
            <UButton
              label="Create role"
              icon="i-lucide-plus"
              size="xs"
              class="mt-2"
              @click="createRole()"
            />
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">
              {{ selectedRole ? `Permissions — ${selectedRole.name}` : 'Permissions' }}
            </h2>
            <p class="mt-1 text-sm text-gray-500">
              {{
                selectedRole?.builtIn
                  ? 'Built-in roles are governed by role-matrix.ts in code — read-only here.'
                  : 'Toggle a collection + action to grant or revoke it. Changes apply to the next request (60s grant cache).'
              }}
            </p>
          </template>
          <p v-if="selectedRoleId === ''" class="text-sm text-gray-500">
            Select a role on the left.
          </p>
          <div v-else-if="rolePermsPending" class="flex justify-center py-8">
            <UIcon
              name="i-lucide-loader-circle"
              class="size-6 animate-spin text-gray-400"
            />
          </div>
          <div v-else class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead>
                <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th class="px-3 py-2 font-medium">Collection</th>
                  <th
                    v-for="action in ACTIONS"
                    :key="action"
                    class="px-3 py-2 text-center font-medium"
                  >
                    {{ action }}
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                <tr v-for="collection in collections" :key="collection">
                  <td class="px-3 py-2 font-mono text-xs">{{ collection }}</td>
                  <td
                    v-for="action in ACTIONS"
                    :key="action"
                    class="px-3 py-2 text-center"
                  >
                    <UButton
                      :icon="
                        permKey(collection, action) ? 'i-lucide-check' : 'i-lucide-minus'
                      "
                      :color="permKey(collection, action) ? 'success' : 'neutral'"
                      variant="ghost"
                      size="xs"
                      :disabled="!selectedRole || selectedRole.builtIn"
                      :aria-label="`${action} ${collection}`"
                      @click="togglePermission(collection, action)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="selectedRole && !selectedRole.builtIn"
              class="mt-4 border-t border-gray-200 pt-4 dark:border-gray-800"
            >
              <h3 class="text-sm font-semibold">Row filters</h3>
              <p class="mt-1 text-xs text-gray-500">
                Permissions carrying a Directus row filter narrow to matching rows instead
                of the whole collection.
              </p>
              <ul class="mt-2 space-y-1 text-xs">
                <li
                  v-for="perm in filteredRolePermissions"
                  :key="perm.id"
                  class="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 font-mono dark:bg-gray-900"
                >
                  <span>{{ perm.collection }}:{{ perm.action }}</span>
                  <span class="text-gray-500">{{ JSON.stringify(perm.filter) }}</span>
                  <UButton
                    icon="i-lucide-x"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="ml-auto"
                    :aria-label="`Remove ${perm.collection} ${perm.action} filter`"
                    @click="togglePermission(perm.collection, perm.action)"
                  />
                </li>
                <li v-if="filteredRolePermissions.length === 0" class="text-gray-400">
                  No row filters — every grant covers its whole collection.
                </li>
              </ul>
              <h3 class="mt-4 text-sm font-semibold">Add permission</h3>
              <div class="mt-2 grid gap-2 sm:grid-cols-[1fr_140px]">
                <UFormField label="Collection">
                  <USelect
                    v-model="permForm.collection"
                    :items="collectionOptions"
                    class="w-full"
                  />
                </UFormField>
                <UFormField label="Action">
                  <USelect
                    v-model="permForm.action"
                    :items="actionOptions"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <UFormField label="Row filter JSON (optional)" class="mt-2">
                <UInput
                  v-model="permForm.filter"
                  placeholder='e.g. {"zone":{"_eq":"…"}}'
                  class="w-full font-mono"
                />
              </UFormField>
              <p v-if="permFormError !== ''" class="mt-2 text-xs text-red-600">
                {{ permFormError }}
              </p>
              <UButton
                label="Add permission"
                icon="i-lucide-plus"
                size="xs"
                class="mt-2"
                @click="addPermission()"
              />
            </div>
          </div>
        </UCard>
      </div>

      <!-- PEOPLE -->
      <UCard v-if="tab === 'people'">
        <template #header>
          <h2 class="font-semibold">People</h2>
          <p class="mt-1 text-sm text-gray-500">
            Assign a role bundle to a group of people. Scope links (branch / zone) decide
            which rows they see.
          </p>
        </template>
        <div
          v-if="pendingBundle"
          class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm dark:border-primary-900 dark:bg-primary-950/40"
        >
          <UIcon name="i-lucide-package" class="size-4 text-primary-500" />
          <span>
            Assigning bundle <strong>{{ pendingBundle.label }}</strong> (role
            <span class="font-mono text-xs">{{ pendingBundle.staffRole }}</span
            >).
          </span>
          <UButton
            label="Clear"
            color="neutral"
            variant="ghost"
            size="xs"
            class="ml-auto"
            @click="pendingBundle = null"
          />
        </div>
        <div class="flex gap-2">
          <UInput
            v-model="userSearch"
            placeholder="Search by name or email…"
            icon="i-lucide-search"
            class="max-w-sm flex-1"
            @keyup.enter="searchUsers()"
          />
          <UButton label="Search" icon="i-lucide-search" @click="searchUsers()" />
        </div>
        <div v-if="usersPending" class="flex justify-center py-8">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>
        <div v-else-if="users.length > 0" class="mt-4 overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                <th class="px-3 py-2 font-medium">Person</th>
                <th class="px-3 py-2 font-medium">Role</th>
                <th class="px-3 py-2 font-medium">Status</th>
                <th class="px-3 py-2"><span class="sr-only">Edit</span></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
              <tr v-for="user in users" :key="user.id">
                <td class="px-3 py-2">
                  <p class="font-medium text-gray-900 dark:text-white">
                    {{ displayName(user) }}
                  </p>
                  <p class="font-mono text-xs text-gray-400">{{ user.email }}</p>
                </td>
                <td class="px-3 py-2">
                  <UBadge color="neutral" variant="subtle">{{
                    user.staff_role ?? '—'
                  }}</UBadge>
                </td>
                <td class="px-3 py-2 text-gray-500">{{ user.status }}</td>
                <td class="px-3 py-2 text-right">
                  <UButton
                    label="Edit"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="openEditor(user)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UCard>

      <UModal
        :open="editing !== null"
        title="Assign role & scope"
        :description="editing ? `For ${editing.email}` : ''"
        @update:open="editing = $event ? editing : null"
      >
        <template #body>
          <div class="grid gap-3">
            <UFormField label="Staff role">
              <USelect
                v-model="editForm.staff_role"
                :items="roleOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Branch">
              <EntitySelect
                v-model="editForm.branch"
                :items="branchItems"
                placeholder="No branch"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Zone">
              <EntitySelect
                v-model="editForm.zone"
                :items="zoneItems"
                placeholder="No zone"
                class="w-full"
              />
            </UFormField>
            <p class="text-xs text-gray-500">
              Area link follows the branch automatically
              <span v-if="editAreaPreview" class="font-mono">({{ editAreaPreview }})</span
              >. Area and super admins see everything regardless of links.
            </p>
            <p v-if="editError !== ''" class="text-xs text-red-600">{{ editError }}</p>
            <div class="flex justify-end gap-2">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                @click="editing = null"
              />
              <UButton
                label="Save assignment"
                icon="i-lucide-check"
                :loading="savingUser"
                @click="saveUser()"
              />
            </div>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
