import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Follow-up to PR #126 — the JS-side AI-prompt version was already switched
// to build-time injection via Vite's `define` (`__IMROBOT_VERSION__` in
// demo/src/main.ts). But two HTML-rendered version badges were still
// hard-coded v0.6.0:
//   - demo/index.html hero badge  (Open Source · v0.6.0)
//   - demo/docs.html  topnav badge (v0.6.0)
// This suite locks in that:
//   1. Neither HTML file contains any hard-coded stale version string.
//   2. Both files carry the %IMROBOT_VERSION% placeholder that vite's
//      transformIndexHtml plugin replaces at build time from the root
//      package.json (single source of truth — same as the JS-side fix).
// ---------------------------------------------------------------------------

const repoRoot = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8')) as {
  version: string
}

const indexHtml = readFileSync(resolve(repoRoot, 'demo/index.html'), 'utf-8')
const docsHtml = readFileSync(resolve(repoRoot, 'demo/docs.html'), 'utf-8')

describe('demo HTML version badges (regression for PR #126 follow-up)', () => {
  it('root package.json has a semver version', () => {
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('demo/index.html hero badge uses the %IMROBOT_VERSION% placeholder', () => {
    // Locate the hero badge block — the marker text lives inside `.hero-badge`.
    const heroBadgeMatch = indexHtml.match(/<div class="hero-badge">[\s\S]*?<\/div>/)
    expect(heroBadgeMatch).not.toBeNull()
    const heroBadge = heroBadgeMatch![0]
    expect(heroBadge).toContain('%IMROBOT_VERSION%')
  })

  it('demo/docs.html topnav badge uses the %IMROBOT_VERSION% placeholder', () => {
    const topnavBadgeMatch = docsHtml.match(/<span class="topnav-badge">[^<]*<\/span>/)
    expect(topnavBadgeMatch).not.toBeNull()
    expect(topnavBadgeMatch![0]).toContain('%IMROBOT_VERSION%')
  })

  it('demo/index.html contains no hard-coded stale semver in the hero badge', () => {
    const heroBadge = indexHtml.match(/<div class="hero-badge">[\s\S]*?<\/div>/)![0]
    // No literal `vX.Y.Z` inside the badge — only the placeholder.
    expect(heroBadge).not.toMatch(/v\d+\.\d+\.\d+/)
  })

  it('demo/docs.html contains no hard-coded stale semver in the topnav badge', () => {
    const topnavBadge = docsHtml.match(/<span class="topnav-badge">[^<]*<\/span>/)![0]
    expect(topnavBadge).not.toMatch(/v\d+\.\d+\.\d+/)
  })

  it('vite plugin substitutes %IMROBOT_VERSION% with the current package version', async () => {
    // Load the demo vite config and pull out our injectVersionPlugin.
    // The plugin's `transformIndexHtml` hook is what Vite runs on
    // index.html + docs.html during dev-serve and build. This test
    // exercises it directly, mirroring how Vite invokes it.
    const configModule = await import(resolve(repoRoot, 'demo/vite.config.ts'))
    // defineConfig returns the config object or a function; unwrap.
    const rawConfig =
      typeof configModule.default === 'function'
        ? configModule.default({ command: 'build', mode: 'production' })
        : configModule.default
    const config = await rawConfig
    const plugins = Array.isArray(config.plugins) ? config.plugins : []
    const injectPlugin = plugins.find(
      (p: unknown): p is { name: string; transformIndexHtml: (html: string) => string } =>
        !!p && typeof p === 'object' && (p as { name?: string }).name === 'imrobot-inject-version',
    )
    expect(injectPlugin).toBeTruthy()

    const sampleHtml = `<html><body>
      <div class="hero-badge">Open Source &middot; v%IMROBOT_VERSION%</div>
      <span class="topnav-badge">v%IMROBOT_VERSION%</span>
    </body></html>`
    const transformed = injectPlugin!.transformIndexHtml(sampleHtml)
    expect(transformed).toContain(`v${pkg.version}`)
    expect(transformed).not.toContain('%IMROBOT_VERSION%')
    // Both occurrences must be replaced (global replace).
    const heroMatch = transformed.match(/<div class="hero-badge">[^<]*<\/div>/)
    const topnavMatch = transformed.match(/<span class="topnav-badge">[^<]*<\/span>/)
    expect(heroMatch![0]).toContain(`v${pkg.version}`)
    expect(topnavMatch![0]).toContain(`v${pkg.version}`)
  })
})
