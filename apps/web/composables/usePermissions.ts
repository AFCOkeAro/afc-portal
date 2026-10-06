import type { CapabilitiesPayload, CollectionName, PermissionAction } from '@afc/shared'
import { grantFor, hasCapability, readableCollections, scopeOf } from '@afc/shared'

/**
 * `usePermissions` — what this session may do, as capabilities.
 *
 * The role never reaches the browser. `/api/me/permissions` returns the grant
 * list the server derived from the session, and this composable answers
 * questions about it. data-model §13 rule 7 requires exactly that shape, and it
 * is also what makes a change of governance layer a deployment change.
 *
 * WHAT THESE ANSWERS ARE NOT
 *   They are navigation and field visibility. data-model §9 is explicit that
 *   "the server-side Directus policy is the only authoritative control", and that
 *   a frontend check is defence in depth. Nothing here may be treated as a
 *   reason to skip a server-side check — `hiddenFields` in particular tells the
 *   UI what to leave out of a form, while the Directus policy `fields` list is
 *   what actually withholds it from the response.
 */

const EMPTY: CapabilitiesPayload = {
  grants: [],
  readable: [],
  writable: [],
  hiddenFields: {},
  scoped: false,
}

export function usePermissions() {
  const payload = useState<CapabilitiesPayload | null>('afc:permissions', () => null)
  const loaded = useState<boolean>('afc:permissions:loaded', () => false)

  const api = useApi()

  /**
   * Fetch the capability list once per request. Called from the auth guard, so
   * the guard and the navigation agree by construction rather than by both
   * happening to query the same thing.
   */
  async function load(force = false): Promise<CapabilitiesPayload> {
    if (loaded.value && !force && payload.value) return payload.value
    const next = await api.get<CapabilitiesPayload>('/api/me/permissions')
    payload.value = next
    loaded.value = true
    return next
  }

  function reset(): void {
    payload.value = null
    loaded.value = false
  }

  const grants = computed(() => payload.value?.grants ?? [])
  const readable = computed(() => payload.value?.readable ?? [])
  const writable = computed(() => payload.value?.writable ?? [])
  const scoped = computed(() => payload.value?.scoped ?? false)

  function can(collection: CollectionName, action: PermissionAction): boolean {
    return hasCapability(grants.value, collection, action)
  }

  function canAny(
    pairs: ReadonlyArray<readonly [CollectionName, PermissionAction]>,
  ): boolean {
    return pairs.some(([collection, action]) => can(collection, action))
  }

  function scopeFor(
    collection: CollectionName,
    action: PermissionAction,
  ): ReturnType<typeof scopeOf> {
    return scopeOf(grants.value, collection, action)
  }

  function grantOf(collection: CollectionName, action: PermissionAction) {
    return grantFor(grants.value, collection, action)
  }

  /**
   * Fields this session must not be shown, for one collection (data-model §10.1).
   * Read by forms and by list column definitions so a restricted field is never
   * rendered even when the row contains it.
   */
  function hiddenFields(collection: CollectionName): string[] {
    return payload.value?.hiddenFields?.[collection] ?? []
  }

  function isFieldVisible(collection: CollectionName, field: string): boolean {
    return !hiddenFields(collection).includes(field)
  }

  /**
   * The restricted fields, formatted for display.
   *
   * Formatting lives here rather than in the component so that the shape of the
   * payload is walked in one place. A component reaching into
   * `hiddenFields` and rebuilding a label from it is a component that has to be
   * changed if the payload shape does.
   */
  function hiddenFieldGroups(): string[] {
    const groups = payload.value?.hiddenFields ?? {}
    return Object.entries(groups).map(
      ([collection, fields]) => `${collection}: ${fields.join(', ')}`,
    )
  }

  return {
    payload: computed(() => payload.value ?? EMPTY),
    grants,
    readable,
    writable,
    scoped,
    load,
    reset,
    can,
    canAny,
    scopeFor,
    grantOf,
    hiddenFields,
    isFieldVisible,
    hiddenFieldGroups,
    readableCollections,
  }
}
