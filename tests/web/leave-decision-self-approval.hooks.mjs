/**
 * Loader hooks for the AFC-1067 leave self-approval regression test.
 *
 * The route under test imports `@afc/shared` (workspace root pulls the full
 * shared index with extensionless imports, not resolvable from plain node)
 * plus `../../utils/portal` (pulls the Directus client) and
 * `../../utils/office`. All three are redirected to the side-effect-free
 * stub beside this file so the test executes the real handler.
 */

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === '@afc/shared' ||
    specifier === '../../utils/portal' ||
    specifier === '../../utils/office'
  ) {
    return {
      url: new URL('./leave-decision-self-approval.stubs.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}
