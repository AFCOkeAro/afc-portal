/**
 * Resolve hook for the visitor-intake contract test (AFC-907).
 *
 * The shared schemas use Nuxt-idiomatic extensionless relative imports
 * (`from './common'`), which Node's type stripping cannot resolve on its
 * own. This hook maps an extensionless relative specifier to its `.ts`
 * file when the importer lives under packages/shared/src, so the test
 * imports the real schema modules instead of mirrors. Anything else
 * resolves normally.
 */
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { existsSync } from 'node:fs'

export async function resolve(specifier, context, next) {
  if (
    (specifier === './common' || specifier === '../common') &&
    context.parentURL?.includes('/packages/shared/src/')
  ) {
    const parentPath = fileURLToPath(context.parentURL)
    const target = path.join(path.dirname(parentPath), 'common.ts')
    if (existsSync(target)) {
      return { url: pathToFileURL(target).href, shortCircuit: true }
    }
  }
  return next(specifier, context)
}
