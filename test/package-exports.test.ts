import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Consumer smoke 2026-11-24: with `moduleResolution: "node"` (node10, which
// Next.js 15 still writes into a fresh tsconfig) TypeScript ignores
// `exports`, so `import 'imrobot/next'` had no types and `next build` failed.
// `typesVersions` must map every typed subpath to the same .d.ts as `exports`.
const pkg = JSON.parse(readFileSync(join(resolve(__dirname, '..'), 'package.json'), 'utf-8'))

describe('package.json typesVersions', () => {
  const typed = Object.entries(pkg.exports as Record<string, Record<string, string>>).filter(
    ([sub, cond]) => sub !== '.' && typeof cond.types === 'string',
  )

  it('has at least the server, next and hono subpaths', () => {
    const subs = typed.map(([sub]) => sub)
    expect(subs).toEqual(expect.arrayContaining(['./server', './next', './hono', './core']))
  })

  it.each(typed)('maps %s to the same declaration file as exports', (sub, cond) => {
    const map = pkg.typesVersions?.['*'] ?? {}
    expect(map[sub.slice(2)]).toEqual([cond.types])
  })
})
