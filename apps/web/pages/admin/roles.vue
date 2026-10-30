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
 * - People: every holder of a system role out of the box, search to narrow,
 *   set staff role plus branch/zone/area scope links, and add a new person
 *   with a permission level and coverage (area/zone/branch/AVS/BSC; modules
 *   are derived from the role and previewed read-only).
 *
 * Data paths are area-admin-only server routes; the page itself stays behind
 * the staff middleware like every other staff page.
 */

const api = useApi()
const { user: sessionUser } = useAuth()
/** Super admins may reshape built-in roles; everyone else sees them read-only. */
const isSuperAdmin = computed(() => sessionUser.value?.staffRole === 'super_admin')

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
  collection: string
  action: string
  /** Effective grant state after matrix + stored + overrides. */
  granted: boolean
  /** Where the grant comes from: matrix, stored, override, revoked. */
  sources: string[]
  /** Directus row id when a stored row confers it (custom delete path). */
  ref: string | null
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
interface AreaRow {
  id: string
  name: string
  code: string
}
interface AvsRow {
  id: string
  name: string
  branch: string | null
}
interface BscRow {
  id: string
  name: string
  parent_branch: string | null
  zone: string | null
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

const grantOf = (collection: string, action: string): RolePermission | undefined =>
  rolePermissions.value.find(
    (perm: RolePermission) => perm.collection === collection && perm.action === action,
  )
const isGranted = (collection: string, action: string): boolean =>
  grantOf(collection, action)?.granted ?? false
const grantTitle = (collection: string, action: string): string => {
  const entry = grantOf(collection, action)
  if (!entry?.granted) return `${action} ${collection} — not granted`
  const via = entry.sources.length > 0 ? ` (via ${entry.sources.join('+')})` : ''
  return `${action} ${collection} — granted${via}`
}
const canEditRole = computed(
  () => !!selectedRole.value && (!selectedRole.value.builtIn || isSuperAdmin.value),
)

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
  const role = selectedRole.value
  if (!role || (role.builtIn && !isSuperAdmin.value)) return
  actionError.value = ''
  try {
    const entry = grantOf(collection, action)
    if (entry?.granted) {
      if (role.builtIn) {
        // Built-ins: revoke (snapshot + delete Directus rows + override row).
        await api.post(`/api/admin/roles/${role.id}/revocations`, { collection, action })
      } else if (entry.ref) {
        await api.remove(`/api/admin/permissions/${entry.ref}`)
      } else {
        return
      }
    } else {
      // Grant (built-ins included for super admins; revokes are honoured first server-side).
      await api.post(`/api/admin/roles/${role.id}/permissions`, { collection, action })
    }
    await loadRolePermissions()
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not update the permission'
  }
}

