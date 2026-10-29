/**
 * Resolve hook for the trigger-chain contract test (AFC-868).
 *
 * The portal source uses Nuxt-idiomatic extensionless relative imports
 * (`from './campaign-tick'`), which Node's type stripping cannot resolve
 * on its own. This hook maps exactly one specifier — the campaign-tick
 * import inside trigger-chain.ts — to its `.ts` file so the test imports
 * the real modules instead of mirrors. Anything else resolves normally.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

export async function resolve(specifier, context, next) {
  if (
    specifier === './campaign-tick' &&
    context.parentURL?.endsWith('trigger-chain.ts')
  ) {
    const parentPath = fileURLToPath(context.parentURL)
    const target = path.join(path.dirname(parentPath), 'campaign-tick.ts')
    return { url: pathToFileURL(target).href, shortCircuit: true }
  }
  return next(specifier, context)
}
