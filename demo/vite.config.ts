import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { resolve } from 'path'
import { readFileSync } from 'fs'

// Read the current package version at build time so the demo never
// drifts from what's actually published on npm.
const pkgJson = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as {
  version: string
}

// HTML-side sibling of the JS-side `__IMROBOT_VERSION__` define. Both
// index.html (hero badge) and docs.html (topnav badge) reference the
// version via a `%IMROBOT_VERSION%` marker; this plugin swaps the marker
// for the current root package.json version at build (and dev-serve)
// time. Follow-up to PR #126, which fixed the JS/AI-prompt side only.
const injectVersionPlugin: Plugin = {
  name: 'imrobot-inject-version',
  transformIndexHtml(html: string): string {
    return html.replace(/%IMROBOT_VERSION%/g, pkgJson.version)
  },
}

export default defineConfig({
  plugins: [injectVersionPlugin],
  define: {
    // Injected at build time. Referenced in demo/src/main.ts via a
    // matching `declare const __IMROBOT_VERSION__: string`.
    __IMROBOT_VERSION__: JSON.stringify(pkgJson.version),
  },
  resolve: {
    alias: {
      imrobot: resolve(__dirname, '../src'),
      'imrobot/core': resolve(__dirname, '../src/core'),
      'imrobot/server': resolve(__dirname, '../src/server'),
      'imrobot/web-component': resolve(__dirname, '../src/web-component'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        docs: resolve(__dirname, 'docs.html'),
      },
    },
  },
})
