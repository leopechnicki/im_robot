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
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
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
  const code = js.code
    .replace(
      /from 'svelte\/internal\/client'/g,
      `from '${fileUrl(join(svelteSrc, 'internal', 'client', 'index.js'))}'`,
    )
    .replace(
      /from 'svelte\/internal\/disclose-version'/g,
      `from '${fileUrl(join(svelteSrc, 'internal', 'disclose-version.js'))}'`,
    )
    .replace(/from '\.\.\/(core\/index|styles|screenshot-shield)'/g, (_m, mod: string) => {
      const file =
        mod === 'core/index'
          ? join(root, 'src', 'core', 'index.ts')
          : join(root, 'src', `${mod}.ts`)
      return `from '${file.split('\\').join('/')}'`
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
