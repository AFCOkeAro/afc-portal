/**
 * Loader hooks for the AFC-501 record-transition regression test.
 *
 * The route under test imports `@afc/shared/weca` (workspace alias, not
 * resolvable from plain node) and `../../../utils/portal` (pulls in the
 * Directus client). Both are redirected to the side-effect-free stub
 * beside this file so the test executes the real handler.
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@afc/shared/weca' || specifier === '../../../utils/portal') {
    return {
      url: new URL('./weca-record-transition.stubs.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}
