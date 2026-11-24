/**
 * Svelte 5 client mount (consumer smoke 2026-11-24).
 *
 * imrobot 0.8.0 crashed on mount with `effect_update_depth_exceeded`: the
 * $effect called startCountdown(), which read and then wrote the
 * `countdownTimer` $state, so the effect re-ran itself forever.
 *
 * The component is compiled with svelte/compiler at test time (no Vite
 * plugin in this repo) and mounted with the client
 * runtime in jsdom. The compiled module goes to test/.svelte-compiled/
 * (gitignored, inside the Vite root so its TypeScript imports are
 * transformed) and is deleted afterwards.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compile } from 'svelte/compiler'

const root = resolve(__dirname, '..')
const outDir = join(root, 'test', '.svelte-compiled', String(process.pid))
const svelteSrc = join(root, 'node_modules', 'svelte', 'src')

function fileUrl(p: string): string {
  return pathToFileURL(p).href
}

async function loadComponent() {
  const source = readFileSync(join(root, 'src', 'svelte', 'ImRobot.svelte'), 'utf-8')
  const { js } = compile(source, { generate: 'client', filename: 'ImRobot.svelte' })
  // Rewrite every import specifier to something this test can load:
  // svelte runtime entries -> the client build in node_modules (loaded by
  // Node), relative imports -> the TypeScript source (transformed by Vite).
  // Anything else fails loudly instead of with an obscure resolve error.
  const svelteEntries: Record<string, string> = {
    'svelte/internal/client': join(svelteSrc, 'internal', 'client', 'index.js'),
    'svelte/internal/disclose-version': join(svelteSrc, 'internal', 'disclose-version.js'),
    'svelte/internal/flags/legacy': join(svelteSrc, 'internal', 'flags', 'legacy.js'),
  }
  const componentDir = join(root, 'src', 'svelte')
  const code = js.code.replace(/(from |import )'([^']+)'/g, (_m, kw: string, spec: string) => {
    if (spec in svelteEntries) return `${kw}'${fileUrl(svelteEntries[spec])}'`
    if (spec.startsWith('.')) {
      const base = resolve(componentDir, spec)
      const file = ['.ts', '.tsx', '.js', '/index.ts']
        .map((ext) => base + ext)
        .find((f) => existsSync(f))
      if (!file) throw new Error(`svelte.test: cannot resolve ${spec} from ImRobot.svelte`)
      return `${kw}'${file.split('\\').join('/')}'`
    }
    throw new Error(`svelte.test: unexpected import '${spec}' in compiled ImRobot.svelte`)
  })
  mkdirSync(outDir, { recursive: true })
  const outFile = join(outDir, 'ImRobot.compiled.js')
  writeFileSync(outFile, code)
  const mod = await import(/* @vite-ignore */ outFile.split('\\').join('/'))
  const runtime = await import(/* @vite-ignore */ fileUrl(join(svelteSrc, 'index-client.js')))
  return {
    Component: mod.default,
    mount: runtime.mount,
    unmount: runtime.unmount,
    flushSync: runtime.flushSync,
  }
}

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  const parent = join(outDir, '..')
  if (existsSync(parent) && readdirSync(parent).length === 0) rmSync(parent, { recursive: true })
})

describe('Svelte 5 widget', () => {
  it('mounts, renders a challenge and unmounts without an effect loop', async () => {
    const { Component, mount, unmount, flushSync } = await loadComponent()
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(Component, { target, props: { difficulty: 'easy' } })
    flushSync()
    const el = target.querySelector('[data-imrobot-challenge]')
    expect(el).not.toBeNull()
    expect(JSON.parse(el!.getAttribute('data-imrobot-challenge')!).difficulty).toBe('easy')
    unmount(app)
    target.remove()
  })

  it('declares the Svelte 5 peer range the runes component needs', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
    expect(pkg.peerDependencies.svelte).toBe('>=5.0.0')
  })
})
