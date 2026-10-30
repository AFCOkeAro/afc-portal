/**
 * `@afc/shared` — the single import surface for the portal's types and schemas.
 *
 * Imported by `apps/web` for the frontend forms and by the server routes for
 * the API contracts, so a change to a field name is a change in one file and a
 * compile error in every consumer. `packages/shared` is a workspace package, not
 * a folder: the Nuxt app resolves it through the pnpm workspace link and
 * transpiles it from source, which is why there is no build step here.
 *
 * Note for the gates: `retention-literal-gate.sh` and
 * `awareness-write-context-gate.sh` both scan `packages/**`, so this tree is in
 * scope for both. Nothing in it may name a retention period or the breach clock
 * column.
 */

export * from './auth'
export * from './collections'
export * from './permissions'
export * from './schemas'
export * from './types'
export * from './office-feed'
export * from './leave'
export * from './markdown'
export * from './message-tokens'
export * from './custom-form-definition'
export * from './minutes-samples'
export * from './impersonation'

/**
 * `role-matrix` is deliberately NOT re-exported from here.
 *
 * It is the only module that knows a role name, and data-model §13 rule 7 says
 * the UI must not. Excluding it from the barrel makes the client import
 * impossible by accident; the server routes import it by its explicit path.
 *
 *   import { capabilitiesForRole } from '@afc/shared/role-matrix'
 */