async function addPermission(): Promise<void> {
  if (!selectedRole.value || (selectedRole.value.builtIn && !isSuperAdmin.value)) return
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
/* AFC-914: coverage lookups loaded lazily on first People visit. */
const areas = ref<AreaRow[]>([])
const avsLocations = ref<AvsRow[]>([])
const bscs = ref<BscRow[]>([])
const peopleLookupsPending = ref(false)
const holdersLoaded = ref(false)
const adding = ref(false)
const savingNewUser = ref(false)
const addError = ref('')
const addForm = ref({
  first_name: '',
  last_name: '',
  email: '',
  staff_role: '',
  area: '',
  zone: '',
  branch: '',
  avs_location: '',
  bsc: '',
})

const branchItems = computed(() => [
  { label: 'None', value: '' },
  ...branchesFull.value.map((row: BranchRow) => ({ label: row.name, value: row.id })),
])
const zoneItems = computed(() => [
  { label: 'None', value: '' },
  ...zones.value.map((row: ZoneRow) => ({ label: row.name, value: row.id })),
])
const areaItems = computed(() => [
  { label: 'None', value: '' },
  ...areas.value.map((row: AreaRow) => ({ label: row.name, value: row.id })),
])
const avsItems = computed(() => [
  { label: 'None', value: '' },
  ...avsLocations.value.map((row: AvsRow) => {
    const branch = branchesFull.value.find((b: BranchRow) => b.id === row.branch)
    return {
      label: branch ? `${row.name} (${branch.name})` : row.name,
      value: row.id,
    }
  }),
])
const bscItems = computed(() => [
  { label: 'None', value: '' },
  ...bscs.value.map((row: BscRow) => {
    const branch = branchesFull.value.find((b: BranchRow) => b.id === row.parent_branch)
    return {
      label: branch ? `${row.name} (${branch.name})` : row.name,
      value: row.id,
    }
  }),
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

/** AFC-914: human-readable coverage for the holders table. */
function coverageLabel(user: AdminUser): string {
  const branch = branchesFull.value.find((row: BranchRow) => row.id === user.branch)
  if (branch) return branch.name
  const zone = zones.value.find((row: ZoneRow) => row.id === user.zone)
  if (zone) return zone.name
  const area = areas.value.find((row: AreaRow) => row.id === user.area)
  if (area) return area.name
  return '—'
}

/* AFC-914: AVS/BSC coverage resolves to the parent branch scope — both
 * collections hang off a branch — so the branches derived here must agree
 * with each other and with any explicit branch pick. */
const addDerivedBranches = computed(() => {
  const found: string[] = []
  const avs = avsLocations.value.find(
    (row: AvsRow) => row.id === addForm.value.avs_location,
  )
  if (avs?.branch) found.push(avs.branch)
  const bsc = bscs.value.find((row: BscRow) => row.id === addForm.value.bsc)
  if (bsc?.parent_branch) found.push(bsc.parent_branch)
  return [...new Set(found)]
})
const addCoverageConflict = computed(
  () =>
    (addForm.value.branch !== '' &&
      addDerivedBranches.value.length > 0 &&
      !addDerivedBranches.value.includes(addForm.value.branch)) ||
    addDerivedBranches.value.length > 1,
)
const addBranchPreview = computed(() => {
  const id =
    addForm.value.branch !== ''
      ? addForm.value.branch
      : (addDerivedBranches.value[0] ?? '')
  return branchesFull.value.find((row: BranchRow) => row.id === id)?.name ?? null
})
/* AFC-914: modules are derived from the permission level, never stored —
 * preview which modules the picked role can see. */
const addModules = computed(() => {
  const role = addForm.value.staff_role
  if (role === '') return []
  const bundle = bundles.value.find((row: BundleRow) => row.staffRole === role)
  if (bundle) return bundle.modules
  return modules.value.filter((module: ModuleRow) => module.roles.includes(role))
})

/* AFC-914: first People visit lists every role holder plus the coverage
 * pickers (areas, AVS locations, BSCs). Zones/branches load at page setup
 * as before; search narrows afterwards without refetching lookups. */
async function ensurePeopleLookups(): Promise<void> {
  if (peopleLookupsPending.value) return
  peopleLookupsPending.value = true
  try {
    const jobs: Array<Promise<void>> = []
    if (!holdersLoaded.value) {
      jobs.push(
        (async () => {
          await searchUsers()
          holdersLoaded.value = true
        })(),
      )
    }
    if (areas.value.length === 0) {
      jobs.push(
        (async () => {
          const res = await api.get<AreaRow[]>('/api/areas')
          areas.value = Array.isArray(res) ? res : []
        })(),
      )
    }
    if (avsLocations.value.length === 0) {
      jobs.push(
        (async () => {
          const res = await api.get<{ data: AvsRow[] }>('/api/outreach-locations')
          avsLocations.value = Array.isArray(res)
            ? res
            : ((res as unknown as { data: AvsRow[] }).data ?? [])
        })(),
      )
    }
    if (bscs.value.length === 0) {
      jobs.push(
        (async () => {
          const res = await api.get<BscRow[]>('/api/bscs')
          bscs.value = Array.isArray(res) ? res : []
        })(),
      )
    }
    await Promise.all(jobs)
  } catch (cause) {
    actionError.value =
      (cause as { message?: string }).message ?? 'Could not load people lookups'
  } finally {
    peopleLookupsPending.value = false
  }
}

watch(tab, (next: TabId) => {
  if (next === 'people') void ensurePeopleLookups()
})

function openAdder(): void {
  addError.value = ''
  addForm.value = {
    first_name: '',
    last_name: '',
    email: '',
    staff_role: pendingBundle.value?.staffRole ?? '',
    area: '',
    zone: '',
    branch: '',
    avs_location: '',
    bsc: '',
  }
  adding.value = true
}

async function createUser(): Promise<void> {
  addError.value = ''
  if (addCoverageConflict.value) {
    addError.value = 'Coverage branches disagree — pick one branch'
    return
  }
  savingNewUser.value = true
  try {
    await api.post('/api/admin/users', {
      first_name:
        addForm.value.first_name.trim() === '' ? null : addForm.value.first_name.trim(),
      last_name:
        addForm.value.last_name.trim() === '' ? null : addForm.value.last_name.trim(),
      email: addForm.value.email.trim(),
      staff_role: addForm.value.staff_role,
      branch: addForm.value.branch === '' ? null : addForm.value.branch,
      zone: addForm.value.zone === '' ? null : addForm.value.zone,
      area: addForm.value.area === '' ? null : addForm.value.area,
      avs_location: addForm.value.avs_location === '' ? null : addForm.value.avs_location,
      bsc: addForm.value.bsc === '' ? null : addForm.value.bsc,
    })
    adding.value = false
    holdersLoaded.value = true
    userSearch.value = ''
    await searchUsers()
  } catch (cause) {
    addError.value = (cause as { message?: string }).message ?? 'Could not add the person'
  } finally {
    savingNewUser.value = false
  }
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
                  ? isSuperAdmin
                    ? 'Built-in role: the code matrix is the default; your changes are recorded as super-admin overrides (revoke wins) and mirrored to Directus.'
                    : 'Built-in roles are governed by role-matrix.ts in code — read-only here. A super admin can adjust them.'
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
                        isGranted(collection, action)
                          ? 'i-lucide-check'
                          : 'i-lucide-minus'
                      "
                      :color="isGranted(collection, action) ? 'success' : 'neutral'"
                      variant="ghost"
                      size="xs"
                      :disabled="!canEditRole"
                      :aria-label="grantTitle(collection, action)"
                      :title="grantTitle(collection, action)"
                      @click="togglePermission(collection, action)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-if="canEditRole"
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
                  :key="`${perm.collection}:${perm.action}`"
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
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="font-semibold">People</h2>
            <UButton
              label="Add person"
              icon="i-lucide-user-plus"
              size="xs"
              class="ml-auto"
              @click="openAdder()"
            />
          </div>
          <p class="mt-1 text-sm text-gray-500">
            Everyone holding a system role, plus an option to add a new person with a
            permission level and coverage. Scope links (area / zone / branch) decide which
            rows they see.
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
        <div v-if="usersPending || peopleLookupsPending" class="flex justify-center py-8">
          <UIcon
            name="i-lucide-loader-circle"
            class="size-6 animate-spin text-gray-400"
          />
        </div>
        <p
          v-else-if="users.length > 0 && userSearch.trim() === ''"
          class="mt-3 text-xs text-gray-500"
        >
          Showing all {{ users.length }}
          {{ users.length === 1 ? 'person' : 'people' }} with a system role — search
          narrows by name or email.
        </p>
        <div
          v-if="!usersPending && !peopleLookupsPending && users.length > 0"
          class="mt-4 overflow-x-auto"
        >
          <table class="min-w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wide text-gray-500">
                <th class="px-3 py-2 font-medium">Person</th>
                <th class="px-3 py-2 font-medium">Role</th>
                <th class="px-3 py-2 font-medium">Coverage</th>
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
                <td class="px-3 py-2 text-gray-500">{{ coverageLabel(user) }}</td>
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

      <UModal
        :open="adding"
        title="Add person"
        description="Invite a new person and decide their permission level and coverage. They receive a set-password email."
        @update:open="adding = $event"
      >
        <template #body>
          <div class="grid gap-3">
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="First name">
                <UInput v-model="addForm.first_name" placeholder="Ada" class="w-full" />
              </UFormField>
              <UFormField label="Last name">
                <UInput v-model="addForm.last_name" placeholder="Okafor" class="w-full" />
              </UFormField>
            </div>
            <UFormField label="Email">
              <UInput
                v-model="addForm.email"
                type="email"
                placeholder="ada@example.org"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Permission level (staff role)">
              <USelect v-model="addForm.staff_role" :items="roleOptions" class="w-full" />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="Area coverage">
                <EntitySelect
                  v-model="addForm.area"
                  :items="areaItems"
                  placeholder="No area"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Zone coverage">
                <EntitySelect
                  v-model="addForm.zone"
                  :items="zoneItems"
                  placeholder="No zone"
                  class="w-full"
                />
              </UFormField>
            </div>
            <UFormField label="Branch coverage">
              <EntitySelect
                v-model="addForm.branch"
                :items="branchItems"
                placeholder="No branch"
                class="w-full"
              />
            </UFormField>
            <div class="grid gap-3 sm:grid-cols-2">
              <UFormField label="AVS coverage">
                <EntitySelect
                  v-model="addForm.avs_location"
                  :items="avsItems"
                  placeholder="No AVS centre"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="BSC coverage">
                <EntitySelect
                  v-model="addForm.bsc"
                  :items="bscItems"
                  placeholder="No BSC"
                  class="w-full"
                />
              </UFormField>
            </div>
            <p class="text-xs text-gray-500">
              AVS and BSC coverage resolve to the parent branch scope
              <span v-if="addBranchPreview" class="font-mono"
                >({{ addBranchPreview }})</span
              >. Area link follows the branch automatically.
            </p>
            <div>
              <h3 class="text-sm font-semibold">Modules included</h3>
              <p class="mt-1 text-xs text-gray-500">
                Derived from the permission level — nothing extra to store.
              </p>
              <div v-if="addModules.length > 0" class="mt-2 flex flex-wrap gap-1.5">
                <UBadge
                  v-for="module in addModules"
                  :key="module.key"
                  color="primary"
                  variant="subtle"
                  size="xs"
                >
                  {{ module.label }}
                </UBadge>
              </div>
              <p v-else class="mt-1 text-xs text-gray-400">
                Pick a permission level to preview its modules.
              </p>
            </div>
            <p v-if="addError !== ''" class="text-xs text-red-600">{{ addError }}</p>
            <div class="flex justify-end gap-2">
              <UButton
                label="Cancel"
                color="neutral"
                variant="ghost"
                @click="adding = false"
              />
              <UButton
                label="Send invite"
                icon="i-lucide-mail-plus"
                :loading="savingNewUser"
                :disabled="addCoverageConflict"
                @click="createUser()"
              />
            </div>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>
