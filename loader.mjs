import { existsSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const vitestShimURL = pathToFileURL(join(process.cwd(), 'vitest-shim.mjs')).href

export async function resolve(specifier, context, nextResolve) {
  // Intercept vitest imports → redirect to our shim
  if (specifier === 'vitest') {
    return { url: vitestShimURL, shortCircuit: true }
  }

  // Handle extensionless .ts imports
  if (
    (specifier.startsWith('.') || specifier.startsWith('/')) &&
    !extname(specifier)
  ) {
    const parentDir = context.parentURL
      ? dirname(fileURLToPath(context.parentURL))
      : process.cwd()

    for (const suffix of ['.ts', '/index.ts']) {
      const candidate = join(parentDir, specifier + suffix)
      if (existsSync(candidate)) {
        return nextResolve(pathToFileURL(candidate).href, context)
      }
    }
  }
  return nextResolve(specifier, context)
}
